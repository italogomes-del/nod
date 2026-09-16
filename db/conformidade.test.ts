import { describe, it } from "vitest";

describe("conformidade RLS (ADR-003)", () => {
  it.skip("percorre pg_policies quando DATABASE_URL existir — primeira versão funcional usa o store JSON", () => {
    // Liga na primeira migração Postgres. Sem banco aqui, o gate não é fé: é skip explícito.
  });
});
