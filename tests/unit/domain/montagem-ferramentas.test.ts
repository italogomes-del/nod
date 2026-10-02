import { describe, expect, it } from "vitest";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { montarFerramentas } from "../../../src/domain/montagem-ferramentas.ts";

const f = (nome: string, origem: "nod" | "conector" = "conector"): FerramentaPlano => ({
  nome,
  nomeMcp: `mcp__nod__${nome}`,
  origem,
  conectorId: origem === "conector" ? "k" : null,
  readOnlyHint: false,
  tocaDadoPessoal: false,
  schema: { type: "object" },
});

describe("montarFerramentas", () => {
  it("lista vazia significa nada", () => {
    expect(montarFerramentas({ catalogo: [f("slack__enviar")], allowlistAgente: [], alcanceCanal: null, profundidade: 0 })).toEqual([]);
  });

  it("ausente significa tudo que o catálogo permite", () => {
    const cat = [f("slack__enviar")];
    expect(montarFerramentas({ catalogo: cat, allowlistAgente: null, alcanceCanal: null, profundidade: 0 })).toEqual(cat);
  });

  it("profundidade 1 remove pedir_a_bot e encaminhar ESTRUTURALMENTE (E12.4, ADR-058), sem flag de bypass", () => {
    const cat = [f("pedir_a_bot", "nod"), f("encaminhar", "nod"), f("lembrar", "nod"), f("slack__enviar")];
    const r = montarFerramentas({ catalogo: cat, allowlistAgente: null, alcanceCanal: null, profundidade: 1 });
    expect(r.map((x) => x.nome)).toEqual(["lembrar", "slack__enviar"]);
  });
});
