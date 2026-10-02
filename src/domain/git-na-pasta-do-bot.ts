import { tokenizar } from "./comando.ts";

/**
 * Cada task numa worktree do próprio bot (definido em 2026-10-01, ADR-065). O terminal do bot é o do Mac da pessoa
 * (ADR-055), e os clones dela são um só por repositório: em 30/09 o Dev 4 já tinha o terminal e ia implementar no
 * `~/code/acme/main-repos/acme`, o mesmo clone em que o Marlon e os outros três Devs trabalham. O primeiro
 * `git switch` de um Dev trocaria a branch do outro no meio do trabalho. Por isso o git que MEXE na pasta de
 * trabalho (troca de branch, grava commit, descarta, aplica) só roda dentro de ~/nod/<bot>. O que só lê, o fetch, o
 * push e o `worktree add` no clone da pessoa continuam livres: é por eles que a worktree nasce.
 *
 * É cerca, como a credencial: nega em qualquer modo de aprovação, com o caminho para fazer certo na mensagem.
 */
const GIT_QUE_MEXE = new Set(["checkout", "switch", "commit", "merge", "rebase", "reset", "pull", "stash", "cherry-pick", "revert", "am", "apply", "restore", "clean", "add", "rm", "mv"]);
const STASH_QUE_SO_LE = new Set(["list", "show"]);
const SEPARADORES = new Set(["&&", "||", ";", "|"]);

export type ContextoDaPasta = { cwd: string | null; pastaDoBot: string; home: string };

/** Caminho absoluto e normalizado, ou null quando depende do shell (variável que não seja HOME). */
function resolver(caminho: string, base: string | null, home: string): string | null {
  let p = caminho;
  if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
  else if (p.startsWith("$HOME")) p = home + p.slice(5);
  else if (p.startsWith("${HOME}")) p = home + p.slice(7);
  if (p.includes("$")) return null;
  if (!p.startsWith("/")) {
    if (base === null) return null;
    p = `${base}/${p}`;
  }
  const partes: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") partes.pop();
    else partes.push(s);
  }
  return `/${partes.join("/")}`;
}

const dentro = (alvo: string, pasta: string) => alvo === pasta || alvo.startsWith(`${pasta}/`);

/**
 * As palavras do comando até a primeira substituição: o `git commit -m "$(cat <<'EOF' …)"` que o Claude Code
 * escreve não tokeniza inteiro, mas o `cd … && git commit` que decide a pasta vem antes dela.
 */
function tokensAteSubstituicao(comando: string): { texto: string; operador: boolean }[] | null {
  const corte = [comando.indexOf("$("), comando.indexOf("`"), comando.indexOf("<(")].filter((i) => i >= 0);
  const prefixo = corte.length ? comando.slice(0, Math.min(...corte)) : comando;
  const tokens = tokenizar(prefixo);
  if (tokens || corte.length === 0) return tokens;
  // A aspa que abria a substituição ficou sem par no prefixo: corta nela.
  const aspa = Math.max(prefixo.lastIndexOf('"'), prefixo.lastIndexOf("'"));
  return aspa >= 0 ? tokenizar(prefixo.slice(0, aspa)) : null;
}

function aviso(acao: string, alvo: string | null, pastaDoBot: string): string {
  const onde = alvo ? `mexeria em ${alvo}, fora da sua pasta` : "roda numa pasta que não deu para conferir";
  return `${acao} ${onde}. Cada task numa worktree sua: git -C <clone> fetch origin && git -C <clone> worktree add "${pastaDoBot}/<repo>-<task>" -b <branch> origin/main, e rode os comandos dentro dela. Os clones de fora da sua pasta não são mexidos por bots.`;
}

/**
 * O arquivo que Write/Edit/NotebookEdit gravaria, quando fica FORA de ~/nod/<bot> (definido em 2026-10-01, ADR-066):
 * aí a gravação segue o modo de aprovação, como o comando do terminal já seguia — no manual, card; no automático e
 * no total, grava. Dentro da pasta do bot (a worktree dele), sempre livre. Caminho que não dá para resolver conta
 * como fora: fail-closed para o card, nunca para a gravação calada.
 */
export function arquivoForaDaPastaDoBot(caminho: string, ctx: ContextoDaPasta): string | null {
  const base = ctx.cwd === null ? null : resolver(ctx.cwd, null, ctx.home);
  const alvo = resolver(caminho, base, ctx.home);
  if (alvo !== null && dentro(alvo, ctx.pastaDoBot)) return null;
  return alvo ?? caminho;
}

/** Por que este comando mexeria numa pasta de trabalho fora de ~/nod/<bot>, ou null se pode rodar. */
export function gitForaDaPastaDoBot(comando: string, ctx: ContextoDaPasta): string | null {
  if (!/\b(git|gh)\b/.test(comando)) return null;
  const tokens = tokensAteSubstituicao(comando);
  if (!tokens) {
    // Fail-closed só para o que claramente mexe: o resto segue para o servidor decidir (autorizar-comando.ts).
    const mexe = /\bgit\s[^;&|\n]*\b(checkout|switch|commit|merge|rebase|reset|pull|cherry-pick|revert|restore|clean)\b/.exec(comando);
    return mexe ? aviso(`git ${mexe[1]}`, null, ctx.pastaDoBot) : null;
  }
  let dir = ctx.cwd === null ? null : resolver(ctx.cwd, null, ctx.home);
  let palavras: string[] = [];
  const segmentos: string[][] = [];
  for (const t of tokens) {
    if (t.operador && SEPARADORES.has(t.texto)) { segmentos.push(palavras); palavras = []; continue; }
    if (!t.operador) palavras.push(t.texto);
  }
  segmentos.push(palavras);
  for (const s of segmentos) {
    // `FOO=bar git …`: a variável não muda a pasta.
    const inicio = s.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const [programa, ...args] = inicio < 0 ? [] : s.slice(inicio);
    if (programa === "cd" || programa === "pushd") { dir = resolver(args[0] ?? "~", dir, ctx.home); continue; }
    if (programa === "gh" && args[0] === "pr" && args[1] === "checkout") {
      if (dir === null || !dentro(dir, ctx.pastaDoBot)) return aviso("gh pr checkout", dir, ctx.pastaDoBot);
      continue;
    }
    if (programa !== "git") continue;
    let alvo = dir;
    let i = 0;
    while (i < args.length && args[i]!.startsWith("-")) {
      const a = args[i]!;
      if (a === "-C" || a === "--work-tree") { alvo = resolver(args[i + 1] ?? "", alvo, ctx.home); i += 2; continue; }
      if (a.startsWith("--work-tree=")) { alvo = resolver(a.slice("--work-tree=".length), alvo, ctx.home); i += 1; continue; }
      i += a === "--git-dir" || a === "-c" ? 2 : 1;
    }
    const sub = args[i];
    if (!sub || !GIT_QUE_MEXE.has(sub)) continue;
    if (sub === "stash" && STASH_QUE_SO_LE.has(args[i + 1] ?? "")) continue;
    if (alvo === null || !dentro(alvo, ctx.pastaDoBot)) return aviso(`git ${sub}`, alvo, ctx.pastaDoBot);
  }
  return null;
}
