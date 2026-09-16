import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NOD, NOMES_FERRAMENTAS_NOD, type JsonSchema } from "../../../src/contracts/ferramentas-nod.ts";
import { USE_CASE_POR_FERRAMENTA } from "../../../src/contracts/servicos.ts";

const ESPERADAS = ["lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina", "pedir_aprovacao", "pedir_a_pessoa", "passar", "encaminhar", "perguntar_a_bot"];

describe("FERRAMENTAS_NOD", () => {
  it("lista fechada com as NOVE ferramentas (EMENDA 16 inclui pedir_a_pessoa)", () => {
    expect([...NOMES_FERRAMENTAS_NOD].sort()).toEqual([...ESPERADAS].sort());
    expect(NOMES_FERRAMENTAS_NOD).toHaveLength(9);
  });

  it("nomes casam /^[a-z_]+$/ (viram mcp__nod__<nome> no CLI)", () => {
    for (const n of NOMES_FERRAMENTAS_NOD) expect(n).toMatch(/^[a-z_]+$/);
  });

  it("todo schema é type object com required, description e additionalProperties false", () => {
    for (const n of NOMES_FERRAMENTAS_NOD) {
      const s: JsonSchema = FERRAMENTAS_NOD[n];
      expect(s.type).toBe("object");
      expect(Array.isArray(s.required)).toBe(true);
      expect(typeof s.description).toBe("string");
      expect(s.additionalProperties).toBe(false);
      for (const r of s.required ?? []) expect(Object.keys(s.properties ?? {})).toContain(r);
    }
  });

  it("pedir_a_pessoa exige tipo com os três valores; pedir_aprovacao exige itens com destino tipado", () => {
    expect(FERRAMENTAS_NOD.pedir_a_pessoa.required).toContain("tipo");
    expect(FERRAMENTAS_NOD.pedir_a_pessoa.properties.tipo.enum).toEqual(["pergunta", "falta_de_dado", "permissao"]);
    expect(FERRAMENTAS_NOD.pedir_aprovacao.properties.itens.items.properties.destino.required).toEqual(["conector", "ferramenta", "argumentos"]);
  });

  it("cada ferramenta tem um caso de uso nomeado em UseCasesNod (EMENDA 5)", () => {
    expect(Object.keys(USE_CASE_POR_FERRAMENTA).sort()).toEqual([...ESPERADAS].sort());
    expect(new Set(Object.values(USE_CASE_POR_FERRAMENTA)).size).toBe(9);
  });
});
