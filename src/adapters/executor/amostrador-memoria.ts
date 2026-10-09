import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism, loadavg } from "node:os";
import type { LeituraMemoria, LeituraProcessador, NivelPressao } from "../../contracts/trabalho.ts";
import { cargaDoLoadavg, leituraDoTurno, nivelDaMemoriaLinux, nivelDaPressao, nivelDoProcessador, pressaoSimulada, somarPorGrupo } from "../../domain/memoria-mac.ts";
import { log } from "../../obs/log.ts";

/**
 * Amostrador de memória da máquina (definido em 2026-10-07, ADR-083 §4, #194; decisão S8 da revisão de engenharia):
 * UM por máquina, a cada 30 s, em vez de um `ps -A` por laço (25 laços = 25 `ps` a cada 30 s no pico do diário). Lê o
 * nível de pressão do macOS e a memória somada por grupo de processos; cada renovação leva a última leitura, com a
 * linha do próprio turno. Nada aqui para trabalho nenhum: o servidor decide o que fazer com o nível.
 *
 * Preguiçoso: só começa a amostrar na primeira leitura pedida. revisto em 2026-10-08 (ADR-085): no macOS a leitura da
 * máquina vai em cada `puxar`, então ele amostra desde o primeiro laço; fora do macOS (o servidor em Linux), sem
 * NOD_SIMULAR_*, `daMaquina` não devolve nada e nenhum `sysctl` roda por ela.
 */
export type FonteMemoria = {
  /** A última leitura, com a linha deste turno quando ele tem grupo (null = turno sem processo próprio). */
  leitura(turnoId: string, grupo: number | null): LeituraMemoria;
  /**
   * definido em 2026-10-08 (ADR-085): a leitura da máquina sem turno (o nível, o total dos grupos vivos e o processador),
   * que vai no `puxar`: com ela o servidor sabe se o Mac está apertado antes de entregar trabalho novo.
   */
  daMaquina?(): LeituraMemoria | undefined;
  /** O turno acabou: o grupo dele sai da soma. */
  soltar(turnoId: string): void;
  /**
   * definido em 2026-10-08 (revisão do épico #188, X5): o número da amostra, que só sobe quando o nível ou a memória
   * de um grupo vivo mudou. O laço renova a cada 1 s no app e só manda a leitura quando este número muda (ou a cada
   * 30 s); antes a mesma leitura ia em toda renovação.
   */
  amostra(): number;
};

export type AmostradorMemoria = FonteMemoria & {
  /** Uma amostra agora (o timer chama sozinho; os testes chamam direto). */
  amostrar(): Promise<void>;
  parar(): void;
};

/** definido em 2026-10-07 (ADR-083 §4): de 30 em 30 s, a mesma batida da renovação do lease (RENOVACAO_MS). */
export const INTERVALO_AMOSTRA_MEMORIA_MS = 30_000;
/** definido em 2026-10-07: `sysctl` e `ps` respondem em milissegundos; 5 s só segura um Mac travado. */
const PRAZO_COMANDO_MS = 5_000;

export type Executar = (bin: string, args: readonly string[]) => Promise<string>;

const executarPadrao: Executar = (bin, args) =>
  new Promise((resolver, rejeitar) => {
    execFile(bin, [...args], { timeout: PRAZO_COMANDO_MS, maxBuffer: 8 * 1024 * 1024 }, (erro, stdout) => (erro ? rejeitar(erro) : resolver(String(stdout))));
  });

export function criarAmostradorMemoria(o: { env: Record<string, string | undefined>; intervaloMs?: number; executar?: Executar; nucleos?: number; plataforma?: NodeJS.Platform; lerNoLinux?: boolean; lerArquivo?: (caminho: string) => Promise<string>; cargaLinux?: () => number }): AmostradorMemoria {
  const nucleos = o.nucleos ?? availableParallelism();
  // ADR-085: a leitura da máquina só existe no macOS (ou simulada); fora dele seria um "verde" que ninguém mediu.
  // ADR-088: o motor numa máquina Linux também lê (memória pelo /proc/meminfo, processador pelo os.loadavg). Só quando
  // quem cria pede (`lerNoLinux`, o motor sem janela): o servidor em Linux continua sem leitura, como na revisão do #209.
  const plataforma = o.plataforma ?? process.platform;
  const linux = plataforma === "linux" && o.lerNoLinux === true;
  const daMaquinaLe = plataforma === "darwin" || linux || Boolean(o.env.NOD_SIMULAR_PRESSAO) || Boolean(o.env.NOD_SIMULAR_PROCESSADOR);
  const lerArquivo = o.lerArquivo ?? ((caminho: string) => readFile(caminho, "utf8"));
  const executar = o.executar ?? executarPadrao;
  const intervaloMs = o.intervaloMs ?? INTERVALO_AMOSTRA_MEMORIA_MS;
  const grupos = new Map<string, number>();
  let nivel: NivelPressao = "verde";
  let rss = new Map<number, number>();
  let processador: LeituraProcessador | null = null;
  let numeroDaAmostra = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let amostrando: Promise<void> | null = null;
  let parado = false;
  // Um aviso por motivo e por processo: fora do macOS o `sysctl` falha a cada 30 s.
  const avisados = new Set<string>();
  const avisar = (evento: string, erro: unknown) => {
    if (avisados.has(evento)) return;
    avisados.add(evento);
    log("aviso", evento, { erro: erro instanceof Error ? erro.name : "desconhecido" });
  };

  async function lerNivel(): Promise<NivelPressao> {
    const simulada = pressaoSimulada(o.env.NOD_SIMULAR_PRESSAO);
    if (simulada) return simulada;
    try {
      if (linux) return nivelDaMemoriaLinux(await lerArquivo("/proc/meminfo"));
      return nivelDaPressao(await executar("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]));
    } catch (erro) {
      // Falha ou fora do macOS: verde, nunca um aviso que a máquina não deu.
      avisar("memoria_pressao_sem_leitura", erro);
      return "verde";
    }
  }

  /**
   * ADR-085: a carga do último minuto por núcleo. `NOD_SIMULAR_PROCESSADOR` (carga por núcleo, ex.: 1.2) força a leitura
   * para testes e UAT, como `NOD_SIMULAR_PRESSAO` faz com a memória. Falha = sem leitura (null), nunca um aviso falso.
   */
  async function lerProcessador(): Promise<LeituraProcessador | null> {
    const simulado = Number(o.env.NOD_SIMULAR_PROCESSADOR);
    if (o.env.NOD_SIMULAR_PROCESSADOR && Number.isFinite(simulado) && simulado >= 0) return nivelDoProcessador(simulado * nucleos, nucleos);
    try {
      if (linux) return nivelDoProcessador((o.cargaLinux ?? (() => loadavg()[0] ?? 0))(), nucleos);
      const carga = cargaDoLoadavg(await executar("/usr/sbin/sysctl", ["-n", "vm.loadavg"]));
      return carga === null ? null : nivelDoProcessador(carga, nucleos);
    } catch (erro) {
      avisar("processador_sem_leitura", erro);
      return null;
    }
  }

  async function lerGrupos(): Promise<Map<number, number>> {
    if (grupos.size === 0) return new Map();
    try {
      return somarPorGrupo(await executar("/bin/ps", ["-A", "-o", "pgid=,rss="]));
    } catch (erro) {
      avisar("memoria_ps_sem_leitura", erro);
      return rss;
    }
  }

  function amostrar(): Promise<void> {
    amostrando ??= (async () => {
      try {
        const [n, r, p] = await Promise.all([lerNivel(), lerGrupos(), lerProcessador()]);
        if (n !== nivel || p?.nivel !== processador?.nivel || [...grupos.values()].some((g) => r.get(g) !== rss.get(g))) numeroDaAmostra += 1;
        nivel = n;
        rss = r;
        processador = p;
      } finally {
        amostrando = null;
      }
    })();
    return amostrando;
  }

  function comecar(): void {
    if (timer || parado) return;
    timer = setInterval(() => void amostrar(), intervaloMs);
    timer.unref?.();
    void amostrar();
  }

  return {
    leitura(turnoId, grupo) {
      const novo = grupo !== null && grupos.get(turnoId) !== grupo;
      if (novo) grupos.set(turnoId, grupo);
      // O grupo entra antes da primeira amostra: senão ela sairia sem `ps` (nenhum grupo ainda).
      comecar();
      // Grupo novo: a próxima amostra já o mede, sem esperar a batida de 30 s.
      if (novo && !rss.has(grupo)) void amostrar();
      return leituraDoTurno({ nivel, rssPorGrupo: rss, gruposVivos: [...grupos.values()], turnoId, grupo, processador });
    },
    daMaquina() {
      if (!daMaquinaLe) return undefined;
      comecar();
      return leituraDoTurno({ nivel, rssPorGrupo: rss, gruposVivos: [...grupos.values()], turnoId: null, grupo: null, processador });
    },
    soltar(turnoId) {
      grupos.delete(turnoId);
    },
    amostra: () => numeroDaAmostra,
    amostrar,
    parar() {
      parado = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
