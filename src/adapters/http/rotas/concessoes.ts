import { ErroDeDominio } from "../../../domain/erro.ts";
import { conceder } from "../../../use-cases/conceder.ts";
import { revogar } from "../../../use-cases/revogar.ts";
import type { Rota } from "../roteador.ts";
import { executar, textoDoCorpo, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasConcessoes = { dentro: DentroDeTx };

/**
 * Concessões por agente e capacidade (E6, ADR-013): a rota é sempre de PESSOA (sessão); agente não
 * concede a agente (E12.5) — não há rota interna para isto. A mensagem de consentimento nasce na
 * mesma transação (caso de uso conceder).
 */
export function rotasConcessoes(deps: DepsRotasConcessoes): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        const concessoes = await deps.dentro(ctx.escopo, (d) => d.repos.concessoes.doAgente(ctx.params.id ?? ""));
        ctx.json(200, { concessoes });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const conectorId = textoDoCorpo(corpo, "conectorId");
        const capacidade = textoDoCorpo(corpo, "capacidade");
        if (!conectorId || !capacidade) throw new ErroDeDominio("entrada_invalida", { cause: "conectorId e capacidade" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, conceder, { agenteId: ctx.params.id ?? "", conectorId, capacidade, autorTipo: "pessoa" }));
        ctx.json(201, { ok: true, ids: { concessao: r.concessaoId, mensagem: r.mensagemId }, naoInclui: r.naoInclui });
      },
    },
    {
      metodo: "DELETE",
      padrao: /^\/concessoes\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, revogar, { concessaoId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: true, ids: r.mensagemId ? { mensagem: r.mensagemId } : {} });
      },
    },
  ];
}
