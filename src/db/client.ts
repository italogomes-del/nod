import postgres from "postgres";
import type { Db } from "../shared/types.ts";

/**
 * Pool do postgres.js.
 * prepare:false — definido em 2026-09-16: o deploy alvo usa pooler em modo transação, que não
 * suporta prepared statements (ADR-001; a Leapy documenta o sintoma em packages/db/src/client.ts).
 * idle_timeout — é o parâmetro que de fato protege contra esgotamento, não o `max` (ADR-001).
 */
export function criarDb(url: string, opcoes: { max?: number } = {}): Db {
  return postgres(url, {
    prepare: false,
    max: opcoes.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}
