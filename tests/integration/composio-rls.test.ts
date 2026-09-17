import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";

const marlon = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ana = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };

describeIntegracao("credenciais Composio são privadas por pessoa", () => {
  it("outra pessoa não lê, altera ou publica a chave da dona", async () => {
    await withRollback(marlon, async (tx) => {
      const m = criarRepos(tx, marlon);
      await m.composio.salvarChave("cifrado-apenas-teste");
      expect(await m.composio.chave()).toBe("cifrado-apenas-teste");
      await expectRejected(tx, () => tx`update composio_configuracoes set visibility = 'equipe'`, "23514");
      await vincularEscopo(tx, ana);
      expect(await criarRepos(tx, ana).composio.chave()).toBeNull();
      expect(await tx`select id from composio_configuracoes`).toEqual([]);
      expect((await tx`update composio_configuracoes set chave_cifrada = 'alterada' where owner_id = ${marlon.pessoaId}`).count).toBe(0);
      await vincularEscopo(tx, marlon);
      expect(await m.composio.chave()).toBe("cifrado-apenas-teste");
    });
  });
});
