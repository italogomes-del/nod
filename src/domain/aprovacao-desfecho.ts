import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";

const DESFECHO_HUMANO: Record<DesfechoItem, string> = {
  executado: "executado",
  retirado_pela_pessoa: "retirado pela pessoa",
  sensivel_nao_aprovado: "sensível, não aprovado",
  falhou_na_execucao: "falhou na execução",
};

/**
 * "Marlon aprovou 2 de 3; não enviado: bia (retirado pela pessoa)". O resultado escrito diz o que
 * NÃO saiu, item a item (E4.1). Item sem desfecho conta como não executado.
 */
export function redigirDesfechoAprovacao(entrada: { itens: readonly ItemAprovacao[]; aprovadorNome: string; agora: number }): string {
  const total = entrada.itens.length;
  const executados = entrada.itens.filter((i) => i.desfecho === "executado").length;
  const naoSaiu = entrada.itens
    .filter((i) => i.desfecho !== "executado")
    .map((i) => `${i.textoFinal} (${i.desfecho ? DESFECHO_HUMANO[i.desfecho] : "sem desfecho"})`);
  const cabeca = `${entrada.aprovadorNome} aprovou ${executados} de ${total}`;
  return naoSaiu.length === 0 ? `${cabeca}.` : `${cabeca}; não enviado: ${naoSaiu.join("; ")}.`;
}
