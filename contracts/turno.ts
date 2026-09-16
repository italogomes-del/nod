import type { ParId } from "./ids.ts";

/** Os quatro sinais de aceitação — colunas obrigatórias, não opcionais por driver (ADR-009/012). */
export type SinaisAceitacao = {
  attempted: boolean;
  rejected: boolean;
  promptSubmitted: boolean;
  producedOutput: boolean;
};

export type Turno = {
  id: ParId;
  agenteId: string;
  sinais: SinaisAceitacao;
  reenvios: number;
  iniciadoEm: number;
};
