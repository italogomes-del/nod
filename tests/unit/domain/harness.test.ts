import { describe, expect, it } from "vitest";
import { HARNESSES, type CatalogoHarness } from "../../../src/contracts/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { causaHarnessIndisponivel, harnessFixado, iaAtualDoCatalogo, inventarioHarnessSemSonda, modeloMaisPotente, motivoHarnessIndisponivel, resolverHarness, validarInteligencia } from "../../../src/domain/harness.ts";

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
  it("o mais potente acompanha o Fable mais novo no Claude e é o topo do catálogo no Codex", () => {
    expect(modeloMaisPotente("claude-cli")).toBe("fable");
    expect(modeloMaisPotente("codex-cli")).toBe("gpt-6-astra");
    expect(modeloMaisPotente("hermes")).toBeNull();
  });

  describe("NOD-171: harness fixado e indisponível", () => {
    const causaDe = (f: () => unknown) => { try { f(); } catch (e) { return causaHarnessIndisponivel(e); } return null; };
    it("diz qual harness faltou", () => {
      expect(causaDe(() => resolverHarness({ harness: "codex-cli", modelo: "auto", prontos: ["claude-cli"] }))).toEqual({ harness: "codex-cli" });
      expect(causaDe(() => resolverHarness({ modelo: "sonnet", prontos: ["codex-cli"] }))).toEqual({ harness: "claude-cli" });
      expect(causaDe(() => resolverHarness({ modelo: "auto", prontos: [] }))).toBeNull();
    });
    it("modelo inválido vira indisponibilidade com causa, não entrada_invalida (sem laço na fila)", () => {
      expect(() => resolverHarness({ harness: "codex-cli", modelo: "sonnet", prontos: ["codex-cli"] })).toThrow("executor_indisponivel");
      expect(causaDe(() => resolverHarness({ harness: "codex-cli", modelo: "sonnet", prontos: ["codex-cli"] }))).toEqual({ harness: "codex-cli", modelo: "sonnet", motivo: "modelo_invalido" });
      expect(causaDe(() => resolverHarness({ modelo: "gpt-zz", prontos: ["claude-cli"] }))).toEqual({ harness: "claude-cli", modelo: "gpt-zz", motivo: "modelo_invalido" });
    });
    it("modelo gravado antes continua resolvendo", () => {
      expect(resolverHarness({ modelo: "haiku", prontos: ["claude-cli"] })).toEqual({ harness: "claude-cli", modelo: "haiku" });
      expect(resolverHarness({ harness: "codex-cli", modelo: "gpt-5.6-luna", prontos: ["codex-cli"] })).toEqual({ harness: "codex-cli", modelo: "gpt-5.6-luna" });
    });
    it("harnessFixado: auto/auto não fixa; modelo do Claude fixa no Claude", () => {
      expect(harnessFixado("auto", "auto")).toBeNull();
      expect(harnessFixado("auto", "opus")).toBe("claude-cli");
      expect(harnessFixado("codex-cli", "auto")).toBe("codex-cli");
    });
    it("a negação nomeia o harness escolhido e o estado dele, nunca 'motor pronto'", () => {
      const ausente = motivoHarnessIndisponivel("codex-cli", { estado: "ausente", motivo: "Harness não encontrado neste computador", em: 0 });
      expect(ausente).toBe("Codex não instalado: Harness não encontrado neste computador");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "ausente", causa: "cli_antigo", versao: "0.158.0", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.0) é mais antigo", em: 0 })).toContain("Codex desatualizado");
      expect(motivoHarnessIndisponivel("claude-cli", { estado: "nao_autenticado", motivo: "faça login", em: 0 })).toBe("Claude Code sem conta conectada: faça login");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "pronto", versao: "1", em: 0 })).toBe("Codex indisponível");
      expect(motivoHarnessIndisponivel("codex-cli", { estado: "pronto", versao: "1", em: 0 }, "sonnet")).toContain("modelo sonnet");
      for (const t of [ausente]) expect(t).not.toContain("motor pronto");
    });
    it("sem sonda do harness não afirma 'não instalado'", () => {
      expect(motivoHarnessIndisponivel("codex-cli", inventarioHarnessSemSonda(0))).toBe("Codex não está pronto em nenhum computador conectado");
    });
  });
});

describe("NOD-171 (revisão): a IA 'atual' do modo compartilhado", () => {
  const catalogo = (padrao: CatalogoHarness["padrao"], inv: Record<string, Inventario>): CatalogoHarness => ({
    padrao, simulacao: false,
    opcoes: HARNESSES.map((h) => ({ ...h, integrado: h.id === "claude-cli" || h.id === "codex-cli" ? true : h.integrado, inventario: inv[h.id] ?? { estado: "ausente", motivo: "não encontrado", em: 0 } })),
  });
  const antigo: Inventario = { estado: "ausente", motivo: "abaixo do piso", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", em: 0 };

  it("com uma IA pronta, é o padrão do catálogo", () => {
    expect(iaAtualDoCatalogo(catalogo("codex-cli", { "codex-cli": { estado: "pronto", em: 0 } as Inventario }))).toBe("codex-cli");
  });
  it("sem nenhuma pronta, o Codex desatualizado vence o Claude ausente", () => {
    expect(iaAtualDoCatalogo(catalogo(null, { "codex-cli": antigo }))).toBe("codex-cli");
  });
  it("sem nada no Mac, segue o Claude", () => {
    expect(iaAtualDoCatalogo(catalogo(null, {}))).toBe("claude-cli");
  });
});
