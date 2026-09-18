import { describe, expect, it } from "vitest";
import { resolverHarness, validarInteligencia } from "../../../src/domain/harness.ts";

describe("escolha de inteligência", () => {
  it("escolhe uma conta conectada sem configurar harness ou modelo", () => {
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-sol" });
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "sonnet" });
  });
  it("respeita a preferência da máquina apenas quando disponível", () => {
    expect(resolverHarness({ modelo: "auto", prontos: ["codex-cli", "claude-cli"], preferido: "codex-cli" }).harness).toBe("codex-cli");
    expect(resolverHarness({ modelo: "auto", prontos: ["claude-cli"], preferido: "codex-cli" }).harness).toBe("claude-cli");
  });
  it("nunca troca silenciosamente um fornecedor escolhido nem simula falta de conexão", () => {
    expect(() => resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["claude-cli"] })).toThrow("executor_indisponivel");
    expect(() => resolverHarness({ modelo: "auto", prontos: [] })).toThrow("executor_indisponivel");
    expect(() => resolverHarness({ modelo: "sonnet", prontos: ["codex-cli"] })).toThrow("executor_indisponivel");
  });
  it("recusa combinação de fornecedores, harness não integrado e entrada inválida", () => {
    for (const [h, m] of [["codex-cli", "sonnet"], ["claude-cli", "gpt-6-astra"], ["hermes", "auto"], ["auto", "--model x"], ["auto", null], [null, "auto"]]) expect(() => validarInteligencia(h, m)).toThrow("entrada_invalida");
    expect(() => validarInteligencia("auto", "claude-haiku-4-5-20251001")).not.toThrow();
  });
});
