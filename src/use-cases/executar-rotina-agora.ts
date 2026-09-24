import { randomUUID } from "node:crypto";
import type { Executor } from "../contracts/evento.ts";
import type { MotivoBloqueioRotina } from "../contracts/motivos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * `bloqueio` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou o teste — falta conexão ou
 * acesso. Sem turno; a rota devolve o motivo e o card para a web levar a pessoa até o botão.
 */
export type SaidaExecutarAgora = { conversaId: string; turnoId: string | null; bloqueio: { motivo: MotivoBloqueioRotina; propostaId: string | null } | null };

/** definido em 2026-09-17: testar não altera agenda nem pausa; a janela por minuto deduplica cliques e disputa com o scheduler. */
export const executarRotinaAgora: CasoDeUso<{ rotinaId: string; executor: Executor }, SaidaExecutarAgora> = async (deps, input) => {
  const rotina = await deps.repos.rotinas.buscar(input.rotinaId);
  if (!rotina) throw new ErroDeDominio("nao_encontrado");
  if (rotina.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: Math.floor(deps.agora() / 60_000) * 60_000, machineId: randomUUID(), executor: input.executor, preservarAgenda: true });
  const bloqueio = "bloqueada" in r.data ? { motivo: r.data.bloqueada, propostaId: r.data.propostaId } : null;
  return { data: { conversaId: rotina.conversaId, turnoId: "turno" in r.data ? r.data.turno.id : null, bloqueio }, events: r.events };
};
