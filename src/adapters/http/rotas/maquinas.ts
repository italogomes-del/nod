import { ErroDeDominio } from "../../../domain/erro.ts";
import type { PareamentoMaquina } from "../../../services/pareamento-maquina.ts";
import { emitirChaveMaquina, revogarChaveMaquina } from "../../../use-cases/chaves-maquina.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

/**
 * "Minhas chaves" (E1.3, ADR-031): a pessoa da sessão emite, lista e revoga as chaves dos próprios
 * computadores. Rota de PESSOA (cookie), nunca interna: agente não emite chave. A chave crua aparece
 * só na resposta do POST; a listagem nunca a traz (nem o hash).
 *
 * Pareamento pelo navegador (ADR-069): a pessoa, com sessão, abre um pedido para o Mac que pediu
 * (`pareamentos`); o app troca o código de uso único pela chave em `pareamento/trocar`, rota pública
 * que recusa navegador (Origin → 403) como as de máquina. A chave nasce na troca, dentro do escopo
 * da pessoa que confirmou.
 */
export function rotasMaquinas(deps: { dentro: DentroDeTx; pareamento: PareamentoMaquina }): Rota[] {
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
    {
      metodo: "POST",
      padrao: /^\/maquinas\/pareamentos$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown; desafio?: unknown };
        const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
        if (nome.length === 0 || nome.length > 60 || typeof corpo.desafio !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "pareamento" });
        let codigo: string;
        try { codigo = deps.pareamento.abrir({ escopo: ctx.escopo, nome, desafio: corpo.desafio }); }
        catch { throw new ErroDeDominio("entrada_invalida", { cause: "desafio do pareamento" }); }
        ctx.json(201, { codigo });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/pareamento\/trocar$/,
      publica: true,
      async handler(ctx) {
        // Quem troca é o app, nunca uma página: sem isto, um site qualquer poderia tentar a troca no navegador da pessoa.
        if (ctx.req.headers.origin !== undefined) { ctx.json(403, { codigo: "nao_permitido" }); return; }
        const corpo = (await ctx.corpo()) as { codigo?: unknown; verificador?: unknown };
        const pedido = typeof corpo.codigo === "string" && typeof corpo.verificador === "string" ? deps.pareamento.trocar({ codigo: corpo.codigo, verificador: corpo.verificador }) : null;
        if (!pedido) { ctx.json(400, { codigo: "pareamento_invalido" }); return; }
        const r = await deps.dentro(pedido.escopo, (d) => executar(d, emitirChaveMaquina, { nome: pedido.nome }));
        ctx.json(201, { chave: r.chave });
      },
    },
  ];
}
