import { describe, expect, it } from "vitest";
import { FLAGS_DO_TURNO, montarArgs, montarEnvDoFilho } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { FLAG_FLOORS } from "../../../src/adapters/executor/flag-floors.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";

function planoDeTeste(parcial: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno {
  return {
    tenantId: "t",
    turnoId: "turno-1",
    conversaId: "c",
    agenteId: "a",
    localidade: "local",
    machineId: "m",
    executor: "local",
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: {
      ferramentas: [
        { nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: { type: "object" } },
        { nome: "ex__somar", nomeMcp: "mcp__nod__ex__somar", origem: "conector", conectorId: "k", readOnlyHint: true, tocaAprendiz: false, schema: { type: "object" } },
      ],
      servidores: [],
    },
    promptSistema: "Você é a Vera. Responda em português.",
    entrada: { texto: "oi", sessaoCli: null, modelo: "claude-haiku-4-5-20251001", maxTurnos: 12, ...parcial },
    politicaExecucao: { prazoMs: 3_600_000, orcamentoResultadoChars: 8000, efeitoExternoSoPorAprovacao: false },
    tokenDeTurno: "tok",
    expiraEm: 1,
  };
}

/** Valor que segue uma flag (ou null quando a flag não está). */
const valor = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

describe("montarArgs — contrato empírico do claude -p (mapa-cli 2026-09-16)", () => {
  it("contém as flags obrigatórias, --tools vazio e --allowedTools EXATO com o catálogo do plano", () => {
    const { args } = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/x/mcp.json" });
    expect(args[0]).toBe("-p");
    expect(valor(args, "--output-format")).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--strict-mcp-config");
    expect(valor(args, "--setting-sources")).toBe("project");
    expect(valor(args, "--mcp-config")).toBe("/tmp/x/mcp.json");
    expect(valor(args, "--tools")).toBe("");
    expect(valor(args, "--allowedTools")).toBe("mcp__nod__lembrar,mcp__nod__ex__somar");
    expect(valor(args, "--permission-mode")).toBe("default");
    expect(valor(args, "--model")).toBe("claude-haiku-4-5-20251001");
    expect(valor(args, "--max-turns")).toBe("12");
    expect(valor(args, "--append-system-prompt")).toBe("Você é a Vera. Responda em português.");
    // nunca as flags que liberam tudo
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args.some((a) => a.includes("bypassPermissions"))).toBe(false);
  });

  it("1º turno: --session-id com uuid novo; 2º turno: --resume o MESMO uuid e sem --session-id (s2c)", () => {
    const primeiro = montarArgs({ plano: planoDeTeste({ sessaoCli: null }), mcpJson: "m", sessaoNova: () => "11111111-1111-4111-8111-111111111111" });
    expect(valor(primeiro.args, "--session-id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(primeiro.args).not.toContain("--resume");
    expect(primeiro.sessaoCli).toBe("11111111-1111-4111-8111-111111111111");

    const segundo = montarArgs({ plano: planoDeTeste({ sessaoCli: primeiro.sessaoCli }), mcpJson: "m" });
    expect(valor(segundo.args, "--resume")).toBe("11111111-1111-4111-8111-111111111111");
    expect(segundo.args).not.toContain("--session-id");
  });

  it("envia Sonnet explicitamente ao CLI, inclusive numa sessão retomada", () => {
    const { args } = montarArgs({ plano: planoDeTeste({ modelo: "sonnet", sessaoCli: "sessao-sonnet" }), mcpJson: "m" });
    expect(valor(args, "--model")).toBe("sonnet");
    expect(valor(args, "--resume")).toBe("sessao-sonnet");
  });

  it("sem sessaoNova injetada, o uuid é v4", () => {
    const { sessaoCli } = montarArgs({ plano: planoDeTeste(), mcpJson: "m" });
    expect(sessaoCli).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("toda flag usada nos args tem piso na tabela de floors (ADR-014)", () => {
    const { args } = montarArgs({ plano: planoDeTeste(), mcpJson: "m" });
    const flagsUsadas = args.filter((a) => a.startsWith("--"));
    for (const f of flagsUsadas) expect(Object.keys(FLAG_FLOORS)).toContain(f);
    for (const f of flagsUsadas) expect(FLAGS_DO_TURNO).toContain(f);
  });

  it("env do filho: PATH aumentado, HOME e MCP_TOOL_TIMEOUT >= 60 s e >= prazo do turno", () => {
    const env = montarEnvDoFilho({ PATH: "/usr/bin", LANG: "pt_BR" }, "/Users/x", 5_000);
    expect(env.PATH?.split(":")).toContain("/Users/x/.local/bin");
    expect(env.HOME).toBe("/Users/x");
    expect(env.MCP_TOOL_TIMEOUT).toBe("60000");
    expect(montarEnvDoFilho({}, "/h", 120_000).MCP_TOOL_TIMEOUT).toBe("120000");
    expect(env.LANG).toBe("pt_BR");
  });
});
