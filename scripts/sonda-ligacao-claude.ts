/**
 * Sonda da fase 0 do modo ligação (definido em 2026-10-04, docs/plano-modo-ligacao.md "Fase 0"). PAGA: usa a assinatura
 * do Claude Code (poucas centenas de tokens). Roda o `claude -p` com os argumentos e o ambiente REAIS do laço de voz
 * (montarArgsLigacao + ambienteDaLigacao, MCP vazio) e mede:
 *  - as capacidades do `system/init` (interrupt_receipt_v1, interrupt_cancel_queued_v1);
 *  - o tempo até o primeiro texto, frio (1ª mensagem) e quente (2ª);
 *  - a interrupção in-band: um `control_request interrupt` no meio de uma resposta longa — chega `control_response`?
 *    o `result` sai, e o processo segue vivo para a próxima mensagem?
 *  - o pedido escrito com uma volta em curso: entra na mesma volta (um `result`) ou abre outra?
 * NOD-164: o modelo e as opções vêm no mesmo formato do servidor (lerModelosLigacao); sem opções, vale o padrão
 * (MODELOS_LIGACAO_PADRAO). `--effort` só entra se o `--help` do CLI listar a flag, como no driver.
 * Uso: node scripts/sonda-ligacao-claude.ts [--modelo claude-sonnet-4-6] [--esforco low] [--pensamento adaptativo|desligado]
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELOS_LIGACAO_PADRAO } from "../src/contracts/modelos.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { lerModelosLigacao } from "../src/domain/modelo-ligacao.ts";
import { ambienteDaLigacao, montarArgsLigacao } from "../src/adapters/executor/drivers/claude-ligacao.ts";
import { lerFlagsDoHelp } from "../src/adapters/executor/sonda.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const opcoes = [["esforco", arg("--esforco")], ["pensamento", arg("--pensamento")]].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
const cfg = lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: [arg("--modelo") ?? MODELOS_LIGACAO_PADRAO["claude-cli"].modelo, ...opcoes].join(" ") })["claude-cli"];
const escrever = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A mesma denylist do driver (CLAUDE_EFFORT, CLAUDE_CODE_*, ANTHROPIC_*, NOD_*…): rodada de dentro do Claude Code, o
// esforço herdado mudaria o que a sonda mede.
const envBase = montarAmbiente("local", process.env);
const voz = { ligacaoId: "sonda", modelo: cfg.modelo, nomeBot: "Sonda", generoVoz: "feminina" as const, pensamentoAdaptativo: cfg.pensamentoAdaptativo, ...(cfg.esforco ? { esforco: cfg.esforco } : {}) };
const env = ambienteDaLigacao(envBase, voz);
const dir = mkdtempSync(join(tmpdir(), "sonda-ligacao-"));
const mcpJson = join(dir, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: {} }));
// Só os campos que montarArgsLigacao lê: voz, catálogo (vazio) e o prompt de sistema.
const plano = { ligacaoVoz: voz, catalogo: { ferramentas: [] }, promptSistema: "Você está numa ligação de voz. Responda em português do Brasil, curto, sem markdown." } as unknown as PlanoTurno;
const flagsNoHelp = (await lerFlagsDoHelp("claude", env)) ?? [];
const args = montarArgsLigacao({ plano, mcpJson, sessaoId: randomUUID(), flagsNoHelp });
escrever(`modelo: ${cfg.modelo} · esforço: ${args.includes("--effort") ? cfg.esforco : cfg.esforco ? `${cfg.esforco} (CLI sem --effort: ignorado)` : "padrão"} · adaptativo: ${cfg.pensamentoAdaptativo ? "ligado" : "desligado"}`);
const proc = spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
const linhas: { em: number; o: Record<string, unknown> }[] = [];
let resto = "";
proc.stdout.on("data", (b: Buffer) => {
  resto += b.toString("utf8");
  let n: number;
  while ((n = resto.indexOf("\n")) >= 0) {
    const l = resto.slice(0, n);
    resto = resto.slice(n + 1);
    try { linhas.push({ em: Date.now(), o: JSON.parse(l) as Record<string, unknown> }); } catch { /* não JSON */ }
  }
});
const mandar = (texto: string) => proc.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: texto }] } })}\n`);
const ehDelta = (o: Record<string, unknown>) => o.type === "stream_event" && JSON.stringify(o).includes('"text_delta"');
async function esperar(f: (o: Record<string, unknown>) => boolean, desde: number, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const a = linhas.find((x) => x.em >= desde && f(x.o));
    if (a) return a;
    await dormir(20);
  }
  return null;
}

async function main(): Promise<void> {
  let t0 = Date.now();
  mandar("Diga só: alô.");
  const init = await esperar((o) => o.type === "system" && o.subtype === "init", 0);
  escrever(`capacidades: ${JSON.stringify((init?.o.capabilities as unknown) ?? "(nenhuma)")}`);
  const d1 = await esperar(ehDelta, t0);
  await esperar((o) => o.type === "result", t0);
  escrever(`1º texto (frio): ${d1 ? d1.em - t0 : "—"} ms`);
  t0 = Date.now();
  mandar("Diga só: tudo bem.");
  const d2 = await esperar(ehDelta, t0);
  const r2 = await esperar((o) => o.type === "result", t0);
  escrever(`1º texto (quente): ${d2 ? d2.em - t0 : "—"} ms · result ttft_ms=${String(r2?.o.ttft_ms ?? "?")}`);

  t0 = Date.now();
  mandar("Conte devagar de um a cinquenta, por extenso, um número por frase.");
  await esperar(ehDelta, t0);
  await dormir(700);
  const tInt = Date.now();
  proc.stdin.write(`${JSON.stringify({ type: "control_request", request_id: "int_sonda", request: { subtype: "interrupt", cancel_queued: true } })}\n`);
  const resp = await esperar((o) => o.type === "control_response", tInt, 10_000);
  const r3 = await esperar((o) => o.type === "result", tInt, 15_000);
  escrever(`interrupt: control_response ${resp ? `${resp.em - tInt} ms ${JSON.stringify(resp.o).slice(0, 160)}` : "não veio"} · result ${r3 ? `${r3.em - tInt} ms subtype=${String(r3.o.subtype)}` : "não veio"}`);

  t0 = Date.now();
  mandar("Diga só: voltei.");
  const d4 = await esperar(ehDelta, t0, 20_000);
  escrever(`depois do interrupt o processo responde: ${d4 ? `sim (${d4.em - t0} ms)` : "não"}`);
  await esperar((o) => o.type === "result", t0);

  t0 = Date.now();
  mandar("Conte de um a dez, por extenso.");
  await esperar(ehDelta, t0);
  mandar("Agora diga só: fim.");
  await dormir(12_000);
  const results = linhas.filter((x) => x.em >= t0 && x.o.type === "result").length;
  escrever(`mensagem escrita com a volta em curso: ${results} result(s) em 12 s (1 = entra na mesma volta)`);
  proc.stdin.end();
  await new Promise((r) => proc.on("exit", r));
  const custo = linhas.filter((x) => x.o.type === "result").map((x) => Number(x.o.total_cost_usd ?? 0)).at(-1);
  escrever(`custo equivalente da sessão: US$ ${custo?.toFixed(4) ?? "?"}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  proc.kill();
  process.exit(1);
});
