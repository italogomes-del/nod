import type { CorAgente, FormaAgente } from "../contracts/agente.ts";

export const FORMAS: readonly FormaAgente[] = ["shape-square", "shape-hex", "shape-circle"];
export const CORES: readonly CorAgente[] = ["c-red", "c-pink", "c-purple", "c-blue", "c-teal", "c-green", "c-orange", "c-black"];

/** Round-robin sem repetir enquanto houver forma livre. */
export function proximaForma(usadas: readonly FormaAgente[]): FormaAgente {
  return FORMAS.find((f) => !usadas.includes(f)) ?? "shape-square";
}

export function proximaCor(usadas: readonly CorAgente[]): CorAgente {
  return CORES.find((c) => !usadas.includes(c)) ?? "c-red";
}

/**
 * O que o agente NÃO vai fazer, a partir de dado TIPADO (conectores pedidos pela ferramenta
 * pedir_acesso), nunca de regex sobre o texto (Regra 9; tituloDe/proporPapel apagados em 2026-09-16).
 */
export function montarNaoDeveFazer(entrada: { conectoresPedidos: readonly { nome: string }[] }): string[] {
  const linhas = ["Nada sai para fora sem a sua confirmação.", "Não herda nenhuma credencial sua — nasce vazio."];
  if (entrada.conectoresPedidos.length === 0) {
    linhas.push("Não fala com nenhum app até você conectar e ligar cada capacidade.");
    return linhas;
  }
  for (const c of entrada.conectoresPedidos) {
    linhas.push(`${c.nome}: nenhuma capacidade ligada ainda — exatamente o que ele não poderá fazer até você ligar uma a uma.`);
  }
  return linhas;
}
