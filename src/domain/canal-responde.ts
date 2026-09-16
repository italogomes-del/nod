export type PoliticaResposta = "mencao" | "sempre" | "nunca";

/**
 * Menção explícita sempre vence (E12.1).
 */
export function quemResponde(entrada: {
  texto: string;
  membrosAgenteIds: readonly string[];
  nomes: Readonly<Record<string, string>>;
  politica: PoliticaResposta;
}): string[] {
  const mencionados = entrada.membrosAgenteIds.filter((id) => {
    const nome = entrada.nomes[id];
    if (!nome) return false;
    return new RegExp(`@${nome}\\b`, "i").test(entrada.texto);
  });
  if (mencionados.length > 0) return mencionados;
  if (entrada.politica === "sempre") return [...entrada.membrosAgenteIds];
  return [];
}
