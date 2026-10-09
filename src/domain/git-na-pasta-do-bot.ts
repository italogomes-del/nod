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

/**
 * `daTask` (definido em 2026-10-09, ADR-088): `pastaDoBot` é a pasta da task (`~/nod/<bot>/<slug>`), não a raiz do
 * bot. A worktree nasce ali dentro e a mensagem ensina `<pasta>/<repo>`; ausente = a raiz do bot, `<repo>-<task>`.
 */
export type ContextoDaPasta = { cwd: string | null; pastaDoBot: string; home: string; daTask?: boolean };

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

/** O caminho que a mensagem ensina: dentro da pasta da task, só o repositório; na raiz do bot, repositório e task. */
const destinoDaWorktree = (ctx: ContextoDaPasta) => (ctx.daTask ? `${ctx.pastaDoBot}/<repo>` : `${ctx.pastaDoBot}/<repo>-<task>`);

function aviso(acao: string, alvo: string | null, ctx: ContextoDaPasta): string {
  const onde = alvo ? `mexeria em ${alvo}, fora da sua pasta` : "roda numa pasta que não deu para conferir";
  return `${acao} ${onde}. Cada task numa worktree sua: git -C <clone> fetch origin && git -C <clone> worktree add "${destinoDaWorktree(ctx)}" -b <branch> origin/main, e rode os comandos dentro dela. Os clones de fora da sua pasta não são mexidos por bots.`;
}

/**
 * definido em 2026-10-09 (ADR-088, #216): a worktree nova nasce dentro da pasta deste turno — a da task, quando há task.
 * Medido em 09/10: 198 das 261 worktrees em `~/nod` estavam na raiz do bot, fora de qualquer task, e o nod não sabia de
 * quem eram nem quando apagar. O `worktree add` no clone da pessoa segue livre; o que muda é ONDE ela pode nascer.
 */
function avisoWorktree(alvo: string | null, ctx: ContextoDaPasta): string {
  const onde = alvo ? `criaria a worktree em ${alvo}, fora da ${ctx.daTask ? "pasta desta task" : "sua pasta"}` : "cria a worktree numa pasta que não deu para conferir";
  const limpeza = ctx.daTask ? " Quando a task acaba, o nod apaga a worktree que não tem alteração por commitar (a branch fica no clone)." : "";
  return `git worktree add ${onde}. Crie dentro dela: git -C <clone> worktree add "${destinoDaWorktree(ctx)}" -b <branch> origin/main.${limpeza}`;
}

/** As opções do `git worktree add` que levam valor (o caminho é o primeiro argumento que não é opção nem valor). */
const OPCOES_COM_VALOR_DO_WORKTREE_ADD = new Set(["-b", "-B", "--reason"]);
function caminhoDoWorktreeAdd(args: readonly string[]): string | null {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a === "--") return args[k + 1] ?? null;
    if (OPCOES_COM_VALOR_DO_WORKTREE_ADD.has(a)) { k++; continue; }
    if (a.startsWith("-")) continue;
    return a;
  }
  return null;
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
    return mexe ? aviso(`git ${mexe[1]}`, null, ctx) : null;
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
      if (dir === null || !dentro(dir, ctx.pastaDoBot)) return aviso("gh pr checkout", dir, ctx);
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
    if (sub === "worktree" && args[i + 1] === "add") {
      const caminho = caminhoDoWorktreeAdd(args.slice(i + 2));
      if (caminho === null) continue;
      const destino = resolver(caminho, alvo, ctx.home);
      if (destino === null || !dentro(destino, ctx.pastaDoBot) || destino === ctx.pastaDoBot) return avisoWorktree(destino, ctx);
      continue;
    }
    if (!sub || !GIT_QUE_MEXE.has(sub)) continue;
    if (sub === "stash" && STASH_QUE_SO_LE.has(args[i + 1] ?? "")) continue;
    if (alvo === null || !dentro(alvo, ctx.pastaDoBot)) return aviso(`git ${sub}`, alvo, ctx);
  }
  return null;
}
