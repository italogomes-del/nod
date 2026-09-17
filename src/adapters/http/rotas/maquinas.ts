import { emitirChaveMaquina, revogarChaveMaquina } from "../../../use-cases/chaves-maquina.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

/**
 * "Minhas chaves" (E1.3, ADR-031): a pessoa da sessão emite, lista e revoga as chaves dos próprios
 * computadores. Rota de PESSOA (cookie), nunca interna: agente não emite chave. A chave crua aparece
 * só na resposta do POST; a listagem nunca a traz (nem o hash).
 */
export function rotasMaquinas(deps: { dentro: DentroDeTx }): Rota[] {
  return [
    {
      metodo: "POST",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown };
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, emitirChaveMaquina, { nome: corpo.nome }));
        ctx.json(201, r);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/chaves$/,
      async handler(ctx) {
        ctx.json(200, { chaves: await deps.dentro(ctx.escopo, (d) => d.repos.maquinaTokens.listar()) });
      },
    },
    {
      metodo: "DELETE",
      padrao: /^\/maquinas\/chaves\/(?<id>[^/]+)$/,
      async handler(ctx) {
        ctx.json(200, await deps.dentro(ctx.escopo, (d) => executar(d, revogarChaveMaquina, { id: ctx.params.id ?? "" })));
      },
    },
  ];
}
