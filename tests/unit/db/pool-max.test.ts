import { describe, expect, it } from "vitest";
import { lerPoolMax, POOL_MAX_PADRAO } from "../../../src/db/client.ts";

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
