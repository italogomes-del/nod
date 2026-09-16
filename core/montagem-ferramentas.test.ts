import { describe, expect, it } from "vitest";
import { montarFerramentas } from "./montagem-ferramentas.ts";

describe("montarFerramentas", () => {
  it("lista vazia significa nada", () => {
    const r = montarFerramentas({
      catalogo: [{ nome: "slack.enviar", conectorId: "slack", capacidadeId: "enviar-mensagem" }],
      allowlistAgente: [],
      alcanceCanal: null,
      profundidadeMaxima: false,
    });
    expect(r).toEqual([]);
  });

  it("ausente significa tudo que o catálogo permite", () => {
    const cat = [{ nome: "slack.enviar", conectorId: "slack", capacidadeId: "enviar-mensagem" }];
    const r = montarFerramentas({
      catalogo: cat,
      allowlistAgente: null,
      alcanceCanal: null,
      profundidadeMaxima: false,
    });
    expect(r).toEqual(cat);
  });
});
