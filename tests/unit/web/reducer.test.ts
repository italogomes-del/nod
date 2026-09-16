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
      ownerId: "p",
      visibility: "privado",
      nome: "LGPD",
      titulo: "",
      descricao: "x",
      dono: "pessoa",
      forma: "shape-square",
      cor: "c-pink",
      fixado: false,
      oculto: false,
      confirmado: true,
      modelo: "claude-haiku-4-5-20251001",
      duplicadoDe: null,
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
