import { spawn } from "node:child_process";
import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { encerrarFugitivosDoTurno } from "./fugitivos.ts";
import { gravarArquivoDeGrupos, inicioDesteProcesso, prefixoDaMarca, VARIAVEL_DA_MARCA, type GrupoRegistrado } from "./grupos-orfaos.ts";

/**
 * Processo filho do executor: spawn, linhas do stdout, stderr acumulado, e interrupção em dois
 * tempos. Nenhuma decisão de domínio mora aqui — quem classifica é src/domain/stream-json.ts.
 */
export type FimProcesso = {
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  /** spawn não aconteceu (ENOENT, EACCES): exitCode e signal ficam null. */
  erroSpawn: Error | null;
};

export type Processo = {
  pid: number | null;
  escrever(texto: string): void;
  fecharStdin(): void;
  /** SIGTERM → SIGTERM_PARA_SIGKILL_MS → SIGKILL. Idempotente. */
  interromper(): Promise<void>;
  /** true depois da primeira chamada a interromper() — é o `interrompidoPeloDriver` do classificador. */
  interrompido(): boolean;
  fim: Promise<FimProcesso>;
};

/** definido em 2026-09-16: 5 s — a sonda mediu (s6.log) que o CLI sai em ~640 ms após SIGTERM; 5 s é folga de uma ordem de grandeza. */
export const SIGTERM_PARA_SIGKILL_MS = 5_000;

/** definido em 2026-09-16: 1 s depois do SIGKILL para o pipe fechar sozinho; senão é um neto órfão segurando-o. */
const DEPOIS_DO_SIGKILL_MS = 1_000;

/** definido em 2026-09-16: 64 KiB de stderr bastam para diagnóstico; o classificador nem o lê (ADR-009). */
const STDERR_MAX_CHARS = 65_536;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Grupos de processo vivos (definido em 2026-10-07, ADR-083, #194). Cada filho nasce líder do próprio grupo
 * (`detached: true`), para o amostrador somar a memória do grupo e o Parar levar junto os netos (servidor MCP, Bash do
 * modelo). O preço do `detached` é o filho não morrer com o app: o `exit` do processo do nod (app do Mac ou servidor)
 * mata com SIGKILL todo grupo que ainda estiver aqui. `process.kill` é síncrono, o único tipo de trabalho que o `exit`
 * permite.
 * revisto em 2026-10-09 (ADR-089, #217): o `exit` não roda num SIGKILL nem numa queda, e os grupos ficavam órfãos por
 * horas. Com `registrarGruposEm`, cada grupo também fica anotado no arquivo da instância (grupos-orfaos.ts), e o boot
 * seguinte mata o que sobrou. Sem arquivo (testes, sonda avulsa), nada é gravado.
 */
const gruposVivos = new Map<number, GrupoRegistrado>();
let ganchoDeSaida = false;
let arquivoDeGrupos: string | null = null;
/** Com o registro ligado, cada spawn leva NOD_GRUPO=<prefixo da instância>-<aleatório>: a prova que o boot lê (revisão do #223). */
let prefixoDeMarca: string | null = null;

/** Anota a lista no arquivo da instância; uma falha de disco não pode derrubar o turno (o `exit` ainda mata). */
function anotarGrupos(): void {
  if (arquivoDeGrupos === null) return;
  try {
    gravarArquivoDeGrupos(arquivoDeGrupos, { dono: { pid: process.pid, inicioMs: inicioDesteProcesso() }, grupos: [...gruposVivos.values()] });
  } catch {
    // disco cheio ou sem permissão: segue só com o `exit`, como antes da ADR-089
  }
}

/**
 * Liga o registro em arquivo (ADR-089). O boot chama depois de `encerrarGruposOrfaos` dizer que este processo assumiu o
 * arquivo; null desliga (os testes).
 */
export function registrarGruposEm(arquivo: string | null): void {
  arquivoDeGrupos = arquivo;
  prefixoDeMarca = arquivo === null ? null : prefixoDaMarca(arquivo);
  anotarGrupos();
}

/**
 * SIGKILL em todo grupo que este processo ainda tem e o arquivo anotado vazio: o caminho do `exit`, e o do app do Mac ao
 * sair (will-quit). Síncrono e idempotente.
 */
export function encerrarGruposVivos(): void {
  for (const g of gruposVivos.keys()) {
    try {
      process.kill(-g, "SIGKILL");
    } catch {
      // o grupo já acabou
    }
  }
  gruposVivos.clear();
  anotarGrupos();
}

/** Sinal para o grupo inteiro; sem grupo (plataforma sem `-pid`) ou já morto, cai no próprio processo. */
function sinalizarGrupo(pid: number, sinal: NodeJS.Signals, sozinho: () => void): void {
  try {
    process.kill(-pid, sinal);
  } catch {
    try {
      sozinho();
    } catch {
      // já saiu
    }
  }
}

function vigiarGrupo(pid: number, grupo: GrupoRegistrado): void {
  gruposVivos.set(pid, grupo);
  anotarGrupos();
  if (ganchoDeSaida) return;
  ganchoDeSaida = true;
  process.on("exit", encerrarGruposVivos);
}

/** Tira o grupo da lista (e do arquivo); true se ele estava lá — só então o pid ainda é nosso. */
function soltarGrupo(pid: number): boolean {
  if (!gruposVivos.delete(pid)) return false;
  anotarGrupos();
  return true;
}

/** Os grupos que este processo do nod ainda tem vivos (os testes conferem que o Parar os solta). */
export function gruposDeProcessoVivos(): number[] {
  return [...gruposVivos.keys()];
}

/**
 * Divide o stdout em linhas procurando o "\n" só no pedaço que acabou de chegar; os pedaços da linha ainda aberta são
 * colados uma vez, quando ela fecha. medido em 2026-09-30 (bancada em Node, pedaços de 64 KiB): com
 * `resto += pedaco; resto.indexOf("\n")` cada pedaço relia a linha acumulada inteira — uma linha de 2 MB custava
 * 39–52 ms somados e uma de 6 MB, 0,3–1 s; assim, 3 ms e 5 ms. Linha de vários MB existe: o tool_result de computador_*
 * traz a captura de tela em base64, e o CLI repete o conteúdo em `tool_use_result`. Linha vazia sai como antes; o resto
 * sem "\n" só sai no fechar.
 */
export function criarDivisorDeLinhas(aoLinha: (linha: string) => void): { empurrar(pedaco: string): void; fechar(): void } {
  let aberta: string[] = [];
  return {
    empurrar(pedaco) {
      let inicio = 0;
      let quebra = pedaco.indexOf("\n");
      while (quebra !== -1) {
        const final = pedaco.slice(inicio, quebra);
        aoLinha(aberta.length === 0 ? final : aberta.join("") + final);
        aberta = [];
        inicio = quebra + 1;
        quebra = pedaco.indexOf("\n", inicio);
      }
      if (inicio < pedaco.length) aberta.push(pedaco.slice(inicio));
    },
    fechar() {
      const resto = aberta.join("");
      aberta = [];
      if (resto.trim() !== "") aoLinha(resto);
    },
  };
}

export function iniciarProcesso(o: {
  bin: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  aoLinha(linha: string): void;
  /**
   * Cada pedaço do stderr, quando chega (definido em 2026-10-09: o npm escreve o progresso no stderr, e a instalação
   * pelo app mostra a última linha ao vivo). O stderr continua acumulado no `fim`, como sempre.
   */
  aoStderr?(pedaco: string): void;
  /** 'pipe' (default) para mandar o prompt; 'ignore' para a sonda com prompt como argumento. */
  stdin?: "pipe" | "ignore";
  /**
   * Espera entre SIGTERM e SIGKILL; default SIGTERM_PARA_SIGKILL_MS. Só testes reduzem: quem
   * cronometra `interromper()` precisa de um relógio MENOR que o do código — afirmar contra o
   * mesmo 5 s é corrida, não asserção (a suíte piscava com 'expected 5020 to be less than 5000').
   */
  sigtermParaSigkillMs?: number;
  /**
   * ADR-097 (fase 0): no fim, também encerra o que saiu do grupo com a marca deste spawn (fugitivos.ts). Padrão true;
   * `executarColetando` (sonda, `--version`) passa false: comando curto não abre servidor, e não vale um `ps` por sonda.
   */
  encerrarFugitivos?: boolean;
}): Processo {
  const esperaAteSigkill = o.sigtermParaSigkillMs ?? SIGTERM_PARA_SIGKILL_MS;
  // #194: líder de um grupo próprio (ver gruposVivos). stdin/stdout/stderr continuam pipes.
  // ADR-089: a marca vai no ambiente do líder e é herdada pelos netos (o Bash do modelo, o servidor MCP).
  const marca = prefixoDeMarca === null ? "" : `${prefixoDeMarca}-${randomBytes(6).toString("hex")}`;
  const env = marca === "" ? o.env : { ...o.env, [VARIAVEL_DA_MARCA]: marca };
  const desdeMs = Date.now();
  const filho = spawn(o.bin, [...o.args], { cwd: o.cwd, env, stdio: [o.stdin ?? "pipe", "pipe", "pipe"], detached: true });
  const pid = filho.pid;
  // ADR-089: o relógio antes e depois do spawn cerca o início que o `ps` vai mostrar para este líder.
  if (pid !== undefined) vigiarGrupo(pid, { pid, desdeMs, ateMs: Date.now(), programa: basename(o.bin), marca });
  let stderr = "";
  const linhas = criarDivisorDeLinhas((linha) => o.aoLinha(linha));
  let terminou = false;
  let interrompido = false;
  // ADR-097: o que abriu sessão própria (o Postgres de teste) não sai com o grupo; vai pela marca, sem segurar o fim.
  const levarFugitivos = () => {
    if (pid === undefined || marca === "" || o.encerrarFugitivos === false) return;
    void encerrarFugitivosDoTurno({ pgid: pid, desdeMs, marca }, [...gruposVivos.keys()]);
  };

  filho.stdout?.setEncoding("utf8");
  filho.stdout?.on("data", (pedaco: string) => linhas.empurrar(pedaco));
  filho.stderr?.setEncoding("utf8");
  filho.stderr?.on("data", (pedaco: string) => {
    if (stderr.length < STDERR_MAX_CHARS) stderr += pedaco.slice(0, STDERR_MAX_CHARS - stderr.length);
    o.aoStderr?.(pedaco);
  });
  filho.stdin?.on("error", () => {
    // EPIPE quando o filho morre antes de ler o prompt: o fim do processo já diz o que houve
  });

  let saiu = false;
  const fim = new Promise<FimProcesso>((resolve) => {
    let resolvido = false;
    const concluir = (r: FimProcesso) => {
      if (resolvido) return;
      resolvido = true;
      terminou = true;
      linhas.fechar();
      resolve(r);
    };
    filho.on("error", (erro) => concluir({ exitCode: null, signal: null, stderr, erroSpawn: erro }));
    filho.on("exit", () => {
      saiu = true;
    });
    // 'close' (e não 'exit'): garante que o stdout foi drenado até a última linha
    filho.on("close", (code, signal) => concluir({ exitCode: code, signal, stderr, erroSpawn: null }));
  }).then((r) => {
    // O líder saiu e o stdout fechou: o grupo sai da lista, senão o `exit` do app mataria um grupo novo que reusasse o
    // pid. Quem interrompeu solta o grupo no fim do interromper(), depois do SIGKILL nos netos.
    // revisto em 2026-10-08 (revisão do épico #188, X6): o líder que sai sozinho pode deixar neto no grupo (um
    // `sleep 60 &` do Bash do modelo, um servidor MCP). Fora da lista, o `exit` do app não o mataria mais: o grupo é
    // levado agora, enquanto o pid ainda é nosso (o grupo vive enquanto houver membro, então não foi reusado).
    if (pid !== undefined && !interrompido && soltarGrupo(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // o grupo já acabou junto com o líder
      }
      levarFugitivos();
    }
    return r;
  });

  /** Um neto órfão (servidor MCP que não morreu) pode segurar o pipe aberto depois do exit; fecha à força. */
  const fecharStdio = () => {
    filho.stdout?.destroy();
    filho.stderr?.destroy();
  };

  return {
    pid: pid ?? null,
    escrever(texto) {
      if (!terminou && filho.stdin && !filho.stdin.destroyed) filho.stdin.write(texto);
    },
    fecharStdin() {
      if (filho.stdin && !filho.stdin.destroyed) filho.stdin.end();
    },
    interrompido: () => interrompido,
    async interromper() {
      interrompido = true;
      if (pid === undefined) return;
      if (terminou) {
        // O líder já saiu; um neto do grupo pode estar vivo (Bash do modelo). Leva o grupo, sem esperar — só se ele
        // ainda é nosso (fora da lista, o pid pode já ser de outro).
        if (soltarGrupo(pid)) {
          sinalizarGrupo(pid, "SIGKILL", () => undefined);
          levarFugitivos();
        }
        return;
      }
      // #194: SIGTERM no GRUPO (o CLI e o que ele abriu), com o mesmo 5 s até o SIGKILL.
      sinalizarGrupo(pid, "SIGTERM", () => filho.kill("SIGTERM"));
      const fechou = await Promise.race([fim.then(() => true), dormir(esperaAteSigkill).then(() => false)]);
      if (!fechou) {
        sinalizarGrupo(pid, "SIGKILL", () => { if (!saiu) filho.kill("SIGKILL"); });
        const fechouDepois = await Promise.race([fim.then(() => true), dormir(DEPOIS_DO_SIGKILL_MS).then(() => false)]);
        if (!fechouDepois) fecharStdio();
        await fim;
      }
      // Quem saiu no SIGTERM pode ter deixado neto no grupo: o SIGKILL final não custa nada se não houver.
      sinalizarGrupo(pid, "SIGKILL", () => undefined);
      if (soltarGrupo(pid)) levarFugitivos();
    },
    fim,
  };
}

/** Roda até o fim (ou até `timeoutMs`, quando mata com SIGKILL) e devolve stdout inteiro. Para sonda e `--version`. */
export async function executarColetando(o: {
  bin: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
}): Promise<FimProcesso & { stdout: string; estourouTempo: boolean }> {
  const linhas: string[] = [];
  const proc = iniciarProcesso({ ...o, stdin: "ignore", encerrarFugitivos: false, aoLinha: (l) => linhas.push(l) });
  let estourouTempo = false;
  const relogio = setTimeout(() => {
    estourouTempo = true;
    void proc.interromper();
  }, o.timeoutMs);
  try {
    const r = await proc.fim;
    return { ...r, stdout: linhas.join("\n"), estourouTempo };
  } finally {
    clearTimeout(relogio);
  }
}
