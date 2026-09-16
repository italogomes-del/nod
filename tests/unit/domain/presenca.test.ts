import { describe, expect, it } from "vitest";
import { OFFLINE_MS } from "../../../src/shared/constantes.ts";
import { presencaMaquina } from "../../../src/domain/presenca.ts";

describe("presencaMaquina (derivada do poll, sem heartbeat)", () => {
  it("online dentro da janela, offline depois, nunca_vista sem poll", () => {
    expect(presencaMaquina(1_000, 1_000 + OFFLINE_MS)).toBe("online");
    expect(presencaMaquina(1_000, 1_001 + OFFLINE_MS)).toBe("offline");
    expect(presencaMaquina(null, 5)).toBe("nunca_vista");
  });
});
