import type { Procuracao } from "../contracts/concessao.ts";

export type PedidoDelegacao = {
  agenteConcedenteId: string;
  agenteBeneficiarioId: string;
  classe: string;
  gastoHoje: number;
};

export type ResultadoDelegacao =
  | { autorizado: true; procuracaoId: string }
  | { autorizado: false; motivo: "sem_procuracao" | "classe_nao_permitida" | "teto_diario" };

/**
 * Fail-closed (ADR-025): sem linha de procuração, negado. Bot-a-bot entre donos diferentes só
 * com procuração prévia no Postgres; 'cota_esgotada' é estado de RESULTADO, aqui é teto_diario.
 */
export function autorizarDelegacao(procuracoes: readonly Procuracao[], pedido: PedidoDelegacao): ResultadoDelegacao {
  const candidatas = procuracoes.filter((p) => p.agenteConcedenteId === pedido.agenteConcedenteId && p.agenteBeneficiarioId === pedido.agenteBeneficiarioId);
  if (candidatas.length === 0) return { autorizado: false, motivo: "sem_procuracao" };
  const comClasse = candidatas.filter((p) => p.classesPermitidas.includes(pedido.classe));
  if (comClasse.length === 0) return { autorizado: false, motivo: "classe_nao_permitida" };
  const comTeto = comClasse.find((p) => pedido.gastoHoje < p.tetoDiario);
  if (!comTeto) return { autorizado: false, motivo: "teto_diario" };
  return { autorizado: true, procuracaoId: comTeto.id };
}
