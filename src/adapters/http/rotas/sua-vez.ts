import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { Escopo } from "../../../shared/types.ts";
import { listarSuaVez, type DepsSuaVez } from "../../../use-cases/listar-sua-vez.ts";
import { reabrirDecisao } from "../../../use-cases/reabrir-decisao.ts";
import type { Rota } from "../roteador.ts";

/**
 * Como a rota chega ao caso de uso: a composição (compor.ts, L9) abre `abrirTxEscopada(db, escopo)`,
 * monta as Deps sobre a transação e roda `fn` dentro dela — os events devolvidos pelo caso de uso
 * são gravados via repos.events.gravarComOutbox na MESMA tx (Leapy §1). O teste entrega uma
 * ComDeps sobre o trx do withRollback. Recebe só a fatia que estas rotas usam (DepsSuaVez), então
 * uma ComDeps de Deps completas serve.
 */
export type ComDeps = <T>(escopo: Escopo, fn: (deps: DepsSuaVez) => Promise<T>) => Promise<T>;

/** GET sua-vez e POST decisoes/:id/reabrir (EMENDA 4: decidir/retomar/responder são da L9 em rotas/decisoes.ts). */
export function criarRotasSuaVez(comDeps: ComDeps): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/sua-vez$/,
      async handler(ctx) {
        const saida = await comDeps(ctx.escopo, (deps) => listarSuaVez(deps, {}));
        ctx.json(200, saida.data);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/decisoes\/(?<id>[^/]+)\/reabrir$/,
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const saida = await comDeps(ctx.escopo, async (deps) => {
          const r = await reabrirDecisao(deps, { decisaoId });
          await deps.repos.events.gravarComOutbox(r.events);
          return r;
        });
        const corpo: RespostaMutacao = { ok: true, ids: { decisaoId: saida.data.decisao.id } };
        ctx.json(200, corpo);
      },
    },
  ];
}
