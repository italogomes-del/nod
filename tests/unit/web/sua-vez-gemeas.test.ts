import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderDecisoesDaConversa } from "../../../web/telas/sua-vez.ts";

type Item = SuaVezDto["itens"][number];

const CONVERSA = "c1";
const FRASE = "Conceder a Cecília leitura em gmail: GMAIL_FETCH_EMAILS";

function item(id: string, p: { tipo?: Item["decisao"]["tipo"]; frase?: string; turnoId?: string } = {}): Item {
  return {
    decisao: {
      tenantId: "t1",
      id,
      ownerId: "p1",
      decisorId: "p1",
      agenteId: "a1",
      conversaId: CONVERSA,
      turnoId: p.turnoId ?? "t-1",
      tipo: p.tipo ?? "acesso",
      estado: "pendente",
      prazoDecisaoEm: new Date(Date.now() + 86_400_000).toISOString(),
      prazoExecucaoEm: null,
      frase: p.frase ?? FRASE,
      desfecho: null,
      vistaEm: null,
      criadoEm: new Date().toISOString(),
    },
    estadoColuna: "pendente",
    agenteNome: "Cecília",
    aguardandoHaMs: 1000,
    recusaAutomaticaEmMs: 86_400_000,
    itensAprovacao: [],
    proposta: null,
  };
}

const render = (itens: Item[]) =>
  renderDecisoesDaConversa({ ...estadoInicial, suaVez: { itens, foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } }, CONVERSA, new Set());
const quantosCards = (html: string) => html.split("<li").length - 1;

/**
 * Medido em 2026-09-21: três pedidos de acesso iguais viraram três decisões com a MESMA frase e a tela
 * mostrou as três, sem nada distinguindo qual estava viva. A pessoa resolvia uma e as outras ficavam.
 */
describe("decisões da conversa: pedidos de acesso gêmeos aparecem uma vez só", () => {
  it("colapsa decisões de acesso com a mesma frase, mesmo vindas de turnos diferentes, e mantém a mais antiga", () => {
    const html = render([item("primeira"), item("segunda", { turnoId: "t-2" }), item("terceira", { turnoId: "t-3" })]);
    expect(quantosCards(html)).toBe(1);
    // A primeira da lista é a mais antiga (listarSuaVez ordena por criado_em) e é a que vence primeiro.
    expect(html).toContain("primeira");
    expect(html).not.toContain("segunda");
  });

  it("frases diferentes seguem sendo cards distintos", () => {
    const html = render([item("a"), item("b", { frase: "Conceder a Cecília leitura em slack: SLACK_FIND_USERS" })]);
    expect(quantosCards(html)).toBe(2);
  });

  it("aprovação repete a frase legitimamente (itens diferentes): não colapsa", () => {
    const html = render([
      item("ap1", { tipo: "aprovacao", frase: "Ação no computador do bot" }),
      item("ap2", { tipo: "aprovacao", frase: "Ação no computador do bot" }),
    ]);
    expect(quantosCards(html)).toBe(2);
  });
});
