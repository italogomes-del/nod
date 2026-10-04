import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { LigacaoClaudeCli } from "./claude-cli.ts";

/**
 * O que o `codex exec` (turno) e o `codex app-server` (laço de voz) têm em comum (definido em 2026-10-04, ADR-076):
 * o filtro de ambiente, as chaves `-c` de isolamento, a config do MCP do proxy nod e o launcher 0600 que leva o token
 * do turno sem passá-lo no argv.
 */

/** O Codex nunca herda chave da OpenAI nem acesso ao banco do servidor. */
const FORA_DO_AMBIENTE_CODEX = /^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|DATABASE_|PGPASSWORD$)/;

export function ambienteCodex(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !FORA_DO_AMBIENTE_CODEX.test(k)));
}

/**
 * Chaves de config (`-c chave=valor`) que desligam tudo o que não é o proxy nod: busca na web, terminal, patch,
 * plugins, apps, navegador, skills e AGENTS.md. Valem para qualquer subcomando (são chaves do config.toml, não flags
 * do `exec`). A ordem é a do argv do `codex exec` desde 2026-09-18.
 */
export const OVERRIDES_ISOLAMENTO_CODEX = [
  'web_search="disabled"',
  "features.shell_tool=false", "features.unified_exec=false", "features.apply_patch_freeform=false",
  "features.multi_agent=false", "features.apps=false", "features.js_repl=false", "features.view_image=false", "features.plugins=false", "features.hooks=false",
  "features.browser_use=false", "features.browser_use_external=false", "features.computer_use=false",
  "features.in_app_browser=false", "features.remote_plugin=false", "features.image_generation=false",
  "features.code_mode_host=false", "features.workspace_dependencies=false", "features.shell_snapshot=false",
  "features.skip_host_skill_discovery=true", "features.skill_search=false", "project_doc_max_bytes=0",
] as const;

/** definido em 2026-09-18: configuração aponta para um launcher privado; token nunca em argv. */
export function configMcpCodex(plano: PlanoTurno, lig: LigacaoClaudeCli): string {
  const mcp = { command: lig.nodePath ?? process.execPath, args: [lig.proxyPath], env: lig.electronComoNode ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
  const quote = JSON.stringify;
  return `{ nod = { command = ${quote(mcp.command)}, args = [${mcp.args.map((s) => quote(s)).join(", ")}], required = true, enabled_tools = [${plano.catalogo.ferramentas.map((f) => quote(f.nome)).join(", ")}], tool_timeout_sec = ${Math.ceil(plano.politicaExecucao.prazoMs / 1000)}, env = { ${Object.entries(mcp.env).map(([k, v]) => `${k} = ${quote(v)}`).join(", ")} } } }`;
}

/**
 * Launcher do proxy MCP (definido em 2026-09-18, extraído em 2026-10-04): um `proxy.mjs` 0600, criado exclusivo
 * (`wx`) dentro do diretório privado do turno, que põe URL e token no ambiente do proxy e chama `main()`. Quem cria
 * o diretório o apaga ao encerrar — o token só existe em disco enquanto o turno vive.
 */
export async function escreverLauncherProxy(dir: string, p: { urlNod: string; tokenDeTurno: string; proxyPath: string }): Promise<string> {
  const launcher = join(dir, "proxy.mjs");
  await writeFile(launcher, `process.env.NOD_URL = ${JSON.stringify(p.urlNod)};\nprocess.env.NOD_TOKEN_TURNO = ${JSON.stringify(p.tokenDeTurno)};\nconst proxy = await import(${JSON.stringify(pathToFileURL(p.proxyPath).href)});\nawait proxy.main();\n`, { mode: 0o600, flag: "wx" });
  return launcher;
}
