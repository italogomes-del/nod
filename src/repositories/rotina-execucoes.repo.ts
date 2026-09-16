import type { DesfechoRotina } from "../contracts/motivos.ts";
import type { ExecucaoRotina } from "../contracts/rotina.ts";
import { EXECUCOES_GUARDADAS } from "../shared/constantes.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  rotina_id: string;
  instante_agendado: Date;
  turno_id: string | null;
  desfecho: DesfechoRotina;
  motivo: string | null;
  em: Date;
}

const COLUNAS = "tenant_id, id, rotina_id, instante_agendado, turno_id, desfecho, motivo, em";

const paraExecucao = (l: Linha): ExecucaoRotina => ({
  tenantId: l.tenant_id,
  id: l.id,
  rotinaId: l.rotina_id,
  instanteAgendado: ms(l.instante_agendado),
  turnoId: l.turno_id,
  desfecho: l.desfecho,
  motivo: l.motivo,
  em: ms(l.em),
});

export type NovaExecucao = {
  id?: string;
  rotinaId: string;
  instanteAgendado: number;
  turnoId?: string | null;
  desfecho: DesfechoRotina;
  /** Só snake_case minúsculo (CHECK): ex. 'ninguem_respondeu_o_gate'. */
  motivo?: string | null;
  em: number;
};

/** Últimas 20 execuções por rotina (Grok Bot); passou_em_branco ≠ falhou (E7.3). */
export function rotinaExecucoesRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(e: NovaExecucao): Promise<ExecucaoRotina | null> {
      const [l] = await conn<Linha[]>`
        insert into rotina_execucoes (tenant_id, id, owner_id, rotina_id, instante_agendado, turno_id, desfecho, motivo, em)
        values (${escopo.tenantId}, ${e.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${e.rotinaId}, ${data(e.instanteAgendado)}, ${e.turnoId ?? null},
          ${e.desfecho}, ${e.motivo ?? null}, ${data(e.em)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraExecucao(l) : null;
    },

    async atualizarDesfecho(id: string, desfecho: DesfechoRotina, motivo: string | null = null): Promise<ExecucaoRotina | null> {
      const [l] = await conn<Linha[]>`
        update rotina_execucoes set desfecho = ${desfecho}, motivo = ${motivo} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraExecucao(l) : null;
    },

    /** Mais recentes primeiro, no máximo `limite` (default = as 20 guardadas). */
    async listar(rotinaId: string, limite = EXECUCOES_GUARDADAS): Promise<ExecucaoRotina[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from rotina_execucoes where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId}
        order by em desc, id desc limit ${limite}`;
      return linhas.map(paraExecucao);
    },

    /** Poda o que passa das `guardar` mais recentes; devolve quantas saíram (src/domain/rotina-limites.ts decide o número). */
    async podar(rotinaId: string, guardar = EXECUCOES_GUARDADAS): Promise<number> {
      const r = await conn`
        delete from rotina_execucoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${rotinaId} and id not in (
          select id from rotina_execucoes where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} order by em desc, id desc limit ${guardar})`;
      return r.count;
    },
  };
}
