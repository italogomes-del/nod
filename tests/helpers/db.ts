import { afterAll } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import type { Db } from "../../src/shared/types.ts";

/**
 * Pool ÚNICO em cache de módulo, como nod_app (NOBYPASSRLS) em DATABASE_URL_TEST.
 * NÃO conecte como nod_dono aqui: o dono escapa da RLS e a suíte ficaria verde provando nada
 * (tests/conformidade/rls.test.ts assere rolbypassrls = false).
 *
 * max: 4 — não aperte: transações concorrentes enfileiradas deixam os testes de concorrência
 * verdes provando nada (Leapy §13).
 *
 * LINHA DE BASE — medido em 2026-09-16: `time npm run test:integration` = 2,92 s de parede
 * (25 testes em 7 arquivos, vitest "Duration 1.59s", Postgres 16 em Docker nesta máquina, max 4).
 * Se a suíte de integração degradar por ordem de grandeza, é aqui que se compara.
 */
export const db: Db = criarDb(process.env.DATABASE_URL_TEST ?? "postgres://sem-banco", { max: 4 });

afterAll(async () => {
  await db.end({ timeout: 1 });
});
