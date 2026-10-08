import { spawn } from "node:child_process";

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
 * Grupos de processo vivos (definido em 2026-10-07, ADR-081, #194). Cada filho nasce líder do próprio grupo
 * (`detached: true`), para o amostrador somar a memória do grupo e o Parar levar junto os netos (servidor MCP, Bash do
 * modelo). O preço do `detached` é o filho não morrer com o app: o `exit` do processo do nod (app do Mac ou servidor)
 * mata com SIGKILL todo grupo que ainda estiver aqui. `process.kill` é síncrono, o único tipo de trabalho que o `exit`
 * permite.
 */
const gruposVivos = new Set<number>();
let ganchoDeSaida = false;

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

function vigiarGrupo(pid: number): void {
  gruposVivos.add(pid);
  if (ganchoDeSaida) return;
  ganchoDeSaida = true;
  process.on("exit", () => {
    for (const g of gruposVivos) {
      try {
        process.kill(-g, "SIGKILL");
      } catch {
        // o grupo já acabou
      }
    }
  });
}

/** Os grupos que este processo do nod ainda tem vivos (os testes conferem que o Parar os solta). */
export function gruposDeProcessoVivos(): number[] {
  return [...gruposVivos];
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
  /** 'pipe' (default) para mandar o prompt; 'ignore' para a sonda com prompt como argumento. */
  stdin?: "pipe" | "ignore";
  /**
   * Espera entre SIGTERM e SIGKILL; default SIGTERM_PARA_SIGKILL_MS. Só testes reduzem: quem
   * cronometra `interromper()` precisa de um relógio MENOR que o do código — afirmar contra o
   * mesmo 5 s é corrida, não asserção (a suíte piscava com 'expected 5020 to be less than 5000').
   */
  sigtermParaSigkillMs?: number;
}): Processo {
  const esperaAteSigkill = o.sigtermParaSigkillMs ?? SIGTERM_PARA_SIGKILL_MS;
  // #194: líder de um grupo próprio (ver gruposVivos). stdin/stdout/stderr continuam pipes.
  const filho = spawn(o.bin, [...o.args], { cwd: o.cwd, env: o.env, stdio: [o.stdin ?? "pipe", "pipe", "pipe"], detached: true });
  const pid = filho.pid;
  if (pid !== undefined) vigiarGrupo(pid);
  let stderr = "";
  const linhas = criarDivisorDeLinhas((linha) => o.aoLinha(linha));
  let terminou = false;
  let interrompido = false;

  filho.stdout?.setEncoding("utf8");
  filho.stdout?.on("data", (pedaco: string) => linhas.empurrar(pedaco));
  filho.stderr?.setEncoding("utf8");
  filho.stderr?.on("data", (pedaco: string) => {
    if (stderr.length < STDERR_MAX_CHARS) stderr += pedaco.slice(0, STDERR_MAX_CHARS - stderr.length);
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
    if (pid !== undefined && !interrompido) gruposVivos.delete(pid);
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
        if (gruposVivos.delete(pid)) sinalizarGrupo(pid, "SIGKILL", () => undefined);
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
      gruposVivos.delete(pid);
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
  const proc = iniciarProcesso({ ...o, stdin: "ignore", aoLinha: (l) => linhas.push(l) });
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
