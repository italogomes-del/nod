import type { ParId } from "./ids.ts";
import type { DecisionSource } from "./evento.ts";

export type DecisaoId = ParId;

export type DecisaoEstado = "pendente" | "decidida" | "vencida" | "reaberta";

export type Decisao = {
  id: DecisaoId;
  estado: DecisaoEstado;
  expiresAt: number;
  source: DecisionSource;
  agenteId: string;
  criadoEm: number;
};
