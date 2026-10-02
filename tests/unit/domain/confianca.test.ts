import { describe, expect, it } from "vitest";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { catalogoReduzido, propagarConfianca } from "../../../src/domain/confianca.ts";

const f = (nome: string, origem: "nod" | "conector", readOnlyHint: boolean): FerramentaPlano => ({
  nome, nomeMcp: `mcp__nod__${nome}`, origem, conectorId: origem === "conector" ? "k" : null, readOnlyHint, tocaDadoPessoal: false, schema: { type: "object" },
});

describe("confianca", () => {
  it("qualquer entrada não confiável contamina (ADR-026)", () => {
    expect(propagarConfianca(["confiavel", "confiavel"])).toBe("confiavel");
    expect(propagarConfianca(["confiavel", "nao_confiavel"])).toBe("nao_confiavel");
    expect(propagarConfianca([])).toBe("confiavel");
  });

  it("regra reducao_por_confianca v1: remove só conector sem readOnlyHint; nod fica (pedir_aprovacao é o caminho)", () => {
    const r = catalogoReduzido([f("lembrar", "nod", false), f("pedir_aprovacao", "nod", false), f("ex__listar", "conector", true), f("ex__enviar", "conector", false)]);
    expect(r.map((x) => x.nome)).toEqual(["lembrar", "pedir_aprovacao", "ex__listar"]);
  });
});
