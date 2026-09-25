import type { FerramentaPlano } from "../contracts/plano-turno.ts";
import type { Profundidade } from "../contracts/turno.ts";

/**
 * Ferramentas que abrem outro salto: some ESTRUTURALMENTE em profundidade 1 (E12.4, sem flag de bypass).
 * delegar_tarefa desde 2026-09-24 (ADR-047): quem cumpre uma tarefa delegada não a repassa.
 */
export const FERRAMENTAS_DE_SALTO = ["perguntar_a_bot", "encaminhar", "delegar_tarefa"] as const;

/**
 * catálogo ∩ allowlist do agente ∩ alcance do canal, depois a poda por profundidade (ADR-013).
 * Ausente (null) = tudo que o nível acima permite; lista vazia = nada.
 */
export function montarFerramentas(entrada: {
  catalogo: readonly FerramentaPlano[];
  allowlistAgente: readonly string[] | null;
  alcanceCanal: readonly string[] | null;
  profundidade: Profundidade;
}): FerramentaPlano[] {
  let lista = [...entrada.catalogo];
  const allow = entrada.allowlistAgente;
  if (allow) lista = lista.filter((f) => allow.includes(f.nome));
  const alcance = entrada.alcanceCanal;
  if (alcance) lista = lista.filter((f) => alcance.includes(f.nome));
  if (entrada.profundidade >= 1) {
    lista = lista.filter((f) => !(FERRAMENTAS_DE_SALTO as readonly string[]).includes(f.nome));
  }
  return lista;
}
