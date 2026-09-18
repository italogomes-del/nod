import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { criarCodexCliDriver } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";
import type { SinaisTurno } from "../../../src/contracts/turno.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";
let dir: string;
let cfg: ConfigDriver;
const lig = { urlNod: "http://127.0.0.1:8888", proxyPath: fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url)), sigtermParaSigkillMs: 50 };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-codex-teste-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`); await chmod(bin, 0o700);
  cfg = { bins: { "codex-cli": bin }, env: { HOME: dir, PATH: process.env.PATH ?? "", TESTE_NOD_REGISTRO: join(dir, "registro.json"), OPENAI_API_KEY: "nao-herdar", DATABASE_URL: "nao-herdar" }, cwdBase: join(dir, "turnos") };
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
it("normaliza texto, ferramentas, sinais e tokens; isola configuração e apaga o token", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect((await instance.sondar()).estado).toBe("pronto");
  const sinais: (keyof SinaisTurno)[] = []; const deltas: string[] = [];
  const plano = planoHarness(); plano.tokenDeTurno = "segredo-do-turno";
  const resultado = await instance.adapter(plano).rodarTurno({ sinal: async (s) => { sinais.push(s); }, delta: (d) => deltas.push(d), evento: () => {} });
  expect(resultado).toMatchObject({ desfecho: "sucesso", texto: "Resposta de teste.", custoUsd: null, sessaoCli: null, tokens: { entrada: 14, saida: 6, cacheLeitura: 4 }, ferramentasChamadas: ["mcp__nod__lembrar"] });
  expect(sinais.slice(0, 2)).toEqual(["attempted", "promptSubmitted"]); expect(deltas).toEqual(["Resposta de teste."]);
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.args.join(" ")).not.toContain(plano.tokenDeTurno);
  expect(registro.args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--ephemeral", "features.shell_tool=false", "features.plugins=false", "read-only"]));
  expect(registro.env.OPENAI_API_KEY).toBeUndefined(); expect(registro.env.DATABASE_URL).toBeUndefined();
  expect(registro.modo).toBe(0o600); expect(registro.proxy).toContain(plano.tokenDeTurno);
  expect(await readdir(cfg.cwdBase)).toEqual([]);
});
it("conta desconectada fecha o gate antes de enviar o prompt", async () => {
  cfg.env.TESTE_NOD_SEM_LOGIN = "1";
  const instance = await criarCodexCliDriver(lig).create(cfg);
  expect((await instance.sondar()).estado).toBe("nao_autenticado");
  await expect(instance.adapter(planoHarness()).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} })).rejects.toThrow("executor_indisponivel");
});
it("interrupção encerra o processo e limpa o diretório", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const adapter = instance.adapter(planoHarness({ texto: "esperar" }));
  const resultado = await adapter.rodarTurno({ sinal: async () => {}, delta: () => {}, evento: (e) => { if (e.tipo === "init") void adapter.interromper(); } });
  expect(resultado.desfecho).toBe("interrompido"); expect(await readdir(cfg.cwdBase)).toEqual([]);
});
it("erro do fornecedor vira falha sem vazar a mensagem crua", async () => {
  const instance = await criarCodexCliDriver(lig).create(cfg);
  const resultado = await instance.adapter(planoHarness({ texto: "falhar" })).rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  expect(resultado.desfecho).toBe("falha"); expect(JSON.stringify(resultado)).not.toContain("segredo");
});
