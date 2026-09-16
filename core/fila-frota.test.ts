import { describe, expect, it } from "vitest";
import { montarFila } from "./fila-frota.ts";
import type { Decisao } from "../contracts/decisao.ts";

const base: Decisao & { empresaId: string } = {
  id: { tenantId: "t", id: "d1" },
  estado: "pendente",
  expiresAt: 200,
  source: "user",
  agenteId: "a",
  criadoEm: 100,
  empresaId: "leapy",
};

describe("montarFila", () => {
  it("item vencido continua visível em cinza — caso adversarial", () => {
    const fila = montarFila({
      decisoes: [{ ...base, estado: "vencida", expiresAt: 50 }],
      agora: 100,
    });
    expect(fila).toHaveLength(1);
    expect(fila[0]?.estado).toBe("vencido");
  });

  it("prazo estourado vira vencido mesmo se o estado ainda diz pendente", () => {
    const fila = montarFila({
      decisoes: [{ ...base, expiresAt: 90 }],
      agora: 100,
    });
    expect(fila[0]?.estado).toBe("vencido");
  });
});
