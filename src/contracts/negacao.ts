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
  /**
   * definido em 2026-10-05 (NOD-157): causa que muda a redação sem criar motivo novo no enum (ADR-029). O MCP que
   * responde 401/403 não está "fora": o acesso ao app foi recusado e repetir não adianta.
   */
  causa?: "acesso_recusado";
};
