import type { Executor } from "../contracts/evento.ts";
import type { JanelaRotina } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  rotina_id: string;
  instante_agendado: Date;
  executor: Executor;
  machine_id: string;
  turno_id: string | null;
}

/** PENDÊNCIA DE CONTRATO: JanelaRotina.turnoId é `string`, mas a janela é reivindicada ANTES do turno nascer. */
export type JanelaReivindicada = Omit<JanelaRotina, "turnoId"> & { turnoId: string | null };

const paraJanela = (l: Linha): JanelaReivindicada => ({
  tenantId: l.tenant_id,
  rotinaId: l.rotina_id,
  instanteAgendado: ms(l.instante_agendado),
  executor: l.executor,
  machineId: l.machine_id,
  turnoId: l.turno_id,
});

/**
 * Trava de execução (ADR-011): UNIQUE (tenant_id, rotina_id, instante_agendado). INSERT ... ON
 * CONFLICT DO NOTHING — a segunda máquina recebe false, sem erro, e cala. Registra QUAL executor
 * ganhou. Provado em tests/concurrency/rotina-janela-unique.test.ts com duas conexões.
 */
export function rotinaJanelasRepo(conn: Conn, escopo: Escopo) {
  return {
    async reivindicar(p: { rotinaId: string; instanteAgendado: number; machineId: string; executor: Executor }): Promise<boolean> {
      const linhas = await conn`
        insert into rotina_janelas (tenant_id, owner_id, rotina_id, instante_agendado, executor, machine_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.rotinaId}, ${data(p.instanteAgendado)}, ${p.executor}, ${p.machineId})
        on conflict (tenant_id, rotina_id, instante_agendado) do nothing returning id`;
      return linhas.length === 1;
    },

    /** O turno nasce na mesma tx logo depois da reivindicação; aqui ele é ligado à janela. */
    async vincularTurno(p: { rotinaId: string; instanteAgendado: number; turnoId: string }): Promise<boolean> {
      const r = await conn`
        update rotina_janelas set turno_id = ${p.turnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${p.rotinaId} and instante_agendado = ${data(p.instanteAgendado)}`;
      return r.count === 1;
    },

    async listar(rotinaId: string): Promise<JanelaReivindicada[]> {
      const linhas = await conn<Linha[]>`
        select tenant_id, rotina_id, instante_agendado, executor, machine_id, turno_id from rotina_janelas
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} order by instante_agendado`;
      return linhas.map(paraJanela);
    },
  };
}
