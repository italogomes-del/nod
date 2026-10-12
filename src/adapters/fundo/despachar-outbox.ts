import type { EstadoDoDono } from "../../contracts/dono.ts";
import type { KindEvento } from "../../contracts/evento.ts";
import type { TipoFrame } from "../../contracts/frame.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Barramento } from "../../services/barramento.ts";
import { OUTBOX_IDADE_MIN_MS, OUTBOX_TETO_TENTATIVAS } from "../../shared/constantes.ts";
import { ouvirOutbox } from "../../shared/sinal-outbox.ts";
import { estadoDoDonoAgora } from "../../use-cases/estado-do-dono.ts";
import type { Conn, Db, Escopo, Relogio } from "../../shared/types.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/**
 * Despachante do outbox (ADR-010 refinado, Práticas §7): laço de fundo que, POR PESSOA e numa
 * transação real escopada (paraCadaPessoa), lê os itens pendentes de `events_outbox`, publica cada
 * um como frame no barramento da pessoa e marca entregue. Mora em src/adapters/fundo porque abre
 * transação (EMENDA 3); o barramento (src/services) não conhece banco.
 *
 * Semântica: pelo menos uma vez. O frame é publicado ANTES do commit do `entregue_em`; se a
 * transação cair no meio, o item sai de novo na próxima passada (o cliente deduplica por seq).
 * Falha ao publicar → `incrementarTentativa`. Abandono só com as DUAS condições (teto de tentativas
 * E idade mínima, constantes em src/shared/constantes.ts), varrido numa cadência menor que a do
 * despacho; abandonado é CONTADO na métrica `outbox_abandonados`, nunca apagado. Item cancelado
 * (Parar, E8.3) nunca sai: `pendentes()` já o exclui.
 */

/** Tabela TOTAL kind → frame: um kind fora dela é linha envenenada e segue o caminho de falha/abandono. */
export const FRAME_POR_EVENTO: Record<KindEvento, TipoFrame> = {
  mensagem_criada: "mensagem.nova",
  turno_criado: "turno.iniciado",
  turno_despachado: "turno.iniciado",
  turno_encerrado: "turno.encerrado",
  turno_interrompido: "turno.interrompido",
  decisao_criada: "decisao.nova",
  decisao_decidida: "decisao.decidida",
  decisao_vencida: "decisao.vencida",
  proposta_criada: "proposta.nova",
  rotina_criada: "rotina.criada",
  // definido em 2026-09-21: atualizar/excluir reusam o frame 'rotina.criada' porque ele só diz
  // "a lista de rotinas mudou" — o reducer invalida e reidrata por REST (web/estado/reducer.ts).
  // Frame novo exigiria caso novo no reducer para o mesmo efeito.
  rotina_atualizada: "rotina.criada",
  rotina_excluida: "rotina.criada",
  rotina_executou: "rotina.executou",
  // Mesmo frame de propósito: a execução silenciosa não escreve no chat, mas o painel de rotinas
  // precisa saber que ela rodou para o histórico aparecer sem recarregar a página.
  rotina_sem_novidade: "rotina.executou",
  // definido em 2026-09-24 (emenda da ADR-044): a janela bloqueada entra no histórico sem escrever no
  // chat — o mesmo frame faz a lista de rotinas e o histórico relerem, como a execução silenciosa.
  rotina_bloqueada: "rotina.executou",
  sala_handoff: "sala.handoff",
  negacao: "negacao",
  concessao_criada: "agente.mudou",
  agente_atualizado: "agente.mudou",
  parada: "parada.faixa",
  relato_criado: "relato.criado",
  ligacao_mudou: "ligacao.mudou",
  // definido em 2026-10-07 (ADR-083): o frame diz "os trabalhos deste bot mudaram"; a web relê por REST.
  trabalho_mudou: "trabalho.mudou",
  pressao_memoria: "memoria.mudou",
  // Telemetria das linhas (#191): gravada sem outbox, nunca vira frame. A chave existe porque a tabela é total; se uma
  // linha dessas cair no outbox por engano, o frame inofensivo "agente.mudou" só faz a web reler o bot.
  linha_mostrada: "agente.mudou",
  linha_aberta: "agente.mudou",
};

export function frameDoEvento(kind: string): TipoFrame {
  const tipo = Object.hasOwn(FRAME_POR_EVENTO, kind) ? FRAME_POR_EVENTO[kind as KindEvento] : undefined;
  if (!tipo) throw new ErroDeDominio("entrada_invalida", { cause: `kind de evento sem frame: ${kind}` });
  return tipo;
}

export type ResultadoPassada = { publicados: number; falhas: number; abandonadosAgora: number };

export interface OpcoesDespacho {
  agora?: Relogio;
  metricas?: Metricas;
  teto?: number;
  idadeMinMs?: number;
  /** Itens lidos por pessoa por passada (default do repo: 100). */
  limite?: number;
  /** Varre abandono e atualiza a métrica nesta passada (o laço faz isso a cada `abandonoACadaMs`). */
  varrerAbandono?: boolean;
}

/** Uma pessoa, uma conexão já escopada: é a unidade que os testes exercitam sob withRollback. */
export async function despacharPessoa(conn: Conn, escopo: Escopo, barramento: Barramento, opcoes: OpcoesDespacho = {}): Promise<ResultadoPassada> {
  const metricas = opcoes.metricas ?? registroPadrao;
  const agora = (opcoes.agora ?? Date.now)();
  const repos = criarRepos(conn, escopo);
  const resultado: ResultadoPassada = { publicados: 0, falhas: 0, abandonadosAgora: 0 };

  const donos = new Map<string, EstadoDoDono | null>();
  for (const item of await repos.outbox.pendentes(opcoes.limite)) {
    try {
      // ADR-099 (I10, definido em 2026-10-12): o `trabalho.mudou` leva o estado do dono do bot, lido na hora de publicar
      // (depois do commit de quem mudou): a web atualiza a linha do bot sem refazer a lista. Um por bot por passada.
      const extra = item.tipo === "trabalho_mudou" ? await estadoDoDonoNoFrame(conn, repos, agora, item.dados.agenteId, donos) : {};
      // conversaId/turnoId do evento vão no frame: é como a web sabe qual conversa reidratar (definido em 2026-09-16, L9).
      barramento.publicar(escopo.pessoaId, frameDoEvento(item.tipo), { ...item.dados, ...extra, kind: item.tipo, eventoId: item.eventoId, conversaId: item.conversaId, turnoId: item.turnoId });
      await repos.outbox.marcarEntregue(item.id);
      resultado.publicados += 1;
    } catch (e) {
      await repos.outbox.incrementarTentativa(item.id);
      resultado.falhas += 1;
      log("aviso", "outbox_publicar_falhou", { outbox_id: item.id, tipo: item.tipo, tentativas: item.tentativas + 1, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  if (opcoes.varrerAbandono ?? true) {
    resultado.abandonadosAgora = await repos.outbox.abandonar({ teto: opcoes.teto ?? OUTBOX_TETO_TENTATIVAS, idadeMinMs: opcoes.idadeMinMs ?? OUTBOX_IDADE_MIN_MS, agora });
    if (resultado.abandonadosAgora > 0) log("aviso", "outbox_abandonado", { n: resultado.abandonadosAgora });
    metricas.registrar({ metrica: "outbox_abandonados", tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId }, await repos.outbox.contarAbandonados());
  }
  return resultado;
}

/**
 * O estado do dono para o frame (ADR-099, I10). Ler não pode segurar o frame nem a transação do despacho: a leitura roda
 * num SAVEPOINT e, na falha, o frame sai sem o estado e a web relê por REST, como antes.
 */
async function estadoDoDonoNoFrame(conn: Conn, repos: ReturnType<typeof criarRepos>, agora: number, agenteId: unknown, cache: Map<string, EstadoDoDono | null>): Promise<{ estadoDono?: EstadoDoDono }> {
  if (typeof agenteId !== "string") return {};
  if (!cache.has(agenteId)) {
    let estado: EstadoDoDono | null = null;
    try {
      await conn`savepoint estado_do_dono`;
      try {
        estado = await estadoDoDonoAgora({ repos, agora: () => agora }, agenteId);
        await conn`release savepoint estado_do_dono`;
      } catch (e) {
        await conn`rollback to savepoint estado_do_dono`;
        throw e;
      }
    } catch (e) {
      log("aviso", "estado_do_dono_falhou", { agente_id: agenteId, erro: e instanceof Error ? e.name : "desconhecido" });
    }
    cache.set(agenteId, estado);
  }
  const estado = cache.get(agenteId);
  return estado ? { estadoDono: estado } : {};
}

/**
 * Gauges por pessoa do ADR-017 que dependem de leitura no banco, coletadas no mesmo laço:
 *  - pendencia_mais_velha_s: idade da decisão pendente/reaberta mais velha em que a pessoa é a decisora;
 *  - custo_servidor_mes: nesta rodada não existe executor de servidor (Executor = 'local' | 'catcher',
 *    ADR-022/028 — o catcher é driver in-process sem custo), então o valor é 0 por construção.
 *    gastosRepo.somarMes(agora, executor) já filtra por executor (L9, pendência L8 §3); quando o
 *    executor de servidor existir, é `somarMes(agora, 'servidor')` aqui e o valor deixa de ser 0.
 */
export async function coletarGauges(conn: Conn, escopo: Escopo, agora: number, metricas: Metricas = registroPadrao): Promise<void> {
  const repos = criarRepos(conn, escopo);
  const abertas = (await repos.decisoes.listarSuaVez(agora)).filter((d) => d.estado === "pendente" || d.estado === "reaberta");
  const maisVelhaMs = abertas.reduce((max, d) => Math.max(max, agora - Date.parse(d.criadoEm)), 0);
  metricas.registrar({ metrica: "pendencia_mais_velha_s", tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId }, Math.floor(maisVelhaMs / 1000));
  metricas.registrar({ metrica: "custo_servidor_mes", tenant_id: escopo.tenantId }, 0);
}

export interface OpcoesLacoOutbox extends OpcoesDespacho, Pick<OpcoesLaco, "listarPessoas" | "aoFalhar"> {
  /**
   * definido em 2026-09-16: 250 ms entre passadas — abaixo do que uma pessoa percebe como atraso do frame.
   * revisto em 2026-10-09 (#218): é o passo CURTO, usado enquanto há trabalho. Fixo, eram ~345 mil transações por dia
   * com o Nod parado (4 passadas por segundo, uma transação por pessoa em cada).
   */
  intervaloMs?: number;
  /**
   * definido em 2026-10-09 (#218): o passo ocioso dobra a cada passada vazia, do curto até este teto (5 s). Linha
   * gravada neste processo acorda o despachante na hora (sinal-outbox.ts); de outro processo, espera no máximo isto.
   */
  ociosoMaxMs?: number;
  /**
   * definido em 2026-10-09 (#218): quanto o passo curto dura (5 s) depois de achar trabalho ou de um aviso — cobre o
   * commit de quem gravou (o aviso sai antes dele) e a rajada de frames de um turno, sem cair no passo longo no meio.
   */
  quenteMs?: number;
  /** definido em 2026-09-16: 30 s entre varreduras de abandono e coleta de gauges — a idade mínima é de 30 min. */
  abandonoACadaMs?: number;
}

export interface DespachanteOutbox {
  /** Uma passada completa por todas as pessoas (o laço chama; o teste pode chamar direto). */
  passada(): Promise<void>;
  parar(): Promise<void>;
}

/**
 * `iniciar(db, barramento, {intervaloMs: 250})`: passa o POOL (paraCadaPessoa abre uma tx real por pessoa).
 * revisto em 2026-10-09 (#218): o passo é adaptativo — 250 ms com trabalho, dobrando até 5 s ocioso, e de volta a 250 ms
 * quando este processo grava no outbox (sinal-outbox.ts). Ocioso, menos de uma passada por segundo.
 */
export function iniciarDespachanteOutbox(db: Db, barramento: Barramento, opcoes: OpcoesLacoOutbox = {}): DespachanteOutbox {
  const intervaloMs = opcoes.intervaloMs ?? 250;
  const ociosoMaxMs = Math.max(intervaloMs, opcoes.ociosoMaxMs ?? 5_000);
  const quenteMs = opcoes.quenteMs ?? 5_000;
  const abandonoACadaMs = opcoes.abandonoACadaMs ?? 30_000;
  const agora = opcoes.agora ?? Date.now;
  const metricas = opcoes.metricas ?? registroPadrao;
  let ultimaVarredura = 0;
  let parado = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerVenceEm = 0;
  let emVoo: Promise<void> | null = null;
  // #218: o passo do próximo agendamento e até quando ele fica curto (relógio de parede: é tempo de timer, não de domínio).
  let passo = intervaloMs;
  let quenteAte = Date.now() + quenteMs;

  const passada = async (): Promise<void> => {
    const instante = agora();
    const varrer = instante - ultimaVarredura >= abandonoACadaMs;
    if (varrer) ultimaVarredura = instante;
    let achou = false;
    await paraCadaPessoa(
      db,
      async (escopo, tx) => {
        await tx(async (trx) => {
          const r = await despacharPessoa(trx, escopo, barramento, { ...opcoes, metricas, varrerAbandono: varrer });
          if (r.publicados + r.falhas > 0) achou = true;
          if (varrer) await coletarGauges(trx, escopo, instante, metricas);
        });
      },
      { listarPessoas: opcoes.listarPessoas, aoFalhar: opcoes.aoFalhar },
    );
    if (achou) quenteAte = Date.now() + quenteMs;
  };

  const agendarEm = (ms: number): void => {
    if (parado) return;
    timerVenceEm = Date.now() + ms;
    timer = setTimeout(() => {
      timer = null;
      emVoo = passada()
        .catch((e: unknown) => {
          log("erro", "despachante_outbox_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
        })
        .finally(() => {
          emVoo = null;
          agendar();
        });
    }, ms);
    timer.unref();
  };
  // Com trabalho (ou logo depois de um aviso), o passo curto; ocioso, o passo dobra até o teto.
  const agendar = (): void => {
    passo = Date.now() < quenteAte ? intervaloMs : Math.min(passo * 2, ociosoMaxMs);
    agendarEm(passo);
  };
  // Aviso de linha nova neste processo: volta ao passo curto. Uma passada em curso reagenda sozinha no `finally`.
  const pararDeOuvir = ouvirOutbox(() => {
    quenteAte = Date.now() + quenteMs;
    passo = intervaloMs;
    if (timer && timerVenceEm - Date.now() > intervaloMs) {
      clearTimeout(timer);
      timer = null;
      agendarEm(intervaloMs);
    }
  });
  agendarEm(intervaloMs);

  return {
    passada,
    async parar() {
      parado = true;
      pararDeOuvir();
      if (timer) clearTimeout(timer);
      timer = null;
      if (emVoo) await emVoo;
    },
  };
}
