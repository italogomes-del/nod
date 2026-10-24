import type { Computadores } from "../../fundo/computadores.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { OPERACOES_DA_PESSOA, type OperacaoDaPessoa } from "../../../contracts/computador-motor.ts";
import { ORIGENS_CONTROLE, type OrigemControle } from "../../../contracts/computador.ts";

export function rotasComputadores(computadores: Computadores): Rota[] {
  return [
    // NOD-96 PR 5: o computador da pessoa (NOD_COMPUTADORES=motor); com a flag desligada, 404.
    { metodo: "GET", padrao: /^\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultarDaPessoa(ctx.escopo)); } },
    { metodo: "POST", padrao: /^\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string" || !(OPERACOES_DA_PESSOA as readonly string[]).includes(corpo.operacao)) throw new ErroDeDominio("entrada_invalida");
      // Atualizar, Redefinir e Sair de todos seguem em segundo plano; o progresso vem pelo GET.
      await computadores.operarDaPessoa(ctx.escopo, corpo.operacao as OperacaoDaPessoa);
      ctx.json(200, { ok: true });
    } },
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
