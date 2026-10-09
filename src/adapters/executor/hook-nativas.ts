import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decidirNativa } from "../../domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS, LONGPOLL_APROVACAO_MS } from "../../shared/constantes.ts";

/**
 * Hook PreToolUse do nod (ADR-052): o Claude Code o chama ANTES de cada ferramenta nativa do turno, e é ele
 * quem decide — o mesmo papel do proxy para as ferramentas MCP (ADR-013), local e fail-closed. O driver grava
 * a configuração (0600) no diretório temporário do turno; o token nunca vai na linha de comando.
 *
 * revisto em 2026-09-28 (ADR-055, "terminal de verdade, como o inhouse"): sem sandbox. Arquivo em qualquer
 * lugar do Mac passa; o Bash vai ao servidor COM o comando, e o servidor decide: o que só lê roda, o resto
 * vira card de aprovação na conversa — e o hook espera a resposta no próprio turno, em fatias, como o proxy
 * espera uma aprovação (0032). Sem confirmação do servidor, nada roda. Nunca escreve fora do JSON de saída
 * no stdout: é o canal com o CLI.
 */
/**
 * `pastaDoBot` e `home` (definido em 2026-10-01, ADR-065): a cerca do git fora da pasta do bot. Config de um driver
 * antigo sem os dois campos não liga a cerca — o comando segue para o servidor como antes.
 */
/** `daTask` (definido em 2026-10-09, ADR-088): `pastaDoBot` é a pasta da task, e a worktree nasce dentro dela. */
export type ConfigHook = { url: string; token: string; pastaDoBot?: string; home?: string; daTask?: boolean };

export type SaidaHook = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow" | "deny"; permissionDecisionReason: string } };

/** O que o servidor respondeu sobre a chamada; `motivo` volta ao modelo quando nega. */
export type Confirmacao = { permitir: boolean; motivo?: string };
/** `arquivo` (ADR-066): a gravação fora de ~/nod/<bot>, que o servidor decide pelo modo — e o hook espera, como no Bash. */
export type Confirmar = (p: { ferramenta: string; contamina: boolean; comando?: string; arquivo?: string }) => Promise<Confirmacao>;

const saida = (permitir: boolean, motivo: string): SaidaHook => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: permitir ? "allow" : "deny", permissionDecisionReason: `nod: ${motivo}` } });

/** O motivo que o modelo lê quando a espera acaba sem resposta: a aprovação segue na conversa e retoma a tarefa. */
export const AINDA_ESPERANDO = "o pedido de aprovação deste comando continua na conversa; quando a pessoa decidir, a tarefa retoma sozinha. Encerre o turno dizendo que está esperando — não repita o comando agora.";

/** Uma decisão completa: evento do CLI → saída do hook. `confirmar` fala com o servidor (injetável no teste). */
export async function decidirHook(evento: unknown, confirmar: Confirmar, pastas?: Pick<ConfigHook, "pastaDoBot" | "home" | "daTask">): Promise<SaidaHook> {
  const e = (typeof evento === "object" && evento !== null ? evento : {}) as { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  const ferramenta = typeof e.tool_name === "string" ? e.tool_name : "";
  const entrada = typeof e.tool_input === "object" && e.tool_input !== null ? (e.tool_input as Record<string, unknown>) : {};
  // ADR-065: o `cwd` do evento é a pasta em que o Bash está agora (o Claude Code a mantém entre comandos).
  const pasta = pastas?.pastaDoBot && pastas.home ? { cwd: typeof e.cwd === "string" ? e.cwd : null, pastaDoBot: pastas.pastaDoBot, home: pastas.home, daTask: pastas.daTask === true } : undefined;
  const d = decidirNativa({ ferramenta, entrada, ...(pasta ? { pasta } : {}) });
  if (!d.permitir) return saida(false, d.motivo);
  // MCP: o proxy já decide e registra; o hook não confirma de novo no servidor (a rota só aceita nativas).
  if (ferramenta.startsWith("mcp__")) return saida(true, d.motivo);
  const c = await confirmar({ ferramenta, contamina: d.contamina, ...(d.comando !== undefined ? { comando: d.comando } : {}), ...(d.arquivo !== undefined ? { arquivo: d.arquivo } : {}) });
  return c.permitir ? saida(true, d.motivo) : saida(false, c.motivo ?? "o servidor do nod não confirmou esta chamada");
}

/** Resposta do POST /api/interno/nativas: liberada, ou uma decisão aberta para esperar. */
type RespostaNativa = { ok?: boolean; aguardar?: string; mensagem?: string };
type RespostaAguardar = { estado?: string; itens?: { desfecho?: string | null }[] };

/**
 * Fala com o servidor. Bash que precisa de aprovação: espera a decisão em fatias até ESPERA_APROVACAO_NO_TURNO_MS
 * (era abaixo da isenção do vigia da ADR-040, que saiu na ADR-067); aprovada, confirma de novo — agora o servidor acha a aprovação, grava a
 * trilha e libera. Recusada, ou a espera acabou: nega com o motivo que o modelo precisa ler.
 */
export function confirmarNoServidor(cfg: ConfigHook, opcoes: { agora?: () => number; fetch?: typeof fetch } = {}): Confirmar {
  const agora = opcoes.agora ?? Date.now;
  const buscar = opcoes.fetch ?? fetch;
  const base = cfg.url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" };
  return async ({ ferramenta, contamina, comando, arquivo }) => {
    const pedir = async (): Promise<RespostaNativa | Confirmacao> => {
      const r = await buscar(`${base}/api/interno/nativas`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ferramenta, contamina, ...(comando !== undefined ? { comando } : {}), ...(arquivo !== undefined ? { arquivo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      const corpo = (await r.json().catch(() => ({}))) as RespostaNativa;
      return r.ok ? corpo : { permitir: false, motivo: corpo.mensagem ?? "o servidor do nod não confirmou esta chamada" };
    };
    const primeira = await pedir();
    if ("permitir" in primeira) return primeira;
    if (primeira.ok === true) return { permitir: true };
    if (typeof primeira.aguardar !== "string") return { permitir: false, motivo: "resposta inesperada do servidor do nod" };
    const inicio = agora();
    while (agora() - inicio < ESPERA_APROVACAO_NO_TURNO_MS) {
      const r = await buscar(`${base}/api/interno/decisoes/${encodeURIComponent(primeira.aguardar)}/aguardar`, { headers, signal: AbortSignal.timeout(LONGPOLL_APROVACAO_MS + 10_000) });
      if (!r.ok) return { permitir: false, motivo: "a aprovação deste comando não foi encontrada" };
      const d = (await r.json()) as RespostaAguardar;
      if (d.estado !== "decidida") continue;
      if (!(d.itens ?? []).some((i) => i.desfecho === "executado")) return { permitir: false, motivo: "a pessoa não aprovou este comando" };
      const segunda = await pedir();
      return "permitir" in segunda ? segunda : segunda.ok === true ? { permitir: true } : { permitir: false, motivo: "o servidor do nod não liberou o comando aprovado" };
    }
    return { permitir: false, motivo: AINDA_ESPERANDO };
  };
}

async function lerStdin(): Promise<string> {
  let texto = "";
  for await (const pedaco of process.stdin) texto += String(pedaco);
  return texto;
}

export async function main(): Promise<void> {
  let resposta: SaidaHook;
  try {
    const cfg = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as ConfigHook;
    const evento = JSON.parse(await lerStdin()) as unknown;
    resposta = await decidirHook(evento, confirmarNoServidor(cfg), cfg);
  } catch {
    resposta = saida(false, "não foi possível decidir esta chamada");
  }
  process.stdout.write(JSON.stringify(resposta));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
