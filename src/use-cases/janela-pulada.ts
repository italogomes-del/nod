import type { RuntimeEvent } from "../contracts/evento.ts";
import type { MotivoNaoRodouRotina } from "../contracts/motivos.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { autoriaPessoa, evento } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-10-16 (NOD-274, C9): a regra que registra a janela que o agendador pulou. */
export const REGRA_JANELA_PULADA = "regra:janela-pulada" as const;

const DUAS_HORAS_MS = 2 * 60 * 60_000;

/**
 * definido em 2026-10-16 (NOD-274, C9; decidido em 15/10): o prazo da frente que espera um colega — 2 períodos do cron,
 * no mínimo 2 h. O período é o intervalo da janela agendada até a seguinte (o cron irregular usa o intervalo de agora).
 */
export function prazoDoColega(rotina: Pick<Rotina, "cron" | "fusoIana">, instanteAgendado: number): number {
  const seguinte = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: instanteAgendado });
  return Math.max(2 * (seguinte - instanteAgendado), DUAS_HORAS_MS);
}

/**
 * definido em 2026-10-16 (NOD-274, C9): a janela que o agendador pula porque a execução anterior segue aberta (ADR-045)
 * fica no histórico — 'nao_rodou'/'execucao_anterior_aberta', sem turno, silenciosa no chat (como sem_pendencia). A
 * janela NÃO é reivindicada (ADR-045: pular só reagenda); uma linha por janela pelo registro que já existir dela.
 */
export async function registrarJanelaPulada(deps: Deps, p: { rotina: Rotina; instanteAgendado: number }): Promise<RuntimeEvent[]> {
  const { rotina, instanteAgendado } = p;
  if (await deps.repos.rotinaExecucoes.daJanela(rotina.id, instanteAgendado)) return [];
  const motivo: MotivoNaoRodouRotina = "execucao_anterior_aberta";
  const agora = deps.agora();
  const execucao = await deps.repos.rotinaExecucoes.registrar({ rotinaId: rotina.id, instanteAgendado, turnoId: null, desfecho: "nao_rodou", motivo, em: agora });
  if (!execucao) return [];
  await deps.repos.rotinaExecucoes.podar(rotina.id);
  const dados = { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: "nao_rodou", motivo, instanteAgendado };
  return [evento(deps, "rotina_executou", autoriaPessoa(deps.escopo.pessoaId, REGRA_JANELA_PULADA), dados, { conversaId: rotina.conversaId })];
}
