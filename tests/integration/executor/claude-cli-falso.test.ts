import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarClaudeCliDriver } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { configDosDrivers } from "../../../src/adapters/executor/registry.ts";
import type { ConfigDriver, Instance, SinksTurno } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream, SinaisTurno } from "../../../src/contracts/turno.ts";

/**
 * Spawn REAL do binário falso (tests/fixtures/claude-falso.mjs, L3) por trás de um `claude` de
 * teste que grava argv/env/cwd/mcp.json e o stdin recebido, e repassa sinais. Sem custo: nenhum
 * `claude` real. Cada cenário do mapa-cli (s3, s4b, s6, s2c) é um shim com o env do cenário fixo
 * — as variáveis NOD_FALSO_* têm prefixo NOD_ e a denylist do executor as apagaria (ADR-015).
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const FALSO = join(AQUI, "..", "..", "fixtures", "claude-falso.mjs");

const WRAPPER = `
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const i = args.indexOf("--mcp-config");
let mcp = null;
if (i !== -1) {
  const p = args[i + 1];
  try { mcp = { caminho: p, modo: (statSync(p).mode & 0o777).toString(8), conteudo: JSON.parse(readFileSync(p, "utf8")) }; } catch (e) { mcp = { erro: String(e) }; }
}
if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify({ argv: args, env: process.env, cwd: process.cwd(), mcp }));
const filho = spawn(process.execPath, [${JSON.stringify(FALSO)}, ...args], { stdio: ["pipe", "inherit", "inherit"], env: process.env });
process.stdin.on("data", (c) => { if (process.env.TESTE_NOD_STDIN) appendFileSync(process.env.TESTE_NOD_STDIN, c); filho.stdin.write(c); });
process.stdin.on("end", () => filho.stdin.end());
process.on("SIGTERM", () => filho.kill("SIGTERM"));
filho.on("exit", (code) => process.exit(code ?? 143));
`;

async function shim(dir: string, nome: string, envDoCenario: Record<string, string>): Promise<string> {
  const mjs = join(dir, `${nome}.mjs`);
  await writeFile(mjs, WRAPPER);
  const exports = Object.entries(envDoCenario)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join("\n");
  const sh = join(dir, nome);
  await writeFile(sh, `#!/bin/sh\n${exports}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mjs)} "$@"\n`);
  await chmod(sh, 0o755);
  return sh;
}

function planoDeTeste(dir: string, parcial: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno {
  return {
    tenantId: "t",
    turnoId: `turno-${Math.random().toString(36).slice(2, 8)}`,
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
      ferramentas: [{ nome: "somar", nomeMcp: "mcp__nod__somar", origem: "conector", conectorId: "k", readOnlyHint: true, tocaAprendiz: false, schema: { type: "object" } }],
      servidores: [],
    },
    promptSistema: "Você é a sonda do nod.",
    entrada: { texto: `Some 17 e 25 (${dir})`, sessaoCli: null, modelo: "claude-haiku-4-5-20251001", maxTurnos: 3, ...parcial },
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000, efeitoExternoSoPorAprovacao: false },
    tokenDeTurno: "token-de-turno-teste",
    expiraEm: Date.now() + 60_000,
  };
}

type Registro = { argv: string[]; env: Record<string, string>; cwd: string; mcp: { caminho: string; modo: string; conteudo: unknown } | null };

const valor = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

describe("driver claude-cli contra o binário falso (contrato empírico 2026-09-16)", () => {
  let dir: string;
  let cfgBase: ConfigDriver;
  const lig = { urlNod: "http://127.0.0.1:65000", proxyPath: "/app/src/adapters/mcp-proxy/proxy.ts" };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-cli-falso-"));
    // env do processo servidor, com a sujeira que a denylist tem que apagar
    cfgBase = await configDosDrivers(
      { HOME: dir, PATH: process.env.PATH, ANTHROPIC_API_KEY: "sk-vazou", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", NOD_HOME: join(dir, ".nod"), NOD_SESSAO_SEGREDO: "s" },
      { shellDeLogin: false },
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function instanciar(cenario: string, extraEnv: Record<string, string> = {}, extraShim: Record<string, string> = {}): Promise<{ instance: Instance; registro: string; stdin: string }> {
    const sessoes = join(dir, `sessoes-${cenario}-${Math.random().toString(36).slice(2, 8)}`);
    const bin = await shim(dir, `claude-${cenario}-${Math.random().toString(36).slice(2, 6)}`, { NOD_FALSO_CENARIO: cenario, NOD_FALSO_SESSOES: sessoes, ...extraShim });
    const registro = join(dir, `registro-${Math.random().toString(36).slice(2, 8)}.json`);
    const stdin = join(dir, `stdin-${Math.random().toString(36).slice(2, 8)}.txt`);
    const cfg: ConfigDriver = { ...cfgBase, bin, env: { ...cfgBase.env, TESTE_NOD_REGISTRO: registro, TESTE_NOD_STDIN: stdin, ...extraEnv } };
    const instance = await criarClaudeCliDriver(lig).create(cfg);
    return { instance, registro, stdin };
  }

  function sinksEspiao(extra: Partial<SinksTurno> = {}) {
    const sinais: (keyof SinaisTurno)[] = [];
    const eventos: EventoStream[] = [];
    const deltas: string[] = [];
    const sinks: SinksTurno = {
      async sinal(s) {
        sinais.push(s);
        await extra.sinal?.(s);
      },
      evento: (e) => eventos.push(e),
      delta: (t) => deltas.push(t),
    };
    return { sinks, sinais, eventos, deltas };
  }

  it("s3: flags obrigatórias, --allowedTools exato, mcp.json 0600 no cwd mkdtemp, env sem ANTHROPIC_API_KEY/CLAUDECODE, promptSubmitted ANTES do stdin, tmpdir apagado", async () => {
    const { instance, registro, stdin } = await instanciar("s3-mcp-ok");
    const plano = planoDeTeste(dir);
    let stdinJaTinhaChegado: boolean | null = null;
    const espiao = sinksEspiao({
      async sinal(s) {
        if (s === "promptSubmitted") {
          stdinJaTinhaChegado = await stat(stdin).then(() => true, () => false);
        }
      },
    });
    const resultado = await instance.adapter(plano).rodarTurno(espiao.sinks);

    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.texto).toContain("SONDA_OK");
    expect(resultado.custoUsd).toBe(0.0207631);
    expect(resultado.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
    expect(resultado.negacoesPermissao).toEqual([]);
    expect(resultado.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(espiao.sinais[0]).toBe("attempted");
    expect(espiao.sinais.indexOf("promptSubmitted")).toBeLessThan(espiao.sinais.indexOf("producedOutput"));
    expect(stdinJaTinhaChegado).toBe(false);
    expect(await readFile(stdin, "utf8")).toBe(plano.entrada.texto);
    expect(espiao.deltas.join("")).toContain("SONDA_OK");

    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    expect(r.argv[0]).toBe("-p");
    expect(valor(r.argv, "--output-format")).toBe("stream-json");
    expect(r.argv).toContain("--verbose");
    expect(r.argv).toContain("--include-partial-messages");
    expect(r.argv).toContain("--strict-mcp-config");
    expect(valor(r.argv, "--setting-sources")).toBe("project");
    expect(valor(r.argv, "--tools")).toBe("");
    expect(valor(r.argv, "--allowedTools")).toBe("mcp__nod__somar");
    expect(valor(r.argv, "--permission-mode")).toBe("default");
    expect(valor(r.argv, "--max-turns")).toBe("3");
    expect(valor(r.argv, "--append-system-prompt")).toBe("Você é a sonda do nod.");
    expect(valor(r.argv, "--session-id")).toBe(resultado.sessaoCli);
    expect(r.argv).not.toContain("--resume");

    // cwd = mkdtemp em NOD_HOME/turnos (nunca o repo) com o mcp.json 0600 dentro
    // (realpath: no macOS o tmpdir /var/... é enxergado pelo filho como /private/var/...)
    expect(r.cwd.startsWith(join(await realpath(join(dir, ".nod", "turnos")), "turno-"))).toBe(true);
    expect(r.mcp?.caminho).toBe(join(dir, ".nod", "turnos", basename(r.cwd), "mcp.json"));
    expect(r.mcp?.modo).toBe("600");
    expect(r.mcp?.conteudo).toEqual({ mcpServers: { nod: { command: process.execPath, args: [lig.proxyPath], env: { NOD_URL: lig.urlNod, NOD_TOKEN_TURNO: "token-de-turno-teste" } } } });
    await expect(stat(r.cwd)).rejects.toThrow(/ENOENT/);

    // ambiente do filho: denylist aplicada, PATH aumentado, HOME e MCP_TOOL_TIMEOUT presentes
    expect(r.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.env.CLAUDECODE).toBeUndefined();
    expect(r.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(r.env.NOD_SESSAO_SEGREDO).toBeUndefined();
    expect(r.env.HOME).toBe(dir);
    expect(r.env.PATH?.split(":")).toContain(join(dir, ".local/bin"));
    expect(r.env.MCP_TOOL_TIMEOUT).toBe("60000");
  });

  it("2º turno com sessaoCli do 1º: --resume o MESMO uuid, sem --session-id, e o binário falso aceita", async () => {
    const { instance, registro } = await instanciar("s3-mcp-ok");
    const primeiro = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(primeiro.sessaoCli).toMatch(/^[0-9a-f-]{36}$/);
    const segundo = await instance.adapter(planoDeTeste(dir, { sessaoCli: primeiro.sessaoCli })).rodarTurno(sinksEspiao().sinks);
    expect(segundo.desfecho).toBe("sucesso");
    expect(segundo.sessaoCli).toBe(primeiro.sessaoCli);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    expect(valor(r.argv, "--resume")).toBe(primeiro.sessaoCli);
    expect(r.argv).not.toContain("--session-id");
  });

  it("s6: SIGTERM no meio do streaming → 'interrompido' sem result, sem motivo (quem sabe é o servidor), tmpdir apagado", async () => {
    const { instance, registro } = await instanciar("s6-sigterm", {}, { NOD_FALSO_ATRASO_MS: "40" });
    const adapter = instance.adapter(planoDeTeste(dir));
    const espiao = sinksEspiao();
    const inicio = Date.now();
    const promessa = adapter.rodarTurno({
      ...espiao.sinks,
      delta(t) {
        espiao.deltas.push(t);
        if (espiao.deltas.length === 3) void adapter.interromper();
      },
    });
    const resultado = await promessa;
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(resultado.desfecho).toBe("interrompido");
    expect(resultado.motivoInterrupcao).toBeUndefined();
    expect(espiao.eventos.some((e) => e.tipo === "result")).toBe(false);
    expect(espiao.eventos[0]?.tipo).toBe("init");
    expect(resultado.sinais.promptSubmitted).toBe(true);
    expect(resultado.sinais.producedOutput).toBe(true);
    expect(resultado.texto.length).toBeGreaterThan(0);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    await expect(stat(r.cwd)).rejects.toThrow(/ENOENT/);
  });

  it("s2c: exit 1 sem init (Session ID already in use) → 'sessao_rejeitada' com rejected=true; tmpdir apagado mesmo na falha", async () => {
    const { instance, registro } = await instanciar("s2c-session-in-use");
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(resultado.desfecho).toBe("interrompido");
    expect(resultado.motivoInterrupcao).toBe("sessao_rejeitada");
    expect(resultado.sinais.rejected).toBe(true);
    expect(resultado.sinais.producedOutput).toBe(false);
    const r = JSON.parse(await readFile(registro, "utf8")) as Registro;
    await expect(stat(r.cwd)).rejects.toThrow(/ENOENT/);
  });

  it("s4b: negação de permissão NÃO é erro: sucesso com negacoesPermissao = ['mcp__nod__somar']", async () => {
    const { instance } = await instanciar("s4b-negado");
    const resultado = await instance.adapter(planoDeTeste(dir)).rodarTurno(sinksEspiao().sinks);
    expect(resultado.desfecho).toBe("sucesso");
    expect(resultado.negacoesPermissao).toEqual(["mcp__nod__somar"]);
  });

  it("binário que não existe → ErroDeDominio executor_indisponivel (motor_ausente) antes de qualquer spawn", async () => {
    const instance = await criarClaudeCliDriver(lig).create({ ...cfgBase, bin: "/nao/existe/claude" });
    const espiao = sinksEspiao();
    await expect(instance.adapter(planoDeTeste(dir)).rodarTurno(espiao.sinks)).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "motor_ausente" });
    expect(espiao.sinais).toEqual(["attempted"]);
  });

  it("sondar() da instância contra o binário falso: pronto 2.1.272 (stream-json, init.apiKeySource none)", async () => {
    const { instance } = await instanciar("s3-mcp-ok");
    const inv = await instance.sondar();
    expect(inv).toMatchObject({ estado: "pronto", versao: "2.1.272" });
  });
});
