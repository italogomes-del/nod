import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, readdir, readFile, realpath, rename, rmdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { MotivoPuladaLimpeza, PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../contracts/ponte.ts";
import { classificarIgnorado, motivoDaRecusa, ORFA_PARADA_MS, pastaDeTask, protegidoPorMontagem } from "../../domain/limpeza-das-tasks.ts";
import { log } from "../../obs/log.ts";
import { caminhoAumentado } from "./caminho.ts";

/**
 * A limpeza das pastas de task no Mac (definido em 2026-10-09, ADR-088, issue #216). O servidor diz quais tasks
 * encerradas podem ser limpas (src/use-cases/limpeza-das-tasks.ts); aqui, onde os arquivos estão, cada worktree dentro
 * da pasta da task sai com `git worktree remove` SEM --force, e só depois de conferir o que o git NÃO protege: outra
 * worktree ou repositório aninhado, arquivo ignorado que não se refaz, commit com HEAD solto, origem de montagem do
 * Docker, turno vivo na pasta. Depois as pastas que ficaram vazias saem com `rmdir` (que nunca apaga conteúdo). Nada
 * fora de `~/nod/<bot>/<slug>` é tocado: a raiz do bot, onde moram as 198 worktrees antigas de dono desconhecido
 * (medido em 09/10), só é contada.
 *
 * Roda no executor: no modo local (o diário), no processo do servidor, que está no Mac; no modo compartilhado, no app
 * do Mac, que puxa a lista pela ponte (ADR-021). O servidor na nuvem nunca vê o disco.
 */

export type ResultadoComando = { codigo: number; stdout: string; stderr: string };
/** Roda um programa sem shell. `codigo` -1 = não achou o programa (ENOENT); -2 = estourou o prazo. */
export type ExecutarComando = (bin: string, args: readonly string[], o?: { cwd?: string; prazoMs?: number }) => Promise<ResultadoComando>;

/**
 * Revisão do #225: `simular` faz a passada inteira, com todas as checagens, e só registra o que sairia
 * (`limpeza_simulada`); `ligada` apaga; `desligada` não roda. Lido de `NOD_LIMPEZA_TASKS`. revisto na segunda revisão
 * do #225: o padrão é `simular` em todo modo (diário e app) até o Marlon validar os logs — só apaga com `ligada`
 * escrito. O gatilho para mudar o padrão está na ADR-088 §7.
 */
export type ModoLimpeza = "ligada" | "simular" | "desligada";
export function modoDaLimpeza(env: Readonly<Record<string, string | undefined>>): ModoLimpeza {
  const v = env.NOD_LIMPEZA_TASKS?.trim().toLowerCase();
  return v === "desligada" ? "desligada" : v === "ligada" ? "ligada" : "simular";
}

/** definido em 2026-10-09: a primeira passada 10 min depois de subir (o boot já é pesado), e então a cada 6 h. */
export const PRIMEIRA_LIMPEZA_MS = 10 * 60_000;
export const INTERVALO_LIMPEZA_MS = 6 * 3_600_000;
/**
 * definido em 2026-10-09: o `git worktree remove` apaga o node_modules junto (180 MB a 3,6 GB por worktree, medido na
 * #216) e o Mac pode estar carregado; 10 min só segura um disco travado. `docker` e `gh` respondem em segundos; o
 * `git status --ignored` e o `du` de uma worktree grande ficam abaixo de 2 min.
 */
const PRAZO_REMOVER_MS = 10 * 60_000;
const PRAZO_MEDIO_MS = 2 * 60_000;
const PRAZO_CURTO_MS = 30_000;
/** Até onde se procura worktree dentro da pasta da task (`<slug>/<repo>` é 1; `<slug>/repos/<repo>` é 2). */
const PROFUNDIDADE_MAXIMA = 3;
/**
 * Revisão do #225: a busca de `.git` aninhado dentro da worktree (fora de node_modules) vai até esta profundidade e este
 * número de pastas; passou disso, a worktree fica (`aninhado`) — sem ter olhado tudo, não se apaga.
 */
const ANINHADO_PROFUNDIDADE = 8;
const ANINHADO_MAX_PASTAS = 20_000;
/** Revisão do #225: a trava de um processo que morreu, ou mais velha que isto, é retomada. */
const TRAVA_VENCE_MS = 24 * 3_600_000;
/** Segunda revisão do #225: trava vazia ou ilegível (alguém acabou de criá-la) vale como viva por isto. */
const TRAVA_ILEGIVEL_VIVA_MS = 30_000;
/** Segunda revisão do #225: a busca de `.env*` dentro de uma pasta regenerável inteira (`dist/`) para aqui e recusa. */
const ENV_MAX_PASTAS = 5_000;

export function criarExecutarComando(env: Readonly<Record<string, string | undefined>>, home: string): ExecutarComando {
  const ambiente = { ...env, PATH: caminhoAumentado(env.PATH, home), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GIT_OPTIONAL_LOCKS: "0" };
  return (bin, args, o) =>
    new Promise((resolver) => {
      execFile(bin, [...args], { cwd: o?.cwd, env: ambiente, timeout: o?.prazoMs ?? PRAZO_CURTO_MS, maxBuffer: 16 * 1024 * 1024 }, (erro, stdout, stderr) => {
        if (!erro) { resolver({ codigo: 0, stdout: String(stdout), stderr: String(stderr) }); return; }
        const e = erro as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        const codigo = e.code === "ENOENT" ? -1 : e.killed ? -2 : typeof e.code === "number" ? e.code : 1;
        resolver({ codigo, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

const existePadrao = (caminho: string): Promise<boolean> => lstat(caminho).then(() => true, () => false);

/**
 * As origens dos bind mounts de todos os containers (rodando ou parados: o parado volta a montar ao subir). `[]` = sem
 * Docker neste Mac; `null` = não se sabe — o Docker não respondeu (o Docker Desktop trava quando o disco da VM enche),
 * ou o binário não está no PATH mas o Docker existe (o app em /Applications ou o socket). revisto na segunda revisão do
 * #225: com `null` a passada inteira é adiada — sem saber o que está montado, não se mexe em nada.
 */
export async function montagensDoDocker(executar: ExecutarComando, home: string, existe: (c: string) => Promise<boolean> = existePadrao): Promise<string[] | null> {
  const ps = await executar("docker", ["ps", "-aq"]);
  if (ps.codigo === -1) {
    for (const c of ["/Applications/Docker.app", join(home, ".docker", "run", "docker.sock"), "/var/run/docker.sock"]) if (await existe(c)) return null;
    return [];
  }
  if (ps.codigo !== 0) return null;
  const ids = ps.stdout.split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]+$/i.test(l));
  if (ids.length === 0) return [];
  const insp = await executar("docker", ["inspect", "--format", "{{json .Mounts}}", ...ids]);
  if (insp.codigo !== 0) return null;
  const fontes: string[] = [];
  for (const linha of insp.stdout.split("\n")) {
    if (linha.trim() === "") continue;
    try {
      const m = JSON.parse(linha) as unknown;
      if (Array.isArray(m)) for (const x of m) if (x && typeof x === "object" && (x as { Type?: unknown }).Type === "bind" && typeof (x as { Source?: unknown }).Source === "string") fontes.push((x as { Source: string }).Source);
    } catch {
      return null;
    }
  }
  return fontes;
}

export type OpcoesLimpeza = {
  home: string;
  executar: ExecutarComando;
  /** Injetável nos testes; padrão: `montagensDoDocker`. */
  montagens?: () => Promise<string[] | null>;
  /** Bytes livres no volume do caminho; padrão: `statfs`. */
  livre?: (caminho: string) => Promise<number>;
  /** Revisão do #225: não apaga nada; só conta o que sairia. */
  simular?: boolean;
  /** Revisão do #225: um turno deste Mac roda nesta pasta (`<bot>/<slug>`) agora? */
  emUso?: (pasta: string) => boolean;
  /** Revisão do #225: o servidor ainda oferece esta pasta? Perguntado logo antes da primeira remoção de cada pasta. */
  reconfirmar?: (p: PastaParaLimpar) => Promise<boolean>;
};

type Achados = { worktrees: string[]; clones: number };

/** Worktrees (`.git` ARQUIVO) dentro da pasta, sem entrar em node_modules, pasta escondida, link ou na própria worktree. */
async function procurar(dir: string, profundidade: number, achados: Achados): Promise<void> {
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return; }
  const git = entradas.find((e) => e.name === ".git");
  if (git) {
    if (git.isFile()) achados.worktrees.push(dir);
    else if (git.isDirectory()) achados.clones++;
    return;
  }
  if (profundidade >= PROFUNDIDADE_MAXIMA) return;
  for (const e of entradas) if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) await procurar(join(dir, e.name), profundidade + 1, achados);
}

/**
 * Revisão do #225: há `.git` (arquivo ou pasta) ABAIXO da raiz da worktree, fora de node_modules? Entra em pasta
 * escondida e ignorada (`.claude/worktrees/agent-1` é o caso real). `true` também quando a busca passou do limite.
 */
async function temGitAninhado(raiz: string): Promise<boolean> {
  let vistas = 0;
  async function descer(dir: string, profundidade: number): Promise<boolean> {
    if (++vistas > ANINHADO_MAX_PASTAS) return true;
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return true; }
    for (const e of entradas) {
      if (e.name === ".git") { if (dir !== raiz) return true; continue; }
      if (!e.isDirectory() || e.name === "node_modules") continue;
      if (profundidade >= ANINHADO_PROFUNDIDADE) return true;
      if (await descer(join(dir, e.name), profundidade + 1)) return true;
    }
    return false;
  }
  return descer(raiz, 0);
}

/** Pastas vazias dentro de `dir` e ela mesma (só `.DS_Store` conta como vazio); `ausentes` contam como já removidas. */
async function ficariaVazia(dir: string, profundidade: number, ausentes: ReadonlySet<string>, montagens: readonly string[], apagar: boolean): Promise<boolean> {
  if (ausentes.has(dir)) return true;
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  // Nunca entra numa worktree ou clone que ficou (a pasta vazia de dentro dela pode ser origem de montagem, como o
  // `infra/postgres/init` do diário) nem mexe na pasta que é origem de montagem conhecida.
  if (entradas.some((e) => e.name === ".git") || protegidoPorMontagem(dir, montagens)) return false;
  let vazia = true;
  for (const e of entradas) {
    if (e.name === ".DS_Store" && e.isFile()) continue;
    if (e.isDirectory() && profundidade < PROFUNDIDADE_MAXIMA + 1 && (await ficariaVazia(join(dir, e.name), profundidade + 1, ausentes, montagens, apagar))) continue;
    vazia = false;
  }
  if (!vazia || !apagar) return vazia;
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name !== ".DS_Store" || !e.isFile()) return false;
      await unlink(join(dir, e.name));
    }
    await rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Segunda revisão do #225: há `.env*` dentro desta pasta (a regenerável inteira que o git mostra recolhida, `dist/`)?
 * Fora de node_modules; passou do limite, conta como sim.
 */
async function temEnvDentro(dir: string): Promise<boolean> {
  let vistas = 0;
  async function descer(d: string): Promise<boolean> {
    if (++vistas > ENV_MAX_PASTAS) return true;
    let entradas;
    try { entradas = await readdir(d, { withFileTypes: true }); } catch { return true; }
    for (const e of entradas) {
      if (e.name.startsWith(".env")) return true;
      if (e.isDirectory() && e.name !== "node_modules" && (await descer(join(d, e.name)))) return true;
    }
    return false;
  }
  return descer(dir);
}

const livrePadrao = async (caminho: string): Promise<number> => {
  const s = await statfs(caminho);
  return Number(s.bavail) * Number(s.bsize);
};

/** O caminho real, ou ele mesmo quando não existe. */
const real = (c: string) => realpath(c).catch(() => c);

/**
 * O PR desta worktree foi mergeado COM o HEAD que está aqui? revisto em 2026-10-09 (revisão do #225): o nome da branch
 * não basta — uma branch reaproveitada depois do merge teria commits novos. Qualquer dúvida (gh fora, sem login, HEAD
 * solto) = não.
 */
async function prMergeado(wt: string, executar: ExecutarComando): Promise<boolean> {
  const ramo = await executar("git", ["-C", wt, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = ramo.stdout.trim();
  const head = (await executar("git", ["-C", wt, "rev-parse", "HEAD"])).stdout.trim();
  if (ramo.codigo !== 0 || branch === "" || !/^[0-9a-f]{40,64}$/.test(head)) return false;
  const gh = await executar("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid", "--limit", "20"], { cwd: wt });
  if (gh.codigo !== 0) return false;
  try {
    const lista = JSON.parse(gh.stdout) as unknown;
    return Array.isArray(lista) && lista.some((p) => typeof p === "object" && p !== null && (p as { headRefOid?: unknown }).headRefOid === head);
  } catch {
    return false;
  }
}

/** As worktrees que o clone conhece (`git worktree list --porcelain`): caminho e se está travada. */
async function worktreesDoClone(dirComum: string, executar: ExecutarComando): Promise<{ caminho: string; travada: boolean }[] | null> {
  const r = await executar("git", ["-C", dirComum, "worktree", "list", "--porcelain"]);
  if (r.codigo !== 0) return null;
  const lista: { caminho: string; travada: boolean }[] = [];
  for (const linha of r.stdout.split("\n")) {
    if (linha.startsWith("worktree ")) lista.push({ caminho: linha.slice("worktree ".length), travada: false });
    else if (linha === "locked" || linha.startsWith("locked ")) { const u = lista[lista.length - 1]; if (u) u.travada = true; }
  }
  return lista;
}

const comparavel = (c: string) => c.normalize("NFC").toLowerCase().replace(/\/+$/, "");

/**
 * Tudo o que o `git worktree remove` sem --force não protege, conferido antes (revisão do #225). Devolve o motivo para
 * pular, ou null se a worktree pode sair. A ordem vai do mais barato ao mais caro.
 */
async function motivoParaFicar(wt: string, p: PastaParaLimpar, dirComum: string, montagens: readonly string[], executar: ExecutarComando): Promise<MotivoPuladaLimpeza | null> {
  const wtReal = await real(wt);
  if (protegidoPorMontagem(wt, montagens) || protegidoPorMontagem(wtReal, montagens)) return "montagem";
  const conhecidas = await worktreesDoClone(dirComum, executar);
  if (conhecidas === null) return "erro";
  const alvo = comparavel(wtReal);
  for (const w of conhecidas) {
    const c = comparavel(await real(w.caminho));
    if (c === alvo && w.travada) return "travada";
    if (c.startsWith(`${alvo}/`)) return "aninhado";
  }
  if (await temGitAninhado(wt)) return "aninhado";
  // Alteração em arquivo rastreado ou arquivo novo = suja (o remove recusaria; aqui vale também para a simulação).
  // Ignorado que não se refaz = o remove apagaria calado.
  const status = await executar("git", ["-C", wt, "status", "--porcelain", "-z", "--ignored=traditional", "--untracked-files=normal"], { prazoMs: PRAZO_MEDIO_MS });
  if (status.codigo !== 0) return "erro";
  let valioso = false;
  for (const entrada of status.stdout.split("\0")) {
    if (entrada === "") continue;
    if (!entrada.startsWith("!! ")) return "suja";
    const tipo = classificarIgnorado(entrada.slice(3));
    if (tipo === "valioso" || (tipo === "conferir_env" && (await temEnvDentro(join(wt, entrada.slice(3)))))) valioso = true;
  }
  if (valioso) return "ignorado_valioso";
  // Commit que só o HEAD solto alcança se perderia com a worktree.
  const solto = await executar("git", ["-C", wt, "rev-list", "-n1", "HEAD", "--not", "--branches", "--remotes", "--tags"]);
  if (solto.codigo !== 0) return "erro";
  if (solto.stdout.trim() !== "") return "head_solto";
  if (p.quando === "so_com_pr_mergeado" && !(await prMergeado(wt, executar))) return "pr_nao_mergeado";
  return null;
}

function relatoVazio(simular: boolean): RelatoLimpeza {
  return { pastas: 0, removidas: 0, pastasApagadas: 0, liberadoBytes: 0, puladas: {}, orfas: 0, orfasParadas: 0, duracaoMs: 0, ...(simular ? { simulada: true, estimadoBytes: 0 } : {}) };
}

/**
 * Uma passada sobre as pastas que o servidor ofereceu. Cada pasta é conferida de novo aqui: forma `<bot>/<slug>`, pasta
 * de verdade (não link) e o caminho real dentro de `~/nod`. Sequencial de propósito: apagar node_modules é disco, e
 * vários bots já disputam o disco.
 */
export async function limparPastas(pastas: readonly PastaParaLimpar[], o: OpcoesLimpeza): Promise<RelatoLimpeza> {
  const simular = o.simular === true;
  const relato = relatoVazio(simular);
  const pular = (m: MotivoPuladaLimpeza) => { relato.puladas[m] = (relato.puladas[m] ?? 0) + 1; };
  const raiz = join(o.home, "nod");
  let raizReal: string;
  try { raizReal = await realpath(raiz); } catch { return relato; }
  const livre = o.livre ?? livrePadrao;
  // Uma consulta ao Docker por passada, só quando há pasta para mexer; cada origem entra também pelo caminho real.
  let montagensLidas: Promise<string[] | null> | null = null;
  const lerMontagens = () => (montagensLidas ??= (async () => {
    const m = await (o.montagens ?? (() => montagensDoDocker(o.executar, o.home)))();
    return m === null ? null : [...m, ...(await Promise.all(m.map(real)))];
  })());
  // Segunda revisão do #225: Docker instalado e mudo = a passada inteira espera a próxima. Sem saber o que está montado,
  // nem worktree nem pasta vazia sai.
  if (pastas.length > 0 && (await lerMontagens()) === null) {
    relato.adiada = true;
    log("aviso", "limpeza_adiada", { motivo: "docker_sem_resposta", pastas: pastas.length });
    return relato;
  }

  for (const p of pastas) {
    const rel = pastaDeTask(`~/nod/${p.pasta}`);
    if (rel === null || rel !== p.pasta) { pular("fora_da_pasta"); continue; }
    const base = join(raiz, rel);
    try {
      const info = await lstat(base);
      if (!info.isDirectory()) { pular("fora_da_pasta"); continue; }
      if ((await realpath(base)) !== join(raizReal, rel)) { pular("fora_da_pasta"); continue; }
    } catch {
      continue; // não existe neste Mac (já limpa, ou a task rodou em outro Mac)
    }
    relato.pastas++;
    if (o.emUso?.(rel)) { pular("em_uso"); continue; }
    const achados: Achados = { worktrees: [], clones: 0 };
    await procurar(base, 0, achados);
    for (let i = 0; i < achados.clones; i++) pular("clone");
    const montagens = (await lerMontagens()) ?? [];
    const saem = new Set<string>();
    let confirmada: boolean | null = null;

    for (const wt of achados.worktrees) {
      const nome = basename(wt);
      const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const dirComum = comum.stdout.trim();
      const motivo = comum.codigo !== 0 || !isAbsolute(dirComum) ? "erro" : await motivoParaFicar(wt, p, dirComum, montagens, o.executar);
      if (motivo) {
        pular(motivo);
        if (motivo !== "pr_nao_mergeado") log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo });
        continue;
      }
      // Logo antes da primeira remoção da pasta: o servidor ainda a oferece, e nenhum turno deste Mac começou nela.
      if (confirmada === null) confirmada = (o.reconfirmar ? await o.reconfirmar(p) : true) && !o.emUso?.(rel);
      if (!confirmada) { pular("nao_reconfirmada"); break; }
      if (simular) {
        const du = await o.executar("du", ["-sk", wt], { prazoMs: PRAZO_MEDIO_MS });
        const kb = Number.parseInt(du.stdout.trim().split(/\s/)[0] ?? "", 10);
        const bytes = du.codigo === 0 && Number.isFinite(kb) ? kb * 1024 : 0;
        relato.removidas++;
        relato.estimadoBytes = (relato.estimadoBytes ?? 0) + bytes;
        saem.add(wt);
        // No log do Mac pode ir o caminho (relativo a ~/nod): é ele que o Marlon confere antes de ligar.
        log("info", "limpeza_simulada_worktree", { trabalho_id: p.trabalhoId, caminho: relative(raiz, wt), quando: p.quando, estimado_mb: Math.round(bytes / 1_048_576) });
        continue;
      }
      const antes = await livre(raiz).catch(() => null);
      // SEM --force (ADR-088): se algo mudou desde a conferência, o git ainda recusa a worktree suja.
      const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", wt], { prazoMs: PRAZO_REMOVER_MS });
      if (r.codigo !== 0) {
        const recusa = motivoDaRecusa(r.stderr);
        pular(recusa);
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo: recusa, codigo: r.codigo });
        continue;
      }
      const depois = await livre(raiz).catch(() => null);
      const liberado = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
      relato.removidas++;
      relato.liberadoBytes += liberado;
      log("info", "limpeza_worktree_removida", { trabalho_id: p.trabalhoId, pasta: nome, quando: p.quando, liberado_mb: Math.round(liberado / 1_048_576) });
    }
    // Nem a pasta que o servidor deixou de oferecer, nem a que ganhou turno vivo.
    if (confirmada === false || o.emUso?.(rel)) continue;
    if (await ficariaVazia(base, 0, saem, montagens, !simular)) relato.pastasApagadas++;
  }
  // Revisão do #225: sem `git worktree prune` — o `remove` já apaga os metadados da worktree que tirou, e o prune
  // varreria também as worktrees de OUTROS donos cuja pasta sumiu (num disco desmontado, por exemplo).
  return relato;
}

/**
 * As worktrees na raiz das pastas dos bots (`~/nod/<bot>/<x>` com `.git` arquivo), fora de qualquer task: só contadas
 * (ADR-088 §5). "Parada" = nem a pasta nem o HEAD/índice dela no clone mudaram há ORFA_PARADA_MS.
 */
export async function contarOrfas(home: string, agora: number): Promise<{ orfas: number; paradas: number }> {
  const raiz = join(home, "nod");
  let orfas = 0;
  let paradas = 0;
  let bots;
  try { bots = await readdir(raiz, { withFileTypes: true }); } catch { return { orfas, paradas }; }
  for (const b of bots) {
    if (!b.isDirectory()) continue;
    let itens;
    try { itens = await readdir(join(raiz, b.name), { withFileTypes: true }); } catch { continue; }
    for (const i of itens) {
      if (!i.isDirectory()) continue;
      const dir = join(raiz, b.name, i.name);
      try {
        const git = await lstat(join(dir, ".git"));
        if (!git.isFile()) continue;
        orfas++;
        let ultima = (await stat(dir)).mtimeMs;
        const m = /^gitdir:\s*(.+)$/m.exec(await readFile(join(dir, ".git"), "utf8"));
        if (m) {
          const gitdir = resolve(dir, m[1]!.trim());
          for (const f of ["HEAD", "index"]) ultima = Math.max(ultima, await stat(join(gitdir, f)).then((s) => s.mtimeMs, () => 0));
        }
        if (agora - ultima >= ORFA_PARADA_MS) paradas++;
      } catch {
        // sem .git: pasta de task ou pasta comum
      }
    }
  }
  return { orfas, paradas };
}

/**
 * Revisão do #225: uma passada por Mac de cada vez, também entre processos (o diário, um servidor de teste e o app do
 * Mac podem rodar juntos). `~/nod/.limpeza.lock` guarda pid e hora; a trava de um pid morto, ou de mais de 24 h, é
 * retomada. Devolve a função que solta, ou null se outro processo está limpando.
 *
 * revisto na segunda revisão do #225: a trava nasce inteira — o conteúdo vai para um temporário e o `link()` o publica
 * como `.limpeza.lock` (falha se já existe), então ninguém lê uma trava pela metade. Trava vazia ou ilegível (corrompida
 * ou de fora) vale como viva por 30 s. A retomada de uma vencida a renomeia para um nome único e só a apaga se o
 * conteúdo for o que foi lido; se outro processo a trocou nesse meio, devolve a dele.
 */
export async function travarLimpeza(home: string, agora: number): Promise<(() => Promise<void>) | null> {
  const arquivo = join(home, "nod", ".limpeza.lock");
  const conteudo = JSON.stringify({ pid: process.pid, em: agora, id: randomUUID() });
  const soltar = async () => {
    if ((await readFile(arquivo, "utf8").catch(() => "")) === conteudo) await unlink(arquivo).catch(() => undefined);
  };
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const temporario = `${arquivo}.${process.pid}.${randomUUID()}`;
    try {
      await writeFile(temporario, conteudo, { mode: 0o600 });
      await link(temporario, arquivo);
      return soltar;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
    } finally {
      await unlink(temporario).catch(() => undefined);
    }
    const lido = await readFile(arquivo, "utf8").catch(() => null);
    if (lido === null) continue; // sumiu entre o link e a leitura: tenta de novo
    const dono = donoDaTrava(lido);
    if (dono === null) {
      const mtime = await stat(arquivo).then((s) => s.mtimeMs, () => 0);
      if (agora - mtime < TRAVA_ILEGIVEL_VIVA_MS) return null;
    } else if (processoVivo(dono.pid) && agora - dono.em < TRAVA_VENCE_MS) {
      return null;
    }
    // Vencida: tira do caminho com um nome único e confere que era a que foi lida.
    const vencida = `${arquivo}.vencida.${process.pid}.${randomUUID()}`;
    try { await rename(arquivo, vencida); } catch { continue; }
    const tirada = await readFile(vencida, "utf8").catch(() => null);
    if (tirada !== lido) {
      // Outro processo publicou uma trava nova entre a leitura e o rename: devolve a dele e desiste.
      await link(vencida, arquivo).catch(() => undefined);
      await unlink(vencida).catch(() => undefined);
      return null;
    }
    await unlink(vencida).catch(() => undefined);
  }
  return null;
}

/** O pid e a hora gravados na trava; null = vazia ou ilegível. */
function donoDaTrava(texto: string): { pid: number; em: number } | null {
  try {
    const d = JSON.parse(texto) as { pid?: unknown; em?: unknown } | null;
    return d && typeof d.pid === "number" && typeof d.em === "number" ? { pid: d.pid, em: d.em } : null;
  } catch {
    return null;
  }
}

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Revisão do #225: as passadas DESTE processo em fila — no diário há uma limpeza por pessoa, e elas disparavam juntas
 * sobre o mesmo `~/nod`. A fila serializa; a trava em arquivo cuida dos outros processos.
 */
let filaDoProcesso: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const vez = filaDoProcesso.then(fn, fn);
  filaDoProcesso = vez.catch(() => undefined);
  return vez;
}

export type LimpezaDasTasks = { parar(): void; passada(): Promise<RelatoLimpeza | null> };

/**
 * A limpeza periódica de uma pessoa neste Mac: pede a lista à ponte, limpa e relata. Uma passada por vez (fila do
 * processo e trava em arquivo); erro vira log e a próxima tenta de novo. Ponte sem `pastasParaLimpar` (servidor antigo)
 * = nada a fazer.
 */
export function iniciarLimpezaDasTasks(o: OpcoesLimpeza & { ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza">; pessoaId: string; agora?: () => number; primeiraMs?: number; intervaloMs?: number }): LimpezaDasTasks {
  const agora = o.agora ?? Date.now;
  let rodando = false;
  let parado = false;
  async function umaPassada(): Promise<RelatoLimpeza | null> {
    const pastasParaLimpar = o.ponte.pastasParaLimpar?.bind(o.ponte);
    if (parado || !pastasParaLimpar) return null;
    const soltar = await travarLimpeza(o.home, agora());
    if (!soltar) { log("info", "limpeza_adiada", { pessoa_id: o.pessoaId, motivo: "outra_passada" }); return null; }
    const inicio = agora();
    try {
      const pastas = await pastasParaLimpar(o.pessoaId);
      const reconfirmar = o.reconfirmar ?? (async (p: PastaParaLimpar) =>
        (await pastasParaLimpar(o.pessoaId)).some((x) => x.trabalhoId === p.trabalhoId && x.pasta === p.pasta && (x.quando === "encerrada" || x.quando === p.quando)));
      const relato = await limparPastas(pastas, { ...o, reconfirmar });
      const { orfas, paradas } = await contarOrfas(o.home, agora());
      relato.orfas = orfas;
      relato.orfasParadas = paradas;
      relato.duracaoMs = Math.max(0, agora() - inicio);
      await o.ponte.relatarLimpeza?.(o.pessoaId, relato);
      return relato;
    } finally {
      await soltar();
    }
  }
  async function passada(): Promise<RelatoLimpeza | null> {
    if (rodando || parado) return null;
    rodando = true;
    try {
      return await naFila(umaPassada);
    } catch (e) {
      log("aviso", "limpeza_falhou", { pessoa_id: o.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      return null;
    } finally {
      rodando = false;
    }
  }
  let intervalo: ReturnType<typeof setInterval> | null = null;
  const primeira = setTimeout(() => {
    void passada();
    intervalo = setInterval(() => void passada(), o.intervaloMs ?? INTERVALO_LIMPEZA_MS);
    intervalo.unref?.();
  }, o.primeiraMs ?? PRIMEIRA_LIMPEZA_MS);
  primeira.unref?.();
  return {
    parar() {
      parado = true;
      clearTimeout(primeira);
      if (intervalo) clearInterval(intervalo);
    },
    passada,
  };
}
