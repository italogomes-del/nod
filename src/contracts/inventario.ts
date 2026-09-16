import type { EpochMs } from "./ids.ts";

/**
 * Snapshot da sonda (ADR-019): três estados, motivo escrito, versão do CLI e instante.
 * SEM email nem identidade do fornecedor — proibida para autorização e não gravada.
 */
export type Inventario =
  | { estado: "ausente"; motivo: string; em: EpochMs }
  | { estado: "nao_autenticado"; motivo: string; versao?: string; em: EpochMs }
  | { estado: "pronto"; versao: string; em: EpochMs };
