import type { Executor } from "../../contracts/evento.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { passoDoAgendador, type RelogioDoAgendador } from "../../domain/presenca.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { dispararRotina } from "../../use-cases/disparar-rotina.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: tick a cada 30 s — o cron tem granularidade de minuto e o Grok Bot promete "em até um minuto". */
export const INTERVALO_SCHEDULER_MS = 30_000;

export type OpcoesTick = {
  machineId: string;
  executor: Executor;
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
};

/**
 * `puladas`: rotinas cuja execução anterior ainda estava aberta — só reagendadas (ADR-045).
 * `bloqueadas` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou a janela sem turno.
 */
export type ResultadoTick = { disparadas: string[]; deOutroProcesso: string[]; puladas: string[]; bloqueadas: string[]; falhas: string[] };

/**
 * Um tick para UMA pessoa (o teste chama isto sob withRollback com `tx = (fn) => fn(trx)`): lista
 * as rotinas ativas vencidas numa tx, e dispara cada uma na SUA tx — uma rotina que falha
 * (cron sem futuro ao reagendar, agente sumido) não derruba as outras nem a janela delas.
 * `false` na reivindicação é outro processo, silencioso (E7.6). Só aqui se avalia cron (ADR-011).
 */
export async function tickPessoa(escopo: Escopo, tx: Transacao, opcoes: OpcoesTick): Promise<ResultadoTick> {
  const agora = opcoes.agora();
  const resultado: ResultadoTick = { disparadas: [], deOutroProcesso: [], puladas: [], bloqueadas: [], falhas: [] };
  const vencidas = await tx(async (trx) => criarRepos(trx, escopo).rotinas.ativasVencidas(agora));
  for (const rotina of vencidas) {
    try {
      await tx(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
        const r = await dispararRotina(deps, { rotina, instanteAgendado: rotina.proximaExecucao, machineId: opcoes.machineId, executor: opcoes.executor });
        if ("janelaDeOutro" in r.data) {
          resultado.deOutroProcesso.push(rotina.id);
          return;
        }
        if ("pulada" in r.data) {
          resultado.puladas.push(rotina.id);
          log("aviso", "rotina_janela_pulada", { rotina_id: rotina.id, turno_aberto_id: r.data.turnoAbertoId, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        // Sem turno e sem crédito gasto: a execução 'bloqueada', o card e o evento vão juntos nesta tx.
        if ("bloqueada" in r.data) {
          await repos.events.gravarComOutbox(r.events ?? []);
          resultado.bloqueadas.push(rotina.id);
          log("info", "rotina_bloqueada", { rotina_id: rotina.id, motivo: r.data.bloqueada, proposta_id: r.data.propostaId, instante_agendado: rotina.proximaExecucao, proxima_execucao: r.data.proximaExecucao });
          return;
        }
        await repos.events.gravarComOutbox(r.events ?? []);
        resultado.disparadas.push(rotina.id);
        log("info", "rotina_disparada", { rotina_id: rotina.id, turno_id: r.data.turno.id, instante_agendado: rotina.proximaExecucao, atraso_ms: agora - rotina.proximaExecucao });
      });
    } catch (e) {
      resultado.falhas.push(rotina.id);
      log("erro", "rotina_disparo_falhou", { rotina_id: rotina.id, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
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
 */
export function iniciarScheduler(db: Db, opcoes: OpcoesTick & { intervaloMs?: number }, laco: OpcoesLaco = {}): { parar(): void } {
  let rodando = false;
  let relogio: RelogioDoAgendador = { ultimoTick: null, esperarAte: 0 };
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_SCHEDULER_MS;
  const timer = setInterval(() => {
    // O relógio anda a cada disparo do timer, mesmo com um tick ainda rodando: um tick longo não é sono.
    const passo = passoDoAgendador(relogio, opcoes.agora(), intervaloMs);
    relogio = passo.estado;
    if (passo.paradoMs !== null) log("aviso", "processo_acordou", { parado_ms: passo.paradoMs, espera_ms: relogio.esperarAte - (relogio.ultimoTick ?? 0) });
    if (rodando || !passo.disparar) return;
    rodando = true;
    tick(db, opcoes, laco)
      .catch((e: unknown) => log("erro", "scheduler_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        rodando = false;
      });
  }, intervaloMs);
  timer.unref();
  return { parar: () => clearInterval(timer) };
}
