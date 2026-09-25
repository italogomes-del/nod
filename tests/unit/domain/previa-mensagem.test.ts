import { describe, expect, it } from "vitest";
import { PREVIA_MAX, previaDaMensagem } from "../../../src/domain/descricao-agente.ts";

describe("prévia da última mensagem na sidebar (definido em 2026-09-24)", () => {
  it("tira ênfase e código, colapsa quebras e espaços", () => {
    expect(previaDaMensagem("O Dev 1 **não revisou** o PR.\n\n1. `pedir_acesso`   falta")).toBe("O Dev 1 não revisou o PR. 1. pedir_acesso falta");
  });

  it("corta numa linha com reticências", () => {
    const p = previaDaMensagem("a".repeat(PREVIA_MAX + 50));
    expect(p).toHaveLength(PREVIA_MAX);
    expect(p?.endsWith("…")).toBe(true);
  });

  it("texto vazio ou só marcação vira null — a linha mostra o estado do agente", () => {
    expect(previaDaMensagem("")).toBeNull();
    expect(previaDaMensagem("  **  \n ")).toBeNull();
  });
});
