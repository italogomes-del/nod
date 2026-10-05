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
 *
 * `features.code_mode_host=false` SAIU daqui em 2026-10-05, e `features.code_mode` não entra. Medido nesse dia com o
 * codex-cli 0.147.0 e o gpt-5.6-sol (scripts/sonda-codex-ferramentas.ts e os argumentos deste driver contra um
 * servidor MCP de prova):
 *  - o modelo NÃO recebe as ferramentas MCP como funções: ele as chama por `functions.exec`, um trecho de código que
 *    roda no "code-mode host". Com o host desligado, toda chamada volta "code-mode host is disabled" antes de chegar
 *    ao servidor (o servidor sobe e responde `tools/list`, mas nunca recebe `tools/call`). Em produção, nove turnos
 *    seguidos de um bot no Codex terminaram com zero chamadas e o bot dizendo que "a ferramenta está indisponível";
 *  - esse ambiente de código não tem arquivo nem rede (`require`, `process`, `fetch`, `WebSocket` indefinidos). O que
 *    ele enxerga é `apply_patch` (preso ao sandbox do turno), `update_plan`, os recursos MCP e as `mcp__nod__*` do
 *    plano. Ligar o host não abriu nada além do caminho até o proxy;
 *  - a lista de funções que o modelo vê (`functions.exec`, `functions.wait`, `collaboration.*`…) é a MESMA com o host
 *    ligado ou desligado: desligá-lo só fazia tudo falhar. As `collaboration.*` continuam lá apesar de
 *    `features.multi_agent=false`; não foi este ajuste que as trouxe, e fechar isso fica em aberto.
 */
export const OVERRIDES_ISOLAMENTO_CODEX = [
  'web_search="disabled"',
  "features.shell_tool=false", "features.unified_exec=false", "features.apply_patch_freeform=false",
  "features.multi_agent=false", "features.apps=false", "features.js_repl=false", "features.view_image=false", "features.plugins=false", "features.hooks=false",
  "features.browser_use=false", "features.browser_use_external=false", "features.computer_use=false",
  "features.in_app_browser=false", "features.remote_plugin=false", "features.image_generation=false",
  "features.workspace_dependencies=false", "features.shell_snapshot=false",
  "features.skip_host_skill_discovery=true", "features.skill_search=false", "project_doc_max_bytes=0",
] as const;

/**
 * Chaves que a versão instalada do Codex RECUSOU ("unknown configuration field"), descobertas por
 * `negociarConfigCodex`. O driver roda com `--strict-config`: uma chave que a versão não conhece derruba o turno
 * inteiro antes do modelo (medido em 2026-10-05: o 0.147.0 não conhece `features.skip_host_skill_discovery`, e todo
 * turno saía com código 1 e zero tokens).
 */
export type RecusadasCodex = ReadonlySet<string>;
export const SEM_RECUSADAS: RecusadasCodex = new Set<string>();

/**
 * definido em 2026-10-05: as ferramentas do servidor nod rodam sem pedir aprovação AO CODEX. Medido com o 0.147.0:
 * sob `approval_policy="never"` o Codex cancela a chamada MCP sozinho ("user cancelled MCP tool call"), e com este
 * campo a chamada chega ao servidor. Quem decide se a ferramenta roda continua sendo o proxy do nod, com o modo de
 * aprovação do bot e o cartão na conversa (ADR-062); o Codex nunca foi esse lugar.
 */
const CAMPO_APROVACAO = "default_tools_approval_mode";

/**
 * definido em 2026-10-05: o que NÃO pode ser recusado. Sem estas, o nod não sabe se o modelo ficou com terminal ou
 * sem o proxy, e o Codex fica indisponível em vez de rodar mais solto. As outras `features.*` e os campos opcionais do
 * servidor podem cair: uma feature que a versão não conhece não existe nela para ser desligada.
 */
const PODE_CAIR = (chave: string) =>
  (chave.startsWith("features.") && chave !== "features.shell_tool" && chave !== "features.unified_exec") || chave === `mcp_servers.nod.${CAMPO_APROVACAO}`;

const chaveDoOverride = (override: string) => override.slice(0, override.indexOf("="));

export function overridesIsolamentoCodex(recusadas: RecusadasCodex = SEM_RECUSADAS): string[] {
  return OVERRIDES_ISOLAMENTO_CODEX.filter((o) => !recusadas.has(chaveDoOverride(o)));
}

/** definido em 2026-09-18: configuração aponta para um launcher privado; token nunca em argv. */
export function configMcpCodex(plano: PlanoTurno, lig: LigacaoClaudeCli, recusadas: RecusadasCodex = SEM_RECUSADAS): string {
  const mcp = { command: lig.nodePath ?? process.execPath, args: [lig.proxyPath], env: lig.electronComoNode ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
  const quote = JSON.stringify;
  const campos: [string, string][] = [
    ["command", quote(mcp.command)],
    ["args", `[${mcp.args.map((s) => quote(s)).join(", ")}]`],
    ["required", "true"],
    [CAMPO_APROVACAO, quote("approve")],
    ["enabled_tools", `[${plano.catalogo.ferramentas.map((f) => quote(f.nome)).join(", ")}]`],
    ["tool_timeout_sec", String(Math.ceil(plano.politicaExecucao.prazoMs / 1000))],
    ["env", `{ ${Object.entries(mcp.env).map(([k, v]) => `${k} = ${quote(v)}`).join(", ")} }`],
  ];
  return `{ nod = { ${campos.filter(([nome]) => !recusadas.has(`mcp_servers.nod.${nome}`)).map(([nome, valor]) => `${nome} = ${valor}`).join(", ")} } }`;
}

/** A chave que o Codex recusou, tirada da mensagem dele. null = a saída não é uma recusa de chave. */
export function chaveRecusada(saida: string): string | null {
  return /unknown configuration field `([^`]+)`/.exec(saida)?.[1] ?? null;
}

export type NegociacaoCodex = { aceita: true; recusadas: RecusadasCodex } | { aceita: false; recusadas: RecusadasCodex; chave: string | null };

/** definido em 2026-10-05: uma rodada por chave que cai, mais folga; a lista de isolamento tem 21 chaves. */
const RODADAS_MAX = 30;

/**
 * Descobre, SEM gastar turno, quais chaves a versão instalada aceita. Medido em 2026-10-05 com o 0.147.0: o
 * `codex exec --strict-config … -` com o stdin vazio valida a configuração inteira e para em "No prompt provided via
 * stdin" (menos de 1 s, nenhum modelo chamado); com uma chave desconhecida, para antes em "unknown configuration field
 * `<chave>`", uma chave por vez. Cada rodada tira a chave recusada e tenta de novo.
 *
 * `rodar(recusadas)` executa o comando com o stdin fechado e devolve stdout+stderr. Uma chave que não pode cair
 * (ver PODE_CAIR), ou uma recusa que se repete, encerra com `aceita: false`: o Codex fica indisponível.
 * Saída que não é recusa de chave (inclusive a de uma versão que não pare em "No prompt provided") conta como aceita:
 * a negociação só existe para tirar chave desconhecida, e sem recusa não há o que tirar.
 */
export async function negociarConfigCodex(rodar: (recusadas: RecusadasCodex) => Promise<string>): Promise<NegociacaoCodex> {
  const recusadas = new Set<string>();
  for (let i = 0; i < RODADAS_MAX; i++) {
    const chave = chaveRecusada(await rodar(recusadas));
    if (chave === null) return { aceita: true, recusadas };
    if (recusadas.has(chave) || !PODE_CAIR(chave)) return { aceita: false, recusadas, chave };
    recusadas.add(chave);
  }
  return { aceita: false, recusadas, chave: null };
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
