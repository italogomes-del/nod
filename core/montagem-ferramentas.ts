export type Ferramenta = { nome: string; conectorId: string; capacidadeId: string };

/**
 * catálogo ∩ allowlist do agente ∩ alcance do canal.
 * Ausente = tudo que o nível acima permite; lista vazia = nada (ADR-013).
 */
export function montarFerramentas(entrada: {
  catalogo: readonly Ferramenta[];
  allowlistAgente: readonly string[] | null;
  alcanceCanal: readonly string[] | null;
  profundidadeMaxima: boolean;
}): Ferramenta[] {
  let lista = [...entrada.catalogo];
  if (entrada.allowlistAgente) {
    lista = lista.filter((f) => entrada.allowlistAgente!.includes(f.nome));
  }
  if (entrada.alcanceCanal) {
    lista = lista.filter((f) => entrada.alcanceCanal!.includes(f.nome));
  }
  if (entrada.profundidadeMaxima) {
    lista = lista.filter((f) => f.nome !== "contatar-agente");
  }
  return lista;
}
