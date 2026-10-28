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

/**
 * revisto em 2026-10-09 (revisão do #225): NFC e sem caixa — o APFS não diferencia maiúsculas e o mesmo acento chega em
 * NFC ou NFD; `~/nod/dev 4/x` e `~/nod/Dev 4/x` são a mesma pasta no Mac.
 */
/** A forma de comparar caminhos: o disco do macOS não distingue maiúsculas e o nome pode vir em NFD. */
export const comparavel = (c: string): string => c.normalize("NFC").toLowerCase();
const dentro = (alvo: string, pasta: string) => {
  const a = comparavel(alvo);
  const p = comparavel(pasta);
  return a === p || a.startsWith(`${p}/`);
};

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

/** O caminho absoluto que a nativa grava (relativo ao `cwd` do evento), ou o cru quando não dá para resolver. */
export function caminhoGravado(caminho: string, ctx: Pick<ContextoDaPasta, "cwd" | "home">): string {
  const base = ctx.cwd === null ? null : resolver(ctx.cwd, null, ctx.home);
  return resolver(caminho, base, ctx.home) ?? caminho;
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

/** Palavras do shell que abrem o comando de verdade: `for …; do git …`, `if …; then git …`. */
const PALAVRAS_DE_CONTROLE = new Set(["do", "then", "else", "elif", "if", "while", "until", "{", "!", "time"]);
const ATRIBUICAO = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/**
 * definido em 2026-10-11: `$NOME` e `${NOME}` com o valor que o próprio comando deu antes (`T=~/nod/x; git worktree add
 * "$T/repo"`), e `$HOME`. Variável sem valor conhecido fica como está, e o `resolver` desiste dela. No levantamento de
 * 11/10, 167 das 177 recusas "numa pasta que não deu para conferir" (VM e Mac, 28/09 a 11/10) eram esse padrão.
 */
function expandir(palavra: string, vars: ReadonlyMap<string, string | null>, home: string, literal: (nome: string) => boolean): string {
  return palavra.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (inteiro, a?: string, b?: string) => {
    const nome = (a ?? b)!;
    if (literal(nome)) return inteiro;
    if (nome === "HOME") return home;
    return vars.get(nome) ?? inteiro;
  });
}

/**
 * O tokenizador tira as aspas, e `'$T'` é literal no shell. A variável que aparece entre aspas simples em algum ponto do
 * comando não é expandida em lugar nenhum. A conferência é larga (pode casar de uma aspa que fecha até a próxima que
 * abre), e o erro dela só nega a mais.
 */
const citadaLiteral = (comando: string) => (nome: string) => new RegExp(`'[^']*\\$\\{?${nome}(?![A-Za-z0-9_])[^']*'`).test(comando);

/** `$PWD` é a pasta em que o comando está naquele ponto (o cwd, depois dos `cd`), quando ela é conhecida. */
function comPwd(vars: ReadonlyMap<string, string | null>, dir: string | null): ReadonlyMap<string, string | null> {
  return vars.has("PWD") ? vars : new Map([...vars, ["PWD", dir]]);
}

/**
 * definido em 2026-10-22 (NOD-315, ADR-119): o clone da máquina (`~/nod/.clones/<dono>/<nome>.git`) é um só para todos
 * os bots. Uma frente que apaga o branch de outra, remove a worktree dela ou roda `gc`/`config` nele estraga o trabalho
 * dos outros. O fetch e o `worktree add` dentro da própria pasta seguem livres: é por eles que a frente trabalha.
 */
const CLONE_E_DE_TODOS = "O clone da máquina é de todos os bots: só o nod mexe nele.";
const OPCOES_QUE_APAGAM_BRANCH = new Set(["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force"]);
const WORKTREE_DE_OUTRO = new Set(["remove", "lock", "unlock", "repair"]);
const MANUTENCAO = new Set(["gc", "prune", "repack", "reflog", "config", "remote", "filter-branch", "filter-repo", "maintenance"]);
const REFLOG_QUE_SO_LE = new Set(["show", "exists"]);
const CONFIG_QUE_SO_LE = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "get", "list"]);
const REMOTE_QUE_SO_LE = new Set(["-v", "--verbose", "show", "get-url"]);

/** O branch desta frente (`frente/<slug da pasta>`); fora da pasta de task, nenhum. */
const branchProprio = (ctx: ContextoDaPasta) => (ctx.daTask ? `frente/${ctx.pastaDoBot.split("/").filter(Boolean).at(-1) ?? ""}` : null);
const nomeDoBranch = (ref: string) => ref.replace(/^refs\/heads\//, "");

/**
 * revisto em 2026-10-22 (revisão do #456): o `config` e o `remote` só leem quando a ação vem primeiro. O git lê as opções
 * depois do nome como argumento: `git config core.bare false --get` GRAVA (o `--get` vira o padrão do valor), e
 * `git remote -v add x url` adiciona o remoto.
 */
function soLe(sub: string, resto: readonly string[]): boolean {
  if (sub === "reflog") return resto.length === 0 || REFLOG_QUE_SO_LE.has(resto[0]!);
  if (sub === "config") return CONFIG_QUE_SO_LE.has(resto[0] ?? "");
  if (sub === "remote") {
    let k = 0;
    while (resto[k] === "-v" || resto[k] === "--verbose") k++;
    return k === resto.length || REMOTE_QUE_SO_LE.has(resto[k]!);
  }
  return false;
}

function cercaDoCloneDaMaquina(sub: string | undefined, resto: readonly string[], alvo: string | null, ctx: ContextoDaPasta, gitDir: string | null = null): string | null {
  const proprio = branchProprio(ctx);
  const deOutraFrente = (ref: string) => { const b = nomeDoBranch(ref); return b.startsWith("frente/") && b !== proprio; };
  if (sub === "branch" && resto.some((a) => OPCOES_QUE_APAGAM_BRANCH.has(a) || (/^-[a-zA-Z]*[dDmMcCf]/.test(a) && !a.startsWith("--")))) {
    const outro = resto.find((a) => !a.startsWith("-") && deOutraFrente(a));
    if (outro) return `git branch mexeria em ${outro}, o branch de outra frente. ${CLONE_E_DE_TODOS} Mexa só no seu${proprio ? ` (${proprio})` : ""}.`;
  }
  // QA do #456: o update-ref sem -d também regrava o branch de outra frente (`git update-ref refs/heads/frente/x <sha>`).
  if (sub === "update-ref") {
    const outro = resto.find((a) => !a.startsWith("-") && deOutraFrente(a));
    if (outro || resto.includes("--stdin")) return `git update-ref mexeria em ${outro ?? "refs que não deu para conferir"}. ${CLONE_E_DE_TODOS}`;
  }
  // QA do #456: o fetch com refspec grava no destino dele (`git fetch origin main:frente/x`, `+HEAD:refs/heads/frente/x`).
  if (sub === "fetch") {
    const outro = resto.map((a) => (!a.startsWith("-") && a.includes(":") ? a.slice(a.lastIndexOf(":") + 1) : "")).find((d) => d && deOutraFrente(d));
    if (outro) return `git fetch gravaria em ${outro}, o branch de outra frente. ${CLONE_E_DE_TODOS} Mexa só no seu${proprio ? ` (${proprio})` : ""}.`;
  }
  if (sub === "worktree" && WORKTREE_DE_OUTRO.has(resto[0] ?? "")) {
    const caminhos = resto.slice(1).filter((a) => !a.startsWith("-"));
    // Sem caminho, o `repair`/`remove` vale para a worktree em que roda (ou para todas, no clone).
    const destinos = caminhos.length ? caminhos.map((c) => resolver(c, alvo, ctx.home)) : [alvo];
    const fora = destinos.find((d) => d === null || !dentro(d, ctx.pastaDoBot));
    if (fora !== undefined) return `git worktree ${resto[0]} mexeria em ${fora ?? "uma pasta que não deu para conferir"}, fora da sua pasta. ${CLONE_E_DE_TODOS} Remova só a sua worktree; as outras o nod apaga quando a frente acaba.`;
  }
  // O repositório em que o comando roda: o `--git-dir`/`GIT_DIR`, quando há, vale mais que o -C/cwd.
  const repo = gitDir ?? alvo;
  const noClone = repo !== null && dentro(repo, `${ctx.home}/nod/.clones`);
  if (!noClone || !sub) return null;
  if ((MANUTENCAO.has(sub) && !soLe(sub, resto)) || (sub === "worktree" && resto[0] === "prune")) return `git ${sub} mexeria em ${repo}. ${CLONE_E_DE_TODOS} Para atualizar, só git -C <clone> fetch origin.`;
  return null;
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
  // `depois`: o separador que vem antes do segmento. A atribuição vale depois de `;`, do começo e de `&&` (se ela não
  // rodou, o que vem encadeado por `&&` também não roda). Depois de `||` pode não ter rodado, e num pipe roda num subshell.
  const segmentos: { palavras: string[]; depois: string }[] = [];
  let depois = ";";
  for (const t of tokens) {
    if (t.operador && SEPARADORES.has(t.texto)) { segmentos.push({ palavras, depois }); palavras = []; depois = t.texto; continue; }
    if (!t.operador) palavras.push(t.texto);
  }
  segmentos.push({ palavras, depois });
  const literal = citadaLiteral(comando);
  const vars = new Map<string, string | null>();
  for (const seg of segmentos) {
    let s = seg.palavras;
    while (s.length > 0 && PALAVRAS_DE_CONTROLE.has(s[0]!)) s = s.slice(1);
    // `for b in …`: o valor de `b` muda a cada volta.
    if (s[0] === "for" || s[0] === "select") { if (s[1]) vars.set(s[1], null); continue; }
    if (s[0] === "export" || s[0] === "local" || s[0] === "readonly") s = s.slice(1).filter((w) => !w.startsWith("-"));
    if (s.length > 0 && s.every((w) => ATRIBUICAO.test(w))) {
      for (const w of s) {
        const [, nome, valor] = ATRIBUICAO.exec(w)!;
        const v = expandir(valor!, comPwd(vars, dir), ctx.home, literal);
        vars.set(nome!, (seg.depois === ";" || seg.depois === "&&") && !v.includes("$") ? v : null);
      }
      continue;
    }
    s = s.map((w) => expandir(w, comPwd(vars, dir), ctx.home, literal));
    // `FOO=bar git …`: a variável não muda a pasta.
    const inicio = s.findIndex((w) => !ATRIBUICAO.test(w));
    const [programa, ...args] = inicio < 0 ? [] : s.slice(inicio);
    if (programa === "cd" || programa === "pushd") { dir = resolver(args[0] ?? "~", dir, ctx.home); continue; }
    if (programa === "gh" && args[0] === "pr" && args[1] === "checkout") {
      if (dir === null || !dentro(dir, ctx.pastaDoBot)) return aviso("gh pr checkout", dir, ctx);
      continue;
    }
    if (programa !== "git") continue;
    let alvo = dir;
    // revisão do #456: o repositório pelo `GIT_DIR=` (no próprio comando ou atribuído antes) e pelo `--git-dir`.
    const gitDirDoAmbiente = s.slice(0, Math.max(0, inicio)).map((w) => ATRIBUICAO.exec(w)).find((m) => m?.[1] === "GIT_DIR")?.[2] ?? vars.get("GIT_DIR") ?? null;
    let gitDir = gitDirDoAmbiente === null ? null : resolver(gitDirDoAmbiente, alvo, ctx.home);
    let i = 0;
    while (i < args.length && args[i]!.startsWith("-")) {
      const a = args[i]!;
      if (a === "-C" || a === "--work-tree") { alvo = resolver(args[i + 1] ?? "", alvo, ctx.home); i += 2; continue; }
      if (a.startsWith("--work-tree=")) { alvo = resolver(a.slice("--work-tree=".length), alvo, ctx.home); i += 1; continue; }
      if (a === "--git-dir") { gitDir = resolver(args[i + 1] ?? "", alvo, ctx.home); i += 2; continue; }
      if (a.startsWith("--git-dir=")) { gitDir = resolver(a.slice("--git-dir=".length), alvo, ctx.home); i += 1; continue; }
      i += a === "-c" ? 2 : 1;
    }
    const sub = args[i];
    const cerca = cercaDoCloneDaMaquina(sub, args.slice(i + 1), alvo, ctx, gitDir);
    if (cerca) return cerca;
    if (sub === "worktree" && (args[i + 1] === "add" || args[i + 1] === "move")) {
      // revisão do #225: o `worktree move <worktree> <destino>` muda onde ela mora — vale a mesma regra do `add`.
      const posicionais = args[i + 1] === "add" ? [caminhoDoWorktreeAdd(args.slice(i + 2))] : args.slice(i + 2).filter((a) => !a.startsWith("-"));
      const caminho = args[i + 1] === "add" ? posicionais[0] : posicionais[1];
      if (caminho === null || caminho === undefined) continue;
      const destino = resolver(caminho, alvo, ctx.home);
      if (destino === null || !dentro(destino, ctx.pastaDoBot) || comparavel(destino) === comparavel(ctx.pastaDoBot)) return avisoWorktree(destino, ctx);
      continue;
    }
    if (!sub || !GIT_QUE_MEXE.has(sub)) continue;
    if (sub === "stash" && STASH_QUE_SO_LE.has(args[i + 1] ?? "")) continue;
    if (alvo === null || !dentro(alvo, ctx.pastaDoBot)) return aviso(`git ${sub}`, alvo, ctx);
  }
  return null;
}
