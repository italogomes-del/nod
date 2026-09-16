import { vincularEscopo } from "../../src/db/tx.ts";
import type { Db, Escopo } from "../../src/shared/types.ts";

/**
 * Limpeza própria do E2E (terceiro modo, ADR-011 refinado): as linhas COMMITAM porque o servidor
 * completo roda laços reais; ao fim, tudo que pertence à pessoa do teste é apagado por owner_id,
 * como nod_app sob o escopo dela (a policy deixa a dona apagar o que é dela), e a linha em
 * `pessoas` como nod_dono. Ordem respeita as FKs da 0002.
 *
 * O que FICA, por desenho: `trilha` é imutável por trigger e REVOKE (ADR-004) — as linhas de
 * tool_call/negacao do e2e permanecem em nod_test, de uma pessoa aleatória que não volta a existir.
 */
export async function limparPessoaE2E(db: Db, dbDono: Db, escopo: Escopo, ids: { agentes: string[]; conversas: string[] }): Promise<void> {
  const p = escopo.pessoaId;
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '5s'`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from concessoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from rotina_execucoes where owner_id = ${p}`;
    await trx`delete from rotina_janelas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from rotinas where owner_id = ${p}`;
    await trx`delete from sala_membros where owner_id = ${p}`;
    await trx`delete from salas where owner_id = ${p}`;
    if (ids.conversas.length) await trx`delete from conversas where id in ${trx(ids.conversas)}`;
    await trx`delete from conversas where owner_id = ${p}`;
    if (ids.agentes.length) await trx`delete from agentes where id in ${trx(ids.agentes)}`;
    await trx`delete from agentes where owner_id = ${p}`;
    await trx`delete from conectores where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  await dbDono`delete from pessoas where tenant_id = ${escopo.tenantId} and id = ${p}`;
}
