import { describe, expect, it } from "vitest";
import { abrirTxEscopada, vincularEscopo } from "../../../src/db/tx.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import type { Db, Escopo, Tx } from "../../../src/shared/types.ts";

/** Sem banco: o que se prova aqui é que o escopo é OBRIGATÓRIO e não tem default (ADR-003). */
const dbQueNaoPodeSerTocado = new Proxy({} as Db, {
  get() {
    throw new Error("o banco não pode ser tocado sem escopo");
  },
});
const trxQueNaoPodeSerTocada = new Proxy({} as Tx, {
  get() {
    throw new Error("a transação não pode ser tocada sem escopo");
  },
});

/** Escopo que chegou incompleto de fora (JSON, env): um campo pode faltar. Um só `as`, nunca cast duplo. */
const escopoIncompleto = (parcial: Partial<Escopo>): Escopo => parcial as Escopo;

describe("tx: escopo obrigatório", () => {
  it.each([
    ["tenantId vazio", escopoIncompleto({ tenantId: "", pessoaId: "p" })],
    ["pessoaId vazio", escopoIncompleto({ tenantId: "t", pessoaId: "" })],
    ["tenantId ausente", escopoIncompleto({ pessoaId: "p" })],
    ["pessoaId ausente", escopoIncompleto({ tenantId: "t" })],
  ])("abrirTxEscopada lança escopo_vazio com %s, antes de tocar o banco", (_nome, escopo) => {
    try {
      abrirTxEscopada(dbQueNaoPodeSerTocado, escopo);
      expect.unreachable("deveria lançar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeDominio);
      expect((e as ErroDeDominio).codigo).toBe("escopo_vazio");
      expect((e as ErroDeDominio).seguro).toBe(true);
    }
  });

  it("vincularEscopo lança escopo_vazio antes de emitir qualquer SQL", async () => {
    await expect(vincularEscopo(trxQueNaoPodeSerTocada, { tenantId: "t", pessoaId: "" })).rejects.toMatchObject({ codigo: "escopo_vazio" });
    await expect(vincularEscopo(trxQueNaoPodeSerTocada, { tenantId: "", pessoaId: "p" })).rejects.toMatchObject({ codigo: "escopo_vazio" });
  });

  it("abrirTxEscopada recusa uma transação já aberta: no tipo e em runtime (escopo aninhado não existe)", () => {
    // Um objeto com a cara de TransactionSql (savepoint, sem begin). O SET LOCAL feito num SAVEPOINT
    // persiste após o RELEASE (medido em 2026-09-16 no psql), então isto seria escalada de escopo.
    const trxAberta = { savepoint: async (): Promise<void> => undefined };
    try {
      // @ts-expect-error o contrato é (db: Db): uma transação já aberta usa vincularEscopo
      abrirTxEscopada(trxAberta, { tenantId: "t", pessoaId: "p" });
      expect.unreachable("deveria lançar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErroDeDominio);
      expect((e as ErroDeDominio).codigo).toBe("estado_invalido");
    }
  });

  it("ErroDeDominio guarda o detalhe em cause, nunca na mensagem", () => {
    const e = new ErroDeDominio("nao_encontrado", { cause: "agente 123 de marlon@acme" });
    expect(e.message).toBe("nao_encontrado");
    expect(e.cause).toBe("agente 123 de marlon@acme");
  });
});
