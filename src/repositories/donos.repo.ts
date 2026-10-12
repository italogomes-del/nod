import type { DeQuemPediu } from "../contracts/dono.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

/** Um comando esperando (`esperar_comando`), com o que a linha aberta mostra e o que a tentativa precisa. */
export type ComandoDoDono = {
  id: string;
  agenteId: string;
  trabalhoId: string | null;
  turnoId: string;
  comando: string;
  motivo: string;
  desde: number;
  /** A saída da espera anterior do mesmo comando, na mesma faixa (a desta só chega quando ela acaba). */
  saidaAnterior: string | null;
  /** O turno que deixou a espera já é uma volta da cadeia; `origem` é o turno que as voltas retomam. */
  emVolta: boolean;
  origem: string;
};

export type VoltaDoDono = { agenteId: string; trabalhoId: string | null; motivo: string | null; desde: number; acordaEm: number };
export type ColegaDoDono = { agenteId: string; trabalhoId: string | null; nome: string | null; desde: number };
export type PedidoDoDono = { turnoId: string; agenteId: string; de: DeQuemPediu; nome: string | null; desde: number };

export type FatosCrusDosDonos = {
  /** agenteId → desde quando um turno dele fora de frente roda. */
  vivos: Map<string, number>;
  /** Os trabalhos (frentes) com turno vivo agora. */
  frentesVivas: Set<string>;
  /** agenteId → as decisões abertas dele e a mais antiga. */
  decisoes: Map<string, { quantas: number; desde: number }>;
  comandos: ComandoDoDono[];
  voltas: VoltaDoDono[];
  colegas: ColegaDoDono[];
  fila: PedidoDoDono[];
};

/**
 * O que o estado do dono lê de cada bot (definido em 2026-10-12, ADR-099 item 10, I10). Padrão dos repositórios
 * (tipos.ts): WHERE tenant_id explícito sob RLS, só leitura. Quem decide é src/domain/estado-do-dono.ts; as frentes vêm
 * da lista de trabalhos de sempre (trabalhos.repo.ts). `desdeColegas` é a janela dos pedidos a colega que ainda contam
 * (a mesma do varredor de pedidos parados, 24 h).
 */
export function donosRepo(conn: Conn, escopo: Escopo) {
  return {
    async fatos(agenteIds: readonly string[], agora: number, desdeColegas: number): Promise<FatosCrusDosDonos> {
      const vazio: FatosCrusDosDonos = { vivos: new Map(), frentesVivas: new Set(), decisoes: new Map(), comandos: [], voltas: [], colegas: [], fila: [] };
      if (agenteIds.length === 0) return vazio;
      const ids = [...agenteIds];
      const [vivos, frentesVivas, decisoes, comandos, voltas, colegas, fila] = await Promise.all([
        conn<{ agente_id: string; desde: Date }[]>`
          select agente_id, min(criado_em) as desde from turnos
          where tenant_id = ${escopo.tenantId} and agente_id = any(${ids}::uuid[]) and estado = 'despachando' and trabalho_id is null
          group by agente_id`,
        conn<{ trabalho_id: string }[]>`
          select distinct trabalho_id from turnos
          where tenant_id = ${escopo.tenantId} and agente_id = any(${ids}::uuid[]) and estado = 'despachando' and trabalho_id is not null`,
        conn<{ agente_id: string; quantas: number; desde: Date }[]>`
          select agente_id, count(*)::int as quantas, min(criado_em) as desde from decisoes
          where tenant_id = ${escopo.tenantId} and agente_id = any(${ids}::uuid[]) and estado in ('pendente', 'reaberta')
          group by agente_id`,
        conn<{ id: string; agente_id: string; trabalho_id: string | null; turno_id: string; comando: string; motivo: string; criado_em: Date; saida_anterior: string | null; em_volta: boolean; origem: string }[]>`
          select e.id, e.agente_id, e.trabalho_id, e.turno_id, e.comando, e.motivo, e.criado_em,
            (select p.saida from esperas p where p.tenant_id = e.tenant_id and p.agente_id = e.agente_id
              and p.trabalho_id is not distinct from e.trabalho_id and p.comando = e.comando and p.estado <> 'rodando'
              and p.criado_em < e.criado_em order by p.criado_em desc limit 1) as saida_anterior,
            (t.acordar_em is not null and t.retoma_turno_id is not null) as em_volta,
            case when t.acordar_em is not null and t.retoma_turno_id is not null then t.retoma_turno_id else t.id end as origem
          from esperas e join turnos t on t.tenant_id = e.tenant_id and t.id = e.turno_id
          where e.tenant_id = ${escopo.tenantId} and e.agente_id = any(${ids}::uuid[]) and e.estado = 'rodando'
          order by e.criado_em, e.id`,
        // A volta marcada para mais tarde (ADR-086); o motivo é o do turno que a marcou (o mesmo `despertar_em`).
        conn<{ agente_id: string; trabalho_id: string | null; motivo: string | null; criado_em: Date; acordar_em: Date }[]>`
          select t.agente_id, t.trabalho_id, m.despertar_motivo as motivo, t.criado_em, t.acordar_em from turnos t
          left join lateral (
            select x.despertar_motivo from turnos x where x.tenant_id = t.tenant_id and x.despertar_em = t.acordar_em
              and (x.id = t.retoma_turno_id or x.retoma_turno_id = t.retoma_turno_id)
            order by x.criado_em desc limit 1
          ) m on true
          where t.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and t.estado = 'pendente' and t.acordar_em > ${data(agora)}
          order by t.criado_em, t.id`,
        // O pedido a colega sem resposta (a regra de fatos.colega em trabalhos.repo.ts), da conversa ou de uma frente.
        conn<{ agente_id: string; trabalho_id: string | null; nome: string | null; criado_em: Date }[]>`
          select t.agente_id, t.trabalho_id, g.nome, h.criado_em from mensagens h
          join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
          left join agentes g on g.tenant_id = h.tenant_id and g.id::text = h.payload->>'para'
          where h.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and h.kind = 'handoff'
            and h.payload->>'tarefaId' is not null and h.criado_em >= ${data(desdeColegas)}
            and not exists (select 1 from mensagens r where r.tenant_id = h.tenant_id and r.conversa_id = h.conversa_id and r.kind = 'peer_ask'
              and r.payload->>'tarefaId' = h.payload->>'tarefaId')
            and not exists (select 1 from trabalhos k where k.tenant_id = h.tenant_id and k.id::text = h.payload->>'trabalhoId'
              and k.estado in ('terminado', 'parado', 'falhou'))
          order by h.criado_em, h.id`,
        // Os pedidos na fila do dono, ainda não começados: a fala da pessoa, a triagem de um colega ou de uma rotina. A
        // ordem é a do reivindicar no que importa à tela: a pessoa passa na frente, o resto por chegada.
        conn<{ id: string; agente_id: string; origem: string; criado_em: Date; colega: string | null; rotina: string | null }[]>`
          select t.id, t.agente_id, t.origem, t.criado_em,
            (select g.nome from mensagens m join agentes g on g.tenant_id = m.tenant_id and g.id = m.autor_id
              where m.tenant_id = t.tenant_id and m.turno_id = t.id and m.kind = 'texto' and m.autor_tipo = 'agente' and m.autor_id <> t.agente_id
              order by m.criado_em limit 1) as colega,
            (select r.instrucao from rotina_janelas j join rotinas r on r.tenant_id = j.tenant_id and r.id = j.rotina_id
              where j.tenant_id = t.tenant_id and j.turno_id = t.id limit 1) as rotina
          from turnos t
          where t.tenant_id = ${escopo.tenantId} and t.agente_id = any(${ids}::uuid[]) and t.estado = 'pendente' and t.trabalho_id is null
            and (t.acordar_em is null or t.acordar_em <= ${data(agora)}) and t.origem in ('conversa', 'delegacao', 'peer', 'rotina')
          order by (t.origem = 'conversa') desc, t.criado_em, t.id`,
      ]);
      return {
        vivos: new Map(vivos.map((l) => [l.agente_id, ms(l.desde)])),
        frentesVivas: new Set(frentesVivas.map((l) => l.trabalho_id)),
        decisoes: new Map(decisoes.map((l) => [l.agente_id, { quantas: l.quantas, desde: ms(l.desde) }])),
        comandos: comandos.map((l) => ({ id: l.id, agenteId: l.agente_id, trabalhoId: l.trabalho_id, turnoId: l.turno_id, comando: l.comando, motivo: l.motivo, desde: ms(l.criado_em), saidaAnterior: l.saida_anterior, emVolta: l.em_volta, origem: l.origem })),
        voltas: voltas.map((l) => ({ agenteId: l.agente_id, trabalhoId: l.trabalho_id, motivo: l.motivo, desde: ms(l.criado_em), acordaEm: ms(l.acordar_em) })),
        colegas: colegas.map((l) => ({ agenteId: l.agente_id, trabalhoId: l.trabalho_id, nome: l.nome, desde: ms(l.criado_em) })),
        fila: fila.map((l) => {
          const de: DeQuemPediu = l.origem === "conversa" ? "pessoa" : l.origem === "rotina" ? "rotina" : "colega";
          return { turnoId: l.id, agenteId: l.agente_id, de, nome: de === "colega" ? l.colega : de === "rotina" ? l.rotina : null, desde: ms(l.criado_em) };
        }),
      };
    },
  };
}
