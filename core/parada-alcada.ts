export type ClasseNegacao = "TERMINAL" | "TRANSITORIA";

export type MotivoNegacao =
  | "capacidade-desligada"
  | "teto-canal"
  | "alcance-insuficiente"
  | "falha-tecnica"
  | "timeout-transporte";

/**
 * Falta de alçada encerra o turno. Falha técnica segue (E5.1 / ADR-013).
 */
export function classificarNegacao(motivo: MotivoNegacao, _agora: number): ClasseNegacao {
  switch (motivo) {
    case "capacidade-desligada":
    case "teto-canal":
    case "alcance-insuficiente":
      return "TERMINAL";
    case "falha-tecnica":
    case "timeout-transporte":
      return "TRANSITORIA";
  }
}
