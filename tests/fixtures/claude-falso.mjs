// Binário FALSO do `claude` para os testes do driver (L4), sem custo. Reproduz o contrato empírico
// de 2026-09-16 (mapa-cli): lê os args, emite a fixture escolhida por NOD_FALSO_CENARIO, honra
// --session-id/--resume, morre em SIGTERM sem `result` (exit 143, como a sonda s6 mediu), e sai 1
// com "Session ID … is already in use" quando o mesmo --session-id é reutilizado (s2c).
// Sem console.*: a saída é o protocolo, escrita direto em stdout/stderr.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as dormir } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(AQUI, "stream-json");
const VERSAO = "2.1.272";
const CENARIOS = {
  "s3-mcp-ok": "s3-mcp-ok.jsonl",
  "s4b-negado": "s4b-negado.jsonl",
  "s6-sigterm": "s6-sigterm.jsonl",
  "s2c-session-in-use": "s2c-session-in-use.jsonl",
};

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

if (args.includes("--version")) {
  process.stdout.write(`${VERSAO} (Claude Code)\n`);
  process.exit(0);
}

// Registro de sessões já usadas (o CLI real recusa reutilizar --session-id): um arquivo por sessão.
const dirSessoes = process.env.NOD_FALSO_SESSOES ?? join(tmpdir(), "nod-claude-falso-sessoes");
mkdirSync(dirSessoes, { recursive: true });
const sessionId = valor("--session-id");
const resume = valor("--resume");
if (sessionId) {
  const marca = join(dirSessoes, `${sessionId}.usada`);
  if (existsSync(marca)) {
    process.stderr.write(`Error: Session ID ${sessionId} is already in use.\n`);
    process.exit(1);
  }
  writeFileSync(marca, "");
}
if (resume && !existsSync(join(dirSessoes, `${resume}.usada`)) && process.env.NOD_FALSO_EXIGE_SESSAO === "1") {
  process.stderr.write(`Error: No conversation found with session ID: ${resume}\n`);
  process.exit(1);
}
const sessao = sessionId ?? resume ?? "00000000-0000-4000-8000-000000000000";

const cenario = process.env.NOD_FALSO_CENARIO ?? "s3-mcp-ok";
if (cenario === "s2c-session-in-use") {
  process.stderr.write(`Error: Session ID ${sessao} is already in use.\n`);
  process.exit(1);
}

// Formato json (sonda ADR-019): um resultado só, apiKeySource conforme NOD_FALSO_API_KEY_SOURCE.
if (valor("--output-format") === "json") {
  const apiKeySource = process.env.NOD_FALSO_API_KEY_SOURCE ?? "none";
  if (process.env.NOD_FALSO_NAO_AUTENTICADO === "1") {
    process.stderr.write("Not logged in · Please run /login\n");
    process.exit(1);
  }
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: sessao, result: "OK", total_cost_usd: 0.003, num_turns: 1, apiKeySource, claude_code_version: VERSAO, permission_denials: [] })}\n`,
  );
  process.exit(0);
}

// stream-json: reemite a fixture linha a linha com um pequeno atraso (SIGTERM no meio precisa de tempo).
const arquivo = CENARIOS[cenario];
if (!arquivo) {
  process.stderr.write(`cenário desconhecido: ${cenario}\n`);
  process.exit(2);
}
const linhas = readFileSync(join(FIXTURES, arquivo), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => l.replaceAll(/"session_id":"[0-9a-f-]{36}"/g, `"session_id":"${sessao}"`));

let interrompido = false;
process.on("SIGTERM", () => {
  interrompido = true;
  // medido em 2026-09-16 (s6.log): o CLI real sai com code 143 e signal null, sem `result`.
  process.exit(143);
});

const atrasoMs = Number(process.env.NOD_FALSO_ATRASO_MS ?? "5");

// Consome o prompt do stdin (o CLI real lê tudo antes de responder) sem bloquear se for /dev/null.
process.stdin.resume();
process.stdin.on("error", () => {});

for (const linha of linhas) {
  if (interrompido) break;
  process.stdout.write(`${linha}\n`);
  if (atrasoMs > 0) await dormir(atrasoMs);
}
process.exit(0);
