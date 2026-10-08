import type { LeituraMemoria, NivelPressao } from "../../contracts/trabalho.ts";
import { piorNivel } from "../../domain/memoria-mac.ts";

/**
 * O que só o processo sabe dos trabalhos (definido em 2026-10-07, ADR-083): a última ferramenta de cada turno vivo
 * (a faixa mostra "o último passo"; o nome sai do mesmo `turno.atividade` que a tela já recebe) e a última leitura de
 * memória de cada Mac (#194). Nada disso vai para o banco: um reinício zera, e a próxima renovação (30 s) refaz.
 */

/** definido em 2026-10-07: uma leitura de Mac vale 2 min (quatro renovações); depois, aquele Mac não conta mais. */
export const VALIDADE_LEITURA_MS = 120_000;
const TURNOS_GUARDADOS = 1000;
const GRAVIDADE: Record<NivelPressao, number> = { verde: 0, amarela: 1, vermelha: 2 };

export type MudancaDePressao = { mudou: boolean; nivel: NivelPressao; anterior: NivelPressao | null };

export function criarTrabalhosVivos(agora: () => number = Date.now) {
  const ferramentas = new Map<string, string>();
  const maquinas = new Map<string, { pessoaId: string; nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; carga: number | null; em: number }>();
  /** O nível que a pessoa via da última vez (o pior entre os Macs dela): o frame sai só quando ele muda. */
  const vistoPorPessoa = new Map<string, NivelPressao>();

  function daPessoa(pessoaId: string): { nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; carga: number | null } | null {
    const vivas = [...maquinas.values()].filter((m) => m.pessoaId === pessoaId && agora() - m.em <= VALIDADE_LEITURA_MS);
    if (vivas.length === 0) return null;
    const pior = vivas.reduce((a, b) => (GRAVIDADE[b.nivel] > GRAVIDADE[a.nivel] ? b : a));
    // ADR-085: o processador também pelo pior Mac; a carga é a maior por núcleo entre os que mandaram.
    const comCarga = vivas.filter((m) => m.carga !== null);
    return {
      nivel: pior.nivel,
      totalMb: vivas.reduce((s, m) => s + m.totalMb, 0),
      processador: vivas.reduce<NivelPressao | null>((p, m) => piorNivel(p, m.processador), null),
      carga: comCarga.length ? Math.max(...comCarga.map((m) => m.carga ?? 0)) : null,
    };
  }

  /** ADR-085: a última leitura viva de UM Mac — o `puxar` dele decide se entrega trabalho novo pela leitura dele. */
  function daMaquina(machineId: string): { memoria: NivelPressao; processador: NivelPressao | null } | null {
    const m = maquinas.get(machineId);
    return m && agora() - m.em <= VALIDADE_LEITURA_MS ? { memoria: m.nivel, processador: m.processador } : null;
  }

  return {
    ferramenta(turnoId: string, nome: string): void {
      ferramentas.delete(turnoId);
      ferramentas.set(turnoId, nome);
      if (ferramentas.size > TURNOS_GUARDADOS) ferramentas.delete(ferramentas.keys().next().value!);
    },
    esquecerTurno(turnoId: string): void {
      ferramentas.delete(turnoId);
    },
    ultimaFerramenta(turnoId: string): string | null {
      return ferramentas.get(turnoId) ?? null;
    },
    /** Guarda a leitura do Mac e diz se o nível que a pessoa vê mudou (o pior entre os Macs vivos dela). */
    registrarMemoria(pessoaId: string, machineId: string, leitura: LeituraMemoria): MudancaDePressao {
      maquinas.set(machineId, { pessoaId, nivel: leitura.nivel, totalMb: leitura.totalMb, processador: leitura.processador?.nivel ?? null, carga: leitura.processador?.carga ?? null, em: agora() });
      const atual = daPessoa(pessoaId)?.nivel ?? leitura.nivel;
      const anterior = vistoPorPessoa.get(pessoaId) ?? null;
      vistoPorPessoa.set(pessoaId, atual);
      return { mudou: anterior !== atual && !(anterior === null && atual === "verde"), nivel: atual, anterior };
    },
    memoria: daPessoa,
    daMaquina,
  };
}

export type TrabalhosVivos = ReturnType<typeof criarTrabalhosVivos>;
