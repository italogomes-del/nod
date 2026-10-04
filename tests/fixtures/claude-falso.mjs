// Binário FALSO do `claude` para os testes do driver (L4), sem custo. Reproduz o contrato empírico
// de 2026-09-16 (mapa-cli): lê os args, emite a fixture escolhida por NOD_FALSO_CENARIO, honra
// --session-id/--resume, morre em SIGTERM sem `result` (exit 143, como a sonda s6 mediu), e sai 1
// com "Session ID … is already in use" quando o mesmo --session-id é reutilizado (s2c).
// Sem console.*: a saída é o protocolo, escrita direto em stdout/stderr.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as agendar } from "node:timers";
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
  "relatorio-lembrar": "relatorio-lembrar.jsonl",
};

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? null);
};

if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true }) + "\n");
  process.exit(0);
}

if (args.includes("--version")) {
  process.stdout.write(`${VERSAO} (Claude Code)\n`);
  process.exit(0);
}

// `--help` com as flags que o cenário quer anunciar (ADR-067: --input-format liga a sessão viva no driver).
if (args.includes("--help") && process.env.NOD_FALSO_HELP) {
  process.stdout.write(`Usage: claude [options]\n${process.env.NOD_FALSO_HELP.split(" ").map((f) => `  ${f} <x>`).join("\n")}\n`);
  process.exit(0);
}

// ADR-072, laço de voz. Imita o que a sonda mediu em 2026-10-04 no 2.1.289: cada volta abre com um `init`; com
// `--replay-user-messages` o CLI ecoa a mensagem (com o `uuid` dela) no momento em que a lê; uma mensagem escrita com
// o TEXTO saindo espera o `result` e abre outra volta; escrita com uma FERRAMENTA rodando, é lida na mesma volta, logo
// depois do resultado da ferramenta (um `result` só); `control_request interrupt` corta a volta com um `result` de erro
// e, com `cancel_queued`, descarta o que estava na fila.
if (process.env.NOD_FALSO_CENARIO === "ligacao-voz") {
  const sessaoVoz = valor("--session-id") ?? "00000000-0000-4000-8000-000000000000";
  const eco = args.includes("--replay-user-messages");
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const fila = [];
  let emVolta = false;
  let fechada = false;
  let cortar = null;
  let ferramentas = 0;
  const delta = (t) => out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } });
  const ler = (m) => {
    if (eco) out({ type: "user", isReplay: true, uuid: m.uuid, session_id: sessaoVoz, message: m.message });
  };
  const textoDe = (m) => (typeof m.message.content === "string" ? m.message.content : m.message.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  const rodar = async () => {
    if (emVolta) return;
    emVolta = true;
    while (fila.length > 0) {
      let m = fila.shift();
      const volta = { cortada: false };
      cortar = () => { volta.cortada = true; };
      out({ type: "system", subtype: "init", session_id: sessaoVoz, tools: [], model: valor("--model"), claude_code_version: VERSAO, apiKeySource: "none", capabilities: ["interrupt_receipt_v1", "interrupt_cancel_queued_v1"] });
      ler(m);
      let ultimo = "";
      for (;;) {
        const texto = textoDe(m);
        if (texto.includes("[[ferramenta]]")) {
          delta("Vou anotar.");
          const id = `tu_${++ferramentas}`;
          out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "mcp__nod__lembrar", input: {} }] } });
          await dormir(150);
          if (volta.cortada) break;
          out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });
          const noMeio = fila.shift();
          if (noMeio) {
            ler(noMeio);
            m = noMeio;
            continue;
          }
          ultimo = "Anotado.";
        } else if (texto.includes("demorar")) {
          delta("Pensando");
          await dormir(200);
          if (volta.cortada) break;
          ultimo = " terminei.";
        } else ultimo = texto.includes("Escreva para o chat") ? "Resumo da ligação." : `Entendi: ${texto}.`;
        delta(ultimo);
        break;
      }
      cortar = null;
      out({ type: "result", subtype: volta.cortada ? "error_during_execution" : "success", is_error: volta.cortada, session_id: sessaoVoz, result: volta.cortada ? "" : ultimo, total_cost_usd: 0.01, num_turns: 1, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }, permission_denials: [] });
    }
    emVolta = false;
    if (fechada) process.exit(0);
  };
  process.on("SIGTERM", () => process.exit(143));
  let resto = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (pedaco) => {
    resto += pedaco;
    let i;
    while ((i = resto.indexOf("\n")) !== -1) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linha.trim() === "") continue;
      const m = JSON.parse(linha);
      if (m.type === "control_request") {
        const cancelados = m.request?.cancel_queued ? fila.splice(0).map((x) => x.uuid) : [];
        out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { still_queued: [], cancelled: cancelados } } });
        cortar?.();
        continue;
      }
      fila.push(m);
      void rodar();
    }
  });
  process.stdin.on("end", () => {
    fechada = true;
    if (!emVolta) process.exit(0);
  });
} else
// ADR-067, sessão viva: com `--input-format stream-json` o CLI real lê mensagens pelo stdin enquanto ele está aberto.
// Este cenário imita a medição M1 (01/10/2026, 2.1.286): a 1ª mensagem põe um comando em segundo plano e responde;
// quando ele termina, o CLI volta sozinho ("Testes verdes."); cada mensagem seguinte ganha uma resposta; o processo
// sai quando o stdin fecha e nada roda em segundo plano. SIGTERM: sai 143 sem `result`, como no s6.
if (process.env.NOD_FALSO_CENARIO === "sessao-viva") {
  const sessaoViva = valor("--session-id") ?? valor("--resume") ?? "00000000-0000-4000-8000-000000000000";
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  let custo = 0;
  let emFundo = 0;
  let fechada = false;
  let mensagens = 0;
  const volta = (texto, antesDoResult = () => {}) => {
    custo += 0.01;
    out({ type: "system", subtype: "init", session_id: sessaoViva, tools: ["Bash", "Monitor"], model: "claude-haiku-4-5-20251001", claude_code_version: VERSAO, apiKeySource: "none" });
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: texto }] } });
    antesDoResult();
    out({ type: "result", subtype: "success", is_error: false, session_id: sessaoViva, result: texto, total_cost_usd: Number(custo.toFixed(2)), num_turns: 1, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }, permission_denials: [] });
  };
  const talvezSair = () => { if (fechada && emFundo === 0) process.exit(0); };
  process.on("SIGTERM", () => process.exit(143));
  let resto = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (pedaco) => {
    resto += pedaco;
    let i;
    while ((i = resto.indexOf("\n")) !== -1) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linha.trim() === "") continue;
      const conteudo = JSON.parse(linha).message.content;
      const texto = typeof conteudo === "string" ? conteudo : conteudo.filter((b) => b.type === "text").map((b) => b.text).join("");
      mensagens += 1;
      if (mensagens === 1) {
        volta("Disparei os testes.", () => {
          out({ type: "system", subtype: "task_started", task_id: "bg1", is_backgrounded: true });
          emFundo += 1;
        });
        agendar(() => {
          emFundo -= 1;
          out({ type: "system", subtype: "task_updated", task_id: "bg1", patch: { status: "completed" } });
          out({ type: "system", subtype: "task_notification", task_id: "bg1", status: "completed" });
          volta("Testes verdes.");
          talvezSair();
        }, Number(process.env.NOD_FALSO_FUNDO_MS ?? "150"));
      } else volta(`Recebi: ${texto}`);
    }
  });
  process.stdin.on("end", () => {
    fechada = true;
    talvezSair();
  });
} else {

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
}
