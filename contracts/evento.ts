import type { TenantId } from "./ids.ts";

/** Quem decidiu — copiado literalmente de contracts.ts:174 (ADR-012). */
export type DecisionSource =
  | "user"
  | "auto"
  | "timeout"
  | "system"
  | "unavailable"
  | "peer";

/**
 * Autoria composta na forma da mensagem (ADR-012 / E6).
 * Nenhuma regra pergunta "foi uma pessoa?" olhando só um campo.
 */
export type Autoria =
  | { tipo: "pessoa"; pessoaId: string }
  | { tipo: "agente"; agenteId: string; porPessoaId: string | null };

export type RuntimeEvent = {
  tenantId: TenantId;
  id: string;
  createdAt: number;
  /** O que foi NEGADO — copiado de contracts.ts:114. */
  denials: string[];
  source: DecisionSource;
  autoria: Autoria;
  kind: string;
};
