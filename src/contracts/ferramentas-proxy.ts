import type { FerramentaPlano } from "./plano-turno.ts";

/**
 * Ferramenta atendida pelo PRÓPRIO proxy do turno (definido em 2026-09-28). Não entra em FERRAMENTAS_NOD
 * (lista fechada com caso de uso no servidor, EMENDA 5): o resto que ela devolve já passou pela decisão do
 * servidor na chamada original, e só o proxy o tem. É o equivalente do arquivo em que o Claude Code do
 * terminal salva a resposta grande e o modelo lê por partes.
 */
export const FERRAMENTA_LER_MAIS: FerramentaPlano = {
  nome: "ler_mais",
  nomeMcp: "mcp__nod__ler_mais",
  origem: "proxy",
  conectorId: null,
  readOnlyHint: true,
  tocaAprendiz: false,
  schema: {
    type: "object",
    description: "Lê a próxima parte de uma resposta de ferramenta que o nod cortou por tamanho NESTE turno. Use o ref da marca [nod: …] que veio no fim da resposta cortada; chame de novo até a marca dizer que é a última parte.",
    properties: { ref: { type: "string", description: "O ref que a marca de corte indicou, por exemplo r1." } },
    required: ["ref"],
    additionalProperties: false,
  },
};
