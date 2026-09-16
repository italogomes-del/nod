import { describe, expect, it } from "vitest";
import { abrirTxEscopada, vincularEscopo } from "../../../src/db/tx.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import type { Db, Tx } from "../../../src/shared/types.ts";

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

describe("tx: escopo obrigatório", () => {
  it.each([
    ["tenantId vazio", { tenantId: "", pessoaId: "p" }],
    ["pessoaId vazio", { tenantId: "t", pessoaId: "" }],
    ["tenantId undefined", { tenantId: undefined as unknown as string, pessoaId: "p" }],
    ["pessoaId undefined", { tenantId: "t", pessoaId: undefined as unknown as string }],
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

  it("ErroDeDominio guarda o detalhe em cause, nunca na mensagem", () => {
    const e = new ErroDeDominio("nao_encontrado", { cause: "agente 123 de marlon@leapy" });
    expect(e.message).toBe("nao_encontrado");
    expect(e.cause).toBe("agente 123 de marlon@leapy");
  });
});
