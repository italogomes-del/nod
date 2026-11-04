import { spawnSync } from "node:child_process";
import { invocarDoHook } from "../src/adapters/executor/drivers/claude-cli.ts";
import { acharGitBash, ehWindows, RESPOSTA_DO_AUTOTESTE, resolverBinario, type Disco } from "../src/adapters/executor/plataforma.ts";

/**
 * ADA-11 (ADR-147): o que o motor muda quando roda no Windows nativo. A plataforma vai de verdade no anúncio e no
 * pareamento (antes era `linux` fixo), e o motor só sobe com o Git for Windows: sem o Git Bash o Claude Code não roda o
 * hook do nod, e a cerca sumiria em silêncio (risco 3 do plano).
 */
export type PlataformaDoMotor = "linux" | "win32";

export function plataformaDoMotor(plataforma: NodeJS.Platform = process.platform): PlataformaDoMotor {
  return ehWindows(plataforma) ? "win32" : "linux";
}

/**
 * Revisão do PR #642 (M4): o servidor que responde a sessão conhece o win32? Um servidor de antes da ADR-147 não manda
 * `plataformas` e trataria esta máquina como Mac; o motor do Windows não conecta nele (tenta de novo, como servidor fora).
 */
export function servidorAceitaPlataforma(dados: { plataformas?: unknown }, plataforma: NodeJS.Platform = process.platform): boolean {
  if (!ehWindows(plataforma)) return true;
  return Array.isArray(dados.plataformas) && dados.plataformas.includes("win32");
}

/** O código de saída do motor sem o Git for Windows (2 é chave/versão; 3 é "falta instalar algo nesta máquina"). */
export const SAIDA_SEM_GIT_FOR_WINDOWS = 3;

export const MENSAGEM_SEM_GIT_FOR_WINDOWS = "O nod no Windows precisa do Git for Windows (o Git Bash roda o hook que protege os comandos do bot).\nInstale com: winget install --id Git.Git -e\nDepois abra um terminal novo e rode o motor de novo.\n";

type Bash = (bash: string, script: string) => { status: number | null; stdout: string };
const bashDeVerdade: Bash = (bash, script) => {
  const r = spawnSync(bash, ["-c", script], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  return { status: r.status, stdout: String(r.stdout ?? "") };
};

/**
 * No Windows: o Git Bash, o `git.exe` no PATH e o hook rodando por ele, do mesmo jeito que o Claude Code o chama
 * (`invocarDoHook` com caminhos em `/`). Devolve null quando está tudo certo, ou o motivo. Fora do Windows, sempre null.
 */
export function conferirGitForWindows(o: { plataforma?: NodeJS.Platform; env?: Readonly<Record<string, string | undefined>>; disco?: Disco; nodePath: string; hookPath: string; bash?: Bash }): string | null {
  if (!ehWindows(o.plataforma ?? process.platform)) return null;
  const env = o.env ?? process.env;
  const bash = acharGitBash({ env, ...(o.disco ? { disco: o.disco } : {}) });
  if (!bash) return "sem_git_bash";
  let git: ReturnType<typeof resolverBinario>;
  try {
    git = resolverBinario("git", { env, plataforma: "win32", ...(o.disco ? { disco: o.disco } : {}) });
  } catch {
    git = null;
  }
  if (!git) return "sem_git";
  const script = `${invocarDoHook({ nodePath: o.nodePath, hookPath: o.hookPath, windows: true })} autoteste`;
  const r = (o.bash ?? bashDeVerdade)(bash, script);
  return r.status === 0 && r.stdout.trim() === RESPOSTA_DO_AUTOTESTE ? null : "hook_nao_roda";
}
