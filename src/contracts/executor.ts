import type { Inventario } from "./inventario.ts";

/** Os dois executores do SPI (ADR-012/014): catcher (sem CLI, sem custo) e claude-cli (real, na assinatura da pessoa). */
export type IdExecutor = "catcher" | "claude-cli";

/** Uma opção do interruptor: o que a sonda daquele driver disse por último (ADR-019/029: estado escrito, nunca ícone). */
export type OpcaoExecutor = { id: IdExecutor; custo: "zero" | "real"; inventario: Inventario };

/**
 * Estado do interruptor de executor (definido em 2026-09-16): é da MÁQUINA (um processo, um registry),
 * não da pessoa. `recusa` é o motivo escrito quando a última troca pedida não pôde acontecer.
 */
export type EstadoExecutor = { atual: IdExecutor; opcoes: OpcaoExecutor[]; recusa: string | null };
