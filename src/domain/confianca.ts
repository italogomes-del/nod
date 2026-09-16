import type { Confianca } from "../contracts/mensagem.ts";
import type { FerramentaPlano } from "../contracts/plano-turno.ts";

export const VERSAO_REGRA_REDUCAO_POR_CONFIANCA = 1 as const;
export const REGRA_REDUCAO_POR_CONFIANCA = "regra:reducao_por_confianca" as const;

/** Qualquer entrada não confiável contamina o turno (ADR-026: a marca é do CONTEÚDO). */
export function propagarConfianca(entradas: readonly Confianca[]): Confianca {
  return entradas.some((c) => c === "nao_confiavel") ? "nao_confiavel" : "confiavel";
}

/**
 * Regra NOMEADA 'reducao_por_confianca' v1, resolvida no SERVIDOR em emitir-plano-turno, nunca no
 * proxy: turno com entrada não confiável perde toda ferramenta de conector sem readOnlyHint.
 * Ferramentas nod ficam (pedir_aprovacao é justamente o caminho para efeito externo).
 */
export function catalogoReduzido(ferramentas: readonly FerramentaPlano[]): FerramentaPlano[] {
  return ferramentas.filter((f) => f.origem === "nod" || f.readOnlyHint);
}
