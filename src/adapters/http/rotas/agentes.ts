import type { PreferenciaHarness } from "../../../contracts/harness.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import { gerirAgente } from "../../../use-cases/gerir-agente.ts";
import type { DonoAgente, FormaAgente, CorAgente } from "../../../contracts/agente.ts";
import type { TipoMemoria } from "../../../contracts/memoria.ts";
import { criarAgente } from "../../../use-cases/criar-agente.ts";
import { duplicarAgente } from "../../../use-cases/duplicar-agente.ts";
import { apagarMemoria, editarMemoria, listarMemorias } from "../../../use-cases/editar-memorias.ts";
import { editarPerfil } from "../../../use-cases/editar-perfil.ts";
import { fixarAgente, ocultarAgente } from "../../../use-cases/fixar-ocultar-agente.ts";
import { registrarMemoria } from "../../../use-cases/lembrar.ts";
import { mudarModoAprovacao } from "../../../use-cases/mudar-modo-aprovacao.ts";
import { definirInteligenciaDoBot, lerInteligenciaDoBot } from "../../../use-cases/inteligencia.ts";
import { decidirTrocaDeIa } from "../../../use-cases/trocas-de-ia.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, textoOpcional, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Rotas de agentes (tabela ROTAS, lane L6): criação {dono, nome?} (EMENDA 17), PATCH de perfil
 * (dono no corpo → 403 dono_imutavel), Pin/Hide/Duplicate e memória. Cada handler: valida a forma,
 * chama o caso de uso, responde. Mutação devolve o que criou/alterou; o estado vivo chega por SSE.
 */
export function criarRotasAgentes(d: DepsRotas, desligarComputador?: (escopo: Escopo, agenteId: string) => Promise<void>, prontosPorMaquina?: (escopo: Escopo) => Readonly<Record<string, readonly IdHarness[]>>): Rota[] {
  const executar = criarExecutor(d);
  return [
    { metodo: "PATCH", padrao: new RegExp(`^/agentes/${ID}/organizacao$`), async handler(ctx) {
      const corpo = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, gerirAgente, { agenteId: ctx.params.id ?? "", acao: "organizar",
        secao: corpo.secao as string | undefined, naoLido: corpo.naoLido as boolean | undefined,
        fixado: corpo.fixado as boolean | undefined, ordem: corpo.ordem as string[] | undefined }));
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
          esforco: corpo.esforco === null ? null : textoOpcional(corpo.esforco),
          forma: corpo.forma as FormaAgente | undefined,
          cor: corpo.cor as CorAgente | undefined,
          dono: corpo.dono,
        });
        ctx.json(200, r);
      },
    },
    {
      // definido em 2026-10-10 (0068, emenda da ADR-036): a inteligência do bot — modo, IA fixa, ordem própria e o modelo e
      // o raciocínio de cada IA (contrato em src/contracts/inteligencia.ts). Campo ausente não muda; `ordem: null` volta à
      // ordem da pessoa. O PATCH acima continua aceitando o par antigo {harness, modelo, esforco}.
      metodo: "GET",
      padrao: new RegExp(`^/agentes/${ID}/inteligencia$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerInteligenciaDoBot, { agenteId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "PUT",
      padrao: new RegExp(`^/agentes/${ID}/inteligencia$`),
      async handler(ctx) {
        // ADR-108 (revisão do PR 2, C6): as IAs prontas por máquina, para "levar as tasks" ao Automático.
        ctx.json(200, await executar(ctx.escopo, definirInteligenciaDoBot, { agenteId: ctx.params.id ?? "", pedido: await ctx.corpo(), prontosPorMaquina: prontosPorMaquina?.(ctx.escopo) ?? {} }));
      },
    },
    {
      // ADR-108 (R4/R6): a escolha no aviso de troca de IA do bot — esperar, levar as tasks, ou (bot fixo) seguir noutra IA
      // até a volta. Só a dona; quem chega primeiro vence (o segundo clique recebe `aplicada: false`).
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/troca-de-ia$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, decidirTrocaDeIa, { agenteId: ctx.params.id ?? "", decisao: corpo.decisao, ...(corpo.trocaId !== undefined ? { trocaId: corpo.trocaId } : {}) }));
      },
    },
    {
      // ADR-059: o botão de aprovações do campo. Só a dona; a troca vira linha na conversa do bot. O total exige
      // `confirmado: true` (o segundo clique do menu; emenda de 2026-10-18).
      metodo: "POST",
      padrao: new RegExp(`^/agentes/${ID}/modo-aprovacao$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, mudarModoAprovacao, { agenteId: ctx.params.id ?? "", modo: corpo.modo, confirmado: corpo.confirmado }));
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
