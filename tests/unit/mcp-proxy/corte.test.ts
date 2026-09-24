import { describe, expect, it } from "vitest";
import { cortar } from "../../../src/adapters/mcp-proxy/corte.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../../../src/shared/constantes.ts";

describe("corte ao orçamento (ADR-013)", () => {
  it("dentro do orçamento passa intacto", () => {
    expect(cortar("abc", 10)).toEqual({ texto: "abc", cortado: false, original: 3 });
    expect(cortar("a".repeat(ORCAMENTO_RESULTADO_CHARS), ORCAMENTO_RESULTADO_CHARS).cortado).toBe(false);
  });

  it("acima do orçamento corta e a marca diz quanto ficou de fora — o modelo não inventa o resto", () => {
    const r = cortar("x".repeat(100), 40);
    expect(r.cortado).toBe(true);
    expect(r.original).toBe(100);
    expect(r.texto.startsWith("x".repeat(40))).toBe(true);
    expect(r.texto).toContain("[cortado pelo nod: 60 de 100 caracteres ficaram de fora; orçamento do turno = 40.");
    expect(r.texto).toContain("refaça a chamada pedindo menos itens ou só metadados]");
  });

  it("nunca parte um par substituto ao meio", () => {
    const emoji = "😀"; // dois code units
    const r = cortar(`ab${emoji}cd`, 3);
    expect(r.texto.startsWith("ab\n")).toBe(true);
    expect(r.texto).not.toContain("\uD83D\n");
  });

  it("orçamento zero ou negativo vira marca só", () => {
    expect(cortar("abc", 0).texto.startsWith("\n[cortado")).toBe(true);
    expect(cortar("abc", -5).texto.startsWith("\n[cortado")).toBe(true);
  });
});
