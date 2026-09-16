import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { RuntimeEvent } from "../../../contracts/evento.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { criarRepos } from "../../../repositories/index.ts";
import type { Escopo, Relogio, Transacao, Tx } from "../../../shared/types.ts";
import { criarRotinaPelaPessoa } from "../../../use-cases/criar-rotina.ts";
import { listarExecucoes, listarRotinas } from "../../../use-cases/listar-rotinas.ts";
import { pausarRotina } from "../../../use-cases/pausar-rotina.ts";
import type { CasoDeUso, Deps, Services, UseCasesNod } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";

/**
 * Dependências das rotas da L7 (rotinas e salas). `txPara` é a fábrica de transação ESCOPADA por
 * pessoa: em produção `(escopo) => abrirTxEscopada(db, escopo)`; no teste, o envelope do
 * withRollback com vincularEscopo — por isso a rota não conhece o pool.
 */
export type DepsRotasL7 = {
  txPara(escopo: Escopo): Transacao;
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
};

/** Roda um caso de uso numa tx escopada e grava os eventos na MESMA tx (events + outbox). */
export async function executar<I, O>(deps: DepsRotasL7, escopo: Escopo, caso: CasoDeUso<I, O>, input: I): Promise<O> {
  const tx = deps.txPara(escopo);
  return tx(async (trx: Tx) => {
    const repos = criarRepos(trx, escopo);
    const d: Deps = { repos, services: deps.services, useCases: deps.useCases, tx, escopo, agora: deps.agora };
    const r = await caso(d, input);
    const events: RuntimeEvent[] = r.events ?? [];
    if (events.length > 0) await repos.events.gravarComOutbox(events);
    return r.data;
  });
}

export function texto(corpo: Record<string, unknown>, campo: string): string {
  const v = corpo[campo];
  if (typeof v !== "string") throw new ErroDeDominio("entrada_invalida", { cause: `campo ${campo}` });
  return v;
}

export function corpoObjeto(c: unknown): Record<string, unknown> {
  if (typeof c !== "object" || c === null || Array.isArray(c)) throw new ErroDeDominio("entrada_invalida", { cause: "corpo" });
  return c as Record<string, unknown>;
}

/**
 * Rotas de rotinas (tabela ROTAS, lane L7). POST rotinas: 400 fuso_invalido / cron_sem_futuro /
 * entrada_invalida, 429 limite_atingido, 404 agente — a tradução é da tabela fixa de erros.ts.
 * O fuso é validado ANTES dos demais campos (o e2e manda só cron + fuso e espera fuso_invalido).
 */
export function criarRotasRotinas(deps: DepsRotasL7): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/rotinas$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, listarRotinas, {}));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/rotinas$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const fusoIana = typeof corpo.fusoIana === "string" ? corpo.fusoIana : typeof corpo.fuso_iana === "string" ? corpo.fuso_iana : "";
        const { rotina } = await executar(deps, ctx.escopo, criarRotinaPelaPessoa, {
          agenteId: typeof corpo.agenteId === "string" ? corpo.agenteId : "",
          cron: typeof corpo.cron === "string" ? corpo.cron : "",
          fusoIana,
          instrucao: typeof corpo.instrucao === "string" ? corpo.instrucao : "",
          fonte: typeof corpo.fonte === "string" ? corpo.fonte : "",
          entregavel: typeof corpo.entregavel === "string" ? corpo.entregavel : "",
          limitesAprovacao: typeof corpo.limitesAprovacao === "string" ? corpo.limitesAprovacao : "",
          politicaSemDado: typeof corpo.politicaSemDado === "string" ? corpo.politicaSemDado : "",
        });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id, conversaId: rotina.conversaId } };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/pausar$/,
      async handler(ctx) {
        const { rotina } = await executar(deps, ctx.escopo, pausarRotina, { rotinaId: ctx.params.id ?? "", estado: "pausada" });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/ativar$/,
      async handler(ctx) {
        const { rotina } = await executar(deps, ctx.escopo, pausarRotina, { rotinaId: ctx.params.id ?? "", estado: "ativa" });
        const resposta: RespostaMutacao = { ok: true, ids: { rotinaId: rotina.id } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/rotinas\/(?<id>[^/]+)\/execucoes$/,
      async handler(ctx) {
        ctx.json(200, await executar(deps, ctx.escopo, listarExecucoes, { rotinaId: ctx.params.id ?? "" }));
      },
    },
  ];
}
