import { describe, expect, it } from "vitest";
import type { Pendencia } from "../../../src/contracts/pendencia.ts";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import {
  A_PARTIR_DE_MAX_MS,
  idDePendenciaValido,
  lerAPartirDe,
  mesmoTexto,
  normalizarTexto,
  PENDENCIAS_NO_PROMPT,
  pendenciaNoPrompt,
  pendenciasDoPrompt,
  TEXTO_PENDENCIA_NO_PROMPT,
  visivelAoBot,
} from "../../../src/domain/pendencia.ts";
import { montarPromptSistema } from "../../../src/domain/prompt-sistema.ts";

/**
 * Pendências do bot (ADR-064): o que ele deixou para depois volta na próxima rotina ou conversa. Sem alarme: a hora
 * (`a_partir_de`) só decide quando ela passa a aparecer para o bot.
 */
const AGORA = Date.parse("2026-09-30T15:50:00-03:00");
const MIN = 60_000;

function pendencia(extra: Partial<Pendencia> = {}): Pendencia {
  return { tenantId: "t", id: "0f8f7c1e-9a51-4d0e-8f3a-5a8a0b1c2d3e", agenteId: "chico", conversaId: "c1", turnoId: "t0", texto: "Cobrar do Dev 1 o parecer do PR #475", aPartirDe: null, cuidado: false, profundidade: 0, estado: "aberta", resolvidaEm: null, resolvidaPor: null, motivo: null, pedidaEm: null, criadoEm: AGORA - 5 * MIN, ...extra };
}

describe("a_partir_de: não antes de, sem alarme", () => {
  it("sem valor (ou vazio) é sem hora; no passado já vale; com fuso até um ano à frente vira instante", () => {
    expect(lerAPartirDe(undefined, AGORA)).toEqual({ ok: true, em: null });
    expect(lerAPartirDe("  ", AGORA)).toEqual({ ok: true, em: null });
    expect(lerAPartirDe("2026-09-30T14:00:00-03:00", AGORA)).toEqual({ ok: true, em: null });
    expect(lerAPartirDe("2026-09-30T16:20:00-03:00", AGORA)).toEqual({ ok: true, em: Date.parse("2026-09-30T19:20:00Z") });
    expect(lerAPartirDe("2026-10-01T13:00Z", AGORA)).toEqual({ ok: true, em: Date.parse("2026-10-01T13:00:00Z") });
  });

  it("sem fuso, fora do formato ou longe demais é inválido: a ferramenta devolve a instrução em vez de gravar hora errada", () => {
    expect(lerAPartirDe("2026-09-30T16:20:00", AGORA)).toEqual({ ok: false });
    expect(lerAPartirDe("amanhã às 10h", AGORA)).toEqual({ ok: false });
    expect(lerAPartirDe(new Date(AGORA + A_PARTIR_DE_MAX_MS + MIN).toISOString(), AGORA)).toEqual({ ok: false });
  });

  it("o bot vê a aberta sem hora ou com a hora passada; a de hora futura e a resolvida, não", () => {
    expect(visivelAoBot(pendencia(), AGORA)).toBe(true);
    expect(visivelAoBot(pendencia({ aPartirDe: AGORA - MIN }), AGORA)).toBe(true);
    expect(visivelAoBot(pendencia({ aPartirDe: AGORA }), AGORA)).toBe(true);
    expect(visivelAoBot(pendencia({ aPartirDe: AGORA + MIN }), AGORA)).toBe(false);
    expect(visivelAoBot(pendencia({ estado: "feita" }), AGORA)).toBe(false);
    expect(visivelAoBot(pendencia({ estado: "descartada" }), AGORA)).toBe(false);
  });
});

describe("a lista do prompt", () => {
  it("só as visíveis, da mais nova para a mais antiga, no máximo PENDENCIAS_NO_PROMPT", () => {
    const muitas = Array.from({ length: 14 }, (_, i) => pendencia({ id: `id-${String(i).padStart(2, "0")}`, texto: `tarefa ${i}`, criadoEm: AGORA - (20 - i) * MIN }));
    const futura = pendencia({ id: "futura", texto: "depois das 16:20", aPartirDe: AGORA + 30 * MIN, criadoEm: AGORA });
    const lista = pendenciasDoPrompt([...muitas, futura], AGORA);
    expect(lista).toHaveLength(PENDENCIAS_NO_PROMPT);
    expect(lista.map((p) => p.texto)).toEqual(["tarefa 13", "tarefa 12", "tarefa 11", "tarefa 10", "tarefa 9", "tarefa 8", "tarefa 7", "tarefa 6", "tarefa 5", "tarefa 4"]);
    expect(lista.some((p) => p.id === "futura")).toBe(false);
    // Passada a hora, ela entra — e é a mais nova.
    expect(pendenciasDoPrompt([...muitas, futura], AGORA + 31 * MIN)[0]?.id).toBe("futura");
  });

  it("cada linha leva id, texto cortado, quando foi anotada e o cuidado só quando há", () => {
    const longa = pendencia({ texto: "x".repeat(TEXTO_PENDENCIA_NO_PROMPT + 50) });
    const linha = pendenciaNoPrompt(longa);
    expect(linha.texto).toHaveLength(TEXTO_PENDENCIA_NO_PROMPT);
    expect(linha.texto.endsWith("…")).toBe(true);
    expect(linha).toEqual({ id: longa.id, texto: linha.texto, anotada_em: new Date(longa.criadoEm).toISOString() });
    expect(pendenciaNoPrompt(pendencia({ cuidado: true })).cuidado).toBe(true);
  });

  it("texto igual é o mesmo depois de normalizar espaços e maiúsculas; id de outro formato nem chega ao banco", () => {
    expect(normalizarTexto("  Cobrar   o Dev 1\n do parecer ")).toBe("Cobrar o Dev 1 do parecer");
    expect(mesmoTexto("Cobrar o Dev 1", "  cobrar   o DEV 1 ")).toBe(true);
    expect(mesmoTexto("Cobrar o Dev 1", "Cobrar o Dev 2")).toBe(false);
    expect(idDePendenciaValido("0f8f7c1e-9a51-4d0e-8f3a-5a8a0b1c2d3e")).toBe(true);
    expect(idDePendenciaValido("pendencia-1")).toBe(false);
  });
});

describe("o prompt com e sem pendências", () => {
  const agente = { nome: "Chico", titulo: "Tech Lead", descricao: "" };
  const f = (nome: string): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: { type: "object" } });
  const REGRA = "Pendências: vai deixar algo para depois? Anote com anotar_pendencia (o quê e para quem, e a_partir_de se tiver hora). Promessa sem pendência anotada se perde.";

  it("a regra entra onde anotar_pendencia está no catálogo, literal; sem ela, não", () => {
    const com = montarPromptSistema({ agente, memorias: [], ferramentas: [f("anotar_pendencia")], pessoaNome: "Marlon", modo: "delegacao", delegacao: { pessoaNome: "Marlon", remetenteNome: "Clarice" } });
    expect(com.split("\n")).toContain(REGRA);
    expect(montarPromptSistema({ agente, memorias: [], ferramentas: [f("lembrar")], pessoaNome: "Marlon", modo: "conversa" })).not.toContain("anotar_pendencia (o quê");
  });

  it("a lista vem depois da memória e antes do contexto; na rotina, resolver é novidade", () => {
    const entrada = { agente, memorias: [{ tenantId: "t", id: "m1", agenteId: "chico", tipo: "fato" as const, texto: "o time usa ClickUp", origem: "pessoa" as const, criadoEm: 1 }], ferramentas: [f("anotar_pendencia"), f("concluir_pendencia"), f("descartar_pendencia")], pessoaNome: "Marlon", contextoConversa: "{\"historico\":[]}", pendencias: [pendencia({ cuidado: true })] };
    const conversa = montarPromptSistema({ ...entrada, modo: "conversa" });
    const memoria = conversa.indexOf("- [fato] o time usa ClickUp");
    const lista = conversa.indexOf("Suas pendências abertas");
    const contexto = conversa.indexOf("Contexto recente da conversa");
    expect(memoria).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(memoria);
    expect(contexto).toBeGreaterThan(lista);
    expect(conversa).toContain("resolva neste turno as que der e marque cada uma com concluir_pendencia; descarte com descartar_pendencia, dizendo por quê, as que perderam o sentido; não repita trabalho já feito.");
    expect(conversa).toContain("\"cuidado\":true");
    expect(conversa).not.toContain("Numa rotina, resolver uma pendência é novidade");
    expect(montarPromptSistema({ ...entrada, modo: "rotina" })).toContain("Numa rotina, resolver uma pendência é novidade: conte em uma frase o que fez, em vez de chamar sem_novidade.");
    expect(montarPromptSistema({ ...entrada, modo: "conversa", pendencias: [] })).not.toContain("Suas pendências abertas");
  });
});
