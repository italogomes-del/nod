import type { Agente } from "../contracts/agente.ts";

/**
 * Estado do agente em uma linha para a frota: 'sem acessos · nunca executou' até a primeira
 * concessão e a primeira execução. Contagens, nunca interpretação de texto.
 */
export function descricaoEstado(_agente: Pick<Agente, "confirmado">, estado: { concessoes: number; execucoes: number }): string {
  const acessos = estado.concessoes === 0 ? "sem acessos" : estado.concessoes === 1 ? "1 acesso" : `${estado.concessoes} acessos`;
  const execucoes = estado.execucoes === 0 ? "nunca executou" : estado.execucoes === 1 ? "executou 1 vez" : `executou ${estado.execucoes} vezes`;
  return `${acessos} · ${execucoes}`;
}
