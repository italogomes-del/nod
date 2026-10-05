import type { EpochMs } from "./ids.ts";

/**
 * Por que uma IA com login feito não serve (definido em 2026-10-05, emenda da ADR-019). A sonda de login diz só
 * "logado"; o TESTE (um turno de uma frase) é o que mostra que a conta responde. Código fechado, nunca o texto do
 * fornecedor: o servidor aceita só estes valores de um Mac e escreve ele mesmo a frase.
 *  - `conta_sem_acesso`: a conta entrou, mas a organização dela desativou o uso por assinatura (medido em produção em
 *    2026-10-05: "Your organization has disabled Claude subscription access for Claude Code");
 *  - `teste_falhou`: o teste não teve resposta por outro motivo (sem rede, limite, erro do fornecedor).
 */
export const CAUSAS_SEM_IA = ["conta_sem_acesso", "teste_falhou"] as const;
export type CausaSemIa = (typeof CAUSAS_SEM_IA)[number];

/**
 * Snapshot da sonda (ADR-019): três estados, motivo escrito, versão do CLI e instante.
 * SEM email nem identidade do fornecedor — proibida para autorização e não gravada.
 * `causa` só existe quando um teste de verdade reprovou uma IA que estava logada; ausente = não há login (ou a sonda
 * de login falhou), que é o `nao_autenticado` de sempre.
 */
export type Inventario =
  | { estado: "ausente"; motivo: string; em: EpochMs }
  | { estado: "nao_autenticado"; motivo: string; versao?: string; causa?: CausaSemIa; em: EpochMs }
  | { estado: "pronto"; versao: string; em: EpochMs };

/** A frase de cada causa, para quem só tem o código (o servidor, ao receber o anúncio de um Mac). */
export const MOTIVO_DA_CAUSA: Record<CausaSemIa, string> = {
  conta_sem_acesso: "A conta entrou, mas está sem acesso: a organização dela desativou o uso por assinatura.",
  teste_falhou: "A conta entrou, mas não respondeu ao teste.",
};
