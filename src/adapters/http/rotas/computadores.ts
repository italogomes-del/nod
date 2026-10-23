import type { Computadores } from "../../fundo/computadores.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { ORIGENS_CONTROLE, type OrigemControle } from "../../../contracts/computador.ts";

export function rotasComputadores(computadores: Computadores): Rota[] {
  return [
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultar(ctx.escopo, ctx.params.id!)); } },
    { metodo: "POST", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown; origem?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string") throw new ErroDeDominio("entrada_invalida");
      // NOD-97: `origem` é opcional (sem ela, "botao"); fora do enum é entrada inválida.
      if (corpo.origem !== undefined && !ORIGENS_CONTROLE.includes(corpo.origem as OrigemControle)) throw new ErroDeDominio("entrada_invalida");
      await computadores.configurar(ctx.escopo, ctx.params.id!, corpo.operacao, corpo.origem as OrigemControle | undefined);
      ctx.json(200, { ok: true });
    } },
    { metodo: "POST", padrao: /^\/agentes\/(?<id>[^/]+)\/computador\/acoes$/, async handler(ctx) { ctx.json(200, await computadores.humano(ctx.escopo, ctx.params.id!, await ctx.corpo())); } },
  ];
}
