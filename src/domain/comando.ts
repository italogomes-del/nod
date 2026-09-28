/**
 * Um comando do terminal do Mac da pessoa só LÊ, ou muda algo? (definido em 2026-09-28, ADR-053, "terminal de
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
 * Onde moram as credenciais da pessoa no Mac (definido em 2026-09-28, ADR-053). Ler é "só ler", mas ler ISTO e
 * depois mandar para fora (WebFetch, um comentário) é o caminho de um texto malicioso num PR: por isso nunca é
 * leitura livre. Casa no texto do comando e no caminho das ferramentas de arquivo.
 */
const CREDENCIAL = /(^|[\s"'=/:~])(\.ssh|\.aws|\.gnupg|\.config\/gh|\.netrc|\.git-credentials|\.npmrc|\.docker\/config\.json|\.kube)(\/|$|[\s"'])|id_(rsa|ed25519|ecdsa|dsa)\b|\.(pem|p12|pfx|key)\b|(^|[\s;&|])security\s+(find|dump|export)|gh\s+auth\s+token|Library\/Keychains/;

/** O comando ou o caminho toca uma credencial da pessoa (chaves SSH, AWS, login do gh, Keychain)? */
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
  run: ["list", "view"],
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
