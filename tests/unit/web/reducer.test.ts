import { describe, expect, it } from "vitest";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import type { Snapshot } from "../../../web/estado/reducer.ts";

const snap: Snapshot = {
  tenantId: "t",
  pessoa: { tenantId: "t", id: "p", nome: "M", iniciais: "MW" },
  agentes: [
    {
      tenantId: "t",
      id: "a1",
      nome: "LGPD",
      instrucoes: "x",
      dono: { tipo: "pessoa", pessoaId: "p" },
      forma: "shape-square",
      cor: "c-pink",
      secao: "sem-secao",
      favorito: false,
      confirmado: true,
      criadoEm: 1,
    },
  ],
  rotinas: [],
  concessoes: [],
  catalogo: [],
  mensagens: [],
};

describe("reducer", () => {
  it("hidratar seleciona o primeiro agente se nenhum atual", () => {
    const e = reduzir(estadoInicial, { tipo: "hidratar", snapshot: snap });
    expect(e.agenteAtualId).toBe("a1");
  });
});
