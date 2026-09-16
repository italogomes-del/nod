import { describe, expect, it } from "vitest";
import { montarFila, type DecisaoComNomes } from "../../../src/domain/fila-frota.ts";

const base: DecisaoComNomes = {
  tenantId: "t",
  id: "d1",
  ownerId: "p",
  decisorId: "p",
  agenteId: "a",
  agenteNome: "Vera",
  conversaId: "c",
  turnoId: null,
  tipo: "aprovacao",
  estado: "pendente",
  prazoDecisaoEm: new Date(200_000).toISOString(),
  prazoExecucaoEm: null,
  frase: "aprovar?",
  desfecho: null,
  vistaEm: null,
  criadoEm: new Date(100_000).toISOString(),
};

describe("montarFila", () => {
  it("item vencido continua visível em cinza — caso adversarial", () => {
    const fila = montarFila({ decisoes: [{ ...base, estado: "vencida", prazoDecisaoEm: new Date(50_000).toISOString() }], agora: 100_000 });
    expect(fila.itens).toHaveLength(1);
    expect(fila.itens[0]?.estadoColuna).toBe("vencido");
    expect(fila.vazio).toBe(false);
  });

  it("prazo estourado vira vencido mesmo se o estado ainda diz pendente; recusa automática nunca negativa", () => {
    const fila = montarFila({ decisoes: [{ ...base, prazoDecisaoEm: new Date(90_000).toISOString() }], agora: 100_000 });
    expect(fila.itens[0]?.estadoColuna).toBe("vencido");
    expect(fila.itens[0]?.recusaAutomaticaEmMs).toBe(0);
  });

  it("aguardandoHaMs e recusaAutomaticaEmMs saem de colunas ISO UTC; reaberto vai ao topo", () => {
    const fila = montarFila({
      decisoes: [base, { ...base, id: "d2", estado: "reaberta", criadoEm: new Date(150_000).toISOString() }],
      agora: 160_000,
    });
    expect(fila.itens[0]?.decisao.id).toBe("d2");
    expect(fila.itens[0]?.estadoColuna).toBe("reaberto");
    expect(fila.itens[1]?.aguardandoHaMs).toBe(60_000);
    expect(fila.itens[1]?.recusaAutomaticaEmMs).toBe(40_000);
  });

  it("agrupa por pessoa (decisor) e agente", () => {
    const fila = montarFila({
      decisoes: [base, { ...base, id: "d2", decisorId: "ana" }, { ...base, id: "d3", agenteId: "b", agenteNome: "Tuca" }],
      agora: 160_000,
    });
    expect(fila.grupos.map((g) => `${g.pessoaId}:${g.agenteNome}`)).toEqual(["p:Vera", "ana:Vera", "p:Tuca"]);
  });

  it("vazio traz carimbo da última decisão", () => {
    const fila = montarFila({ decisoes: [], agora: 1, ultimaDecisaoEm: "2026-09-16T12:00:00.000Z" });
    expect(fila.vazio).toBe(true);
    expect(fila.ultimaDecisaoEm).toBe("2026-09-16T12:00:00.000Z");
  });
});
