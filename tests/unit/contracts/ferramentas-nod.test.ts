import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NOD, NOMES_FERRAMENTAS_NOD, type JsonSchema, type NomeFerramentaNod } from "../../../src/contracts/ferramentas-nod.ts";
import { HTML_MAX_ARTEFATO, TITULO_MAX_ARTEFATO } from "../../../src/contracts/artefato.ts";
import { USE_CASE_POR_FERRAMENTA } from "../../../src/contracts/servicos.ts";

const ESPERADAS = [
  "lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina",
  "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina",
  "pedir_aprovacao", "pedir_a_pessoa", "passar", "encaminhar", "sem_novidade", "perguntar_a_bot", "delegar_tarefa",
  "ver_colegas",
  "publicar_artefato", "ler_artefato",
];

describe("FERRAMENTAS_NOD", () => {
  it("lista fechada com as DEZENOVE ferramentas (EMENDA 16 inclui pedir_a_pessoa; 2026-09-21 traz sem_novidade e o ciclo de vida de rotina; 2026-09-24 traz delegar_tarefa; 2026-09-28 traz ver_colegas e o artefato, ADR-051)", () => {
    expect([...NOMES_FERRAMENTAS_NOD].sort()).toEqual([...ESPERADAS].sort());
    expect(NOMES_FERRAMENTAS_NOD).toHaveLength(ESPERADAS.length);
  });

  it("NOMES_FERRAMENTAS_NOD é literal (EMENDA 26) e cobre TODAS as chaves de FERRAMENTAS_NOD, no tipo e em runtime", () => {
    // Se uma chave nova entrar em FERRAMENTAS_NOD sem entrar na lista, `Faltando` deixa de ser never e esta linha não compila.
    type Faltando = Exclude<NomeFerramentaNod, (typeof NOMES_FERRAMENTAS_NOD)[number]>;
    const cobreTudo: [Faltando] extends [never] ? true : never = true;
    expect(cobreTudo).toBe(true);
    expect([...NOMES_FERRAMENTAS_NOD].sort()).toEqual(Object.keys(FERRAMENTAS_NOD).sort());
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

  it("atualizar_perfil aceita as rotinas que vêm com o perfil, no MESMO schema de criar_rotina (ADR-050)", () => {
    expect(FERRAMENTAS_NOD.atualizar_perfil.properties.rotinas.items).toBe(FERRAMENTAS_NOD.criar_rotina);
    expect(FERRAMENTAS_NOD.atualizar_perfil.required).toEqual([]);
  });

  it("ADR-051: os tetos dos schemas do artefato são os de artefato.ts (o schema precisa de literal; a regra mora no contrato)", () => {
    expect(FERRAMENTAS_NOD.publicar_artefato.properties.titulo.maxLength).toBe(TITULO_MAX_ARTEFATO);
    expect(FERRAMENTAS_NOD.publicar_artefato.properties.html.maxLength).toBe(HTML_MAX_ARTEFATO);
    expect(FERRAMENTAS_NOD.publicar_artefato.required).toEqual(["titulo", "html"]);
    expect(FERRAMENTAS_NOD.ler_artefato.required).toEqual(["artefato_id"]);
  });

  it("cada ferramenta tem um caso de uso nomeado em UseCasesNod (EMENDA 5)", () => {
    expect(Object.keys(USE_CASE_POR_FERRAMENTA).sort()).toEqual([...ESPERADAS].sort());
    // Um caso de uso DISTINTO por ferramenta: duas ferramentas não compartilham implementação.
    expect(new Set(Object.values(USE_CASE_POR_FERRAMENTA)).size).toBe(ESPERADAS.length);
  });
});
