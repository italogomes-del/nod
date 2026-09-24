import { describe, expect, it } from "vitest";
import type { Memoria } from "../../../src/contracts/memoria.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import { INSTRUCAO_ROTINA_NO_PROMPT, MEMORIAS_NO_PROMPT, montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";

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

  it("expõe o inventário de rotinas com id, só para quem pode agir sobre rotina existente", () => {
    const rotinas = [{ id: "r-relatorio", resumo: "dias úteis às 08:00 (America/Sao_Paulo)", instrucao: "Resumir os PRs abertos", estado: "ativa" as const }];
    const entrada = { agente, memorias: [], pessoaNome: "Marlon", modo: "conversa" as const, rotinas };
    const p = montarPromptSistema({ ...entrada, ferramentas: [f("pausar_rotina")] });
    expect(p).toContain('"id":"r-relatorio"');
    expect(p).toContain("dias úteis às 08:00");
    expect(p).toContain('"estado":"ativa"');
    expect(p).toContain("use o id EXATO");
    // criar_rotina sozinha não age sobre rotina existente: inventário seria contexto morto.
    expect(montarPromptSistema({ ...entrada, ferramentas: [f("criar_rotina")] })).not.toContain("r-relatorio");
    expect(montarPromptSistema({ ...entrada, ferramentas: [] })).not.toContain("Inventário de rotinas");
  });

  it("manda desambiguar com a pessoa em vez de escolher a rotina por conta própria", () => {
    const rotinas = [
      { id: "r-1", resumo: "todo dia às 09:00 (UTC)", instrucao: "Resumir vendas", estado: "ativa" as const },
      { id: "r-2", resumo: "toda segunda às 09:00 (UTC)", instrucao: "Resumir vendas da semana", estado: "pausada" as const },
    ];
    const p = montarPromptSistema({ agente, memorias: [], pessoaNome: "Marlon", modo: "conversa", ferramentas: [f("excluir_rotina")], rotinas });
    expect(p).toContain("pedir_a_pessoa");
    expect(p).toContain("não escolha por conta própria");
  });

  it("inventário é estável e a instrução é truncada (o prompt é cacheado por agente)", () => {
    const longa = "x".repeat(INSTRUCAO_ROTINA_NO_PROMPT + 50);
    const r = (id: string, instrucao: string) => ({ id, resumo: "todo dia às 08:00 (UTC)", instrucao, estado: "ativa" as const });
    const base = { agente, memorias: [], pessoaNome: "Marlon", modo: "conversa" as const, ferramentas: [f("listar_rotinas")] };
    const a = montarPromptSistema({ ...base, rotinas: [r("r-a", longa), r("r-b", "curta")] });
    const b = montarPromptSistema({ ...base, rotinas: [r("r-b", "curta"), r("r-a", longa)] });
    expect(a).toBe(b);
    expect(a).not.toContain(longa);
    expect(a).toContain("x".repeat(INSTRUCAO_ROTINA_NO_PROMPT));
  });

  it("ADR-044: rotina sem acesso pede por pedir_acesso (leitura, capacidades []) e encerra — nunca por pedir_a_pessoa", () => {
    const p = montarPromptSistema({ agente, memorias: [], ferramentas: [f("pedir_acesso"), f("pedir_a_pessoa")], pessoaNome: "Marlon", modo: "rotina" });
    expect(p).toContain("Se faltar acesso a um app, chame pedir_acesso com o slug, capacidades [] e nivel leitura, e encerre");
    expect(p).toContain("a rotina roda de novo sozinha");
    expect(p).toContain("Nunca use pedir_a_pessoa para pedir acesso");
    expect(p).toContain("Se a consulta falhar por erro técnico, diga o erro em uma frase");
    expect(p).not.toContain("informe o bloqueio");
  });

  it("ADR-044: na rotina entram só os slugs — o catálogo de cada conexão (~4-5 mil tokens) fica de fora", () => {
    const conectores = [{ tenantId: "t", id: "k1", ownerId: "p", visibility: "privado" as const, nome: "Interno", slug: "interno", transporte: "stdio" as const, comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca" as const, habilitado: true, catalogo: [{ nome: "LER_TUDO", descricao: "lê tudo", schema: { type: "object" as const }, readOnlyHint: true }], sondadoEm: 1, ultimaFalha: null, criadoEm: 0 }];
    const rotina = montarPromptSistema({ agente, memorias: [], ferramentas: [f("pedir_acesso")], pessoaNome: "Marlon", modo: "rotina", conectores });
    expect(rotina).not.toContain("Conexões cadastradas");
    expect(rotina).not.toContain("Apps do marketplace");
    expect(rotina).not.toContain("LER_TUDO");
    expect(rotina).toMatch(/Apps que você pode pedir com pedir_acesso \(slug\): [a-z_, ]*gmail[a-z_, ]*interno/);
    const conversa = montarPromptSistema({ agente, memorias: [], ferramentas: [f("pedir_acesso")], pessoaNome: "Marlon", modo: "conversa", conectores });
    expect(conversa).toContain("Conexões cadastradas");
    expect(conversa).toContain("Apps do marketplace");
    expect(conversa).toContain("LER_TUDO");
    // Sem pedir_acesso no catálogo, nenhuma das duas formas aparece.
    expect(montarPromptSistema({ agente, memorias: [], ferramentas: [], pessoaNome: "Marlon", modo: "rotina", conectores })).not.toContain("pedir_acesso (slug)");
  });

  it("memória é limitada para o prompt não crescer sem teto", () => {
    const muitas = Array.from({ length: MEMORIAS_NO_PROMPT + 5 }, (_, i) => mem(`m${i}`, `fato ${i}`, i));
    const p = montarPromptSistema({ agente, memorias: muitas, ferramentas: [], pessoaNome: "M", modo: "conversa" });
    expect(p.split("\n- [").length - 1).toBe(MEMORIAS_NO_PROMPT);
  });
});
