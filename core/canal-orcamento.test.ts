import { describe, expect, it } from "vitest";
import { avaliarOrcamento } from "./canal-orcamento.ts";

describe("canal-orcamento", () => {
  it("anel de três agentes é recusado — caso adversarial", () => {
    const r = avaliarOrcamento({
      estado: { ultimosPostsAgenteIds: ["a", "b"], postsSemHumano: 2, ultimoPostEm: 0 },
      candidatoAgenteId: "c",
      eRotina: false,
      agora: 60_000,
    });
    expect(r).toBe("recusar");
  });

  it("rotina é isenta", () => {
    const r = avaliarOrcamento({
      estado: { ultimosPostsAgenteIds: ["a", "b"], postsSemHumano: 2, ultimoPostEm: 0 },
      candidatoAgenteId: "c",
      eRotina: true,
      agora: 60_000,
    });
    expect(r).toBe("permitir");
  });
});
