import { expect, it } from "vitest";
import { paraCadaPessoa } from "../../src/adapters/fundo/escopos-de-fundo.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };

describeIntegracao("escopos de fundo (paraCadaPessoa)", () => {
  it("visita cada pessoa com o escopo certo, numa transação escopada por pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      // O envelope do withRollback vira o "db" do laço: a tx por pessoa nasce como SAVEPOINT
      // e as pessoas inseridas aqui (nunca do seed) são as que o laço enumera.
      await trx`insert into tenants (id, nome) values (${TENANT_LEAPY}, 'Leapy') on conflict do nothing`;
      await trx`insert into pessoas (tenant_id, id, nome, iniciais) values
        (${TENANT_LEAPY}, ${PESSOA_MARLON}, 'Marlon', 'MW'), (${TENANT_LEAPY}, ${PESSOA_ANA}, 'Ana', 'AN')
        on conflict do nothing`;

      const visitados: { escopo: Escopo; noBanco: string }[] = [];
      await paraCadaPessoa(trx, async (escopo, tx) => {
        const noBanco = await tx(async (t) => {
          const [r] = await t`select current_setting('nod.pessoa_id') as p`;
          return r?.p as string;
        });
        visitados.push({ escopo, noBanco });
      });

      const ids = visitados.map((v) => v.escopo.pessoaId).sort();
      expect(ids).toEqual([PESSOA_MARLON, PESSOA_ANA].sort());
      for (const v of visitados) {
        expect(v.escopo.tenantId).toBe(TENANT_LEAPY);
        expect(v.noBanco).toBe(v.escopo.pessoaId);
      }
    });
  });

  it("uma pessoa que falha não impede as outras", async () => {
    await withRollback(MARLON, async (trx) => {
      await trx`insert into tenants (id, nome) values (${TENANT_LEAPY}, 'Leapy') on conflict do nothing`;
      await trx`insert into pessoas (tenant_id, id, nome, iniciais) values
        (${TENANT_LEAPY}, ${PESSOA_MARLON}, 'Marlon', 'MW'), (${TENANT_LEAPY}, ${PESSOA_ANA}, 'Ana', 'AN')
        on conflict do nothing`;
      const falhas: string[] = [];
      const ok: string[] = [];
      await paraCadaPessoa(
        trx,
        async (escopo) => {
          if (escopo.pessoaId === PESSOA_ANA) throw new Error("ana falhou");
          ok.push(escopo.pessoaId);
        },
        (escopo) => falhas.push(escopo.pessoaId),
      );
      expect(ok).toEqual([PESSOA_MARLON]);
      expect(falhas).toEqual([PESSOA_ANA]);
    });
  });

  it("abrirTxEscopada com pessoaId '' lança escopo_vazio antes de tocar o banco", () => {
    expect(() => abrirTxEscopada(db, { tenantId: TENANT_LEAPY, pessoaId: "" })).toThrow(ErroDeDominio);
    try {
      abrirTxEscopada(db, { tenantId: "", pessoaId: PESSOA_MARLON });
    } catch (e) {
      expect((e as ErroDeDominio).codigo).toBe("escopo_vazio");
    }
  });
});
