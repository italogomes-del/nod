import { randomUUID } from "node:crypto";
import type { Executor } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

/** definido em 2026-09-17: testar não altera agenda nem pausa; a janela por minuto deduplica cliques e disputa com o scheduler. */
export const executarRotinaAgora: CasoDeUso<{ rotinaId: string; executor: Executor }, { conversaId: string; turnoId: string | null }> = async (deps, input) => {
  const rotina = await deps.repos.rotinas.buscar(input.rotinaId);
  if (!rotina) throw new ErroDeDominio("nao_encontrado");
  if (rotina.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: Math.floor(deps.agora() / 60_000) * 60_000, machineId: randomUUID(), executor: input.executor, preservarAgenda: true });
  return { data: { conversaId: rotina.conversaId, turnoId: "turno" in r.data ? r.data.turno.id : null }, events: r.events };
};
