import { EXECUTORES_QUADRO } from "../../../use-cases/acoes/quadro.ts";
import { verQuadro } from "../../../use-cases/quadro.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const TID = "(?<tid>[^/]+)";
const LID = "(?<lid>[^/]+)";

/**
 * A aba Quadro de um bot (definido em 2026-10-31, NOD-442, ADR-135). Cada mutação é um lote de uma ação pelo executor
 * único do id (src/use-cases/acoes/quadro.ts), o mesmo lote do gerir_quadro; o corpo passa pelo lerOp do domínio. A
 * resposta traz o quadro montado e o lote (para o Desfazer); o outro aparelho atualiza pelo frame quadro.mudou.
 */
export function rotasQuadro(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  const base = (agenteId: string) => ({ anfitriaoId: agenteId, executor: d.executor ?? "catcher" });
  return [
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verQuadro, { agenteId: ctx.params.id ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.criar", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar"], { ...base(ctx.params.id ?? ""), meta: c.meta as string, prazo: c.prazo as string | null | undefined }));
    } },
    { metodo: "PATCH", acao: "quadro.editar", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar"], { ...base(ctx.params.id ?? ""), meta: c.meta as string | undefined, prazo: c.prazo as string | null | undefined }));
    } },
    { metodo: "POST", acao: "quadro.criar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_tarefa"], { titulo: c.titulo as string, descricao: c.descricao as string | undefined, status: c.status as never, agente: c.agente as string | null | undefined, ...base(ctx.params.id ?? "") }));
    } },
    { metodo: "POST", acao: "quadro.importar_linear", padrao: new RegExp(`^/agentes/${ID}/quadro/linear$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.importar_linear"], { ...base(ctx.params.id ?? ""), itens: c.itens as never }));
    } },
    { metodo: "PATCH", acao: "quadro.mudar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_tarefa"], { ...c, ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "DELETE", acao: "quadro.mudar_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mudar_tarefa"], { ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "", excluir: true }));
    } },
    { metodo: "POST", acao: "quadro.responder", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/resposta$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.responder"], { ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "", resposta: c.resposta as string }));
    } },
    { metodo: "POST", acao: "quadro.desfazer", padrao: new RegExp(`^/agentes/${ID}/quadro/lotes/${LID}/desfazer$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desfazer"], { ...base(ctx.params.id ?? ""), lote: ctx.params.lid ?? "" }));
    } },
  ];
}
