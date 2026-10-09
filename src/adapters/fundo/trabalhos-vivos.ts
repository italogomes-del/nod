import type { LeituraDisco, LeituraMemoria, NivelPressao } from "../../contracts/trabalho.ts";
import { nivelDoDisco, piorNivel } from "../../domain/memoria-mac.ts";

/**
 * O que só o processo sabe dos trabalhos (definido em 2026-10-07, ADR-083): a última ferramenta de cada turno vivo
 * (a faixa mostra "o último passo"; o nome sai do mesmo `turno.atividade` que a tela já recebe) e a última leitura de
 * memória de cada Mac (#194). Nada disso vai para o banco: um reinício zera, e a próxima renovação (30 s) refaz.
 */

/** definido em 2026-10-07: uma leitura de Mac vale 2 min (quatro renovações); depois, aquele Mac não conta mais. */
export const VALIDADE_LEITURA_MS = 120_000;
const TURNOS_GUARDADOS = 1000;

/**
 * O que a pessoa via da última vez: o pior nível de memória e o pior de processador entre os Macs vivos dela, e (#219) o
 * nível do pior disco.
 */
type Visto = { nivel: NivelPressao; processador: NivelPressao | null; disco?: NivelPressao | null };

/**
 * `mudou`: o frame `memoria.mudou` sai (a pílula e a lista relêem). ADR-085: a mudança só do processador também conta
 * — a pílula "Seu Mac está ocupado" e Este Mac dependem dele. `vistoAntes` é o que `desfazer` repõe se o evento não foi
 * gravado (a tx do puxar desfez).
 */
export type MudancaDePressao = { mudou: boolean; nivel: NivelPressao; anterior: NivelPressao | null; processador: NivelPressao | null; disco?: NivelPressao | null; vistoAntes: Visto | null };

type LeituraGuardada = { pessoaId: string; nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; carga: number | null; disco: LeituraDisco | null; em: number };

/** #219: o pior disco entre os Macs: o de menos espaço livre (os limites são absolutos). */
function piorDisco(a: LeituraDisco | null, b: LeituraDisco | null): LeituraDisco | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.livreMb < a.livreMb ? b : a;
}

export function criarTrabalhosVivos(agora: () => number = Date.now) {
  const ferramentas = new Map<string, string>();
  const maquinas = new Map<string, LeituraGuardada>();
  const vistoPorPessoa = new Map<string, Visto>();
  /** ADR-085: quando a pessoa trocou o "uso do Mac" pela última vez (o cache do puxar lido antes disso não vale). */
  const usoTrocadoEm = new Map<string, number>();

  const viva = (m: LeituraGuardada) => agora() - m.em <= VALIDADE_LEITURA_MS;

  function daPessoa(pessoaId: string): { nivel: NivelPressao; totalMb: number; processador: NivelPressao | null; carga: number | null; disco: LeituraDisco | null } | null {
    const vivas = [...maquinas.values()].filter((m) => m.pessoaId === pessoaId && viva(m));
    if (vivas.length === 0) return null;
    // ADR-085: o processador também pelo pior Mac; a carga é a maior por núcleo entre os que mandaram.
    const comCarga = vivas.filter((m) => m.carga !== null);
    return {
      nivel: vivas.reduce<NivelPressao>((p, m) => piorNivel(p, m.nivel) ?? p, "verde"),
      totalMb: vivas.reduce((s, m) => s + m.totalMb, 0),
      processador: vivas.reduce<NivelPressao | null>((p, m) => piorNivel(p, m.processador), null),
      carga: comCarga.length ? Math.max(...comCarga.map((m) => m.carga ?? 0)) : null,
      disco: vivas.reduce<LeituraDisco | null>((p, m) => piorDisco(p, m.disco), null),
    };
  }

  /** ADR-085: a última leitura viva de UM Mac — o `puxar` dele decide se entrega trabalho novo pela leitura dele. */
  function daMaquina(machineId: string): { memoria: NivelPressao; processador: NivelPressao | null; disco: LeituraDisco | null } | null {
    const m = maquinas.get(machineId);
    return m && viva(m) ? { memoria: m.nivel, processador: m.processador, disco: m.disco } : null;
  }

  /** Revisão do #209: leitura vencida sai do mapa (nenhum Mac que sumiu fica para sempre). */
  function podar(): void {
    for (const [id, m] of maquinas) if (!viva(m)) maquinas.delete(id);
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
    /** Guarda a leitura do Mac e diz se o que a pessoa vê mudou (o pior entre os Macs vivos dela). */
    registrarMemoria(pessoaId: string, machineId: string, leitura: LeituraMemoria): MudancaDePressao {
      podar();
      maquinas.set(machineId, { pessoaId, nivel: leitura.nivel, totalMb: leitura.totalMb, processador: leitura.processador?.nivel ?? null, carga: leitura.processador?.carga ?? null, disco: leitura.disco ?? null, em: agora() });
      const juntos = daPessoa(pessoaId);
      // #219: o disco mudar de nível também vira o frame (a lista relê o motivo da espera e Este Mac, o disco).
      const atual: Visto = { nivel: juntos?.nivel ?? leitura.nivel, processador: juntos?.processador ?? null, disco: nivelDoDisco(juntos?.disco) };
      const antes = vistoPorPessoa.get(pessoaId) ?? null;
      vistoPorPessoa.set(pessoaId, atual);
      // O primeiro verde não vira frame: a tela já parte de "sem aviso".
      const nada = atual.nivel === "verde" && (atual.processador === null || atual.processador === "verde") && (atual.disco ?? "verde") === "verde";
      const mudou = antes === null ? !nada : antes.nivel !== atual.nivel || antes.processador !== atual.processador || (antes.disco ?? "verde") !== (atual.disco ?? "verde");
      return { mudou, nivel: atual.nivel, anterior: antes?.nivel ?? null, processador: atual.processador, disco: atual.disco, vistoAntes: antes };
    },
    /** Revisão do #209: o evento da mudança não foi gravado — volta o "visto" para a próxima leitura refazer o frame. */
    desfazer(pessoaId: string, m: MudancaDePressao): void {
      if (!m.mudou) return;
      if (m.vistoAntes) vistoPorPessoa.set(pessoaId, m.vistoAntes);
      else vistoPorPessoa.delete(pessoaId);
    },
    /** Revisão do #209: o Mac desconectou — a leitura dele não segura nem soma mais nada. */
    esquecerMaquina(machineId: string): void {
      maquinas.delete(machineId);
    },
    trocouUsoDoMac(pessoaId: string): void {
      usoTrocadoEm.set(pessoaId, agora());
    },
    usoTrocadoEm(pessoaId: string): number {
      return usoTrocadoEm.get(pessoaId) ?? 0;
    },
    memoria: daPessoa,
    daMaquina,
  };
}

export type TrabalhosVivos = ReturnType<typeof criarTrabalhosVivos>;
