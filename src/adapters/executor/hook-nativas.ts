import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { decidirNativa } from "../../domain/nativas.ts";

/**
 * Hook PreToolUse do nod (ADR-052): o Claude Code o chama ANTES de cada ferramenta nativa do turno, e é ele
 * quem decide — o mesmo papel do proxy para as ferramentas MCP (ADR-013), local e fail-closed. O driver grava
 * a configuração (0600) no diretório temporário do turno; o token nunca vai na linha de comando.
 *
 * Decide sozinho o que é local (caminho dentro da pasta do bot ou das pastas autorizadas, Bash no sandbox) e
 * confirma com o servidor, que grava a trilha e marca o turno quando a web entra (0033). Sem confirmação do
 * servidor, nada roda. Nunca escreve fora do JSON de saída no stdout: é o canal com o CLI.
 */
export type ConfigHook = { url: string; token: string; permitidas: string[] };

/** Caminho real: realpath do que existe; do ancestral que existe + o resto, para arquivo ainda por criar. */
export function resolverCaminho(caminho: string): string {
  const resto: string[] = [];
  let atual = caminho;
  for (;;) {
    try {
      return join(realpathSync(atual), ...resto.reverse());
    } catch {
      const pai = dirname(atual);
      if (pai === atual) return caminho;
      resto.push(basename(atual));
      atual = pai;
    }
  }
}

export type SaidaHook = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow" | "deny"; permissionDecisionReason: string } };

const saida = (permitir: boolean, motivo: string): SaidaHook => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: permitir ? "allow" : "deny", permissionDecisionReason: `nod: ${motivo}` } });

/** Uma decisão completa: evento do CLI → saída do hook. `confirmar` fala com o servidor (injetável no teste). */
export async function decidirHook(evento: unknown, cfg: ConfigHook, confirmar: (ferramenta: string, contamina: boolean) => Promise<boolean>): Promise<SaidaHook> {
  const e = (typeof evento === "object" && evento !== null ? evento : {}) as { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  const ferramenta = typeof e.tool_name === "string" ? e.tool_name : "";
  const entrada = typeof e.tool_input === "object" && e.tool_input !== null ? (e.tool_input as Record<string, unknown>) : {};
  const cwd = typeof e.cwd === "string" && e.cwd !== "" ? e.cwd : process.cwd();
  const d = decidirNativa({ ferramenta, entrada, permitidas: cfg.permitidas.map(resolverCaminho), cwd, resolver: resolverCaminho, separador: sep });
  if (!d.permitir) return saida(false, d.motivo);
  // MCP: o proxy já decide e registra; o hook não confirma de novo no servidor (a rota só aceita nativas).
  if (ferramenta.startsWith("mcp__")) return saida(true, d.motivo);
  return (await confirmar(ferramenta, d.contamina)) ? saida(true, d.motivo) : saida(false, "o servidor do nod não confirmou esta chamada");
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
    resposta = await decidirHook(evento, cfg, async (ferramenta, contamina) => {
      const r = await fetch(`${cfg.url.replace(/\/+$/, "")}/api/interno/nativas`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
        body: JSON.stringify({ ferramenta, contamina }),
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    });
  } catch {
    resposta = saida(false, "não foi possível decidir esta chamada");
  }
  process.stdout.write(JSON.stringify(resposta));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
