import type { RespostaMutacao } from "../../../contracts/api.ts";
import { descartarPendenciaPelaPessoa, fazerPendenciaAgora, listarPendencias } from "../../../use-cases/pendencias.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
// `mid`: o roteador só deixa passar uuid (EMENDA-L9 §2) — id malformado é 404, nunca 22P02.
const MID = "(?<mid>[^/]+)";

/**
 * Pendências do bot vistas pela pessoa (definido em 2026-09-30, ADR-064): a lista (indicador embaixo da resposta
 * e seção "A fazer" da gaveta), Descartar e Fazer agora. O estado vivo chega por SSE (agente.mudou).
 */
export function criarRotasPendencias(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/pendencias$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarPendencias, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/pendencias/${MID}/descartar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, descartarPendenciaPelaPessoa, { agenteId: ctx.params.id ?? "", pendenciaId: ctx.params.mid ?? "" });
        const resposta: RespostaMutacao = { ok: true, ids: { pendencia: r.pendencia.id, ...(r.mensagem ? { mensagem: r.mensagem.id } : {}) } };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/pendencias/${MID}/fazer-agora$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, fazerPendenciaAgora, { agenteId: ctx.params.id ?? "", pendenciaId: ctx.params.mid ?? "", prazoMs: d.prazoDecisaoMs, executor: d.executor });
        const resposta: RespostaMutacao = { ok: true, ids: { mensagem: r.mensagem.id, turno: r.turno.id, ...(r.negacao ? { negacao: r.negacao.id } : {}) } };
        ctx.json(201, resposta);
      },
    },
  ];
}
