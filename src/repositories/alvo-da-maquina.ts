import type { Conn } from "../shared/types.ts";
import { data } from "./conversao.ts";

/**
 * ADR-090: a máquina-alvo do turno `t` (o alias é obrigatório), em ordem — o "desta vez" (ato da pessoa), a máquina do
 * bot, o padrão da pessoa. Cada nível só vale se a chave está viva e é da dona do turno (não revogada, não vencida); um
 * nível que não vale passa a vez ao próximo, e sem nenhum o alvo é nulo: qualquer máquina (com o servidor no Mac, ADR-092,
 * o Mac). A fila nunca prende um turno numa máquina que não pode mais aparecer.
 *
 * Revisto em 2026-10-09 (a tela fala por máquina): a mesma regra serve ao `reivindicar` (turnos.repo.ts) e à lista de
 * trabalhos (trabalhos.repo.ts, `extras`), que diz de qual máquina o trabalho na fila espera. Uma regra só, para a tela
 * nunca dizer uma máquina e a fila entregar a outra.
 */
export function alvoDoTurno(sql: Conn, agora: number) {
  const viva = (id: ReturnType<typeof sql>) => sql`(select k.id::text from maquina_tokens k where k.tenant_id = t.tenant_id and k.owner_id = t.owner_id and k.id = ${id}
    and k.revogado_em is null and (k.expira_em is null or k.expira_em > ${data(agora)}))`;
  return sql`coalesce(${viva(sql`t.maquina_desta_vez`)},
    ${viva(sql`(select ag.maquina_id from agentes ag where ag.tenant_id = t.tenant_id and ag.id = t.agente_id)`)},
    ${viva(sql`(select pr.maquina_padrao_id from preferencias pr where pr.tenant_id = t.tenant_id and pr.owner_id = t.owner_id)`)})`;
}
