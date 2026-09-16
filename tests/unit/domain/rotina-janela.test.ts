import { describe, expect, it } from "vitest";
import { assertFusoIana, proximaJanela, RotinaInvalida } from "../../../src/domain/rotina-janela.ts";

const TZ = "America/Sao_Paulo";

describe("rotina-janela", () => {
  it("recusa offset numérico", () => {
    expect(() => assertFusoIana("UTC-3")).toThrow(RotinaInvalida);
    expect(() => assertFusoIana("-03:00")).toThrow(RotinaInvalida);
    expect(() => assertFusoIana("GMT+3")).toThrow(RotinaInvalida);
  });

  it("aceita America/Sao_Paulo", () => {
    expect(() => assertFusoIana(TZ)).not.toThrow();
  });

  it("dois processos com a mesma entrada chegam ao mesmo instante", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00");
    const a = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    const b = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    expect(a).toBe(b);
  });

  it("todo dia às 8h a partir das 12h cai no dia seguinte às 8h de São Paulo", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00");
    const n = proximaJanela({ cron: "0 8 * * *", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2026-09-17T11:00:00.000Z");
  });

  it("toda segunda às 7h a partir de uma quarta cai na segunda seguinte", () => {
    const agora = Date.parse("2026-09-16T12:00:00-03:00"); // quarta
    const n = proximaJanela({ cron: "0 7 * * 1", fusoIana: TZ, agora });
    expect(new Date(n).toISOString()).toBe("2026-09-21T10:00:00.000Z");
  });
});
