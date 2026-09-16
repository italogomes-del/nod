import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { ClassificacaoOrigem } from "../contracts/conector.ts";
import type { ParId } from "../contracts/ids.ts";

export type PropostaItem = {
  texto: string;
  destino: string;
};

/**
 * Monta itens tipados. Origem sensível nasce desmarcada (E4.2).
 * Nunca devolve um campo de texto único.
 */
export function montarItens(entrada: {
  tenantId: string;
  decisaoId: ParId;
  propostas: readonly PropostaItem[];
  origem: ClassificacaoOrigem;
  agora: number;
}): ItemAprovacao[] {
  return entrada.propostas.map((p, i) => ({
    id: { tenantId: entrada.tenantId, id: `${entrada.decisaoId.id}:item:${i}` },
    decisaoId: entrada.decisaoId,
    texto: p.texto,
    estado: "proposto",
    origem: entrada.origem,
    autoriaMarcacao: null,
    nasceDesmarcado: entrada.origem.tocaDadoPessoal,
  }));
}
