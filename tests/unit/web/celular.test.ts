import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaVisivel, CONSULTA_CELULAR, ehCelular, enterEnvia } from "../../../web/lib/celular.ts";

/** O Nod no celular (ADR-094): o que decide "é celular", a altura acima do teclado e o Enter. */
describe("celular", () => {
  it("é celular pelo toque, não pela largura: a mesma consulta no CSS e no código", () => {
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    expect(css).toContain(`@media ${CONSULTA_CELULAR} {`);
    // Cada ramo da consulta exige toque sem hover: janela estreita no Mac nunca vira celular.
    for (const ramo of CONSULTA_CELULAR.split(",")) expect(ramo).toMatch(/\(hover: none\) and \(pointer: coarse\)/);
    expect(ehCelular((q) => ({ matches: q === CONSULTA_CELULAR }))).toBe(true);
    expect(ehCelular(() => ({ matches: false }))).toBe(false);
    expect(ehCelular(undefined)).toBe(false);
  });

  it("areaVisivel: segue o viewport visual (teclado aberto) só no celular e sem zoom de pinça", () => {
    expect(areaVisivel({ height: 507.6, offsetTop: 12.2, scale: 1 }, true)).toEqual({ altura: 508, topo: 12 });
    expect(areaVisivel({ height: 508, offsetTop: -3, scale: 1 }, true)).toEqual({ altura: 508, topo: 0 });
    expect(areaVisivel({ height: 300, offsetTop: 0, scale: 2 }, true)).toBeNull();
    expect(areaVisivel({ height: 508, offsetTop: 0, scale: 1 }, false)).toBeNull();
    expect(areaVisivel(null, true)).toBeNull();
  });

  it("Enter: no computador envia; no celular quebra a linha; acento em composição nunca envia", () => {
    const tecla = (o: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...o });
    expect(enterEnvia(tecla(), false)).toBe(true);
    expect(enterEnvia(tecla({ shiftKey: true }), false)).toBe(false);
    expect(enterEnvia(tecla(), true)).toBe(false);
    expect(enterEnvia(tecla({ metaKey: true }), true)).toBe(true);
    expect(enterEnvia(tecla({ ctrlKey: true }), true)).toBe(true);
    expect(enterEnvia(tecla({ isComposing: true }), false)).toBe(false);
    expect(enterEnvia(tecla({ key: "a" }), false)).toBe(false);
  });
});
