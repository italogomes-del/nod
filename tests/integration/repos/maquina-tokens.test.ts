import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { vincularEscopo } from "../../../src/db/tx.ts";
import { maquinaTokensRepo } from "../../../src/repositories/maquina-tokens.repo.ts";
import { cunharChaveMaquina } from "../../../src/services/token-maquina.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { TENANT_PADRAO } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

/**
 * maquina_tokens sob RLS (ADR-031): a dona é a pessoa, sem perna extra. Tudo sob rollback, com pessoas
 * aleatórias (a tabela não referencia `pessoas`). O gate de conformidade confere as policies; aqui se
 * prova o COMPORTAMENTO que importa: outra pessoa não vê, não acha pelo hash e não revoga.
 */
describeIntegracao("maquina_tokens: só a dona vê, acha e revoga (ADR-031)", () => {
  it("cria sem a chave crua; outra pessoa não lista, não acha pelo hash e não revoga; revogada deixa de ser viva", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    await withRollback(dona, async (trx) => {
      const agora = Date.now();
      const cunhada = cunharChaveMaquina(dona);
      const criada = await maquinaTokensRepo(trx, dona).criar({ nome: "MacBook", prefixo: cunhada.prefixo, hash: cunhada.hash });
      expect(criada).toMatchObject({ nome: "MacBook", prefixo: cunhada.prefixo, revogadaEm: null });

      const [linha] = await trx`select * from maquina_tokens where id = ${criada?.id ?? ""}`;
      const textoDaLinha = JSON.stringify({ ...linha, hash: (linha?.hash as Buffer).toString("hex") });
      expect(textoDaLinha).not.toContain(cunhada.chave);
      expect(textoDaLinha).not.toContain(cunhada.chave.split(".")[1]);
      expect(linha).toMatchObject({ owner_id: dona.pessoaId, visibility: "privado" });

      expect(await maquinaTokensRepo(trx, dona).buscarVivaPorHash(cunhada.hash, agora)).toMatchObject({ id: criada?.id });

      await vincularEscopo(trx, outra);
      const daOutra = maquinaTokensRepo(trx, outra);
      expect(await daOutra.listar()).toEqual([]);
      expect(await daOutra.buscarVivaPorHash(cunhada.hash, agora)).toBeNull();
      expect(await daOutra.revogar(criada?.id ?? "", agora)).toBe(false);
      // Nem por SQL cru, sem o WHERE do repositório: a RLS esconde a linha.
      expect(await trx`select id from maquina_tokens where hash = ${cunhada.hash}`).toHaveLength(0);

      await vincularEscopo(trx, dona);
      const daDona = maquinaTokensRepo(trx, dona);
      expect(await daDona.revogar(criada?.id ?? "", agora)).toBe(true);
      expect(await daDona.buscarVivaPorHash(cunhada.hash, agora)).toBeNull();
      expect((await daDona.listar())[0]?.revogadaEm).toBe(agora);
    });
  });

  it("chave com expira_em no passado não é viva; com expira_em no futuro é", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    await withRollback(dona, async (trx) => {
      const agora = Date.now();
      const repo = maquinaTokensRepo(trx, dona);
      const c = cunharChaveMaquina(dona);
      const criada = await repo.criar({ nome: "expira", prefixo: c.prefixo, hash: c.hash });
      expect(await repo.buscarVivaPorHash(c.hash, agora)).not.toBeNull();
      await trx`update maquina_tokens set expira_em = ${new Date(agora - 1)} where id = ${criada?.id ?? ""}`;
      expect(await repo.buscarVivaPorHash(c.hash, agora)).toBeNull();
      await trx`update maquina_tokens set expira_em = ${new Date(agora + 60_000)} where id = ${criada?.id ?? ""}`;
      expect(await repo.buscarVivaPorHash(c.hash, agora)).not.toBeNull();
    });
  });

  it("hash único por tenant e com 32 bytes; nome vazio recusado pelo banco", async () => {
    const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    await withRollback(dona, async (trx) => {
      const repo = maquinaTokensRepo(trx, dona);
      const c = cunharChaveMaquina(dona);
      await repo.criar({ nome: "a", prefixo: c.prefixo, hash: c.hash });
      await expectRejected(trx, () => repo.criar({ nome: "b", prefixo: c.prefixo, hash: c.hash }), "23505");
      await expectRejected(trx, () => repo.criar({ nome: "c", prefixo: c.prefixo, hash: c.hash.subarray(0, 16) }), "23514");
      await expectRejected(trx, () => repo.criar({ nome: "  ", prefixo: c.prefixo, hash: cunharChaveMaquina(dona).hash }), "23514");
    });
  });
});
