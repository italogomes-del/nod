import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const emit = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
if (args.includes("--version")) process.stdout.write("codex-cli teste\n");
else if (args.includes("--help")) process.stdout.write("--json --ephemeral --ignore-user-config --ignore-rules --strict-config --sandbox --skip-git-repo-check\n");
else if (args[0] === "login") process.exitCode = process.env.TESTE_NOD_SEM_LOGIN ? 1 : 0;
else {
  const arquivo = join(process.cwd(), "proxy.mjs");
  const child = spawn(process.execPath, [arquivo], { stdio: ["pipe", "pipe", "inherit"] });
  let resposta = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("proxy_sem_resposta")); }, 3000);
    child.stdout.on("data", (v) => { resposta += v; if (resposta.includes("\n")) { clearTimeout(timer); child.stdin.end(); resolve(); } });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } }) + "\n");
  });
  if (!JSON.parse(resposta).result?.serverInfo) throw new Error("proxy_invalido");
  const registro = { args, env: process.env, cwd: process.cwd(), arquivos: readdirSync(process.cwd()), proxy: readFileSync(arquivo, "utf8"), modo: statSync(arquivo).mode & 0o777 };
  if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify(registro));
  let prompt = "";
  for await (const p of process.stdin) prompt += p;
  emit({ type: "thread.started", thread_id: "sessao-codex" });
  if (prompt === "esperar") await new Promise((r) => setTimeout(r, 20_000));
  else if (prompt === "falhar") emit({ type: "turn.failed", error: { message: "segredo que não deve escapar" } });
  else {
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "Resposta de teste." } });
    emit({ type: "turn.completed", usage: { input_tokens: 14, output_tokens: 6, cached_input_tokens: 4 } });
  }
}
