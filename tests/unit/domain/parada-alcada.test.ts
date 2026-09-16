import { describe, expect, it } from "vitest";
import { classificarNegacao } from "../../../src/domain/parada-alcada.ts";

describe("classificarNegacao", () => {
  it("capacidade desligada é TERMINAL", () => {
    expect(classificarNegacao("capacidade-desligada", 0)).toBe("TERMINAL");
  });
  it("falha técnica é TRANSITÓRIA", () => {
    expect(classificarNegacao("falha-tecnica", 0)).toBe("TRANSITORIA");
  });
});
