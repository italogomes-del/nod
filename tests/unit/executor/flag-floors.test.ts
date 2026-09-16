import { describe, expect, it } from "vitest";
import { compararVersoes, conferirFloors, extrairVersao, FLAG_FLOORS, flagsListadasNoHelp } from "../../../src/adapters/executor/flag-floors.ts";

describe("flag floors (ADR-014: 19 versões de CLI, uma tabela de pisos)", () => {
  it("extrairVersao lê x.y.z da saída do --version e null do resto", () => {
    expect(extrairVersao("2.1.272 (Claude Code)")).toBe("2.1.272");
    expect(extrairVersao("v10.0.1\n")).toBe("10.0.1");
    expect(extrairVersao("sem versão")).toBeNull();
  });

  it("compararVersoes é numérica, não lexicográfica", () => {
    expect(compararVersoes("2.1.272", "2.1.9")).toBe(1);
    expect(compararVersoes("2.1.9", "2.1.272")).toBe(-1);
    expect(compararVersoes("2.1.272", "2.1.272")).toBe(0);
    expect(compararVersoes("2.1", "2.1.0")).toBe(0);
    expect(compararVersoes("3.0.0", "2.99.99")).toBe(1);
  });

  it("versão no piso ou acima passa; abaixo recusa com cli_antigo e lista as flags", () => {
    expect(conferirFloors({ versao: "2.1.272", flags: ["--strict-mcp-config", "--max-turns"] })).toEqual({ ok: true });
    expect(conferirFloors({ versao: "9.0.0", flags: ["--tools"] })).toEqual({ ok: true });
    const r = conferirFloors({ versao: "2.0.1", flags: ["--strict-mcp-config", "--tools"] });
    expect(r).toEqual({ ok: false, motivo: "cli_antigo", abaixo: ["--strict-mcp-config", "--tools"] });
  });

  it("abaixo do piso, uma flag listada no --help passa; a oculta (--max-turns) só passa pelo piso", () => {
    const help = "  --strict-mcp-config   Only use MCP servers from --mcp-config\n  --tools <tools...>  ...";
    const r = conferirFloors({ versao: "2.0.1", flags: ["--strict-mcp-config", "--tools", "--max-turns"], flagsNoHelp: flagsListadasNoHelp(help) });
    expect(r).toEqual({ ok: false, motivo: "cli_antigo", abaixo: ["--max-turns"] });
    const oculta = conferirFloors({ versao: "2.0.1", flags: ["--max-turns"], flagsNoHelp: ["--max-turns"] });
    expect(oculta.ok).toBe(false);
  });

  it("flagsListadasNoHelp extrai todas as opções longas, inclusive as duas grafias de allowedTools", () => {
    const flags = flagsListadasNoHelp("  --allowedTools, --allowed-tools <tools...>\n  -p, --print  Print\n  --mcp-config <configs...>");
    expect(flags).toEqual(expect.arrayContaining(["--allowedTools", "--allowed-tools", "--print", "--mcp-config"]));
    expect(flags).not.toContain("-p");
  });

  it("a tabela cobre as flags do contrato empírico e marca --max-turns como oculta no help (medido em 2026-09-16)", () => {
    expect(FLAG_FLOORS["--max-turns"].ocultaNoHelp).toBe(true);
    for (const [flag, regra] of Object.entries(FLAG_FLOORS)) {
      expect(flag.startsWith("--")).toBe(true);
      expect(regra.piso).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
