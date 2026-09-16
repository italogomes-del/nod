import type { Conn, Escopo } from "../shared/types.ts";
import type { eventsRepo } from "./events.repo.ts";
import type { outboxRepo } from "./outbox.repo.ts";
import type { pessoasRepo } from "./pessoas.repo.ts";

/**
 * Regras de repositório (Leapy §1, ADR-018 refinado): factory `xRepo(conn: Conn, escopo: Escopo)`
 * aceita Db | Tx na primeira linha; WHERE tenant_id explícito mesmo sob RLS (segunda camada);
 * devolve T | null ou T[], nunca lança. L3 completa `Repos`.
 */
export type Fabrica<R> = (conn: Conn, escopo: Escopo) => R;

export interface Repos {
  pessoas: ReturnType<typeof pessoasRepo>;
  events: ReturnType<typeof eventsRepo>;
  outbox: ReturnType<typeof outboxRepo>;
}
