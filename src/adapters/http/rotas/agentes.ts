import type { PreferenciaHarness } from "../../../contracts/harness.ts";
import type { Escopo } from "../../../shared/types.ts";
import { gerirAgente } from "../../../use-cases/gerir-agente.ts";
import type { DonoAgente, FormaAgente, CorAgente } from "../../../contracts/agente.ts";
import type { TipoMemoria } from "../../../contracts/memoria.ts";
import { criarAgente } from "../../../use-cases/criar-agente.ts";
import { duplicarAgente } from "../../../use-cases/duplicar-agente.ts";
import { apagarMemoria, editarMemoria, listarMemorias } from "../../../use-cases/editar-memorias.ts";
import { editarPerfil } from "../../../use-cases/editar-perfil.ts";
import { fixarAgente, ocultarAgente } from "../../../use-cases/fixar-ocultar-agente.ts";
import { registrarMemoria } from "../../../use-cases/lembrar.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, textoOpcional, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Rotas de agentes (tabela ROTAS, lane L6): criação {dono, nome?} (EMENDA 17), PATCH de perfil
 * (dono no corpo → 403 dono_imutavel), Pin/Hide/Duplicate e memória. Cada handler: valida a forma,
 * chama o caso de uso, responde. Mutação devolve o que criou/alterou; o estado vivo chega por SSE.
 */
export function criarRotasAgentes(d: DepsRotas, desligarComputador?: (escopo: Escopo, agenteId: string) => Promise<void>): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "PATCH", padrao: new RegExp(`^/agentes/${ID}/organizacao$`), async handler(ctx) {
      const corpo = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, gerirAgente, { agenteId: ctx.params.id ?? "", acao: "organizar",
        secao: corpo.secao as string | undefined, naoLido: corpo.naoLido as boolean | undefined }));
    } },
    { metodo: "DELETE", padrao: new RegExp(`^/agentes/${ID}$`), async handler(ctx) {
      const resultado = await executar(ctx.escopo, gerirAgente, { agenteId: ctx.params.id ?? "", acao: "excluir" });
      await desligarComputador?.(ctx.escopo, ctx.params.id ?? "");
      ctx.json(200, resultado);
    } },
    { metodo: "POST", padrao: new RegExp(`^/agentes/${ID}/restaurar$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, gerirAgente, { agenteId: ctx.params.id ?? "", acao: "restaurar" }));
    } },
    {
      metodo: "POST",
      padrao: /^\/agentes$/,
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, criarAgente, { dono: corpo.dono as DonoAgente, interativo: corpo.interativo === true, nome: textoOpcional(corpo.nome), titulo: textoOpcional(corpo.titulo), descricao: textoOpcional(corpo.descricao), modelo: textoOpcional(corpo.modelo) ?? d.modeloPadrao, harness: corpo.harness as PreferenciaHarness | undefined });
        ctx.json(201, r);
      },
    },
    {
      metodo: "PATCH",
      padrao: new RegExp(`^/agentes/${ID}$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, editarPerfil, {
          agenteId: ctx.params.id ?? "",
          nome: textoOpcional(corpo.nome),
          titulo: textoOpcional(corpo.titulo),
          descricao: textoOpcional(corpo.descricao),
          modelo: textoOpcional(corpo.modelo),
          harness: corpo.harness as PreferenciaHarness | undefined,
          forma: corpo.forma as FormaAgente | undefined,
          cor: corpo.cor as CorAgente | undefined,
          dono: corpo.dono,
        });
        ctx.json(200, r);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/fixar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, fixarAgente, { agenteId: ctx.params.id ?? "", fixado: typeof corpo.fixado === "boolean" ? corpo.fixado : undefined }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/ocultar$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, ocultarAgente, { agenteId: ctx.params.id ?? "", oculto: typeof corpo.oculto === "boolean" ? corpo.oculto : undefined }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/duplicar$`),
      async handler(ctx) {
        ctx.json(201, await executar(ctx.escopo, duplicarAgente, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/memoria$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, listarMemorias, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/memoria$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, registrarMemoria, {
          agenteId: ctx.params.id ?? "",
          conversaId: textoOpcional(corpo.conversaId) ?? null,
          turnoId: null,
          tipo: texto(corpo.tipo) as TipoMemoria,
          texto: texto(corpo.texto),
          origem: "pessoa",
        });
        ctx.json(201, r);
      },
    },
    {
      metodo: "PATCH",
      padrao: new RegExp(`^/agentes/${ID}/memoria/(?<mid>[^/]+)$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, editarMemoria, { memoriaId: ctx.params.mid ?? "", texto: textoOpcional(corpo.texto), tipo: textoOpcional(corpo.tipo) as TipoMemoria | undefined }));
      },
    },
    {
      metodo: "DELETE",
      padrao: new RegExp(`^/agentes/${ID}/memoria/(?<mid>[^/]+)$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, apagarMemoria, { memoriaId: ctx.params.mid ?? "" });
        ctx.json(200, { ok: true, ids: { memoria: ctx.params.mid ?? "", agente: r.agenteId } });
      },
    },
  ];
}
