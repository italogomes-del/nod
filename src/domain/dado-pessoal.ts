import type { ClassificacaoOrigem, SensibilidadeDeclarada } from "../contracts/conector.ts";

export const VERSAO_REGRA_DADO_PESSOAL = 1 as const;

export type Procedencia = {
  conectorId: string;
  fonte: string;
  concessaoId: string;
  declaracao: SensibilidadeDeclarada;
};

/**
 * Classifica por ORIGEM declarada no ato da concessão, nunca por texto (ADR-002).
 * Default fechado: não declarou → TOCA.
 */
export function classificarOrigem(procedencia: Procedencia, _agora: number): ClassificacaoOrigem {
  const toca =
    procedencia.declaracao === "nao-toca" ? false : true;
  return {
    conectorId: procedencia.conectorId,
    fonte: procedencia.fonte,
    concessaoId: procedencia.concessaoId,
    declaracao: procedencia.declaracao,
    tocaDadoPessoal: toca,
    versaoRegra: VERSAO_REGRA_DADO_PESSOAL,
  };
}
