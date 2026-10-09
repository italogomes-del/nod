import { execFile } from "node:child_process";
import { lstat, readdir, readFile, realpath, rmdir, stat, statfs, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { MotivoPuladaLimpeza, PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../contracts/ponte.ts";
import { ehArquivoDeCompose, motivoDaRecusa, ORFA_PARADA_MS, pastaDeTask, protegidoPorMontagem } from "../../domain/limpeza-das-tasks.ts";
import { log } from "../../obs/log.ts";
import { caminhoAumentado } from "./caminho.ts";

/**
 * A limpeza das pastas de task no Mac (definido em 2026-10-09, ADR-088, issue #216). O servidor diz quais tasks
 * encerradas podem ser limpas (src/use-cases/limpeza-das-tasks.ts); aqui, onde os arquivos estão, cada worktree dentro
 * da pasta da task sai com `git worktree remove` SEM --force — o git recusa a que tem alteração não commitada ou
 * arquivo novo, e ela fica, registrada no log. Depois as pastas que ficaram vazias saem com `rmdir` (que nunca apaga
 * conteúdo) e o `git worktree prune` arruma os clones. Nada fora de `~/nod/<bot>/<slug>` é tocado: a raiz do bot, onde
 * moram as 198 worktrees antigas de dono desconhecido (medido em 09/10), só é contada.
 *
 * Roda no executor: no modo local (o diário), no processo do servidor, que está no Mac; no modo compartilhado, no app
 * do Mac, que puxa a lista pela ponte (ADR-021). O servidor na nuvem nunca vê o disco.
 */

export type ResultadoComando = { codigo: number; stdout: string; stderr: string };
/** Roda um programa sem shell. `codigo` -1 = não achou o programa (ENOENT); -2 = estourou o prazo. */
export type ExecutarComando = (bin: string, args: readonly string[], o?: { cwd?: string; prazoMs?: number }) => Promise<ResultadoComando>;

/** definido em 2026-10-09: a primeira passada 10 min depois de subir (o boot já é pesado), e então a cada 6 h. */
export const PRIMEIRA_LIMPEZA_MS = 10 * 60_000;
export const INTERVALO_LIMPEZA_MS = 6 * 3_600_000;
/**
 * definido em 2026-10-09: o `git worktree remove` apaga o node_modules junto (180 MB a 3,6 GB por worktree, medido na
 * #216) e o Mac pode estar carregado; 10 min só segura um disco travado. `docker` e `gh` respondem em segundos.
 */
const PRAZO_REMOVER_MS = 10 * 60_000;
const PRAZO_CURTO_MS = 30_000;
/** Até onde se procura worktree dentro da pasta da task (`<slug>/<repo>` é 1; `<slug>/repos/<repo>` é 2). */
const PROFUNDIDADE_MAXIMA = 3;

export function criarExecutarComando(env: Readonly<Record<string, string | undefined>>, home: string): ExecutarComando {
  const ambiente = { ...env, PATH: caminhoAumentado(env.PATH, home), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GIT_OPTIONAL_LOCKS: "0" };
  return (bin, args, o) =>
    new Promise((resolver) => {
      execFile(bin, [...args], { cwd: o?.cwd, env: ambiente, timeout: o?.prazoMs ?? PRAZO_CURTO_MS, maxBuffer: 4 * 1024 * 1024 }, (erro, stdout, stderr) => {
        if (!erro) { resolver({ codigo: 0, stdout: String(stdout), stderr: String(stderr) }); return; }
        const e = erro as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        const codigo = e.code === "ENOENT" ? -1 : e.killed ? -2 : typeof e.code === "number" ? e.code : 1;
        resolver({ codigo, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    });
}

/**
 * As origens dos bind mounts de todos os containers (rodando ou parados: o parado volta a montar ao subir). `[]` = sem
 * Docker instalado; `null` = o Docker não respondeu (o Docker Desktop trava quando o disco da VM enche) — aí a limpeza
 * segura toda worktree que tem arquivo de compose, em vez de apagar às cegas.
 */
export async function montagensDoDocker(executar: ExecutarComando): Promise<string[] | null> {
  const ps = await executar("docker", ["ps", "-aq"]);
  if (ps.codigo === -1) return [];
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
 * Apaga as subpastas vazias e a própria pasta, se ficou vazia (só `.DS_Store` conta como vazio). Nunca apaga arquivo de
 * conteúdo, nunca entra numa worktree ou clone que ficou (a pasta vazia de dentro dela pode ser a origem de uma
 * montagem, como o `infra/postgres/init` do diário) e nunca apaga a pasta que é origem de montagem conhecida.
 */
async function apagarVazias(dir: string, profundidade: number, montagens: readonly string[]): Promise<boolean> {
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  if (entradas.some((e) => e.name === ".git") || protegidoPorMontagem(dir, montagens)) return false;
  for (const e of entradas) if (e.isDirectory() && profundidade < PROFUNDIDADE_MAXIMA + 1) await apagarVazias(join(dir, e.name), profundidade + 1, montagens);
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  if (!entradas.every((e) => e.name === ".DS_Store" && e.isFile())) return false;
  try {
    for (const e of entradas) await unlink(join(dir, e.name));
    await rmdir(dir);
    return true;
  } catch {
    return false;
  }
}

async function temCompose(dir: string): Promise<boolean> {
  try { return (await readdir(dir)).some(ehArquivoDeCompose); } catch { return true; }
}

const livrePadrao = async (caminho: string): Promise<number> => {
  const s = await statfs(caminho);
  return Number(s.bavail) * Number(s.bsize);
};

/** O PR da branch desta worktree já foi mergeado? Qualquer dúvida (gh fora, sem login, HEAD solto) = não. */
async function prMergeado(wt: string, executar: ExecutarComando): Promise<boolean> {
  const ramo = await executar("git", ["-C", wt, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = ramo.stdout.trim();
  if (ramo.codigo !== 0 || branch === "") return false;
  const gh = await executar("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number", "--limit", "1"], { cwd: wt });
  if (gh.codigo !== 0) return false;
  try {
    const lista = JSON.parse(gh.stdout) as unknown;
    return Array.isArray(lista) && lista.length > 0;
  } catch {
    return false;
  }
}

function relatoVazio(): RelatoLimpeza {
  return { pastas: 0, removidas: 0, pastasApagadas: 0, liberadoBytes: 0, puladas: {}, orfas: 0, orfasParadas: 0, duracaoMs: 0 };
}

/**
 * Uma passada sobre as pastas que o servidor ofereceu. Cada pasta é conferida de novo aqui: forma `<bot>/<slug>`, pasta
 * de verdade (não link) e o caminho real dentro de `~/nod`. Sequencial de propósito: apagar node_modules é disco, e
 * vários bots já disputam o disco.
 */
export async function limparPastas(pastas: readonly PastaParaLimpar[], o: OpcoesLimpeza): Promise<RelatoLimpeza> {
  const relato = relatoVazio();
  const pular = (m: MotivoPuladaLimpeza) => { relato.puladas[m] = (relato.puladas[m] ?? 0) + 1; };
  const raiz = join(o.home, "nod");
  let raizReal: string;
  try { raizReal = await realpath(raiz); } catch { return relato; }
  const livre = o.livre ?? livrePadrao;
  // Uma consulta ao Docker por passada, só quando há pasta para mexer.
  let montagensLidas: Promise<string[] | null> | null = null;
  const lerMontagens = () => (montagensLidas ??= (o.montagens ?? (() => montagensDoDocker(o.executar)))());
  const clones = new Set<string>();

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
    const achados: Achados = { worktrees: [], clones: 0 };
    await procurar(base, 0, achados);
    for (let i = 0; i < achados.clones; i++) pular("clone");

    for (const wt of achados.worktrees) {
      const nome = basename(wt);
      const montagens = await lerMontagens();
      if (montagens !== null && protegidoPorMontagem(wt, montagens)) {
        pular("montagem");
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo: "montagem" });
        continue;
      }
      if (montagens === null && (await temCompose(wt))) {
        pular("compose_sem_docker");
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo: "compose_sem_docker" });
        continue;
      }
      if (p.quando === "so_com_pr_mergeado" && !(await prMergeado(wt, o.executar))) { pular("pr_nao_mergeado"); continue; }
      const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const dirComum = comum.stdout.trim();
      if (comum.codigo !== 0 || !isAbsolute(dirComum)) {
        pular("erro");
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo: "erro", codigo: comum.codigo });
        continue;
      }
      const antes = await livre(raiz).catch(() => null);
      // SEM --force (ADR-088): alteração não commitada ou arquivo novo fazem o git recusar, e a worktree fica.
      const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", wt], { prazoMs: PRAZO_REMOVER_MS });
      if (r.codigo !== 0) {
        const motivo = motivoDaRecusa(r.stderr);
        pular(motivo);
        log("aviso", "limpeza_worktree_pulada", { trabalho_id: p.trabalhoId, pasta: nome, motivo, codigo: r.codigo });
        continue;
      }
      const depois = await livre(raiz).catch(() => null);
      const liberado = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
      relato.removidas++;
      relato.liberadoBytes += liberado;
      clones.add(dirComum);
      log("info", "limpeza_worktree_removida", { trabalho_id: p.trabalhoId, pasta: nome, quando: p.quando, liberado_mb: Math.round(liberado / 1_048_576) });
    }
    if (await apagarVazias(base, 0, (await lerMontagens()) ?? [])) relato.pastasApagadas++;
  }
  for (const dirComum of clones) await o.executar("git", ["-C", dirComum, "worktree", "prune"]);
  return relato;
}

/**
 * As worktrees na raiz das pastas dos bots (`~/nod/<bot>/<x>` com `.git` arquivo), fora de qualquer task: só contadas
 * (ADR-088 §3). "Parada" = nem a pasta nem o HEAD/índice dela no clone mudaram há ORFA_PARADA_MS.
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

export type LimpezaDasTasks = { parar(): void; passada(): Promise<RelatoLimpeza | null> };

/**
 * A limpeza periódica de uma pessoa neste Mac: pede a lista à ponte, limpa e relata. Uma passada por vez; erro vira
 * log e a próxima tenta de novo. Ponte sem `pastasParaLimpar` (servidor antigo) = nada a fazer.
 */
export function iniciarLimpezaDasTasks(o: OpcoesLimpeza & { ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza">; pessoaId: string; agora?: () => number; primeiraMs?: number; intervaloMs?: number }): LimpezaDasTasks {
  const agora = o.agora ?? Date.now;
  let rodando = false;
  let parado = false;
  async function passada(): Promise<RelatoLimpeza | null> {
    if (rodando || parado || !o.ponte.pastasParaLimpar) return null;
    rodando = true;
    const inicio = agora();
    try {
      const pastas = await o.ponte.pastasParaLimpar(o.pessoaId);
      const relato = await limparPastas(pastas, o);
      const { orfas, paradas } = await contarOrfas(o.home, agora());
      relato.orfas = orfas;
      relato.orfasParadas = paradas;
      relato.duracaoMs = Math.max(0, agora() - inicio);
      await o.ponte.relatarLimpeza?.(o.pessoaId, relato);
      return relato;
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
