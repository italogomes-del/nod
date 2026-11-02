import { ErroDoMover, EXECUTORES_QUADRO } from "../../../use-cases/acoes/quadro.ts";
import { verComentarios } from "../../../use-cases/comentar-tarefa.ts";
import { historicoDaTarefa, listarQuadros, verQuadro, verTarefaPorCodigo } from "../../../use-cases/quadro.ts";
import { TABELA_ERROS } from "../erros.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";
const TID = "(?<tid>[^/]+)";
const LID = "(?<lid>[^/]+)";
const CID = "(?<cid>[^/]+)";
/** O id da coluna (o nome também serve, como na conversa). O roteador já decodificou: decodificar de novo quebra "100%". */
const coluna = (cid: string | undefined) => cid ?? "";
const texto = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Revisão 2 do PR #623: a recusa do mover que a tela distingue sai com a chave como `motivo` (lista branca, como a NOD-346
 * na Minha conta); a frase segue a da tabela e qualquer outra causa fica só no log (ADR-002). Revisão 7: a chave vem
 * tipada no erro (ErroDoMover), não é deduzida do texto da causa; um erro qualquer com o mesmo texto não ganha motivo.
 */
export function motivoDoMover(erro: unknown): { status: number; corpo: { codigo: string; mensagem: string; motivo: string } } | null {
  if (!(erro instanceof ErroDoMover)) return null;
  const { status, mensagem } = TABELA_ERROS[erro.codigo];
  return { status, corpo: { codigo: erro.codigo, mensagem, motivo: erro.motivo } };
}

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
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar"], { ...base(ctx.params.id ?? ""), meta: c.meta as string | null | undefined, prazo: c.prazo as string | null | undefined }));
    } },
    { metodo: "PATCH", acao: "quadro.editar", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.editar"], { ...base(ctx.params.id ?? ""), meta: c.meta as string | null | undefined, prazo: c.prazo as string | null | undefined }));
    } },
    { metodo: "DELETE", acao: "quadro.remover", padrao: new RegExp(`^/agentes/${ID}/quadro$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.remover"], base(ctx.params.id ?? "")));
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
    // NOD-417: os comentários da tarefa (o da pessoa aciona o responsável; @nome aciona o mencionado).
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verComentarios, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.comentar", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/comentarios$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.comentar"], { ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "", texto: c.texto as string }));
    } },
    // NOD-416 (ADR-144): mudar de quadro, o histórico, o link pelo código (?tarefa=ZE-12) e a lista do "Mover para…".
    { metodo: "POST", acao: "quadro.mover_tarefa", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/mover$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      try {
        ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mover_tarefa"], { ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "", quadro: c.quadro as string }));
      } catch (erro) {
        const r = motivoDoMover(erro);
        if (!r) throw erro;
        ctx.json(r.status, r.corpo);
      }
    } },
    { metodo: "GET", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/historico$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, historicoDaTarefa, { agenteId: ctx.params.id ?? "", tarefaId: ctx.params.tid ?? "" }));
    } },
    { metodo: "GET", padrao: /^\/quadro\/tarefas\/(?<codigo>[^/]+)$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, verTarefaPorCodigo, { codigo: ctx.params.codigo ?? "" }));
    } },
    { metodo: "GET", padrao: /^\/quadros$/, async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, listarQuadros, {}));
    } },
    // NOD-448 (ADR-140): as colunas.
    { metodo: "POST", acao: "quadro.criar_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(201, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.criar_coluna"], { ...base(ctx.params.id ?? ""), nome: c.nome as string, grupo: c.grupo as string, depois_de: texto(c.depois_de) }));
    } },
    { metodo: "PUT", acao: "quadro.substituir_colunas", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.substituir_colunas"], { ...base(ctx.params.id ?? ""), colunas: c.colunas, destinos: c.destinos }));
    } },
    { metodo: "PATCH", acao: "quadro.renomear_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.renomear_coluna"], { ...base(ctx.params.id ?? ""), coluna: coluna(ctx.params.cid), nome: c.nome as string }));
    } },
    { metodo: "POST", acao: "quadro.mover_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}/mover$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.mover_coluna"], { ...base(ctx.params.id ?? ""), coluna: coluna(ctx.params.cid), antes_de: texto(c.antes_de), depois_de: texto(c.depois_de) }));
    } },
    { metodo: "DELETE", acao: "quadro.remover_coluna", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}$`), async handler(ctx) {
      const destino = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("destino");
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.remover_coluna"], { ...base(ctx.params.id ?? ""), coluna: coluna(ctx.params.cid), ...(destino ? { destino } : {}) }));
    } },
    // ADR-142: a passagem da coluna e o fim da etapa.
    { metodo: "PUT", acao: "quadro.definir_passagem", padrao: new RegExp(`^/agentes/${ID}/quadro/colunas/${CID}/passagem$`), async handler(ctx) {
      const c = corpoObjeto(await ctx.corpo());
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.definir_passagem"], { ...base(ctx.params.id ?? ""), coluna: coluna(ctx.params.cid), agente: c.agente as string | null | undefined, instrucoes: c.instrucoes as string | null | undefined }));
    } },
    { metodo: "POST", acao: "quadro.terminei", padrao: new RegExp(`^/agentes/${ID}/quadro/tarefas/${TID}/terminei$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.terminei"], { ...base(ctx.params.id ?? ""), tarefa: ctx.params.tid ?? "" }));
    } },
    { metodo: "POST", acao: "quadro.desfazer", padrao: new RegExp(`^/agentes/${ID}/quadro/lotes/${LID}/desfazer$`), async handler(ctx) {
      ctx.json(200, await executar(ctx.escopo, EXECUTORES_QUADRO["quadro.desfazer"], { ...base(ctx.params.id ?? ""), lote: ctx.params.lid ?? "" }));
    } },
  ];
}
