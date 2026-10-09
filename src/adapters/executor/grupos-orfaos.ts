import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../../obs/log.ts";

/**
 * Os grupos de processo dos turnos que sobreviveram ao nod (definido em 2026-10-09, ADR-089, #217). O `exit` do
 * processo do nod mata os grupos `detached` (processo.ts), mas o `exit` não roda num SIGKILL nem numa queda: medido no
 * Mac do Marlon em 09/10, dois `claude -p` com pai = 1 viviam havia 7h30, de um servidor religado às 21:40Z, um deles num
 * `while :; do gh run list; sleep 30; done`. O resultado não chegava a ninguém, e a task retomada (ADR-084) passava a ter
 * DOIS processos na mesma pasta.
 *
 * Por isso cada grupo vivo fica anotado num arquivo da instância, e o boot seguinte mata o que sobrou — só depois de
 * conferir que o pid ainda é o processo anotado, para nunca matar um pid que o sistema já deu a outro programa.
 */

/**
 * Um grupo anotado. `desdeMs`/`ateMs` cercam o spawn (o relógio antes e depois dele): o início que o `ps` mostra para o
 * líder tem de cair entre os dois. `programa` é o nome do binário (claude, codex, node), conferido na linha de comando.
 */
export type GrupoRegistrado = { pid: number; desdeMs: number; ateMs: number; programa: string };

/** O dono é o processo do nod que anotou: vivo, o arquivo é dele e ninguém mexe (duas cópias da mesma instância). */
export type ArquivoDeGrupos = { dono: { pid: number; inicioMs: number } | null; grupos: GrupoRegistrado[] };

/** Uma linha do `ps`: início com resolução de 1 s (lstart). */
export type ProcessoDoSistema = { pid: number; pgid: number; inicioMs: number; comando: string };

export type Sobra = { pgid: number; programa: string; membros: number; lider: boolean; desdeMs: number };

/** definido em 2026-10-09: o início do dono vem do relógio do Node e o do `ps` é truncado no segundo; 2 s cobrem os dois. */
const FOLGA_DONO_MS = 2_000;
/** definido em 2026-10-09: o `ps -A` sob a carga de 09/10 (load ~430) ainda responde em segundos; 30 s é o teto antes de desistir. */
const PRAZO_PS_MS = 30_000;

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `lstart` com LC_ALL=C: "Fri Oct  9 02:34:24 2026", na hora local (o mesmo TZ do Node, que passa o ambiente). */
const LINHA_PS = /^\s*(\d+)\s+(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})\s(.*)$/;

export function lerSaidaDoPs(saida: string): ProcessoDoSistema[] {
  const processos: ProcessoDoSistema[] = [];
  for (const linha of saida.split("\n")) {
    const m = LINHA_PS.exec(linha);
    if (!m) continue;
    const mes = MESES.indexOf(m[3]!);
    if (mes < 0) continue;
    const inicioMs = new Date(Number(m[8]), mes, Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7])).getTime();
    processos.push({ pid: Number(m[1]), pgid: Number(m[2]), inicioMs, comando: m[9]!.trim() });
  }
  return processos;
}

/** Todos os processos da máquina numa chamada só; null quando o `ps` não existe ou falha (nada é morto sem conferir). */
export function listarProcessosDoSistema(): Promise<ProcessoDoSistema[] | null> {
  return new Promise((resolver) => {
    // LC_ALL=C: no Mac em português o lstart sai "Sex  9 Out" e não daria para ler. -ww: a linha de comando inteira.
    execFile("ps", ["-A", "-ww", "-o", "pid=,pgid=,lstart=,command="], { env: { ...process.env, LC_ALL: "C" }, timeout: PRAZO_PS_MS, maxBuffer: 64 * 1024 * 1024 }, (erro, saida) => {
      resolver(erro ? null : lerSaidaDoPs(String(saida)));
    });
  });
}

/** O líder nasceu durante o spawn anotado (o lstart é truncado no segundo, então o piso também é). */
function nasceuNoSpawn(inicioMs: number, g: GrupoRegistrado): boolean {
  return inicioMs >= Math.floor(g.desdeMs / 1000) * 1000 && inicioMs <= g.ateMs + 1_000;
}

/**
 * O nome do binário aparece na linha de comando: `claude -p`, `node …/bin/claude`, `node …/@anthropic-ai/claude-code/cli.js`
 * (um wrapper que fez exec). Basta conter: quem separa um pid reaproveitado é o início, conferido antes; isto é a segunda
 * trava.
 */
function rodaOPrograma(comando: string, programa: string): boolean {
  return programa !== "" && comando.includes(programa);
}

/**
 * Quais grupos anotados ainda estão vivos e são mesmo os nossos. Puro (os testes montam o `ps`).
 *  - Líder vivo: só conta se ainda é líder do grupo, nasceu durante o spawn anotado e roda o programa anotado. Um pid
 *    reaproveitado falha no início (e quase sempre no programa) e não é tocado — nem ele, nem o grupo dele.
 *  - Líder morto com membros no grupo (o `claude` saiu e deixou o `while … sleep` do Bash): o sistema não dá um pid a
 *    processo novo enquanto existir grupo com esse número, então os membros são do grupo anotado. Ainda assim, todos têm
 *    de ter nascido depois do spawn; um membro mais velho que o grupo é sinal de leitura errada, e nada é tocado.
 */
export function sobrasDoRegistro(grupos: readonly GrupoRegistrado[], processos: readonly ProcessoDoSistema[]): Sobra[] {
  const sobras: Sobra[] = [];
  for (const g of grupos) {
    const membros = processos.filter((p) => p.pgid === g.pid);
    const lider = processos.find((p) => p.pid === g.pid);
    if (lider) {
      if (lider.pgid !== g.pid || !nasceuNoSpawn(lider.inicioMs, g) || !rodaOPrograma(lider.comando, g.programa)) continue;
      sobras.push({ pgid: g.pid, programa: g.programa, membros: membros.length, lider: true, desdeMs: g.desdeMs });
      continue;
    }
    if (membros.length === 0) continue;
    if (membros.some((p) => p.inicioMs < Math.floor(g.desdeMs / 1000) * 1000)) continue;
    sobras.push({ pgid: g.pid, programa: g.programa, membros: membros.length, lider: false, desdeMs: g.desdeMs });
  }
  return sobras;
}

export function lerArquivoDeGrupos(arquivo: string): ArquivoDeGrupos {
  try {
    const lido = JSON.parse(readFileSync(arquivo, "utf8")) as Partial<ArquivoDeGrupos>;
    const grupos = Array.isArray(lido.grupos)
      ? lido.grupos.filter((g): g is GrupoRegistrado => typeof g?.pid === "number" && g.pid > 1 && typeof g.desdeMs === "number" && typeof g.ateMs === "number" && typeof g.programa === "string")
      : [];
    const dono = lido.dono && typeof lido.dono.pid === "number" && typeof lido.dono.inicioMs === "number" ? lido.dono : null;
    return { dono, grupos };
  } catch {
    return { dono: null, grupos: [] };
  }
}

/** Síncrono de propósito: o `exit` do processo só permite trabalho síncrono, e é ele que anota a lista vazia no fim. */
export function gravarArquivoDeGrupos(arquivo: string, conteudo: ArquivoDeGrupos): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(conteudo)}\n`, { mode: 0o600 });
  renameSync(temporario, arquivo);
}

/**
 * O arquivo de UMA instância do servidor (definido em 2026-10-09): o diário e uma instância temporária de teste podem
 * rodar juntos no mesmo Mac com o mesmo ~/.nod, e o boot de uma não pode matar os bots da outra. A instância é o banco e
 * a porta da API; o hash não deixa a senha do DATABASE_URL no nome do arquivo.
 */
export function arquivoDeGruposDoServidor(dirNod: string, env: { DATABASE_URL?: string; NOD_API_PORT?: string }): string {
  const chave = createHash("sha256").update(`${env.DATABASE_URL ?? ""}|${env.NOD_API_PORT ?? "8888"}`).digest("hex").slice(0, 16);
  return join(dirNod, "grupos-vivos", `servidor-${chave}.json`);
}

/** Quando este processo nasceu, no relógio de parede (o dono anotado no arquivo). */
export function inicioDesteProcesso(): number {
  return Math.round(performance.timeOrigin);
}

export type ResultadoDaLimpeza = { assumiu: boolean; encerrados: Sobra[] };

/**
 * O boot (servidor e app do Mac) chama ANTES de qualquer turno: mata com SIGKILL os grupos que sobraram da vida anterior
 * desta instância e diz se este processo pode assumir o arquivo. `assumiu: false` = o dono anotado ainda está vivo (outra
 * cópia da mesma instância, que o listen vai recusar): nada é morto e o arquivo fica com ele.
 */
export async function encerrarGruposOrfaos(o: {
  arquivo: string;
  listar?: () => Promise<ProcessoDoSistema[] | null>;
  matar?: (pgid: number) => void;
  agora?: () => number;
  pidAtual?: number;
}): Promise<ResultadoDaLimpeza> {
  const anotado = lerArquivoDeGrupos(o.arquivo);
  const pidAtual = o.pidAtual ?? process.pid;
  const donoAlheio = anotado.dono && anotado.dono.pid !== pidAtual ? anotado.dono : null;
  if (anotado.grupos.length === 0 && !donoAlheio) return { assumiu: true, encerrados: [] };
  const processos = await (o.listar ?? listarProcessosDoSistema)();
  if (!processos) {
    log("aviso", "orfaos_sem_ps", { grupos: anotado.grupos.length });
    return { assumiu: true, encerrados: [] };
  }
  if (donoAlheio && processos.some((p) => p.pid === donoAlheio.pid && Math.abs(p.inicioMs - donoAlheio.inicioMs) <= FOLGA_DONO_MS)) {
    log("aviso", "grupos_de_outra_copia_viva", { dono_pid: donoAlheio.pid, grupos: anotado.grupos.length });
    return { assumiu: false, encerrados: [] };
  }
  const matar = o.matar ?? ((pgid: number) => process.kill(-pgid, "SIGKILL"));
  const agora = (o.agora ?? Date.now)();
  const encerrados: Sobra[] = [];
  for (const s of sobrasDoRegistro(anotado.grupos, processos)) {
    try {
      matar(s.pgid);
      encerrados.push(s);
      log("aviso", "orfao_encerrado", { pgid: s.pgid, programa: s.programa, membros: s.membros, lider_vivo: s.lider, idade_min: Math.round((agora - s.desdeMs) / 60_000) });
    } catch {
      // acabou entre o `ps` e o kill
    }
  }
  return { assumiu: true, encerrados };
}
