import { describe, expect, it } from "vitest";
import { lerPoolMax, POOL_MAX_PADRAO } from "../../../src/db/client.ts";
import { TIMEOUTS_TX } from "../../../src/db/tx.ts";
import { CHAMADA_COM_ARQUIVO_MS } from "../../../src/services/conectores-vivos.ts";

/** NOD-266, critério 4: o tamanho do pool vem de NOD_DB_POOL_MAX; sem env, 15; inválido derruba o boot. */
describe("lerPoolMax", () => {
  it("sem NOD_DB_POOL_MAX (ou vazio), 15", () => {
    expect(POOL_MAX_PADRAO).toBe(15);
    expect(lerPoolMax({})).toBe(15);
    expect(lerPoolMax({ NOD_DB_POOL_MAX: "" })).toBe(15);
    expect(lerPoolMax({ NOD_DB_POOL_MAX: "  " })).toBe(15);
  });

  it.each([["1", 1], ["8", 8], [" 20 ", 20], ["50", 50]])("respeita %j → %d", (bruto, n) => {
    expect(lerPoolMax({ NOD_DB_POOL_MAX: bruto })).toBe(n);
  });

  it.each(["0", "51", "-3", "2.5", "1e1", "abc", "0x10", "15abc"])("recusa %j com mensagem que nomeia a variável", (bruto) => {
    expect(() => lerPoolMax({ NOD_DB_POOL_MAX: bruto })).toThrow(/NOD_DB_POOL_MAX/);
  });
});

/**
 * Revisão do PR #321: o idle_in_transaction (660 s até a NOD-263) só é seguro enquanto for MAIOR que a chamada de
 * conector mais longa que roda dentro da tx (a com arquivo). Quem subir CHAMADA_COM_ARQUIVO_MS sem subir o idle faz o
 * Postgres matar a tx no meio de uma chamada legítima — este teste quebra antes.
 */
describe("idle_in_transaction × chamada de conector com arquivo", () => {
  it("o idle da tx é maior que CHAMADA_COM_ARQUIVO_MS", () => {
    const m = /^(\d+)s$/.exec(TIMEOUTS_TX.idleNaTx);
    expect(m, `idleNaTx em segundos: ${TIMEOUTS_TX.idleNaTx}`).not.toBeNull();
    expect(Number(m?.[1]) * 1_000).toBeGreaterThan(CHAMADA_COM_ARQUIVO_MS);
  });
});
