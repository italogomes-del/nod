import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { AnuncioMaquina, Entrega, PonteInterna } from "../../contracts/ponte.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../contracts/turno.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { SINAIS_ZERADOS } from "../../domain/stream-json.ts";
import { log } from "../../obs/log.ts";
import { INATIVIDADE_TURNO_MS, ISENCAO_FERRAMENTA_MS, RENOVACAO_MS, TEXTO_ENTREGA_MAX_CHARS, VERIFICACAO_INATIVIDADE_MS } from "../../shared/constantes.ts";
import type { Relogio } from "../../shared/types.ts";
import type { Adapter, IdDriver, Registry } from "./spi.ts";

/**
 * Laço puxar → rodar → renovar → entregar (ADR-021: o app puxa, o servidor nunca disca) sobre uma
 * PonteInterna injetada — in-process nesta rodada, HTTP depois sem trocar o driver. Sinais viajam
 * a cada renovação (ADR-009); {ativo:false} manda interromper; entregar é UMA vez por turno;
 * exceção no turno vira Entrega, nunca derruba o processo (ADR-012 sombra, ADR-029 renderizado).
 */
export type OpcoesLaco = {
  ponte: PonteInterna;
  registry: Registry;
  pessoaId: string;
  machineId: string;
  relogio: Relogio;
  /** Se presente, conectar() no início e desconectar() em parar(). */
  anuncio?: Omit<AnuncioMaquina, "machineId">;
  /** definido em 2026-09-16: 1 s + jitter de até 300 ms quando puxar devolve null (evita batida síncrona de várias máquinas). */
  esperaVaziaMs?: number;
  jitterMs?: number;
  renovacaoMs?: number;
  /** Janela de silêncio que caracteriza turno travado; injetável para o teste não esperar 5 min. */
  inatividadeMs?: number;
  verificacaoInatividadeMs?: number;
  isencaoFerramentaMs?: number;
  /** Deltas são efêmeros: vão direto ao barramento (L8), nunca pelo outbox. */
  aoDelta?: (plano: PlanoTurno, texto: string) => void;
  /** Cada EventoStream interpretado, para quem persiste (catcher_registros, trilha) sem passar pela ponte. */
  aoEvento?: (plano: PlanoTurno, ev: EventoStream) => void;
  /**
   * definido em 2026-09-16 (composição L9): o adapter do turno é registrado no interruptor ANTES de rodar
   * (Parar → SIGTERM em < 2 s, E5.4) e solto ao terminar; sem isto Parar só chegaria pela renovação de lease.
   */
  aoIniciarTurno?: (plano: PlanoTurno, adapter: Adapter) => void;
  aoTerminarTurno?: (plano: PlanoTurno) => void;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
};

export type Laco = {
  parar(): Promise<void>;
  /** Turno em curso (null entre turnos). */
  turnoAtual(): string | null;
};

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TOKENS_ZERADOS = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

/** Resultado sintético para quando o adapter não devolveu um (exceção ou driver em sombra). */
export function resultadoDeExcecao(erro: unknown, sinais: SinaisTurno, texto = ""): ResultadoTurno {
  const base = { texto, sessaoCli: null, sinais, custoUsd: null, tokens: TOKENS_ZERADOS, ferramentasChamadas: [], negacoesPermissao: [] };
  if (ehErroDeDominio(erro) && erro.codigo === "executor_indisponivel") return { desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", ...base };
  return { desfecho: "falha", motivoFalha: "erro_execucao", ...base };
}

/**
 * Corta o texto em `max` caracteres CONTANDO o marcador, que diz quanto ficou de fora. A rota da
 * máquina recusa a Entrega inteira acima de TEXTO_ENTREGA_MAX_CHARS — e aí o turno nunca assentava.
 */
export function cortarTexto(texto: string, max = TEXTO_ENTREGA_MAX_CHARS): string {
  if (texto.length <= max) return texto;
  const marcador = (fora: number) => `\n[cortado pelo nod: ${fora} caracteres ficaram de fora]`;
  // O marcador com o comprimento total tem pelo menos tantos dígitos quanto o real: cabe sempre.
  let manter = Math.max(0, max - marcador(texto.length).length);
  // Não parte um par substituto (emoji) ao meio.
  const codigo = texto.charCodeAt(manter - 1);
  if (manter > 0 && codigo >= 0xd800 && codigo <= 0xdbff) manter -= 1;
  return texto.slice(0, manter) + marcador(texto.length - manter);
}

export function driverDoPlano(plano: PlanoTurno): IdDriver {
  return plano.executor === "catcher" ? "catcher" : plano.harness ?? "claude-cli";
}

export function iniciarLaco(o: OpcoesLaco): Laco {
  const dormir = o.dormir ?? dormirPadrao;
  const aleatorio = o.aleatorio ?? Math.random;
  const esperaVaziaMs = o.esperaVaziaMs ?? 1_000;
  const jitterMs = o.jitterMs ?? 300;
  const renovacaoMs = o.renovacaoMs ?? RENOVACAO_MS;
  const inatividadeMs = o.inatividadeMs ?? INATIVIDADE_TURNO_MS;
  const verificacaoInatividadeMs = o.verificacaoInatividadeMs ?? VERIFICACAO_INATIVIDADE_MS;
  const isencaoFerramentaMs = o.isencaoFerramentaMs ?? ISENCAO_FERRAMENTA_MS;
  let parado = false;
  let acordar: (() => void) | null = null;
  let adapterAtual: Adapter | null = null;
  let turnoAtual: string | null = null;
  let seqLocal = 0;

  async function esperar(ms: number): Promise<void> {
    await Promise.race([dormir(ms), new Promise<void>((r) => (acordar = r))]);
    acordar = null;
  }

  async function rodar(plano: PlanoTurno): Promise<void> {
    turnoAtual = plano.turnoId;
    let sinais: SinaisTurno = { ...SINAIS_ZERADOS };
    let entregue = false;
    let renovando: Promise<void> | null = null;
    let travado = false;

    const renovar = async (): Promise<void> => {
      if (entregue) return;
      if (renovando) return renovando;
      renovando = (async () => {
        try {
          const r = await o.ponte.renovar({ turnoId: plano.turnoId, machineId: o.machineId, sinais, eventos: [] });
          if (!r.ativo && adapterAtual) await adapterAtual.interromper();
        } catch (erro) {
          log("aviso", "laco_renovar_falhou", { turno_id: plano.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
        } finally {
          renovando = null;
        }
      })();
      return renovando;
    };
    const batida = setInterval(() => void renovar(), renovacaoMs);
    batida.unref?.();

    /**
     * Watchdog de ATIVIDADE (definido em 2026-09-18, no lugar do teto de passos). O lease prova que
     * o processo vive; este relógio pergunta se o agente progride. Uma chamada de ferramenta em
     * andamento é silêncio legítimo — computador_* leva até 240s e o proxy serializa as chamadas —
     * então tool_use sem tool_result isenta, com teto para um resultado perdido não isentar sempre.
     */
    let ultimaAtividade = o.relogio();
    let ferramentaAbertaDesde: number | null = null;
    const ferramentasAbertas = new Set<string>();
    const marcarAtividade = () => {
      ultimaAtividade = o.relogio();
    };
    const vigiar = () => {
      if (entregue || !adapterAtual) return;
      const agora = o.relogio();
      const isento = ferramentasAbertas.size > 0 && ferramentaAbertaDesde !== null && agora - ferramentaAbertaDesde < isencaoFerramentaMs;
      if (isento || agora - ultimaAtividade < inatividadeMs) return;
      travado = true;
      log("aviso", "turno_travado", { turno_id: plano.turnoId, mudo_ms: agora - ultimaAtividade, ferramentas_abertas: ferramentasAbertas.size });
      void adapterAtual.interromper();
    };
    const vigia = setInterval(vigiar, verificacaoInatividadeMs);
    vigia.unref?.();

    const entregar = async (bruto: ResultadoTurno): Promise<void> => {
      if (entregue) return;
      entregue = true;
      seqLocal += 1;
      const resultado = bruto.texto.length > TEXTO_ENTREGA_MAX_CHARS ? { ...bruto, texto: cortarTexto(bruto.texto) } : bruto;
      if (resultado !== bruto) log("aviso", "entrega_cortada", { turno_id: plano.turnoId, chars: bruto.texto.length, teto: TEXTO_ENTREGA_MAX_CHARS });
      const entrega: Entrega = {
        turnoId: plano.turnoId,
        machineId: o.machineId,
        seqLocal,
        fala: { tipo: "texto", texto: resultado.texto },
        resultado,
      };
      try {
        await o.ponte.entregar(entrega);
      } catch (erro) {
        log("erro", "laco_entregar_falhou", { turno_id: plano.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
      }
    };

    try {
      const registro = o.registry[driverDoPlano(plano)];
      if (!registro || registro.estado !== "pronto") {
        log("aviso", "laco_driver_em_sombra", { turno_id: plano.turnoId, driver: driverDoPlano(plano), motivo: registro?.motivo ?? "Harness não disponível neste computador" });
        await entregar({ ...resultadoDeExcecao(null, sinais), desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel" });
        return;
      }
      const adapter = registro.instance.adapter(plano);
      adapterAtual = adapter;
      o.aoIniciarTurno?.(plano, adapter);
      if (parado) await adapter.interromper();
      const resultado = await adapter.rodarTurno({
        async sinal(s) {
          sinais = { ...sinais, [s]: true };
          // ADR-009: o sinal viaja imediatamente quando o prompt foi submetido (a fronteira do "pode ter causado efeito").
          if (s === "promptSubmitted") await renovar();
        },
        evento(ev) {
          marcarAtividade();
          if (ev.tipo === "tool_use") {
            ferramentasAbertas.add(ev.id);
            ferramentaAbertaDesde ??= o.relogio();
          } else if (ev.tipo === "tool_result") {
            ferramentasAbertas.delete(ev.toolUseId);
            if (ferramentasAbertas.size === 0) ferramentaAbertaDesde = null;
          }
          o.aoEvento?.(plano, ev);
        },
        delta(texto) {
          marcarAtividade();
          o.aoDelta?.(plano, texto);
        },
      });
      // Interrompido por este watchdog: o classificador não sabe o motivo, quem sabe é quem matou.
      const comMotivo = travado && resultado.desfecho === "interrompido" && !resultado.motivoInterrupcao
        ? { ...resultado, motivoInterrupcao: "turno_travado" as const }
        : resultado;
      await entregar({ ...comMotivo, sinais: { ...resultado.sinais, ...sinais } });
    } catch (erro) {
      log("erro", "laco_turno_excecao", { turno_id: plano.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
      await entregar(resultadoDeExcecao(erro, sinais));
    } finally {
      clearInterval(batida);
      clearInterval(vigia);
      adapterAtual = null;
      turnoAtual = null;
      o.aoTerminarTurno?.(plano);
    }
  }

  const corrida = (async () => {
    if (o.anuncio) {
      try {
        await o.ponte.conectar({ ...o.anuncio, machineId: o.machineId });
      } catch (erro) {
        log("aviso", "laco_conectar_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" });
      }
    }
    while (!parado) {
      let plano: PlanoTurno | null = null;
      try {
        plano = await o.ponte.puxar(o.pessoaId);
      } catch (erro) {
        log("aviso", "laco_puxar_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" });
      }
      if (parado) break;
      if (!plano) {
        await esperar(esperaVaziaMs + Math.floor(aleatorio() * jitterMs));
        continue;
      }
      await rodar(plano);
    }
    if (o.anuncio) {
      try {
        await o.ponte.desconectar(o.machineId);
      } catch (erro) {
        log("aviso", "laco_desconectar_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" });
      }
    }
  })();

  return {
    turnoAtual: () => turnoAtual,
    async parar() {
      parado = true;
      acordar?.();
      if (adapterAtual) await adapterAtual.interromper();
      await corrida;
    },
  };
}
