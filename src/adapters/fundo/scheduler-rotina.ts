import type { Executor } from "../../contracts/evento.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { passoDoAgendador, type RelogioDoAgendador } from "../../domain/presenca.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { dispararRotina } from "../../use-cases/disparar-rotina.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { logarTickLento, paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: tick a cada 30 s — o cron tem granularidade de minuto e o Grok Bot promete "em até um minuto". */
export const INTERVALO_SCHEDULER_MS = 30_000;

/** definido em 2026-10-16 (NOD-271): a tx de uma rotina acima disto vai para o log — o tick inteiro tem 30 s. */
const LIMIAR_TX_LENTA_MS = 2_000;

export type OpcoesTick = {
  machineId: string;
  executor: Executor;
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
  /** O "A fazer" ligado (NOD_PENDENCIAS=1); ausente = desligado (ver dispararRotina). */
  aFazer?: boolean;
};

/**
 * `adiadas` (definido em 2026-10-16, NOD-243): a execução anterior (ou a frente dela) ainda estava aberta — a janela
 * vira uma execução 'adiada' no histórico e a rotina é reagendada (antes: `puladas`, sem rastro).
 * `bloqueadas` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou a janela sem turno.
 * `semPendencia` (definido em 2026-10-01, item 7 da ADR-066): rotina que só acorda com pendência, sem nenhuma — a
 * janela passou sem turno e sem custo.
 */
export type ResultadoTick = { disparadas: string[]; deOutroProcesso: string[]; adiadas: string[]; bloqueadas: string[]; semPendencia: string[]; falhas: string[] };

/**
 * Um tick para UMA pessoa (o teste chama isto sob withRollback com `tx = (fn) => fn(trx)`): lista
 * as rotinas ativas vencidas numa tx, e dispara cada uma na SUA tx — uma rotina que falha
 * (cron sem futuro ao reagendar, agente sumido) não derruba as outras nem a janela delas.
 * `false` na reivindicação é outro processo, silencioso (E7.6). Só aqui se avalia cron (ADR-011).
 */
export async function tickPessoa(escopo: Escopo, tx: Transacao, opcoes: OpcoesTick): Promise<ResultadoTick> {
  const agora = opcoes.agora();
  const resultado: ResultadoTick = { disparadas: [], deOutroProcesso: [], adiadas: [], bloqueadas: [], semPendencia: [], falhas: [] };
  const vencidas = await tx(async (trx) => criarRepos(trx, escopo).rotinas.ativasVencidas(agora));
  for (const rotina of vencidas) {
    const inicioTx = Date.now();
    try {
      await tx(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
        const r = await dispararRotina(deps, { rotina, instanteAgendado: rotina.proximaExecucao, machineId: opcoes.machineId, executor: opcoes.executor, aFazer: opcoes.aFazer });
        if ("janelaDeOutro" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.deOutroProcesso.push(rotina.id);
          // NOD-271: a janela já usada reagenda a rotina — sem isto ela voltava vencida a cada tick.
          if (r.data.proximaExecucao !== undefined) log("info", "rotina_janela_ja_usada", { rotina_id: rotina.id, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // NOD-243: a execução 'adiada' (e o aviso na 3ª seguida) e os eventos vão juntos nesta tx.
        if ("adiada" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.adiadas.push(rotina.id);
          log("aviso", "rotina_adiada", { rotina_id: rotina.id, motivo: r.data.adiada, turno_aberto_id: r.data.turnoAbertoId, trabalho_aberto_id: r.data.trabalhoAbertoId ?? null, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // Sem turno e sem crédito gasto: a execução 'bloqueada', o card e o evento vão juntos nesta tx.
        if ("bloqueada" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.bloqueadas.push(rotina.id);
          log("info", "rotina_bloqueada", { rotina_id: rotina.id, motivo: r.data.bloqueada, proposta_id: r.data.propostaId, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // Sem pendência visível: sem turno e sem crédito gasto; a execução 'sem_novidade' e o evento do histórico vão nesta tx.
        if ("semPendencia" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.semPendencia.push(rotina.id);
          log("info", "rotina_sem_pendencia", { rotina_id: rotina.id, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        await repos.events.gravarComOutbox(r.events ?? []);
        resultado.disparadas.push(rotina.id);
        log("info", "rotina_disparada", { rotina_id: rotina.id, turno_id: r.data.turno.id, instante_agendado: rotina.proximaExecucao, atraso_ms: agora - rotina.proximaExecucao });
      });
    } catch (e) {
      resultado.falhas.push(rotina.id);
      log("erro", "rotina_disparo_falhou", { rotina_id: rotina.id, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    } finally {
      // NOD-271: quanto a tx de UMA rotina segurou o tick (o pré-voo e a busca da execução aberta moram aqui).
      const ms = Date.now() - inicioTx;
      if (ms >= LIMIAR_TX_LENTA_MS) log("aviso", "rotina_tx_ms", { rotina_id: rotina.id, ms });
    }
  }
  return resultado;
}

/** Um tick para todas as pessoas (paraCadaPessoa: uma tx real por pessoa; escopo obrigatório). */
export async function tick(db: Db, opcoes: OpcoesTick, laco: OpcoesLaco = {}): Promise<void> {
  await paraCadaPessoa(db, (escopo, tx) => tickPessoa(escopo, tx, opcoes).then(() => undefined), laco);
}

/**
 * Laço do servidor (boot da L9): um tick por intervalo, nunca dois sobrepostos, erro logado sem derrubar.
 * definido em 2026-09-24 (ADR-045): o relógio que salta mais de 3 intervalos entre dois ticks é o Mac
 * que acordou (o processo ficou suspenso); o laço espera 3 min antes de disparar, para uma rotina não
 * nascer num "dark wake" de segundos e morrer no sono seguinte. Corta a cadeia na origem.
 * definido em 2026-10-15 (NOD-267): `aoBater` ao TERMINAR cada tick (sucesso ou erro) e no tick que só espera a
 * ADR-045 — o tick pulado por `rodando` não bate: é o laço preso que a saúde precisa ver.
 */
export function iniciarScheduler(db: Db, opcoes: OpcoesTick & { intervaloMs?: number; aoBater?: () => void }, laco: OpcoesLaco = {}): { parar(): void } {
  let rodando = false;
  let relogio: RelogioDoAgendador = { ultimoTick: null, esperarAte: 0 };
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_SCHEDULER_MS;
  const timer = setInterval(() => {
    // O relógio anda a cada disparo do timer, mesmo com um tick ainda rodando: um tick longo não é sono.
    const passo = passoDoAgendador(relogio, opcoes.agora(), intervaloMs);
    relogio = passo.estado;
    if (passo.paradoMs !== null) log("aviso", "processo_acordou", { parado_ms: passo.paradoMs, espera_ms: relogio.esperarAte - (relogio.ultimoTick ?? 0) });
    if (rodando) return;
    if (!passo.disparar) {
      opcoes.aoBater?.();
      return;
    }
    rodando = true;
    const inicio = opcoes.agora();
    tick(db, opcoes, laco)
      .catch((e: unknown) => log("erro", "scheduler_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        rodando = false;
        logarTickLento("agendador", opcoes.agora() - inicio, intervaloMs);
        opcoes.aoBater?.();
      });
  }, intervaloMs);
  timer.unref();
  return { parar: () => clearInterval(timer) };
}
