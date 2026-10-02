import postgres from "postgres";
import type { Db } from "../shared/types.ts";

/**
 * Pool do postgres.js.
 * prepare:false — definido em 2026-09-16: o deploy alvo usa pooler em modo transação, que não
 * suporta prepared statements (ADR-001; o sintoma está descrito em docs/praticas-herdadas.md).
 * idle_timeout — é o parâmetro que de fato protege contra esgotamento, não o `max` (ADR-001).
 * onnotice — definido em 2026-09-16: NOTICE (ex. "drop cascades to ...") não é erro e o default do
 * postgres.js o imprime via console, fora do wrapper único de log (Práticas §10); silenciado aqui.
 */
export function criarDb(url: string, opcoes: { max?: number } = {}): Db {
  return postgres(url, {
    prepare: false,
    max: opcoes.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
  });
}
