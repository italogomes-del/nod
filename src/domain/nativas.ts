import type { Confianca } from "../contracts/mensagem.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * Ferramentas nativas de arquivo do Claude Code liberadas quando há projeto autorizado (ADR-039). Bash fica
 * fora: --restricted remove as ferramentas que rodam comando, e comando continua indo ao container do nod.
 * Medido em 2026-09-18: com --restricted, ler fora das pastas permitidas é NEGADO pelo CLI (aparece em
 * permission_denials), por caminho relativo e absoluto, e o CLAUDE.md do projeto é ignorado.
 */
export const NATIVAS_DE_ARQUIVO = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"] as const;

/**
 * Quais nativas o turno recebe. definido em 2026-09-28: só turno de CONVERSA e CONFIÁVEL. Até aqui qualquer
 * turno de uma conversa com pasta autorizada ganhava Write/Edit nativos — inclusive a continuação com a
 * resposta de um colega (não confiável) e a retomada de rotina com gate. As nativas não passam pelo proxy:
 * não há moldura nem catálogo reduzido que as segure (ADR-026), então o único gate possível é não ligá-las.
 */
export function nativasDoTurno(t: { modo: ModoTurno; confianca: Confianca; pastasAutorizadas: boolean }): readonly string[] {
  return t.pastasAutorizadas && t.modo === "conversa" && t.confianca === "confiavel" ? NATIVAS_DE_ARQUIVO : [];
}
