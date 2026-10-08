import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { criarCodexCliDriver } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { prazoSondaDoEnv } from "../../../src/adapters/executor/sonda.ts";
import type { Adapter, ConfigDriver } from "../../../src/adapters/executor/spi.ts";
import { molduraMensagemNoMeio } from "../../../src/domain/mensagem-no-meio.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

/**
 * O chat do Codex no app-server (definido em 2026-10-07, ADR-081 §6, #189): a mesma sessão viva do Claude, com a mensagem
 * do meio entrando por `turn/steer`, contra o app-server falso de tests/fixtures/codex-falso.mjs. O `codex exec` (sem
 * app-server) continua coberto em codex-cli-falso.test.ts.
 */
let dir: string;
let cfg: ConfigDriver;
const lig = { urlNod: "http://127.0.0.1:8888", proxyPath: fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url)), sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoEnv(process.env) };
type Registro = { args: string[]; thread: Record<string, unknown> | null; turnos: { texto: string; effort?: string }[]; steers: string[]; aprovacao: unknown };
const registro = async (): Promise<Registro> => JSON.parse(await readFile(join(dir, "registro.json"), "utf8")) as Registro;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-codex-chat-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`);
  await chmod(bin, 0o700);
  cfg = { bins: { "codex-cli": bin }, env: { HOME: dir, PATH: process.env.PATH ?? "", TESTE_NOD_REGISTRO: join(dir, "registro.json"), OPENAI_API_KEY: "nao-herdar" }, cwdBase: join(dir, "turnos") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("com app-server, o chat abre uma thread efêmera (X8), nega a aprovação pedida e fala a resposta; sessaoCli segue null", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const deltas: string[] = [];
  const r = await instance.adapter(planoHarness({ texto: "olá", esforco: "max" })).rodarTurno({ sinal: async () => {}, delta: (d) => deltas.push(d), evento: () => {} });
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Entendi: olá.", sessaoCli: null, custoUsd: null });
  expect(deltas.join("")).toBe("Entendi: olá.");
  const reg = await registro();
  expect(reg.args).toContain("app-server");
  expect(reg.args).toContain('sandbox_mode="read-only"');
  // X8: sem `thread/resume` medido, nada fica em ~/.codex/sessions.
  expect(reg.thread).toMatchObject({ ephemeral: true, sandbox: "read-only", model: "gpt-5.6-sol", approvalPolicy: "never" });
  // O `max` do Claude não existe no Codex: vai o maior que existe.
  expect(reg.turnos).toEqual([{ texto: "olá", effort: "xhigh" }]);
  expect(reg.aprovacao).toEqual({ decision: "decline" });
  // O launcher (com o token) sumiu com o diretório do turno; só fica a pasta estável do bot.
  expect(await readdir(cfg.cwdBase)).toEqual(["texto-a"]);
});

it("mensagem no meio entra por turn/steer e a resposta vira fala na hora; a fala final não a repete", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter: Adapter = instance.adapter(planoHarness({ texto: "[[chat-steer]] revisa as tasks" }));
  const falas: string[] = [];
  const entraram: string[] = [];
  let entregue = false;
  const r = await adapter.rodarTurno({
    sinal: async () => {},
    delta: () => {},
    evento: (e) => {
      if (e.tipo === "tool_use" && e.nome === "mcp__nod__consultar" && !entregue) {
        expect(adapter.aceitaMensagens?.()).toBe(true);
        entregue = adapter.receberMensagem?.(molduraMensagemNoMeio("e o prazo?"), "m1") ?? false;
        // X2: aceita para entrar, mas só entrou quando o app-server aceitar o steer.
        expect(entraram).toEqual([]);
      }
    },
    falaIntermediaria: (t) => falas.push(t),
    mensagemEntrou: (id) => entraram.push(id),
  });
  expect(entregue).toBe(true);
  expect(entraram).toEqual(["m1"]);
  const reg = await registro();
  expect(reg.steers).toHaveLength(1);
  expect(reg.steers[0]).toContain("«e o prazo?»");
  expect(falas).toHaveLength(1);
  expect(falas[0]).toMatch(/^Recebi: A pessoa escreveu enquanto você trabalhava: «e o prazo\?»/);
  // "Começando." é narração curta antes de ferramenta; a resposta do meio já foi fala.
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Terminei.", ferramentasChamadas: ["mcp__nod__consultar", "mcp__nod__lembrar"] });
  expect(adapter.aceitaMensagens?.()).toBe(false);
});

it("mensagem depois da volta: o ocioso a entrega, ela abre outro turn/start; sem nada novo, a entrada fecha", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness({ texto: "oi" }));
  const falas: string[] = [];
  const entraram: string[] = [];
  let perguntas = 0;
  const r = await adapter.rodarTurno({
    sinal: async () => {},
    delta: () => {},
    evento: () => {},
    falaIntermediaria: (t) => falas.push(t),
    mensagemEntrou: (id) => entraram.push(id),
    async ocioso() {
      perguntas += 1;
      return perguntas === 1 ? (adapter.receberMensagem?.(molduraMensagemNoMeio("mais uma"), "m1") ?? false) : false;
    },
  });
  expect(perguntas).toBe(2);
  // X2: entrou quando o turn/start que a levava abriu.
  expect(entraram).toEqual(["m1"]);
  const reg = await registro();
  expect(reg.turnos.map((t) => t.texto)).toEqual(["oi", molduraMensagemNoMeio("mais uma")]);
  // A 1ª volta vira fala quando a sessão segue; a resposta à mensagem nova sai na hora, e a entrega não a repete.
  expect(falas[0]).toBe("Entendi: oi.");
  expect(falas[1]).toContain("«mais uma»");
  expect(r.desfecho).toBe("sucesso");
  expect(r.texto).toBe("");
});

it("X1: steer aceito enquanto a narração ainda sai — \"Começando.\" não vira a resposta; a fala depois do item seguinte, sim", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter: Adapter = instance.adapter(planoHarness({ texto: "[[chat-steer]] revisa as tasks" }));
  const falas: string[] = [];
  let entregue = false;
  const r = await adapter.rodarTurno({
    sinal: async () => {},
    delta: () => {},
    evento: (e) => {
      // O primeiro delta de "Começando.": a mensagem vai antes de o item da narração fechar.
      if (e.tipo === "delta" && !entregue) entregue = adapter.receberMensagem?.(molduraMensagemNoMeio("e o prazo?"), "m1") ?? false;
    },
    falaIntermediaria: (t) => falas.push(t),
  });
  expect(entregue).toBe(true);
  expect(falas).toHaveLength(1);
  expect(falas[0]).toMatch(/^Recebi: A pessoa escreveu enquanto você trabalhava: «e o prazo\?»/);
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Terminei." });
});

it("X2: o turn/start que levaria a mensagem é recusado — ela nunca é confirmada e volta como devolvida", async () => {
  cfg.env.TESTE_NOD_RECUSAR_TURNO = "2";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness({ texto: "oi" }));
  const entraram: string[] = [];
  const devolvidas: string[] = [];
  let perguntas = 0;
  const r = await adapter.rodarTurno({
    sinal: async () => {},
    delta: () => {},
    evento: () => {},
    falaIntermediaria: () => {},
    mensagemEntrou: (id) => entraram.push(id),
    mensagemDevolvida: (id) => devolvidas.push(id),
    async ocioso() {
      perguntas += 1;
      return perguntas === 1 ? (adapter.receberMensagem?.(molduraMensagemNoMeio("mais uma"), "m1") ?? false) : false;
    },
  });
  const reg = await registro();
  expect(reg.turnos.map((t) => t.texto)).toEqual(["oi", molduraMensagemNoMeio("mais uma")]);
  // Continua `pendente` no servidor: vira turno próprio em vez de sumir.
  expect(entraram).toEqual([]);
  expect(devolvidas).toEqual(["m1"]);
  expect(r.desfecho).toBeDefined();
});

it("X9: capacidades anunciadas — mensagem no meio só com o app-server achado pela sonda", async () => {
  const comAppServer = await criarCodexCliDriver(lig).create(cfg);
  expect(await comAppServer.capacidades!()).toMatchObject({ mensagemNoMeio: true, bifurcaSessao: false, retomaSessao: false });
  cfg.env.TESTE_NOD_SEM_APP_SERVER = "1";
  const semAppServer = await criarCodexCliDriver(lig).create(cfg);
  expect(await semAppServer.capacidades!()).toMatchObject({ mensagemNoMeio: false, bifurcaSessao: false });
});

it("Parar no meio do chat encerra o app-server e sai interrompido; o grupo do processo é medível enquanto roda", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness({ texto: "[[chat-steer]] e espera" }));
  let grupo: number | null = null;
  const r = await adapter.rodarTurno({
    sinal: async () => {},
    delta: () => {},
    evento: (e) => {
      if (e.tipo === "tool_use") {
        grupo = adapter.grupoDeProcessos?.() ?? null;
        void adapter.interromper();
      }
    },
  });
  expect(typeof grupo).toBe("number");
  expect(r.desfecho).toBe("interrompido");
  expect(adapter.grupoDeProcessos?.()).toBeNull();
});

it("sem app-server, o chat segue no codex exec e não aceita mensagem no meio", async () => {
  cfg.env.TESTE_NOD_SEM_APP_SERVER = "1";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness());
  let aceitou: boolean | undefined;
  const r = await adapter.rodarTurno({ sinal: async () => {}, delta: () => {}, evento: (e) => { if (e.tipo === "tool_use") aceitou = adapter.aceitaMensagens?.(); } });
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Resposta de teste." });
  expect(aceitou).toBe(false);
  expect((await registro()).args[0]).toBe("exec");
});
