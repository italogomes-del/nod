import type { EpochMs } from "./ids.ts";
import type { MotivoNegacao } from "./motivos.ts";

export type ClasseNegacao = "ferramenta_negada" | "conector_indisponivel" | "plano_ausente";

/**
 * Fail-closed renderizado (ADR-029): nome, causa e relógio — nunca recusa seca nem silêncio.
 * terminal = o turno encerra (falta de alçada); transitória = o agente segue por outro caminho.
 */
export type Negacao = {
  classe: ClasseNegacao;
  nome: string;
  motivo: MotivoNegacao;
  desde: EpochMs;
  terminal: boolean;
};
