import type { Turno } from "../contracts/turno.ts";
import type { Deps } from "./tipos.ts";

export type NovaRetomada = {
  /** O turno que a retomada continua (retoma_turno_id). */
  original: Turno;
  entradaTexto: string;
  prazoEm: number;
  reenvios?: number;
  /** Executor que já se sabe (resposta a pedido): vai para o turno novo como antes. */
  executor?: "local" | "catcher";
};

/**
 * O ÚNICO jeito de continuar um turno depois de uma decisão (definido em 2026-09-28, 0032). Se já há uma
 * retomada DESTE turno ainda na fila, a nova entrada se junta a ela; senão nasce uma. Antes cada decisão
 * criava a sua: das 11:59 às 12:01 a Ada respondeu cinco vezes, duas com o checklist inteiro repetido,
 * porque acesso ao ClickUp, acesso à agenda e rotinas foram aprovados com segundos de diferença.
 * A trava por turno de origem serializa decisões simultâneas e o assentamento do próprio turno.
 * `nova` diz se nasceu turno (quem chama emite `turno_criado` só nesse caso).
 * Profundidade, confiança, harness, modelo e `sob_procuracao_de` são sempre os do turno de origem
 * (revisão da ADR-047: uma retomada nunca lava a marca nem sai do salto).
 */
export async function enfileirarRetomada(deps: Deps, r: NovaRetomada): Promise<{ turno: Turno | null; nova: boolean }> {
  await deps.repos.turnos.travarRetomadas(r.original.id);
  const naFila = await deps.repos.turnos.retomadaNaFila(r.original.id);
  if (naFila) {
    const juntada = await deps.repos.turnos.juntarEntrada(naFila.id, r.entradaTexto);
    if (juntada) return { turno: juntada, nova: false };
  }
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: r.original.conversaId,
    agenteId: r.original.agenteId,
    origem: "retomada",
    prazoEm: r.prazoEm,
    profundidade: r.original.profundidade,
    entradaTexto: r.entradaTexto,
    entradaConfianca: r.original.entradaConfianca,
    modelo: r.original.modelo,
    harness: r.original.harness,
    retomaTurnoId: r.original.id,
    sobProcuracaoDe: r.original.sobProcuracaoDe ?? null,
    ...(r.reenvios !== undefined ? { reenvios: r.reenvios } : {}),
    ...(r.executor ? { executor: r.executor } : {}),
  });
  return { turno, nova: turno !== null };
}
