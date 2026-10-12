import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { MotivoPuladaLimpeza } from "../../contracts/ponte.ts";
import { FORA_DO_GUARDADO, GUARDADO_MAX_BYTES, guardadoVencido, pedacoDeRef } from "../../domain/guardado.ts";
import { protegidoPorMontagem } from "../../domain/limpeza-das-tasks.ts";
import { log } from "../../obs/log.ts";
import type { ExecutarComando } from "./limpeza-das-tasks.ts";

/**
 * Guardar antes de apagar (ADR-096 §4, definido em 2026-10-11). A limpeza da ADR-088 só tirava a worktree que o git
 * deixa tirar sem --force; o resto (worktree suja, `.env`, HEAD solto, `pgdata`, logs) segurava a pasta para sempre. Aqui
 * a pasta inteira vira um `.tar.gz` em `~/nod/.guardado/<bot>/`, sem dependências e caches; o HEAD de cada worktree ganha
 * uma referência no clone (`refs/nod/guardado/<rotulo>/<nome>`), para nenhum commit se perder; e só depois do guardado
 * conferido a pasta sai. Nada vai ao GitHub.
 *
 * Fica sem mexer: montagem de container dentro, worktree travada, `*.pid` de processo vivo, guardado acima de 2 GB e
 * qualquer erro no caminho (o guardado pela metade é apagado e a pasta fica).
 */

/** definido em 2026-10-11: compactar 1 GB de `pgdata` com prioridade baixa e a máquina cheia passa de 2 min. */
const PRAZO_GUARDAR_MS = 20 * 60_000;
const PRAZO_REMOVER_MS = 10 * 60_000;
/** Até onde se procura `*.pid` dentro da pasta (fora de node_modules): `<slug>/pg/postmaster.pid` é 2. */
const PID_PROFUNDIDADE = 4;

export type OpcoesGuardar = {
  /** `~/nod` (a raiz das pastas dos bots). */
  raiz: string;
  executar: ExecutarComando;
  /** As origens dos bind mounts conhecidas (já com o caminho real). */
  montagens: readonly string[];
  simular?: boolean;
  livre: (caminho: string) => Promise<number>;
  agora: () => number;
  /** O teto do guardado compactado; padrão GUARDADO_MAX_BYTES (injetável nos testes). */
  maxBytes?: number;
};

export type ResultadoGuardar = { motivo: MotivoPuladaLimpeza | null; guardadoBytes: number; liberadoBytes: number; worktrees: number };

const vazio = (motivo: MotivoPuladaLimpeza | null): ResultadoGuardar => ({ motivo, guardadoBytes: 0, liberadoBytes: 0, worktrees: 0 });

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Algum `*.pid` dentro da pasta aponta para um processo vivo (um Postgres de teste, um servidor esquecido)? A primeira
 * linha é o pid (é o formato do `postmaster.pid` e do `ns.pid` que os bots deixam). Pid do próprio processo não conta.
 */
export async function temProcessoVivo(dir: string, profundidade = 0): Promise<boolean> {
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entradas) {
    const caminho = join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".pid")) {
      const pid = Number.parseInt((await readFile(caminho, "utf8").catch(() => "")).split("\n")[0]?.trim() ?? "", 10);
      if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && processoVivo(pid)) return true;
    } else if (e.isDirectory() && e.name !== "node_modules" && profundidade < PID_PROFUNDIDADE && (await temProcessoVivo(caminho, profundidade + 1))) {
      return true;
    }
  }
  return false;
}

/** As worktrees de um clone (`git worktree list --porcelain`), com o caminho e se está travada. */
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

/** As worktrees (`.git` ARQUIVO) dentro da pasta, em qualquer nível fora de node_modules, sem seguir link. */
async function worktreesNaPasta(dir: string, achadas: string[] = [], vistas = { n: 0 }): Promise<string[]> {
  if (++vistas.n > 20_000) return achadas;
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return achadas; }
  if (entradas.some((e) => e.name === ".git" && e.isFile())) achadas.push(dir);
  for (const e of entradas) if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") await worktreesNaPasta(join(dir, e.name), achadas, vistas);
  return achadas;
}

const dentroDe = (caminho: string, pasta: string) => caminho === pasta || caminho.startsWith(`${pasta}${sep}`);

/**
 * Guarda a pasta `base` (dentro de `~/nod/<bot>/`) e a apaga. `rotulo` vai no nome das referências (o id da task, ou
 * `orfa`). Devolve o motivo de ter ficado, ou null com o que foi guardado e liberado.
 */
export async function guardarEApagar(base: string, rotulo: string, o: OpcoesGuardar): Promise<ResultadoGuardar> {
  const bot = dirname(base);
  const nome = basename(base);
  if (dirname(bot) !== o.raiz || nome.startsWith(".") || basename(bot).startsWith(".")) return vazio("fora_da_pasta");
  const baseReal = await realpath(base).catch(() => null);
  const raizReal = await realpath(o.raiz).catch(() => null);
  if (baseReal === null || raizReal === null || !dentroDe(baseReal, raizReal) || baseReal === raizReal) return vazio("fora_da_pasta");
  if (protegidoPorMontagem(base, o.montagens) || protegidoPorMontagem(baseReal, o.montagens)) return vazio("montagem");
  if (await temProcessoVivo(base)) return vazio("processo_vivo");

  // As worktrees dentro da pasta, e as que o clone delas conhece aqui dentro (inclusive em pasta escondida).
  const achadas = await worktreesNaPasta(base);
  const porClone = new Map<string, string[]>();
  for (const wt of achadas) {
    const comum = await o.executar("git", ["-C", wt, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const dirComum = comum.stdout.trim();
    if (comum.codigo !== 0 || !isAbsolute(dirComum)) return vazio("erro");
    // O clone que mora dentro da própria pasta sai junto com ela: as worktrees dele não precisam de remove.
    if (dentroDe(await realpath(dirComum).catch(() => dirComum), baseReal)) continue;
    if (!porClone.has(dirComum)) porClone.set(dirComum, []);
  }
  for (const dirComum of porClone.keys()) {
    const lista = await worktreesDoClone(dirComum, o.executar);
    if (lista === null) return vazio("erro");
    for (const w of lista) {
      const real = await realpath(w.caminho).catch(() => w.caminho);
      if (!dentroDe(real, baseReal)) continue;
      if (w.travada) return vazio("travada");
      porClone.get(dirComum)!.push(w.caminho);
    }
  }
  const worktrees = [...porClone.values()].reduce((n, l) => n + l.length, 0);
  if (o.simular) {
    log("info", "limpeza_simulada_guardar", { caminho: relative(o.raiz, base), worktrees });
    return { motivo: null, guardadoBytes: 0, liberadoBytes: 0, worktrees };
  }

  // 1. Cada HEAD ganha uma referência no clone: o commit que só o HEAD solto alcança não se perde.
  for (const [dirComum, lista] of porClone) {
    for (const wt of lista) {
      const head = (await o.executar("git", ["-C", wt, "rev-parse", "--verify", "-q", "HEAD"])).stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(head)) continue; // worktree sem commit nenhum: o conteúdo vai no guardado
      const ref = `refs/nod/guardado/${pedacoDeRef(rotulo)}/${pedacoDeRef(relative(base, wt) || nome)}`;
      const r = await o.executar("git", ["-C", dirComum, "update-ref", ref, head]);
      if (r.codigo !== 0) return vazio("erro");
    }
  }

  // 2. O guardado: a pasta sem dependências e caches, compactada; nasce `.parcial` e só vira o arquivo final inteiro.
  const pasta = join(o.raiz, ".guardado", basename(bot));
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  let destino = join(pasta, `${nome}.tar.gz`);
  if (await lstat(destino).then(() => true, () => false)) destino = join(pasta, `${nome}-${o.agora()}.tar.gz`);
  const parcial = `${destino}.parcial`;
  const excluir = FORA_DO_GUARDADO.map((x) => `--exclude=${x}`);
  const tar = await o.executar("tar", ["-czf", parcial, ...excluir, "-C", bot, nome], { prazoMs: PRAZO_GUARDAR_MS, fundo: true });
  const tamanho = await stat(parcial).then((s) => s.size, () => -1);
  if (tar.codigo !== 0 || tamanho <= 0) {
    await unlink(parcial).catch(() => undefined);
    log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), codigo: tar.codigo });
    return vazio("erro");
  }
  if (tamanho > (o.maxBytes ?? GUARDADO_MAX_BYTES)) {
    await unlink(parcial).catch(() => undefined);
    return vazio("grande_demais");
  }
  // Conferido: o arquivo se lê inteiro (o gzip e o tar fecham).
  const confere = await o.executar("tar", ["-tzf", parcial], { prazoMs: PRAZO_GUARDAR_MS, fundo: true });
  if (confere.codigo !== 0) {
    await unlink(parcial).catch(() => undefined);
    return vazio("erro");
  }
  await rename(parcial, destino);

  // 3. Só agora a pasta sai: as worktrees pelo git (o clone esquece cada uma), da mais funda para a mais rasa; depois o resto.
  const antes = await o.livre(o.raiz).catch(() => null);
  const todas = [...porClone.entries()].flatMap(([dirComum, lista]) => lista.map((wt) => ({ dirComum, wt }))).sort((a, b) => b.wt.length - a.wt.length);
  for (const { dirComum, wt } of todas) {
    const r = await o.executar("git", ["-C", dirComum, "worktree", "remove", "--force", wt], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
    if (r.codigo !== 0) {
      log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), etapa: "worktree_remove", codigo: r.codigo });
      return { ...vazio("erro"), guardadoBytes: tamanho };
    }
  }
  const rm = await o.executar("rm", ["-rf", "--", base], { prazoMs: PRAZO_REMOVER_MS, fundo: true });
  const ficou = await lstat(base).then(() => true, () => false);
  if (rm.codigo !== 0 || ficou) {
    log("aviso", "limpeza_guardar_falhou", { caminho: relative(o.raiz, base), etapa: "rm", codigo: rm.codigo });
    return { ...vazio("erro"), guardadoBytes: tamanho, worktrees };
  }
  const depois = await o.livre(o.raiz).catch(() => null);
  const liberadoBytes = antes !== null && depois !== null ? Math.max(0, depois - antes) : 0;
  log("info", "limpeza_pasta_guardada", { rotulo, guardado: relative(o.raiz, destino), guardado_mb: Math.round(tamanho / 1_048_576), liberado_mb: Math.round(liberadoBytes / 1_048_576), worktrees });
  return { motivo: null, guardadoBytes: tamanho, liberadoBytes, worktrees };
}

/** Apaga os guardados vencidos (30 dias, ou 7 com o disco apertado). Devolve quantos saíram. */
export async function vencerGuardados(raiz: string, agora: number, apertado: boolean): Promise<number> {
  const pasta = join(raiz, ".guardado");
  let vencidos = 0;
  let bots;
  try { bots = await readdir(pasta, { withFileTypes: true }); } catch { return 0; }
  for (const b of bots) {
    if (!b.isDirectory()) continue;
    let arquivos;
    try { arquivos = await readdir(join(pasta, b.name), { withFileTypes: true }); } catch { continue; }
    for (const a of arquivos) {
      if (!a.isFile() || !(a.name.endsWith(".tar.gz") || a.name.endsWith(".parcial"))) continue;
      const caminho = join(pasta, b.name, a.name);
      const mtime = await stat(caminho).then((s) => s.mtimeMs, () => null);
      // O `.parcial` de uma passada que morreu no meio sai em 1 dia: ele nunca foi um guardado inteiro.
      const vence = mtime !== null && (a.name.endsWith(".parcial") ? agora - mtime >= 24 * 3_600_000 : guardadoVencido(mtime, agora, apertado));
      if (vence && (await unlink(caminho).then(() => true, () => false))) vencidos++;
    }
  }
  if (vencidos > 0) log("info", "limpeza_guardados_vencidos", { vencidos, apertado });
  return vencidos;
}
