import type { EventoStream } from "../contracts/turno.ts";

/** definido em 2026-09-18: normaliza eventos de codex exec --json; custo desconhecido permanece null. */
export function interpretarCodex(linha: string): EventoStream[] {
  let v: Record<string, unknown>;
  try { const j: unknown = JSON.parse(linha); if (!j || typeof j !== "object" || Array.isArray(j)) return []; v = j as Record<string, unknown>; } catch { return []; }
  const item = v.item && typeof v.item === "object" ? v.item as Record<string, unknown> : {};
  if (v.type === "thread.started") return [{ tipo: "init", sessaoCli: "", ferramentas: [], modelo: "", versaoCli: "", apiKeySource: "desconhecido" }];
  if (v.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") return [{ tipo: "delta", texto: item.text }];
  if (v.type === "item.started" && item.type === "mcp_tool_call") return [{ tipo: "tool_use", id: String(item.id ?? ""), nome: `mcp__${String(item.server ?? "nod")}__${String(item.tool ?? "")}`, input: item.arguments }];
  if (v.type === "item.completed" && item.type === "mcp_tool_call") return [{ tipo: "tool_result", toolUseId: String(item.id ?? ""), isError: item.status === "failed", texto: "" }];
  if (v.type !== "turn.completed" && v.type !== "turn.failed") return [];
  const usage = v.usage && typeof v.usage === "object" ? v.usage as Record<string, unknown> : {};
  const n = (key: string) => typeof usage[key] === "number" && Number.isFinite(usage[key]) ? usage[key] as number : 0;
  return [{ tipo: "result", sucesso: v.type === "turn.completed", subtype: v.type === "turn.completed" ? "success" : "error", erroCru: null, sessaoCli: null, texto: "", custoUsd: null,
    tokens: { entrada: n("input_tokens"), saida: n("output_tokens"), cacheLeitura: n("cached_input_tokens"), cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [] }];
}
