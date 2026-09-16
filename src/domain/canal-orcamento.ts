export type DecisaoOrcamento = "permitir" | "recusar" | "resfriar";

export type EstadoOrcamento = {
  ultimosPostsAgenteIds: string[];
  postsSemHumano: number;
  ultimoPostEm: number;
};

/**
 * Quatro regras + quebra-anel. Post de rotina é isento (E12.3).
 */
export function avaliarOrcamento(entrada: {
  estado: EstadoOrcamento;
  candidatoAgenteId: string;
  eRotina: boolean;
  agora: number;
}): DecisaoOrcamento {
  if (entrada.eRotina) return "permitir";
  const anel = [...entrada.estado.ultimosPostsAgenteIds, entrada.candidatoAgenteId];
  if (anel.length >= 3) {
    const last3 = anel.slice(-3);
    if (new Set(last3).size === 3) return "recusar";
  }
  if (entrada.estado.postsSemHumano >= 6) return "resfriar";
  if (entrada.agora - entrada.estado.ultimoPostEm < 8_000) return "resfriar";
  return "permitir";
}
