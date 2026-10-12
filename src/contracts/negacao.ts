import type { EpochMs } from "./ids.ts";
import type { MotivoNegacao } from "./motivos.ts";

/**
 * definido em 2026-10-11: por que o nod barrou uma ferramenta nativa, lido do motivo que o hook devolveu ao modelo
 * (src/domain/negacao-nativa.ts). Muda a redação da pílula sem criar motivo novo no enum (ADR-029).
 */
export const CAUSAS_NATIVAS = ["git_fora_da_pasta", "espera_com_sleep", "esperando_aprovacao", "recusado_pela_pessoa", "credencial", "fora_do_plano", "sem_conferencia", "outra"] as const;
export type CausaNativa = (typeof CAUSAS_NATIVAS)[number];

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
  causa?: "acesso_recusado" | CausaNativa;
  /** definido em 2026-10-11: quantas vezes a mesma causa barrou a mesma ferramenta no turno (uma pílula só). */
  vezes?: number;
};
