import { describe, expect, it } from "vitest";
import { montarAmbienteExecutor } from "./ambiente-executor.ts";

describe("ambiente-executor", () => {
  it("chave solta no ambiente do servidor NÃO sai daqui", () => {
    const r = montarAmbienteExecutor({
      credenciais: { ANTHROPIC_API_KEY: "sk-tenant" },
    });
    expect(r.ANTHROPIC_API_KEY).toBe("sk-tenant");
    expect(r["PATH"]).toBeUndefined();
    expect(Object.keys(r)).toEqual(["ANTHROPIC_API_KEY"]);
  });
});
