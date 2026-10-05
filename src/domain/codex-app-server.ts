import { redigirECortar } from "./segredos.ts";

/**
 * Protocolo do `codex app-server` (definido em 2026-10-04, ADR-076): JSON-RPC 2.0, uma mensagem JSON por linha no
 * stdin/stdout do processo. Puro — só monta as linhas que o laço de voz escreve e interpreta as que ele lê.
 *
 * NÃO HOMOLOGADO: o Codex não estava instalado na máquina onde este parser foi escrito; os nomes de métodos e campos
 * vêm do protocolo v2 publicado (codex-rs/app-server-protocol, main de 2026-10-03) e só foram exercitados contra o
 * app-server falso de `tests/fixtures/codex-falso.mjs`. O parser é tolerante: campo que falta vira null, linha que não
 * é JSON vira `ignorado`, nunca lança.
 */

/** NOD-174: o mesmo teto do `erroCru` do Codex exec (codex-stream.ts). */
const ERRO_CRU_APP_SERVER_MAX_CHARS = 500;

export type IdRpc = number | string;

/** Esforço de raciocínio aceito pelo protocolo (depende do modelo; `model/list` diz quais o modelo aceita). */
export type EsforcoCodex = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * definido em 2026-10-04: "low" no laço de voz. `model/list` (supportedReasoningEfforts) diria o menor esforço que o
 * Luna aceita, mas a resposta nunca foi vista com o Codex real; "low" é aceito por toda a família GPT-6 na API
 * (pesquisa de 2026-10-04). Trocar pelo menor da lista quando a sonda do app-server existir.
 */
export const ESFORCO_LIGACAO_CODEX: EsforcoCodex = "low";

export type TokensAppServer = { entrada: number; saida: number; cacheLeitura: number };

export type EventoAppServer =
  /** Resposta a um pedido nosso. */
  | { tipo: "resposta"; id: IdRpc; resultado: Record<string, unknown> }
  /** Resposta de erro a um pedido nosso (a mensagem crua fica só aqui; quem loga usa o código). */
  | { tipo: "resposta_erro"; id: IdRpc; codigo: number | null; mensagem: string }
  | { tipo: "delta"; threadId: string | null; turnId: string | null; itemId: string | null; texto: string }
  | { tipo: "turno_iniciado"; turnId: string | null }
  /**
   * Item do turno começou ou acabou. `ferramenta` = `mcp__<servidor>__<ferramenta>` quando é chamada MCP (o mesmo nome
   * que o Claude Code usa), null para os outros itens. `texto` = o texto completo de uma mensagem do agente, no fim.
   */
  | { tipo: "item"; fase: "inicio" | "fim"; turnId: string | null; itemId: string | null; tipoItem: string; ferramenta: string | null; falhou: boolean; texto: string | null }
  | { tipo: "turno_concluido"; turnId: string | null; status: "completed" | "interrupted" | "failed"; erro: string | null }
  /** Pedido do servidor que EXIGE resposta (sem ela o turno trava). O laço sempre nega. */
  | { tipo: "pedido_servidor"; id: IdRpc; metodo: string }
  | { tipo: "uso"; tokens: TokensAppServer }
  /** Notificação `error` do servidor (a mensagem crua fica só aqui). */
  | { tipo: "erro"; mensagem: string | null; vaiRepetir: boolean }
  | { tipo: "ignorado" };

type Obj = Record<string, unknown>;

const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ehId = (v: unknown): v is IdRpc => typeof v === "number" || typeof v === "string";

function linha(msg: Obj): string {
  return `${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`;
}

function pedido(id: IdRpc, method: string, params: Obj): string {
  return linha({ id, method, params });
}

export function pedidoInitialize(id: IdRpc, cliente: { nome: string; versao: string }): string {
  return pedido(id, "initialize", { clientInfo: { name: cliente.nome, title: "nod", version: cliente.versao } });
}

export function notificacaoInitialized(): string {
  return linha({ method: "initialized" });
}

/**
 * Thread efêmera do laço de voz: nada vai para o histórico do Codex, sem aprovação interativa (o nod decide pelo
 * proxy), sandbox só de leitura. As instruções de voz vão como `developerInstructions`, o mesmo canal que o
 * `codex exec` usa (`-c developer_instructions`).
 */
export function pedidoThreadStart(id: IdRpc, p: { modelo: string; instrucoes: string; cwd: string }): string {
  return pedido(id, "thread/start", {
    model: p.modelo,
    cwd: p.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    developerInstructions: p.instrucoes,
    ephemeral: true,
  });
}

const entradaTexto = (t: string) => [{ type: "text", text: t }];

export function pedidoTurnStart(id: IdRpc, p: { threadId: string; texto: string; esforco: EsforcoCodex }): string {
  return pedido(id, "turn/start", { threadId: p.threadId, input: entradaTexto(p.texto), effort: p.esforco });
}

/** Fala nova no meio de um turno: entra no turno em andamento, sem abrir outro. */
export function pedidoTurnSteer(id: IdRpc, p: { threadId: string; texto: string; turnoEsperado: string }): string {
  return pedido(id, "turn/steer", { threadId: p.threadId, input: entradaTexto(p.texto), expectedTurnId: p.turnoEsperado });
}

export function pedidoTurnInterrupt(id: IdRpc, p: { threadId: string; turnId: string }): string {
  return pedido(id, "turn/interrupt", { threadId: p.threadId, turnId: p.turnId });
}

/** definido em 2026-10-04: código JSON-RPC da recusa a pedido do servidor que o nod não sabe negar pelo formato. */
export const CODIGO_RECUSA_NOD = -32000;

/**
 * Resposta que NEGA um pedido do servidor (aprovação de comando, de arquivo, de permissão, elicitação de MCP). O laço
 * de voz nunca aprova nada pelo Codex: o que precisa de aprovação passa pelo nod. Método conhecido recebe a recusa no
 * formato dele; o resto recebe um erro JSON-RPC, que o servidor trata como recusa.
 */
export function respostaNegando(id: IdRpc, metodo: string): string {
  switch (metodo) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return linha({ id, result: { decision: "decline" } });
    // Protocolo v1 (ainda aceito pelo servidor): outro vocabulário.
    case "execCommandApproval":
    case "applyPatchApproval":
      return linha({ id, result: { decision: "denied" } });
    case "mcpServer/elicitation/request":
      return linha({ id, result: { action: "decline" } });
    default:
      return linha({ id, error: { code: CODIGO_RECUSA_NOD, message: "negado pelo nod" } });
  }
}

/** `thread/start` → `{thread: {id}}`; tolera `threadId` solto. */
export function idDaThread(resultado: Obj): string | null {
  return (ehObj(resultado.thread) ? texto(resultado.thread.id) : null) ?? texto(resultado.threadId);
}

/** `turn/start` → `{turn: {id}}`; `turn/steer` → `{turnId}`. */
export function idDoTurno(resultado: Obj): string | null {
  return (ehObj(resultado.turn) ? texto(resultado.turn.id) : null) ?? texto(resultado.turnId);
}

function nomeDaFerramenta(item: Obj): string | null {
  const tipo = texto(item.type);
  const ferramenta = texto(item.tool);
  if (tipo === "mcpToolCall" && ferramenta) return `mcp__${texto(item.server) ?? "nod"}__${ferramenta}`;
  if (tipo === "dynamicToolCall" && ferramenta) return ferramenta;
  return null;
}

function turnoDe(params: Obj): string | null {
  return texto(params.turnId) ?? (ehObj(params.turn) ? texto(params.turn.id) : null);
}

function interpretarNotificacao(metodo: string, params: Obj): EventoAppServer {
  switch (metodo) {
    case "item/agentMessage/delta": {
      const delta = texto(params.delta);
      if (delta === null) return { tipo: "ignorado" };
      return { tipo: "delta", threadId: texto(params.threadId), turnId: texto(params.turnId), itemId: texto(params.itemId), texto: delta };
    }
    case "turn/started":
      return { tipo: "turno_iniciado", turnId: turnoDe(params) };
    case "item/started":
    case "item/completed": {
      const item = ehObj(params.item) ? params.item : {};
      const tipoItem = texto(item.type) ?? "desconhecido";
      const fim = metodo === "item/completed";
      return {
        tipo: "item",
        fase: fim ? "fim" : "inicio",
        turnId: texto(params.turnId),
        itemId: texto(item.id),
        tipoItem,
        ferramenta: nomeDaFerramenta(item),
        falhou: fim && (item.status === "failed" || item.status === "declined" || (item.error !== undefined && item.error !== null)),
        texto: fim && tipoItem === "agentMessage" ? texto(item.text) : null,
      };
    }
    case "turn/completed": {
      const turno = ehObj(params.turn) ? params.turn : {};
      const status = turno.status === "interrupted" ? "interrupted" : turno.status === "failed" ? "failed" : "completed";
      // NOD-174: o motivo do Codex chega ao `erroCru` (redigido antes do corte); sem mensagem fica null, nunca o "erro"
      // genérico de antes. Interrompido não é falha do fornecedor: sem erro.
      const erro = status !== "interrupted" && ehObj(turno.error) ? redigirECortar(texto(turno.error.message), ERRO_CRU_APP_SERVER_MAX_CHARS) : null;
      return { tipo: "turno_concluido", turnId: turnoDe(params), status, erro };
    }
    case "thread/tokenUsage/updated": {
      const uso = ehObj(params.tokenUsage) && ehObj(params.tokenUsage.total) ? params.tokenUsage.total : null;
      if (!uso) return { tipo: "ignorado" };
      return { tipo: "uso", tokens: { entrada: numero(uso.inputTokens), saida: numero(uso.outputTokens), cacheLeitura: numero(uso.cachedInputTokens) } };
    }
    case "error": {
      const erro = ehObj(params.error) ? params.error : {};
      return { tipo: "erro", mensagem: redigirECortar(texto(erro.message), ERRO_CRU_APP_SERVER_MAX_CHARS), vaiRepetir: params.willRetry === true };
    }
    default:
      return { tipo: "ignorado" };
  }
}

/** Uma linha do stdout do app-server vira um evento; nada aqui lança. */
export function interpretarLinhaAppServer(linhaCrua: string): EventoAppServer {
  let v: unknown;
  try {
    v = JSON.parse(linhaCrua);
  } catch {
    return { tipo: "ignorado" };
  }
  if (!ehObj(v)) return { tipo: "ignorado" };
  const metodo = texto(v.method);
  const params = ehObj(v.params) ? v.params : {};
  // Pedido do servidor: tem método E id. Notificação: só método. Resposta: só id.
  if (metodo !== null && ehId(v.id)) return { tipo: "pedido_servidor", id: v.id, metodo };
  if (metodo !== null) return interpretarNotificacao(metodo, params);
  if (!ehId(v.id)) return { tipo: "ignorado" };
  if (ehObj(v.error)) return { tipo: "resposta_erro", id: v.id, codigo: typeof v.error.code === "number" ? v.error.code : null, mensagem: texto(v.error.message) ?? "" };
  return { tipo: "resposta", id: v.id, resultado: ehObj(v.result) ? v.result : {} };
}
