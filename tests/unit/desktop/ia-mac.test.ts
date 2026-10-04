import { describe, expect, it } from "vitest";
import { IAS_DESKTOP } from "../../../src/contracts/desktop.ts";
import { ambienteDoLogin, comandoDeLogin, INTERVALO_SONDA_IA_MS, lerIaDesktop, URL_INSTALAR_IA } from "../../../desktop/ia-mac.ts";

/**
 * Os cards de IA do onboarding no Mac (definido em 2026-10-04, ADR-077): a página remota só escolhe UMA das IAs
 * conhecidas; o comando do login e a URL da instalação são fixos do app, e o filho nasce sem chave de fornecedor.
 */
describe("lerIaDesktop", () => {
  it("aceita só os ids conhecidos", () => {
    for (const ia of IAS_DESKTOP) expect(lerIaDesktop(ia)).toBe(ia);
    for (const v of ["cursor-cli", "claude", "", null, undefined, 1, { id: "claude-cli" }, ["codex-cli"], "claude-cli; rm -rf ~"]) expect(lerIaDesktop(v)).toBeNull();
  });
});

describe("comandoDeLogin", () => {
  it("é o login do próprio CLI, sem shell nem argumento vindo da página", () => {
    expect(comandoDeLogin("claude-cli")).toEqual({ nome: "claude", args: ["auth", "login"] });
    expect(comandoDeLogin("codex-cli")).toEqual({ nome: "codex", args: ["login"] });
  });
});

describe("URL_INSTALAR_IA", () => {
  it("uma página oficial https por IA", () => {
    for (const ia of IAS_DESKTOP) expect(URL_INSTALAR_IA[ia]).toMatch(/^https:\/\/(docs\.anthropic\.com|developers\.openai\.com)\//);
  });
});

describe("ambienteDoLogin", () => {
  it("tira as chaves de fornecedor e as do nod; mantém o resto", () => {
    const env = ambienteDoLogin({ PATH: "/usr/bin", HOME: "/Users/x", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_ENTRYPOINT: "b", CLAUDECODE: "1", OPENAI_API_KEY: "c", OPENAI_BASE_URL: "d", CODEX_API_KEY: "e", NOD_SESSAO_SEGREDO: "f", LANG: "pt_BR.UTF-8", VAZIA: undefined });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/Users/x", LANG: "pt_BR.UTF-8" });
  });
});

it("sonda a cada 3 s", () => {
  expect(INTERVALO_SONDA_IA_MS).toBe(3_000);
});
