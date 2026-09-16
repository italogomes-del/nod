import { describe, expect, it } from "vitest";
import { chaveNegada, montarAmbiente } from "../../../src/domain/ambiente-executor.ts";

describe("montarAmbiente", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/Users/x",
    ANTHROPIC_API_KEY: "sk-vazou",
    ANTHROPIC_BASE_URL: "http://proxy",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "abc",
    CLAUDE_PID: "42",
    CLAUDE_EFFORT: "high",
    NOD_SESSAO_SEGREDO: "segredo",
    NOD_CREDENTIAL_KEY: "chave",
    EDITOR: "vim",
  };

  it("regime local herda o ambiente MENOS a denylist (medido em 2026-09-16: run.sh da sonda; apiKeySource='none')", () => {
    const r = montarAmbiente("local", source);
    expect(r.PATH).toBe("/usr/bin");
    expect(r.HOME).toBe("/Users/x");
    expect(r.EDITOR).toBe("vim");
    expect(r.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(r.CLAUDECODE).toBeUndefined();
    expect(r.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(r.CLAUDE_PID).toBeUndefined();
    expect(r.CLAUDE_EFFORT).toBeUndefined();
    expect(r.NOD_SESSAO_SEGREDO).toBeUndefined();
    expect(r.NOD_CREDENTIAL_KEY).toBeUndefined();
  });

  it("regime servidor parte de {} e copia só a allowlist — chave solta NÃO sai daqui", () => {
    const r = montarAmbiente("servidor", source);
    expect(Object.keys(r).sort()).toEqual(["HOME", "PATH"]);
    expect(r.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("valor undefined no source não vira 'undefined' no filho", () => {
    const r = montarAmbiente("local", { PATH: "/bin", VAZIA: undefined });
    expect("VAZIA" in r).toBe(false);
  });

  it("chaveNegada casa a denylist por prefixo e por nome", () => {
    expect(chaveNegada("CLAUDE_CODE_QUALQUER")).toBe(true);
    expect(chaveNegada("ANTHROPIC_AUTH_TOKEN")).toBe(true);
    expect(chaveNegada("NOD_HOME")).toBe(true);
    expect(chaveNegada("CLAUDECODE")).toBe(true);
    expect(chaveNegada("CLAUDE")).toBe(false);
    expect(chaveNegada("PATH")).toBe(false);
  });
});
