import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nivelDaGaveta } from "../../../web/telas/detalhes.ts";

/**
 * Defeitos achados no QA do épico #188 (definido em 2026-10-08: app real sobre banco efêmero, executor catcher, Chrome
 * headless e as pranchas do protótipo "Chat limpo" lado a lado). Cada teste falhava antes da correção.
 */

describe("gaveta: todo nível que a visão geral oferece abre", () => {
  it("a linha \"Trabalhos\" da gaveta abre o nível dos trabalhos (antes o clique não fazia nada)", () => {
    expect(nivelDaGaveta("trabalhos")).toEqual({ tipo: "trabalhos" });
  });

  it("cada irPara(…) desenhado em detalhes.ts tem nível no clique", () => {
    const fonte = readFileSync(new URL("../../../web/telas/detalhes.ts", import.meta.url), "utf8");
    const niveis = [...fonte.matchAll(/irPara\("([a-z-]+)"/g)].map((m) => m[1] ?? "");
    expect(niveis.length).toBeGreaterThan(5);
    for (const n of niveis) expect(nivelDaGaveta(n, "x"), n).not.toBeNull();
    expect(nivelDaGaveta("nao-existe")).toBeNull();
  });
});
