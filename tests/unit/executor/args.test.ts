import { describe, expect, it } from "vitest";
import { CLAUDE_MD_DAS_PASTAS, FLAGS_DO_TURNO, montarArgs, montarEnvDoFilho } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { FLAG_FLOORS } from "../../../src/adapters/executor/flag-floors.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { NATIVAS_DE_ARQUIVO } from "../../../src/domain/nativas.ts";

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
    entrada: { texto: "oi", sessaoCli: null, modelo: "claude-haiku-4-5-20251001", ...parcial },
    semprePermitir: [],
    politicaExecucao: { prazoMs: 3_600_000, orcamentoResultadoChars: 8000 },
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
  it("contém as flags obrigatórias, --tools só com a busca e --allowedTools EXATO com o catálogo do plano", () => {
    const { args } = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/x/mcp.json" });
    expect(args[0]).toBe("-p");
    expect(valor(args, "--output-format")).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--strict-mcp-config");
    expect(valor(args, "--setting-sources")).toBe("project");
    expect(valor(args, "--mcp-config")).toBe("/tmp/x/mcp.json");
    // 2026-09-28 (modo dev): a ToolSearch vai sempre — sem ela toda definição de MCP entra em toda chamada.
    expect(valor(args, "--tools")).toBe("ToolSearch");
    expect(valor(args, "--allowedTools")).toBe("mcp__nod__lembrar,mcp__nod__ex__somar,ToolSearch");
    expect(valor(args, "--permission-mode")).toBe("default");
    expect(valor(args, "--model")).toBe("claude-haiku-4-5-20251001");
    // definido em 2026-09-18: sem teto de passos — quem limita o turno é o watchdog de atividade.
    expect(args).not.toContain("--max-turns");
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

  it("0037: o esforço do bot vira --effort só quando o help da versão instalada traz a flag", () => {
    const plano = { ...planoDeTeste(), entrada: { ...planoDeTeste().entrada, esforco: "high" as const } };
    expect(valor(montarArgs({ plano, mcpJson: "m", esforco: true }).args, "--effort")).toBe("high");
    expect(montarArgs({ plano, mcpJson: "m", esforco: false }).args).not.toContain("--effort");
    expect(montarArgs({ plano: planoDeTeste(), mcpJson: "m", esforco: true }).args).not.toContain("--effort");
    expect(Object.keys(FLAG_FLOORS)).toContain("--effort");
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
    expect(env[CLAUDE_MD_DAS_PASTAS]).toBeUndefined();
  });

  it("no kit do terminal, o CLAUDE.md dos projetos autorizados entra (a variável medida em 28/09)", () => {
    expect(montarEnvDoFilho({}, "/h", 60_000, { claudeMdDasPastas: true })[CLAUDE_MD_DAS_PASTAS]).toBe("1");
  });
});

describe("sem teto de passos, com janela de contexto", () => {
  it("nunca passa --max-turns", () => {
    const { args } = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/mcp.json" });
    expect(args).not.toContain("--max-turns");
  });
  it("--autocompact entra só quando o help da versão instalada oferece a flag", () => {
    const com = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/mcp.json", compactar: true }).args;
    expect(valor(com, "--autocompact")).toBe("200000");
    // Fail-closed: versão sem a flag roda sem ela, em vez de o turno falhar.
    const sem = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/mcp.json", compactar: false }).args;
    expect(sem).not.toContain("--autocompact");
  });
  it("--autocompact não entra no gate de todo turno; --max-turns fica na tabela para a sonda", () => {
    expect(FLAGS_DO_TURNO).not.toContain("--autocompact");
    expect(FLAGS_DO_TURNO).not.toContain("--max-turns");
    expect(FLAG_FLOORS["--autocompact"].piso).toBe("2.1.276");
    expect(FLAG_FLOORS["--max-turns"]).toBeDefined();
  });
});

describe("pastas autorizadas no harness", () => {
  // definido em 2026-09-18, medido com o CLI real: --restricted nega leitura fora das pastas
  // permitidas (por caminho relativo e absoluto) e ignora o CLAUDE.md do repositório aberto.
  const comPastas = (ativa: string, aprovadas: string[]): PlanoTurno => ({ ...planoDeTeste(), workspacePastas: { ativa, aprovadas } });

  it("sem projeto autorizado mantém o comportamento atual: nativas desligadas", () => {
    const { args } = montarArgs({ plano: planoDeTeste(), mcpJson: "/tmp/mcp.json" });
    expect(args).toContain("--tools");
    expect(args[args.indexOf("--tools") + 1]).toBe("ToolSearch");
    expect(args).not.toContain("--restricted");
    expect(args).not.toContain("--add-dir");
    expect(args.join(" ")).not.toMatch(/\bRead\b/);
    // Sem pasta da pessoa, segue lendo a configuração do projeto como antes.
    expect(args).toContain("--setting-sources");
  });

  it("com projeto autorizado liga as nativas de arquivo sob --restricted", () => {
    const { args } = montarArgs({ plano: comPastas("/w/nod", ["/w/nod"]), mcpJson: "/tmp/mcp.json" });
    expect(args).toContain("--restricted");
    // --restricted substitui a leitura de configuração do repo aberto.
    expect(args).not.toContain("--setting-sources");
    // --tools lista exatamente as nativas liberadas, mais a busca de ferramentas.
    expect(args[args.indexOf("--tools") + 1]!.split(",")).toEqual([...NATIVAS_DE_ARQUIVO, "ToolSearch"]);
    const permitidas = args[args.indexOf("--allowedTools") + 1]!.split(",");
    expect(permitidas).toContain("Read");
    expect(permitidas).toContain("Edit");
    expect(permitidas).toContain("mcp__nod__lembrar");
    // Bash continua fora: comando só no container isolado do nod.
    expect(permitidas).not.toContain("Bash");
  });

  it("as nativas vêm do plano (nativasDoTurno); plano antigo sem o campo cai na regra anterior", () => {
    const soLeitura = montarArgs({ plano: { ...comPastas("/w/nod", ["/w/nod"]), nativas: ["Read", "Glob"] }, mcpJson: "/tmp/mcp.json" }).args;
    const permitidas = soLeitura[soLeitura.indexOf("--allowedTools") + 1]!.split(",");
    expect(permitidas).toContain("Read");
    expect(permitidas).not.toContain("Write");
    const antigo = montarArgs({ plano: comPastas("/w/nod", ["/w/nod"]), mcpJson: "/tmp/mcp.json" }).args;
    expect(antigo[antigo.indexOf("--allowedTools") + 1]!.split(",")).toContain("Write");
    // Sem pastas, nem o campo liga nativa nenhuma.
    const semPasta = montarArgs({ plano: { ...planoDeTeste(), nativas: ["Read"] }, mcpJson: "/tmp/mcp.json" }).args;
    expect(semPasta[semPasta.indexOf("--tools") + 1]).toBe("ToolSearch");
    expect(semPasta[semPasta.indexOf("--allowedTools") + 1]!.split(",")).not.toContain("Read");
  });

  it("todos os projetos aprovados entram em --add-dir, sem repetir o ativo", () => {
    const { args } = montarArgs({ plano: comPastas("/w/nod", ["/w/nod", "/w/site", "/w/api"]), mcpJson: "/tmp/mcp.json" });
    const dirs = args.filter((a, i) => args[i - 1] === "--add-dir");
    expect(dirs.sort()).toEqual(["/w/api", "/w/site"]);
    expect(dirs).not.toContain("/w/nod");
  });

  it("um projeto só não gera --add-dir", () => {
    const { args } = montarArgs({ plano: comPastas("/w/nod", ["/w/nod"]), mcpJson: "/tmp/mcp.json" });
    expect(args).not.toContain("--add-dir");
  });

  it("pasta não aprovada nunca aparece nos args", () => {
    const { args } = montarArgs({ plano: comPastas("/w/nod", ["/w/nod", "/w/site"]), mcpJson: "/tmp/mcp.json" });
    expect(args.join(" ")).not.toContain("/w/secreto");
  });
});

describe("pisos das flags de confinamento", () => {
  it("--restricted e --add-dir têm piso registrado", () => {
    expect(FLAG_FLOORS["--restricted"].piso).toBe("2.1.276");
    expect(FLAG_FLOORS["--add-dir"].piso).toBe("2.1.276");
  });
  it("não entram no gate de todo turno: um CLI antigo sem elas ainda atende quem não usa pasta", () => {
    expect(FLAGS_DO_TURNO).not.toContain("--restricted");
    expect(FLAGS_DO_TURNO).not.toContain("--add-dir");
  });
});
