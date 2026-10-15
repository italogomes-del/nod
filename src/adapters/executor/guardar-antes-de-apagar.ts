import { lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
 * qualquer erro no caminho (o guardado pela metade é apagado e a pasta fica). ADR-106 (revisão do #320): também um
 * clone dentro da pasta com worktree viva fora dela (`clone_em_uso`), e o "não" da reconferência logo antes de apagar
 * (`antesDeApagar`; o guardado recém-criado sai). A worktree cujo clone sumiu de vez (`cloneSumiu`) não tem git a
 * consultar: os arquivos dela só vão no guardado.
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
  /**
   * ADR-106 (revisão do #320): perguntado logo antes do primeiro `worktree remove`/`rm`, depois do guardado pronto — a
   * compactação leva até 20 min, e um turno pode ter voltado à pasta nesse meio. Um motivo (ou um erro, que vira
   * `erro`) = a pasta fica e o guardado que acabou de nascer sai (ela continua inteira no disco). As referências
   * `refs/nod/guardado/…` do passo 1 ficam no clone: apontam para commits que existem, e a próxima passada as reescreve.
   */
  antesDeApagar?: () => Promise<MotivoPuladaLimpeza | null>;
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

type GitsNaPasta = { worktrees: string[]; clones: string[]; incompleto: boolean };

/**
 * As worktrees (`.git` ARQUIVO) e os clones (`.git` PASTA) dentro da pasta, em qualquer nível fora de node_modules,
 * sem seguir link. ADR-106 (revisão do #320): `incompleto` = passou do teto de pastas ou uma pasta não se leu — um
 * clone não visto escaparia da conferência das worktrees de fora, então quem chama não apaga.
 */
async function gitsNaPasta(dir: string, achados: GitsNaPasta = { worktrees: [], clones: [], incompleto: false }, vistas = { n: 0 }): Promise<GitsNaPasta> {
  if (++vistas.n > 20_000) { achados.incompleto = true; return achados; }
  let entradas;
  try { entradas = await readdir(dir, { withFileTypes: true }); } catch { achados.incompleto = true; return achados; }
  const git = entradas.find((e) => e.name === ".git");
  if (git?.isFile()) achados.worktrees.push(dir);
  else if (git?.isDirectory()) achados.clones.push(dir);
  for (const e of entradas) if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") await gitsNaPasta(join(dir, e.name), achados, vistas);
  return achados;
}

const dentroDe = (caminho: string, pasta: string) => caminho === pasta || caminho.startsWith(`${pasta}${sep}`);

/** O caminho não existe (ENOENT)? Outro erro (permissão) conta como "existe": na dúvida, nada sai. */
const ausente = (caminho: string) => lstat(caminho).then(() => false, (e: NodeJS.ErrnoException) => e.code === "ENOENT");

/** Erro de leitura que só diz "não está lá" (o resto — permissão, arquivos demais abertos — é dúvida). */
const naoEstaLa = (e: unknown) => ["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "");

/**
 * ADR-106 (revisão do #320): `caminho` não existe e nunca vai voltar? Só dentro de `~/nod` e sem link no caminho: o
 * primeiro ancestral que existe tem de ser o próprio caminho real, dentro de `~/nod`. Um link para um disco que não está
 * montado (`~/nod/<bot>/x -> /Volumes/…`), ou um caminho fora de `~/nod`, pode voltar.
 */
async function sumiuDeVezEmNod(caminho: string, raiz: string, raizReal: string): Promise<boolean> {
  if ((!dentroDe(caminho, raiz) && !dentroDe(caminho, raizReal)) || !(await ausente(caminho))) return false;
  let existente = dirname(caminho);
  while (await ausente(existente)) {
    const acima = dirname(existente);
    if (acima === existente) return false;
    existente = acima;
  }
  const esperado = dentroDe(existente, raizReal) ? existente : join(raizReal, relative(raiz, existente));
  return dentroDe(esperado, raizReal) && (await realpath(existente).catch(() => null)) === esperado;
}

/**
 * ADR-106 (revisão do #320): as worktrees que um clone registra, lidas do disco (`.git/worktrees/<nome>/gitdir` e
 * `locked`) — sem rodar o git, que num `.git` quebrado sobe para o repositório de cima e lista as worktrees de outro.
 * null = não deu para ler tudo (dúvida).
 */
async function registrosDoClone(clone: string): Promise<{ caminho: string; travada: boolean }[] | null> {
  const registros = join(clone, ".git", "worktrees");
  let nomes: string[];
  try { nomes = await readdir(registros); } catch (e) { return naoEstaLa(e) ? [] : null; }
  const lista: { caminho: string; travada: boolean }[] = [];
  for (const r of nomes) {
    let apontado: string;
    try { apontado = (await readFile(join(registros, r, "gitdir"), "utf8")).trim(); } catch (e) { if (naoEstaLa(e)) continue; return null; }
    if (apontado === "") return null;
    // O `gitdir` do registro aponta para o arquivo `.git` da worktree; a worktree é a pasta dele.
    lista.push({ caminho: dirname(resolve(registros, r, apontado)), travada: !(await ausente(join(registros, r, "locked"))) });
  }
  return lista;
}

/** Até onde se procura clone dentro de `~/nod` (`<bot>/<slug>/repos/<repo>` é o nível 4) e quantas pastas no máximo. */
const CLONE_PROFUNDIDADE = 4;
const CLONE_MAX_PASTAS = 20_000;

/**
 * ADR-106 (revisão do #320): algum clone dentro de `raiz` ainda registra a worktree cujo `.git` é `alvos`? É o clone
 * que mudou de lugar: a worktree aponta para o caminho velho, mas o registro está vivo e o `git worktree repair`
 * conserta. Não desce em repositório (o que tem `.git`) nem em pasta escondida ou node_modules. Na dúvida = sim (fica):
 * passou do teto de pastas sem ter olhado tudo, ou uma leitura falhou por outro motivo que "não está lá".
 */
async function algumCloneRegistra(raiz: string, alvos: ReadonlySet<string>): Promise<boolean> {
  let vistas = 0;
  async function descer(dir: string, nivel: number): Promise<boolean> {
    if (++vistas > CLONE_MAX_PASTAS) {
      log("aviso", "limpeza_clone_busca_no_teto", { pastas: CLONE_MAX_PASTAS });
      return true;
    }
    let entradas;
    try { entradas = await readdir(dir, { withFileTypes: true }); } catch (e) { return !naoEstaLa(e); }
    const git = entradas.find((e) => e.name === ".git");
    if (git?.isDirectory()) {
      const lista = await registrosDoClone(dir);
      if (lista === null) return true;
      if (lista.some((w) => alvos.has(join(w.caminho, ".git")))) return true;
    }
    if (git || nivel >= CLONE_PROFUNDIDADE) return false;
    for (const e of entradas) if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && (await descer(join(dir, e.name), nivel + 1))) return true;
    return false;
  }
  return descer(raiz, 0);
}

/**
 * ADR-106 (definido em 2026-10-15): a worktree `wt` aponta (`gitdir:` do arquivo `.git`) para um clone dentro de `raiz`
 * (`~/nod`) que não existe mais? Na VM dos bots, em 15/10, uma task tinha apagado o clone `nod` de outra: a worktree que
 * sobrou dava `erro` no `git rev-parse` a cada passada e segurava a pasta para sempre (`Ada/…-169c93`, e cinco da
 * Tarsila). Sem o clone não há commit a salvar nem worktree a desligar — só os arquivos, que o guardado leva.
 *
 * revisto na revisão do #320: só vale "sumiu" quando é certeza, porque aí a pasta é guardada e apagada. Não sumiu:
 * - o `gitdir` fora da forma de `git worktree add` (`<clone>/.git/worktrees/<nome>`);
 * - o clone fora de `~/nod` (um disco desmontado pode voltar);
 * - o `.git` do clone ainda existe (só o registro da worktree foi podado);
 * - um link no caminho (`~/nod/<bot>/x -> /Volumes/…`, com o disco desmontado): o primeiro ancestral que existe tem de
 *   ser o próprio caminho real, dentro de `~/nod`;
 * - um clone em `~/nod` ainda registra a worktree (ele mudou de lugar).
 */
export async function cloneSumiu(wt: string, raiz: string): Promise<boolean> {
  const m = /^gitdir:\s*(.+)$/m.exec(await readFile(join(wt, ".git"), "utf8").catch(() => ""));
  if (!m) return false;
  const gitdir = resolve(wt, m[1]!.trim());
  if (basename(dirname(gitdir)) !== "worktrees" || basename(dirname(dirname(gitdir))) !== ".git") return false;
  const raizReal = await realpath(raiz).catch(() => null);
  if (raizReal === null || !(await sumiuDeVezEmNod(dirname(dirname(gitdir)), raiz, raizReal))) return false;
  const wtReal = await realpath(wt).catch(() => wt);
  return !(await algumCloneRegistra(raizReal, new Set([join(wt, ".git"), join(wtReal, ".git")])));
}

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
  const { worktrees: achadas, clones, incompleto } = await gitsNaPasta(base);
  if (incompleto) return vazio("erro");
  // ADR-106 (revisão do #320): o clone que mora aqui sai junto com a pasta — então nenhuma worktree dele pode morar
  // fora dela. Era assim que uma task apagava o clone `nod` de outra (a worktree `Ada/…-169c93/nod` de 15/10), e uma
  // task ativa perderia o repositório no meio do trabalho. Fica também com a de fora travada (`locked`) ou num caminho
  // que pode voltar (disco desmontado, link). Só o registro velho de uma worktree que sumiu de vez em ~/nod não conta.
  for (const clone of clones) {
    const lista = await registrosDoClone(clone);
    if (lista === null) return vazio("erro");
    for (const w of lista) {
      const real = await realpath(w.caminho).catch(() => w.caminho);
      if (dentroDe(real, baseReal) || dentroDe(w.caminho, base)) continue;
      if (w.travada || !(await sumiuDeVezEmNod(w.caminho, o.raiz, raizReal))) return vazio("clone_em_uso");
    }
  }
  const porClone = new Map<string, string[]>();
  for (const wt of achadas) {
    // ADR-106: a worktree sem clone não tem o que desligar nem commit a referenciar; os arquivos vão no guardado.
    if (await cloneSumiu(wt, o.raiz)) continue;
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
  // Erro na pergunta (a ponte caiu no meio da compactação) é dúvida: a pasta fica.
  const desistiu = o.antesDeApagar ? await o.antesDeApagar().catch((): MotivoPuladaLimpeza => "erro") : null;
  if (desistiu) {
    await unlink(destino).catch(() => undefined);
    log("info", "limpeza_guardar_desistiu", { rotulo, motivo: desistiu });
    return vazio(desistiu);
  }

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
