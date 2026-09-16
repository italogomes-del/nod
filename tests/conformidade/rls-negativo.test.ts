import { expect, it } from "vitest";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { avaliar, lerTabelas } from "./gate-rls.ts";

/**
 * O primeiro teste contra o gate é NEGATIVO (Leapy §Riscos): cria uma tabela sem RLS de propósito
 * e confirma que o gate a acusa. Se este teste passar sem acusar, o gate tem falso-negativo e a
 * garantia central do ADR-003 ficou sem verificação.
 */
describeIntegracao("gate: teste negativo", () => {
  it("uma tabela com tenant_id e sem RLS é acusada com todas as faltas", async () => {
    await withRollback({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON }, async (trx) => {
      await trx.unsafe(`create temp table _sem_rls (tenant_id uuid not null, id uuid primary key)`);
      const violacoes = avaliar(await lerTabelas(trx));
      const minhas = violacoes.filter((v) => v.startsWith("_sem_rls:"));
      expect(minhas).toEqual([
        "_sem_rls: sem ENABLE ROW LEVEL SECURITY",
        "_sem_rls: sem FORCE ROW LEVEL SECURITY",
        "_sem_rls: sem policy PERMISSIVE nod_pessoa",
        "_sem_rls: sem policy RESTRICTIVE nod_tenant",
      ]);
      // Só a tabela de propósito viola: o resto do banco continua verde.
      expect(violacoes.filter((v) => !v.startsWith("_sem_rls:"))).toEqual([]);
    });
  });

  it("uma tabela sem tenant_id e sem exceção escrita também é acusada", async () => {
    await withRollback({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON }, async (trx) => {
      await trx.unsafe(`create temp table _sem_tenant (id uuid primary key)`);
      const violacoes = avaliar(await lerTabelas(trx));
      expect(violacoes).toContain("_sem_tenant: sem coluna tenant_id e sem exceção escrita");
    });
  });

  it("passar pela nod_escopar_tabela deixa a tabela verde no gate", async () => {
    await withRollback({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON }, async (trx) => {
      await trx.unsafe(`create temp table _escopada (id uuid primary key)`);
      await trx.unsafe(`select nod_escopar_tabela('_escopada')`);
      expect(avaliar(await lerTabelas(trx))).toEqual([]);
    });
  });
});
