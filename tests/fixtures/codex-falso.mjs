import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const emit = (v) => process.stdout.write(`${JSON.stringify(v)}\n`);
if (args.includes("app-server")) await appServer();
// NOD-171: TESTE_NOD_VERSAO simula uma versão (acima ou abaixo do piso); sem ela, uma saída sem x.y.z.
else if (args.includes("--version")) process.stdout.write(process.env.TESTE_NOD_VERSAO ? `codex-cli ${process.env.TESTE_NOD_VERSAO}\n` : "codex-cli teste\n");
else if (args.includes("--help")) process.stdout.write("--json --ephemeral --ignore-user-config --ignore-rules --strict-config --sandbox --skip-git-repo-check\n");
else if (args[0] === "login") process.exitCode = process.env.TESTE_NOD_SEM_LOGIN ? 1 : 0;
else {
  // Como o Codex real (medido em 2026-10-05 com o 0.147.0): a config é validada ANTES de o prompt ser lido. Uma chave
  // desconhecida para em "unknown configuration field" (uma por vez), e o stdin vazio para em "No prompt provided".
  // TESTE_NOD_CHAVES_DESCONHECIDAS lista as chaves que "esta versão" não conhece; TESTE_NOD_NEGOCIACOES conta as rodadas.
  const config = args.filter((a, i) => args[i - 1] === "-c");
  const desconhecida = (process.env.TESTE_NOD_CHAVES_DESCONHECIDAS ?? "").split(",").filter(Boolean).find((chave) => {
    const campoMcp = /^mcp_servers\.nod\.(.+)$/.exec(chave)?.[1];
    return campoMcp ? config.some((c) => c.startsWith("mcp_servers=") && c.includes(` ${campoMcp} = `)) : config.some((c) => c.startsWith(`${chave}=`));
  });
  if (desconhecida) {
    process.stderr.write(`Error loading config.toml: unknown configuration field \`${desconhecida}\` in -c/--config override\n`);
    process.exit(1);
  }
  let prompt = "";
  for await (const p of process.stdin) prompt += p;
  if (prompt === "") {
    if (process.env.TESTE_NOD_NEGOCIACOES) appendFileSync(process.env.TESTE_NOD_NEGOCIACOES, "x");
    process.stderr.write("No prompt provided via stdin.\n");
    process.exit(1);
  }
  // O teste da conta (definido em 2026-10-05): `mcp_servers={}`, sem proxy. Responde a frase pedida, ou falha como uma
  // conta logada que não responde (TESTE_NOD_TESTE_FALHA).
  if (config.includes("mcp_servers={}")) {
    if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify({ args, env: process.env, cwd: process.cwd(), arquivos: readdirSync(process.cwd()), prompt }));
    emit({ type: "thread.started", thread_id: "sessao-teste" });
    if (process.env.TESTE_NOD_TESTE_FALHA) emit({ type: "turn.failed", error: { message: "conta sem uso disponível" } });
    else {
      emit({ type: "item.completed", item: { type: "agent_message", text: "“Oi, Marcelo. Tudo pronto.”" } });
      emit({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 3 } });
    }
    process.exit(0);
  }
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
  emit({ type: "thread.started", thread_id: "sessao-codex" });
  if (prompt === "esperar") await new Promise((r) => setTimeout(r, 20_000));
  else if (prompt === "falhar") emit({ type: "turn.failed", error: { message: "segredo que não deve escapar" } });
  else if (prompt === "aviso-e-ferramenta-cancelada") {
    // O que o 0.147.0 emitia com a config antiga do nod: um item `error` de aviso e a chamada MCP falhando.
    emit({ type: "item.completed", item: { id: "e1", type: "error", message: "Code Mode is unavailable because code-mode host is disabled." } });
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "pedir_acesso", arguments: { app: "gmail" } } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "failed", error: { message: "user cancelled MCP tool call" } } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "A ferramenta está indisponível." } });
    emit({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 5 } });
  } else if (prompt === "morrer-sem-evento") {
    process.stderr.write("2026-10-05T14:46:55.670225Z ERROR codex_core: algo quebrou antes do primeiro evento\n");
    process.exit(1);
  }
  else if (prompt === "relatorio") {
    // Relatório longo, depois lembrar, depois "Anotado." — o turn.completed do Codex não traz texto.
    emit({ type: "item.completed", item: { type: "agent_message", text: "Vou consultar as tasks." } });
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "consultar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: `Relatório das tasks: ${"NOD-101 aberto há 3 dias, sem revisão; ".repeat(10)}fim.` } });
    emit({ type: "item.started", item: { id: "t2", type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t2", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "Anotado." } });
    emit({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 120, cached_input_tokens: 4 } });
  } else {
    emit({ type: "item.started", item: { id: "t1", type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } });
    emit({ type: "item.completed", item: { id: "t1", type: "mcp_tool_call", status: "completed" } });
    emit({ type: "item.completed", item: { type: "agent_message", text: "Resposta de teste." } });
    emit({ type: "turn.completed", usage: { input_tokens: 14, output_tokens: 6, cached_input_tokens: 4 } });
  }
}

/**
 * App-server falso (ADR-076): JSON-RPC por linha no stdio, no formato do protocolo v2 que o laço de voz espera.
 * - initialize / thread/start respondem; thread/start guarda os parâmetros no registro.
 * - turn/start responde {turn:{id}} e fala "Entendi: <texto>." em três deltas; no primeiro turno, antes de falar, pede
 *   uma aprovação de comando (item/commandExecution/requestApproval) e só segue com a resposta (que vai ao registro).
 * - "[[ferramenta]]" no texto: um item mcpToolCall do servidor nod antes da fala.
 * - "demorar": fala "Pensando" e espera turn/steer (responde a fala nova e conclui) ou turn/interrupt (conclui interrompido).
 * - O pedido de resumo do fim responde "Resumo da ligação: N turno(s)." (N = turnos antes do resumo).
 * - "[[mudo]]" no texto (NOD-167): abre o turno e não fala nada até o turn/interrupt (conclui interrompido).
 * - "[[lento]]" no texto (NOD-167): a resposta do turn/start demora 300 ms (o turno fica "iniciando" no laço).
 * - "[[conclui-antes]]" no texto (revisão NOD-167): depois de 300 ms o turno conclui sem fala e só então chega a
 *   resposta do turn/start (a ordem que o app-server real pode entregar num turno curto).
 * - model/list (NOD-167) devolve o Luna e um modelo de chat, com os esforços aceitos; uma notificação que o laço não
 *   conhece (`account/rateLimits/updated`) sai no primeiro turno.
 * - stdin fechado: grava o registro (TESTE_NOD_REGISTRO) e sai 0.
 */
async function appServer() {
  // NOD-167: um Codex antigo, sem o subcomando (o clap recusa com 2, como qualquer subcomando desconhecido).
  if (process.env.TESTE_NOD_SEM_APP_SERVER) {
    process.stderr.write("error: unrecognized subcommand 'app-server'\n");
    process.exit(2);
  }
  if (args.includes("--help")) {
    process.stdout.write("[experimental] Run the app server or related tooling.\n  --listen <URL>\n  --ignore-user-config\n");
    return;
  }
  const registro = { args, env: process.env, cwd: process.cwd(), thread: null, turnos: [], steers: [], interrupcoes: 0, aprovacao: null };
  const gravar = () => { if (process.env.TESTE_NOD_REGISTRO) writeFileSync(process.env.TESTE_NOD_REGISTRO, JSON.stringify(registro)); };
  const indiceMcp = args.findIndex((a) => a.startsWith("mcp_servers="));
  const launcher = indiceMcp >= 0 ? /args = \["([^"]+)"\]/.exec(args[indiceMcp])?.[1] ?? null : null;
  // O launcher do proxy precisa existir, ser 0600 e responder ao initialize do MCP.
  const validacao = (async () => {
    if (!launcher) return { ok: false };
    const child = spawn(process.execPath, [launcher], { stdio: ["pipe", "pipe", "inherit"] });
    let resposta = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("proxy_sem_resposta")); }, 5000);
      child.stdout.on("data", (v) => { resposta += v; if (resposta.includes("\n")) { clearTimeout(timer); child.stdin.end(); resolve(); } });
      child.on("error", reject);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } }) + "\n");
    });
    return { ok: Boolean(JSON.parse(resposta).result?.serverInfo), modo: statSync(launcher).mode & 0o777, conteudo: readFileSync(launcher, "utf8") };
  })().catch(() => ({ ok: false }));

  let proximoTurno = 1;
  let ativo = null; // { id, aoSteer(texto), aoInterromper() }
  let turnosAntesDoResumo = 0;
  let pediuAprovacao = false;
  let aoAprovacao = null;
  const dormirMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const responder = (id, result) => emit({ jsonrpc: "2.0", id, result });
  const notificar = (method, params) => emit({ jsonrpc: "2.0", method, params });
  const falar = async (threadId, turnId, partes) => {
    const itemId = `msg_${turnId}`;
    notificar("item/started", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: "" } });
    for (const delta of partes) { notificar("item/agentMessage/delta", { threadId, turnId, itemId, delta }); await dormirMs(5); }
    notificar("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: partes.join("") } });
  };
  const concluir = (threadId, turnId, status) => {
    notificar("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { total: { inputTokens: 100 * proximoTurno, cachedInputTokens: 80, outputTokens: 10 * proximoTurno, totalTokens: 0 } } });
    notificar("turn/completed", { threadId, turn: { id: turnId, status, items: [] } });
    if (ativo?.id === turnId) ativo = null;
  };

  async function rodarTurno(threadId, turnId, texto) {
    notificar("turn/started", { threadId, turn: { id: turnId, status: "inProgress", items: [] } });
    if (texto.startsWith("[nod] A ligação terminou")) {
      await falar(threadId, turnId, ["Resumo da ligação: ", `${turnosAntesDoResumo} turno(s).`]);
      return concluir(threadId, turnId, "completed");
    }
    turnosAntesDoResumo++;
    if (turnosAntesDoResumo === 1) notificar("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 12, conteudo: "não logar" } } });
    if (texto.includes("[[mudo]]")) {
      // O interrupt pode ter chegado antes deste ponto (ativo ainda sem gancho): vale como já interrompido.
      const jaInterrompido = ativo?.id === turnId && ativo.interrompido === true;
      await new Promise((r) => { if (jaInterrompido) r(); else ativo = { id: turnId, aoSteer: null, aoInterromper: () => r() }; });
      return concluir(threadId, turnId, "interrupted");
    }
    if (!pediuAprovacao) {
      pediuAprovacao = true;
      const resposta = new Promise((r) => { aoAprovacao = r; });
      emit({ jsonrpc: "2.0", id: "srv_aprovar_1", method: "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "cmd_1", command: "rm -rf /" } });
      registro.aprovacao = await resposta;
      gravar();
    }
    if (texto.includes("[[ferramenta]]")) {
      notificar("item/started", { threadId, turnId, item: { type: "mcpToolCall", id: `mcp_${turnId}`, server: "nod", tool: "lembrar", status: "inProgress", arguments: {} } });
      await dormirMs(5);
      notificar("item/completed", { threadId, turnId, item: { type: "mcpToolCall", id: `mcp_${turnId}`, server: "nod", tool: "lembrar", status: "completed", arguments: {} } });
    }
    if (texto.includes("demorar")) {
      // Os ganchos entram ANTES da fala: o steer/interrupt pode chegar logo depois do primeiro delta.
      const esperando = new Promise((r) => { ativo = { id: turnId, aoSteer: (t) => r({ steer: t }), aoInterromper: () => r({ interrompido: true }) }; });
      await falar(threadId, turnId, ["Pensando"]);
      const desfecho = await esperando;
      if (desfecho.interrompido) return concluir(threadId, turnId, "interrupted");
      await falar(threadId, turnId, ["Entendi: ", desfecho.steer.replace(/^\[nod\][^\n]*\n/, ""), "."]);
      return concluir(threadId, turnId, "completed");
    }
    const limpo = texto.replace(/^\[nod\][^\n]*\n/, "").replace("[[ferramenta]]", "").trim();
    await falar(threadId, turnId, ["Entendi: ", limpo, "."]);
    concluir(threadId, turnId, "completed");
  }

  let resto = "";
  let fila = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (pedaco) => {
    resto += pedaco;
    let i;
    while ((i = resto.indexOf("\n")) >= 0) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linha.trim() === "") continue;
      const m = JSON.parse(linha);
      if (m.method === undefined && m.id === "srv_aprovar_1") { aoAprovacao?.(m.result ?? { erro: m.error }); continue; }
      switch (m.method) {
        case "initialize": responder(m.id, { userAgent: "codex-falso/0" }); break;
        case "initialized": break;
        case "thread/start":
          registro.thread = m.params; gravar();
          responder(m.id, { thread: { id: "thr_falso" }, model: m.params.model });
          break;
        case "model/list":
          registro.modelList = (registro.modelList ?? 0) + 1;
          responder(m.id, { data: [
            { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }], defaultReasoningEffort: "medium" },
            { id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: "minimal" }, { reasoningEffort: "low" }, { reasoningEffort: "medium" }], defaultReasoningEffort: "low" },
          ], nextCursor: null });
          break;
        case "turn/start": {
          const turnId = `turn_${proximoTurno++}`;
          const texto = m.params.input?.[0]?.text ?? "";
          registro.turnos.push({ texto, effort: m.params.effort }); gravar();
          const abrir = () => {
            responder(m.id, { turn: { id: turnId, status: "inProgress", items: [] } });
            ativo = { id: turnId, aoSteer: null, aoInterromper: null };
            fila = fila.then(() => rodarTurno(m.params.threadId, turnId, texto));
          };
          if (texto.includes("[[conclui-antes]]")) {
            setTimeout(() => {
              notificar("turn/completed", { threadId: m.params.threadId, turn: { id: turnId, status: "completed", items: [] } });
              responder(m.id, { turn: { id: turnId, status: "inProgress", items: [] } });
            }, 300);
            break;
          }
          if (texto.includes("[[lento]]")) setTimeout(abrir, 300);
          else abrir();
          break;
        }
        case "turn/steer":
          if (!ativo || ativo.id !== m.params.expectedTurnId || !ativo.aoSteer) { emit({ jsonrpc: "2.0", id: m.id, error: { code: -32600, message: "sem turno ativo" } }); break; }
          registro.steers.push(m.params.input?.[0]?.text ?? ""); gravar();
          responder(m.id, { turnId: ativo.id });
          ativo.aoSteer(m.params.input?.[0]?.text ?? "");
          break;
        case "turn/interrupt":
          registro.interrupcoes++; gravar();
          responder(m.id, {});
          if (ativo?.id === m.params.turnId) {
            if (ativo.aoInterromper) ativo.aoInterromper();
            else ativo.interrompido = true;
          }
          break;
        default:
          if (m.id !== undefined) emit({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "método desconhecido" } });
      }
    }
  });
  await new Promise((r) => process.stdin.on("end", r));
  await fila;
  registro.launcher = await validacao;
  gravar();
}
