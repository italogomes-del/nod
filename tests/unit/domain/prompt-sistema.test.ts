import { describe, expect, it } from "vitest";
import type { Memoria } from "../../../src/contracts/memoria.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { MEMORIAS_NO_PROMPT, montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";

const agente = { nome: "Vera", titulo: "revisora de PRs", descricao: "Revisa PRs do time nod e responde curto." };
const f = (nome: string): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: { type: "object" } });
const mem = (id: string, texto: string, criadoEm: number): Memoria => ({ tenantId: "t", id, agenteId: "a", tipo: "preferencia", texto, origem: "pessoa", criadoEm });

describe("montarPromptSistema", () => {
  it("expõe os colegas como dados e explica a continuação assíncrona apenas quando pode consultar", () => {
    const entrada = { agente, memorias: [], pessoaNome: "Marlon", modo: "conversa" as const, colegas: [{ id: "tuca", nome: "Tuca", titulo: "Atendimento", descricao: "Conhece os clientes" }] };
    const prompt = montarPromptSistema({ ...entrada, ferramentas: [f("perguntar_a_bot")] });
    expect(prompt).toContain('"nome":"Tuca"');
    expect(prompt).toContain("Conhece os clientes");
    expect(prompt).toContain("Nunca invente a resposta do colega");
    expect(montarPromptSistema({ ...entrada, ferramentas: [] })).not.toContain('"nome":"Tuca"');
  });
  it("é estável: mesma entrada em ordem diferente produz a mesma string (cache ephemeral_1h)", () => {
    const a = montarPromptSistema({ agente, memorias: [mem("m1", "tópicos", 1), mem("m2", "curto", 2)], ferramentas: [f("lembrar"), f("pedir_aprovacao")], pessoaNome: "Marlon", modo: "conversa" });
    const b = montarPromptSistema({ agente, memorias: [mem("m2", "curto", 2), mem("m1", "tópicos", 1)], ferramentas: [f("pedir_aprovacao"), f("lembrar")], pessoaNome: "Marlon", modo: "conversa" });
    expect(a).toBe(b);
  });

  it("fixa o idioma, lista as únicas ferramentas e avisa que memória não é fonte", () => {
    const p = montarPromptSistema({ agente, memorias: [mem("m1", "prefiro tópicos", 1)], ferramentas: [f("lembrar")], pessoaNome: "Marlon", modo: "conversa" });
    expect(p).toContain("Responda sempre em português do Brasil");
    expect(p).toContain("As únicas ferramentas disponíveis são: mcp__nod__lembrar");
    expect(p).toContain("não substitui fonte autoritativa");
    expect(p).toContain("- [preferencia] prefiro tópicos");
  });

  it("modo criacao instrui a chamar atualizar_perfil; sem ferramentas diz 'nenhuma'", () => {
    const p = montarPromptSistema({ agente: { ...agente, nome: "Novo agente", titulo: "", descricao: "" }, memorias: [], ferramentas: [], pessoaNome: "Marlon", modo: "criacao" });
    expect(p).toContain("atualizar_perfil");
    expect(p).toContain("nenhuma");
    expect(p).not.toContain("O que você faz");
  });

  it("memória é limitada para o prompt não crescer sem teto", () => {
    const muitas = Array.from({ length: MEMORIAS_NO_PROMPT + 5 }, (_, i) => mem(`m${i}`, `fato ${i}`, i));
    const p = montarPromptSistema({ agente, memorias: muitas, ferramentas: [], pessoaNome: "M", modo: "conversa" });
    expect(p.split("\n- [").length - 1).toBe(MEMORIAS_NO_PROMPT);
  });
});
