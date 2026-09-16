import { describe, expect, it } from "vitest";
import { redigir } from "./redacao.ts";

describe("redacao", () => {
  it("rotina sem resposta NÃO envia — caso adversarial", () => {
    const t = redigir("rotina-sem-resposta", 0);
    expect(t).toMatch(/nada foi enviado/i);
    expect(t).not.toMatch(/tent(e|ar) de novo/i);
  });
});
