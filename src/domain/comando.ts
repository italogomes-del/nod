/**
 * Um comando do terminal do Mac da pessoa só LÊ, ou muda algo? (definido em 2026-09-28, ADR-055, "terminal de
 * verdade, como o inhouse"). O que só lê roda direto; o resto pede aprovação num card. A classificação é
 * CONSERVADORA: na dúvida, "altera" — o custo de errar para esse lado é um clique, e o do outro é um comando
 * rodando no Mac com as credenciais da pessoa sem ela ver.
 *
 * Nada aqui interpreta o shell por completo. O que não cabe na forma simples — substituição de comando,
 * redirecionamento para arquivo, segundo plano, variável na frente do comando, binário por caminho — já é
 * "altera", porque é exatamente por onde um texto de fora (PR, página, arquivo) empurraria um comando.
 */
export type ClasseComando = { tipo: "leitura" | "altera"; motivo: string };

const altera = (motivo: string): ClasseComando => ({ tipo: "altera", motivo });
const LEITURA: ClasseComando = { tipo: "leitura", motivo: "só lê" };

/** Teto do que se classifica; acima disso ninguém confere um comando de olho, então pede. */
const TETO = 2_000;

/**
 * Programas que só leem, sem subcomando que mude algo. `sed -i`, `find -delete` e parentes têm regra própria.
 * `env` e `printenv` ficam de fora de propósito: imprimem os tokens do ambiente da pessoa.
 */
const SIMPLES = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "grep", "egrep", "fgrep", "rg", "tree", "echo", "printf", "which", "whoami",
  "date", "uname", "file", "stat", "du", "df", "sort", "uniq", "cut", "tr", "jq", "diff", "cmp", "basename", "dirname",
  "realpath", "readlink", "test", "[", "true", "false", "cd", "nl", "column", "hostname", "id",
]);

/**
 * Onde moram as credenciais da pessoa no Mac (definido em 2026-09-28, ADR-055). Ler é "só ler", mas ler ISTO e
 * depois mandar para fora (WebFetch, um comentário) é o caminho de um texto malicioso num PR: por isso nunca é
 * leitura livre. Casa no texto do comando e no caminho das ferramentas de arquivo.
 */
// revisto em 2026-09-30: `.key`/`.pem` só como NOME DE ARQUIVO (argumento que começa depois de espaço, aspa, `=` ou
// `:` e termina num separador). `\.(pem|…|key)\b` casava `e.key` em JavaScript embutido: 11 blocos das skills do
// Marlon (gstack-learn) paravam por credencial, e credencial pede a pessoa até no modo total.
const CREDENCIAL = /(^|[\s"'=/:~])(\.ssh|\.aws|\.gnupg|\.config\/gh|\.config\/nod-motor|\.netrc|\.git-credentials|\.npmrc|\.docker\/config\.json|\.kube|\.claude\/\.credentials\.json|\.codex\/auth\.json)(\/|$|[\s"'])|(^|[\s"'=/:~])conexao\.json(?=$|[\s"';|&)])|id_(rsa|ed25519|ecdsa|dsa)\b|(^|[\s"'=:])[\w./~*?-]*[\w*?]\.(pem|p12|pfx|key)(?=$|[\s"';|&)])|(^|[\s;&|])security\s+(find|dump|export)|gh\s+auth\s+token|Library\/Keychains/;

/**
 * O comando ou o caminho toca uma credencial da pessoa (chaves SSH, AWS, login do gh, Keychain)? revisto em 2026-10-09
 * (ADR-090): numa máquina Linux o login do Claude Code e do Codex é arquivo (~/.claude/.credentials.json, ~/.codex/auth.json),
 * e a chave do motor fica em ~/.config/nod-motor/conexao.json — o bot não lê nenhum deles sem a pessoa.
 */
export function tocaCredencial(texto: string): boolean {
  return CREDENCIAL.test(texto);
}

const GIT = new Set([
  "status", "diff", "log", "show", "blame", "ls-files", "ls-tree", "ls-remote", "rev-parse", "rev-list", "describe",
  "shortlog", "grep", "fetch", "cat-file", "merge-base", "count-objects", "whatchanged", "reflog", "help", "version",
]);
/** git que muda algo com argumento, e só lê sem argumento (ou com as flags de listar). */
const GIT_SO_LISTAGEM: Record<string, readonly string[]> = {
  branch: ["-a", "-r", "-v", "-vv", "--list", "-l", "--all", "--remotes", "--verbose", "--show-current", "--merged", "--no-merged", "--contains", "--no-color", "--color"],
  tag: ["-l", "--list", "-n", "--contains", "--merged", "--points-at", "--sort"],
  remote: ["-v", "--verbose", "show", "get-url"],
  stash: ["list", "show"],
  worktree: ["list"],
  config: ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin", "--global", "--local"],
};

/** Flags de listagem cujo argumento seguinte é um valor (padrão, commit, chave), não uma ação. */
const VALOR_SEGUE = new Set(["--contains", "--merged", "--no-merged", "--points-at", "--sort", "-l", "--list", "show", "get-url", "--get", "--get-all", "--get-regexp"]);

/** gh <grupo> <subcomando> que só leem. `gh api` tem regra própria (GET sem campos). */
const GH: Record<string, readonly string[]> = {
  pr: ["list", "view", "diff", "checks", "status"],
  issue: ["list", "view", "status"],
  repo: ["view", "list"],
  // definido em 2026-10-12 (ADR-099, parte 2): `gh run watch` só acompanha a execução até o fim — é o comando do esperar_comando.
  run: ["list", "view", "watch"],
  release: ["list", "view"],
  workflow: ["list", "view"],
  label: ["list"],
  gist: ["list", "view"],
  org: ["list"],
  auth: ["status"],
  search: ["repos", "issues", "prs", "code", "commits"],
};

/** Scripts de pacote que verificam (testes, lint, tipos) — o "rodar testes" que a pessoa aceitou rodar direto. */
const SCRIPTS_DE_VERIFICAR = /^(test|lint|typecheck|check|format:check)(:[\w:-]+)?$/;
const NPX_DE_VERIFICAR = new Set(["vitest", "jest", "tsc", "eslint", "prettier", "biome"]);

type Token = { texto: string; operador: boolean };

/**
 * Quebra o comando em palavras e operadores respeitando aspas. Devolve null quando algo exige o shell inteiro:
 * substituição de comando (`$(…)`, crase, `<(…)`) — inclusive dentro de aspas duplas, onde ela também roda.
 */
export function tokenizar(comando: string): Token[] | null {
  const tokens: Token[] = [];
  let atual = "";
  let temAtual = false;
  const fechar = () => {
    if (temAtual) tokens.push({ texto: atual, operador: false });
    atual = "";
    temAtual = false;
  };
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i]!;
    const prox = comando[i + 1] ?? "";
    if (c === "'") {
      const fim = comando.indexOf("'", i + 1);
      if (fim < 0) return null;
      atual += comando.slice(i + 1, fim);
      temAtual = true;
      i = fim;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < comando.length && comando[j] !== '"'; j++) {
        if (comando[j] === "\\") { atual += comando[j + 1] ?? ""; j++; continue; }
        if (comando[j] === "`" || (comando[j] === "$" && comando[j + 1] === "(")) return null;
        atual += comando[j];
      }
      if (j >= comando.length) return null;
      temAtual = true;
      i = j;
      continue;
    }
    if (c === "\\") { atual += prox; temAtual = true; i++; continue; }
    if (c === "`" || (c === "$" && prox === "(") || ((c === "<" || c === ">") && prox === "(")) return null;
    if (c === " " || c === "\t") { fechar(); continue; }
    if (c === "\n" || c === "\r") { fechar(); tokens.push({ texto: ";", operador: true }); continue; }
    const dois = c + prox;
    // `2>`, `2>>`, `2>&1`: o descritor grudado no redirecionamento é parte dele, não uma palavra.
    if (c === ">" && /^\d$/.test(atual)) { atual = ""; temAtual = false; }
    if (dois === "&&" || dois === "||" || dois === ">>" || dois === "&>" || dois === ">&") {
      fechar();
      tokens.push({ texto: dois, operador: true });
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
      fechar();
      tokens.push({ texto: c, operador: true });
      continue;
    }
    atual += c;
    temAtual = true;
  }
  fechar();
  return tokens;
}

function classificarGit(args: readonly string[]): ClasseComando {
  let i = 0;
  // Opções globais que só mudam onde/como exibir. `-c chave=valor` pode trocar o pager por um programa: pede.
  while (i < args.length && args[i]!.startsWith("-")) {
    const a = args[i]!;
    if (a === "-c" || a.startsWith("--exec-path") || a.startsWith("--config-env")) return altera("git com configuração no comando");
    i += a === "-C" || a === "--git-dir" || a === "--work-tree" ? 2 : 1;
  }
  const sub = args[i];
  if (!sub) return LEITURA;
  const resto = args.slice(i + 1);
  if (GIT.has(sub)) {
    if (sub === "reflog" && resto[0] && resto[0] !== "show" && !resto[0].startsWith("-")) return altera(`git reflog ${resto[0]}`);
    return LEITURA;
  }
  const listagem = GIT_SO_LISTAGEM[sub];
  if (listagem) {
    for (let k = 0; k < resto.length; k++) {
      const a = resto[k]!;
      if (!listagem.includes(a)) return altera(`git ${sub} ${a}`);
      // `git branch --contains X`, `git tag -l 'v*'`, `git config --get chave`: o valor que segue também é leitura.
      if (VALOR_SEGUE.has(a) && k + 1 < resto.length) k++;
    }
    return LEITURA;
  }
  return altera(`git ${sub}`);
}

function classificarGh(args: readonly string[]): ClasseComando {
  const [grupo, sub, ...resto] = args;
  if (!grupo) return LEITURA;
  if (grupo === "--version" || grupo === "version" || grupo === "status") return LEITURA;
  if (grupo === "api") {
    const todos = [sub ?? "", ...resto];
    const metodo = todos.findIndex((a) => a === "-X" || a === "--method");
    const verbo = metodo >= 0 ? (todos[metodo + 1] ?? "").toUpperCase() : todos.find((a) => a.startsWith("--method="))?.split("=")[1]?.toUpperCase() ?? "GET";
    const comCampo = todos.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a));
    return verbo === "GET" && !comCampo ? LEITURA : altera("gh api que escreve");
  }
  const leitura = GH[grupo];
  return leitura && sub && leitura.includes(sub) ? LEITURA : altera(`gh ${grupo}${sub ? ` ${sub}` : ""}`);
}

function classificarPacote(programa: string, args: readonly string[]): ClasseComando {
  const [sub, script] = args;
  if (!sub || sub === "--version" || sub === "-v") return LEITURA;
  if (programa === "npx") return NPX_DE_VERIFICAR.has(sub) ? LEITURA : altera(`npx ${sub}`);
  if (sub === "test" || sub === "t") return LEITURA;
  if (["ls", "list", "view", "outdated", "why", "info"].includes(sub)) return LEITURA;
  if (sub === "run" && script && SCRIPTS_DE_VERIFICAR.test(script)) return LEITURA;
  if (programa !== "npm" && SCRIPTS_DE_VERIFICAR.test(sub)) return LEITURA;
  return altera(`${programa} ${sub}${script && sub === "run" ? ` ${script}` : ""}`);
}

function classificarSegmento(palavras: readonly string[]): ClasseComando {
  const [programa, ...args] = palavras;
  if (!programa) return LEITURA;
  // `FOO=bar cmd` troca o ambiente do programa (PAGER, GIT_SSH…): pede.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(programa)) return altera("variável de ambiente na frente do comando");
  // Binário por caminho pode ser qualquer coisa com o nome de um que só lê.
  if (programa.includes("/")) return altera(`programa por caminho: ${programa}`);
  if (programa === "git") return classificarGit(args);
  if (programa === "gh") return classificarGh(args);
  if (["npm", "pnpm", "yarn", "npx", "bun"].includes(programa)) return classificarPacote(programa, args);
  if (["node", "python", "python3", "deno", "ruby"].includes(programa)) {
    return args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "-V") ? LEITURA : altera(`${programa} roda código`);
  }
  if (programa === "sed") return args.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place=")) ? altera("sed -i grava o arquivo") : LEITURA;
  if (programa === "find") {
    return args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(a)) ? altera("find que apaga ou roda comando") : LEITURA;
  }
  return SIMPLES.has(programa) ? LEITURA : altera(programa);
}

/** Redirecionamento que só descarta ou junta a saída de erro: não grava arquivo nenhum. */
function redirecionamentoInofensivo(operador: string, alvo: string | undefined): boolean {
  if (operador === ">&") return alvo === "1" || alvo === "2";
  if (operador === "<") return true;
  return (operador === ">" || operador === ">>" || operador === "&>") && alvo === "/dev/null";
}

/**
 * O que o modo automático nunca aprova sozinho (definido em 2026-09-29, ADR-059): o que não se desfaz, mexe no
 * trabalho de outras pessoas ou roda com mais poder que o da pessoa. Lido no TEXTO inteiro, sem tokenizar, de
 * propósito: o `git commit -m "$(cat <<EOF …)"` que o Claude Code escreve não tokeniza e seria "arriscado" por
 * isso, e um "rm -rf" dentro de uma mensagem de commit só custa um card. `[^;&|\n]*` prende cada regra ao próprio
 * comando da linha. Guarda contra acidente, não contra quem quer esconder o comando: contra texto de fora vale a
 * pausa por conteúdo de fora (decidirPeloModo), que vem antes desta lista.
 * revisto em 2026-09-30: `eval` saiu. Medido nas skills do Mac do Marlon (1.498 SKILL.md, 15.565 blocos bash):
 * 2.502 blocos paravam só por ele, quase todos o preâmbulo do gstack (`eval "$(…/gstack-slug)"`), e o Milton
 * parou no automático num comando que só lia. `eval` esconde o comando, não destrói nada — e esta lista é contra
 * acidente, não contra quem esconde.
 */
const ARRISCADOS: readonly (readonly [RegExp, string])[] = [
  [/(^|[\s;&|(])(sudo|doas)\s|(^|[;&|]\s*)su(\s|$)/, "roda como administrador do Mac"],
  [/(^|[\s;&|(])rm\s+([^;&|\n]*\s)?(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, "apaga pastas inteiras"],
  [/(^|[\s;&|(])find\s+([^;&|\n]*\s)?-delete\b/, "apaga arquivos em massa"],
  [/\bgit\s[^;&|\n]*\bpush\b[^;&|\n]*(\s(-f|--force|--force-with-lease|--force-if-includes|--mirror|--delete|-d|--prune)(\s|=|$)|\s\+\S|\s:\S)/, "reescreve ou apaga no remoto"],
  [/\bgit\s[^;&|\n]*\bpush\b[^;&|\n]*\s(\S+:)?(refs\/heads\/)?(main|master)(\s|$)/, "empurra direto na main"],
  [/\bgit\s[^;&|\n]*\b(reset\s[^;&|\n]*--hard|clean\s[^;&|\n]*-[a-zA-Z]*f|checkout\s+(--\s+)?\.(\s|$)|branch\s+([^;&|\n]*\s)?-D\b|stash\s+(drop|clear)\b|filter-branch|filter-repo|update-ref\s+-d\b|reflog\s+(expire|delete)\b)/, "descarta trabalho que não volta"],
  [/\bgit\s[^;&|\n]*\brestore\b(?![^;&|\n]*--staged)[^;&|\n]*\s\.(\s|$|\/)/, "descarta trabalho que não volta"],
  // revisto em 2026-09-30 (emenda da ADR-059): `gh pr merge` e `gh pr review --approve` saíram — o terminal só
  // existe na conversa com a pessoa, e merge e aprovar PR pedidos na conversa já saem sozinhos pelo app.
  [/\bgh\s+(repo\s+(delete|archive|rename)|release\s+delete|secret\s|variable\s+(set|delete))/, "mexe no trabalho de outras pessoas no GitHub"],
  [/\bgh\s+api\s[^;&|\n]*(-X|--method)[\s=]*DELETE\b/, "apaga no GitHub"],
  [/\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate)\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bdocker\s+push\b/, "publica para fora"],
  [/\b(curl|wget)\s[^;&\n]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|python3?|node|ruby|perl)\b/, "baixa e roda código"],
  [/(^|[\s;&|(])(mkfs(\.\w+)?|shutdown|reboot|halt|csrutil|spctl|nvram)(\s|$)|\bdd\s[^;&|\n]*\bof=|\bdiskutil\s+(erase|partition|zero|secureErase)\w*|\blaunchctl\s+(unload|remove|bootout)\b|\btmutil\s+delete\b/, "mexe no sistema do Mac"],
  [/\bch(mod|own|grp)\s+(-[a-zA-Z]*R|--recursive)\b|\bchmod\s[^;&|\n]*\b777\b/, "muda permissões em massa"],
  [/(^|[\s;&|(])(killall|pkill)\s/, "encerra processos pelo nome"],
  [/\bdrop\s+(table|database|schema|owned)\b|\btruncate\s|\bdropdb\b/i, "apaga dados de um banco"],
  [/\bdocker\s+(system\s+prune|volume\s+(rm|prune)|compose\s[^;&|\n]*\bdown\s[^;&|\n]*(-v|--volumes)\b|rm\s[^;&|\n]*-f)/, "apaga containers ou volumes"],
  [/\bcrontab\s+-r\b/, "apaga os agendamentos do Mac"],
  [/>>?\s*\S*(\.zshrc|\.zprofile|\.bashrc|\.bash_profile|\.profile)\b|Library\/Launch(Agents|Daemons)/, "mexe no que roda ao abrir o terminal ou o Mac"],
];

/** Por que o comando é arriscado, ou null. Só o modo automático consulta (ADR-059); o manual já pede tudo que altera. */
export function comandoArriscado(comando: string): string | null {
  for (const [re, motivo] of ARRISCADOS) if (re.test(comando)) return motivo;
  return null;
}

/**
 * Programas que só embrulham o comando seguinte: `sudo curl …` manda o mesmo que `curl …`. O que vier depois deles com
 * hífen, com `=` ou só com dígitos (`timeout 30`, `nice -n 5`, `env A=1`) é argumento do embrulho, não o programa.
 */
const EMBRULHOS = new Set(["sudo", "doas", "env", "time", "nohup", "command", "exec", "xargs", "nice", "timeout", "caffeinate"]);

const CURL_MANDA = /^(--data(-raw|-binary|-urlencode|-ascii)?|--json|--form(-string)?|--upload-file)(=|$)|^-[a-zA-Z]*[dFT]/;
const METODO_QUE_MANDA = /^(POST|PUT|PATCH)$/i;
/** `host:caminho`, `usuario@host:caminho`, `host::modulo` ou `rsync://` — o destino é outra máquina. */
const REMOTO = /^(?:[^@/\s:]+@)?[^/\s:]+::?|^rsync:\/\//;

/** O programa de um segmento (sem os embrulhos) e os argumentos dele. */
function programaDoSegmento(palavras: readonly string[]): { programa: string; args: readonly string[] } | null {
  let i = 0;
  while (i < palavras.length) {
    const p = palavras[i]!.replace(/^[({]+/, "");
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (EMBRULHOS.has(base) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(p) || (i > 0 && (/^-/.test(p) || /^\d+[smhd]?$/.test(p)))) { i++; continue; }
    return base === "" ? null : { programa: base, args: palavras.slice(i + 1) };
  }
  return null;
}

/** Shells que rodam o texto de `-c` (e o `eval`): `bash -c "curl -d @x …"` manda o mesmo que o `curl` sozinho. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
/** Quantos `bash -c` dentro de `bash -c` são abertos; cada nível relê só o texto de dentro (linear por nível). */
const NIVEIS_DE_SHELL = 3;

/** `-c`, `-lc`, `-ec`: a opção curta que diz "o próximo argumento é o script". Sem regex com dois `*` (volta atrás). */
function opcaoDeScript(a: string): boolean {
  return a.length > 1 && a[0] === "-" && a[1] !== "-" && a.includes("c") && /^-[a-zA-Z]+$/.test(a);
}

function segmentoEnvia(palavras: readonly string[], nivel: number): boolean {
  const s = programaDoSegmento(palavras);
  if (!s) return false;
  const { programa, args } = s;
  if (SHELLS.has(programa) || programa === "eval") {
    // Revisão do PR #402: sem isto, `bash -c 'curl -d @clientes.csv …'` passava como "não manda".
    if (nivel >= NIVEIS_DE_SHELL) return false;
    const k = programa === "eval" ? -1 : args.findIndex(opcaoDeScript);
    if (programa !== "eval" && k < 0) return false;
    return enviaNoNivel(args.slice(k + 1).join(" "), nivel + 1);
  }
  const fixos = args.filter((a) => !a.startsWith("-"));
  const ultimo = fixos.length >= 2 ? fixos[fixos.length - 1]! : "";
  switch (programa) {
    case "curl":
      return args.some((a, k) => CURL_MANDA.test(a) || ((a === "-X" || a === "--request") && METODO_QUE_MANDA.test(args[k + 1] ?? "")) || /^--request=(POST|PUT|PATCH)$/i.test(a) || /^-X(POST|PUT|PATCH)$/i.test(a));
    case "wget":
      return args.some((a) => /^--(post-data|post-file|body-data|body-file)(=|$)|^--method=(POST|PUT|PATCH)$/i.test(a));
    case "scp":
    case "rsync":
      return REMOTO.test(ultimo);
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
      return true;
    case "gh":
      return args[0] === "gist" && (args[1] === "create" || args[1] === "new");
    default:
      return false;
  }
}

const ASPAS = new Set(["\"", "'", "`"]);

/**
 * A palavra sem as aspas e crases das pontas, num passe só. Revisão do PR #402: era `replace(/^["'`]+|["'`]+$/g, "")`,
 * e o `["'`]+$` volta atrás a cada aspa de uma sequência no meio da palavra: `$(x` + 63.000 aspas + `y` levou 64 s de
 * CPU no laço de eventos do servidor (quadrático), no caminho quente do hook.
 */
function semAspasNasPontas(p: string): string {
  let i = 0;
  let f = p.length;
  while (i < f && ASPAS.has(p[i]!)) i++;
  while (f > i && ASPAS.has(p[f - 1]!)) f--;
  return p.slice(i, f);
}

/**
 * O comando manda dados do Mac para fora? (definido em 2026-10-18, plano dos modos de aprovação, revisão de engenharia,
 * item 10): `curl -d @clientes.csv`, `curl -T`, `wget --post-file`, `scp`/`rsync` para outra máquina, `nc` e `gh gist
 * create`. A lista de arriscados é contra acidente e nenhum desses está nela: no automático eles rodam até depois de o
 * bot ler um e-mail. É o gatilho `envio_apos_fora` do terminal (`gatilhoDeRevisao`). Lê palavra por palavra, sem regex
 * sobre o texto inteiro (linear no tamanho do comando); quando o comando não tokeniza (`$(…)`, crase), parte nos
 * separadores e nos espaços, porque `curl -d "$(cat ~/x)"` é justamente o envio que importa. `bash -c`, `sh -c` e
 * `eval` são abertos e o texto de dentro é lido do mesmo jeito, até três níveis.
 */
export function enviaPeloTerminal(comando: string): boolean {
  return enviaNoNivel(comando, 0);
}

function enviaNoNivel(comando: string, nivel: number): boolean {
  const tokens = tokenizar(comando);
  const segmentos: string[][] = [[]];
  if (tokens) {
    for (const t of tokens) {
      if (!t.operador) segmentos[segmentos.length - 1]!.push(t.texto);
      else segmentos.push([]);
    }
  } else {
    // `$(`, crase e parênteses também separam: `x=$(curl -d @f …)` e `echo $(curl …)` rodam o curl (revisão do PR #402).
    // A parte sem letra nenhuma (`$`, aspas soltas) não tem programa: não vira segmento (sem lixo para o GC no `$($($(…`).
    for (const parte of comando.split(/[;&|\n`()]+/)) if (/[A-Za-z]/.test(parte)) segmentos.push(parte.split(/\s+/).filter((p) => p !== "").map(semAspasNasPontas));
  }
  return segmentos.some((palavras) => segmentoEnvia(palavras, nivel));
}

export function classificarComando(comando: string): ClasseComando {
  const texto = comando.trim();
  if (texto === "") return altera("comando vazio");
  if (texto.length > TETO) return altera("comando longo demais para conferir");
  if (tocaCredencial(texto)) return altera("toca uma credencial do Mac");
  const tokens = tokenizar(texto);
  if (!tokens) return altera("substituição de comando");
  let segmento: string[] = [];
  const segmentos: string[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.operador) { segmento.push(t.texto); continue; }
    if (t.texto === "&&" || t.texto === "||" || t.texto === ";" || t.texto === "|") {
      segmentos.push(segmento);
      segmento = [];
      continue;
    }
    if (t.texto === "&") return altera("comando em segundo plano");
    // Redirecionamento: consome o alvo; só /dev/null (ou juntar 2 em 1) é leitura.
    const alvo = tokens[i + 1];
    if (!redirecionamentoInofensivo(t.texto, alvo && !alvo.operador ? alvo.texto : undefined)) return altera("grava em arquivo pelo redirecionamento");
    if (alvo && !alvo.operador) i++;
  }
  segmentos.push(segmento);
  for (const s of segmentos) {
    const c = classificarSegmento(s);
    if (c.tipo === "altera") return c;
  }
  return LEITURA;
}
