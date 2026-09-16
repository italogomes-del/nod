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
  const filho = spawn(o.bin, [...o.args], { cwd: o.cwd, env: o.env, stdio: [o.stdin ?? "pipe", "pipe", "pipe"] });
  let stderr = "";
  let resto = "";
  let terminou = false;
  let interrompido = false;

  filho.stdout?.setEncoding("utf8");
  filho.stdout?.on("data", (pedaco: string) => {
    resto += pedaco;
    let quebra = resto.indexOf("\n");
    while (quebra !== -1) {
      o.aoLinha(resto.slice(0, quebra));
      resto = resto.slice(quebra + 1);
      quebra = resto.indexOf("\n");
    }
  });
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
      if (resto.trim() !== "") o.aoLinha(resto);
      resto = "";
      resolve(r);
    };
    filho.on("error", (erro) => concluir({ exitCode: null, signal: null, stderr, erroSpawn: erro }));
    filho.on("exit", () => {
      saiu = true;
    });
    // 'close' (e não 'exit'): garante que o stdout foi drenado até a última linha
    filho.on("close", (code, signal) => concluir({ exitCode: code, signal, stderr, erroSpawn: null }));
  });

  /** Um neto órfão (servidor MCP que não morreu) pode segurar o pipe aberto depois do exit; fecha à força. */
  const fecharStdio = () => {
    filho.stdout?.destroy();
    filho.stderr?.destroy();
  };

  return {
    pid: filho.pid ?? null,
    escrever(texto) {
      if (!terminou && filho.stdin && !filho.stdin.destroyed) filho.stdin.write(texto);
    },
    fecharStdin() {
      if (filho.stdin && !filho.stdin.destroyed) filho.stdin.end();
    },
    interrompido: () => interrompido,
    async interromper() {
      interrompido = true;
      if (terminou || filho.pid === undefined) return;
      filho.kill("SIGTERM");
      const fechou = await Promise.race([fim.then(() => true), dormir(esperaAteSigkill).then(() => false)]);
      if (fechou) return;
      if (!saiu) filho.kill("SIGKILL");
      const fechouDepois = await Promise.race([fim.then(() => true), dormir(DEPOIS_DO_SIGKILL_MS).then(() => false)]);
      if (!fechouDepois) fecharStdio();
      await fim;
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
