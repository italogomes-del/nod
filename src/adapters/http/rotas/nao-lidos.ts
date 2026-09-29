import type { RespostaMutacao } from "../../../contracts/api.ts";
import { listarNaoLidos, marcarConversaLida, marcarConversaNaoLida, marcarTudoLido } from "../../../use-cases/nao-lidos.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** Não lidos (definido em 2026-09-29, 0039): a lista e o "lido até" de cada conversa. */
export function criarRotasNaoLidos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const ok: RespostaMutacao = { ok: true, ids: {} };
  return [
    {
      metodo: "GET",
      padrao: /^\/nao-lidos$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarNaoLidos, {}));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/nao-lidos\/marcar-tudo$/,
      async handler(ctx) {
        await executar(ctx.escopo, marcarTudoLido, {});
        ctx.json(200, ok);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/conversas/${ID}/lida$`),
      async handler(ctx) {
        await executar(ctx.escopo, marcarConversaLida, { conversaId: ctx.params.id ?? "" });
        ctx.json(200, ok);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/conversas/${ID}/nao-lida$`),
      async handler(ctx) {
        await executar(ctx.escopo, marcarConversaNaoLida, { conversaId: ctx.params.id ?? "" });
        ctx.json(200, ok);
      },
    },
  ];
}
