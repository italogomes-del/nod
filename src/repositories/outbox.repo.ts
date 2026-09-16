import type { Conn, Escopo } from "../shared/types.ts";

export interface ItemOutbox {
  id: string;
  eventoId: string;
  tipo: string;
  dados: Record<string, unknown>;
  tentativas: number;
  criadoEm: string;
}

interface Linha {
  id: string;
  evento_id: string;
  tipo: string;
  dados: Record<string, unknown>;
  tentativas: number;
  criado_em: string;
}

export function outboxRepo(conn: Conn, escopo: Escopo) {
  return {
    async pendentes(limite = 100): Promise<ItemOutbox[]> {
      const linhas = await conn<Linha[]>`
        select id, evento_id, tipo, dados, tentativas, criado_em from events_outbox
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and entregue_em is null and abandonado_em is null and cancelado_em is null
        order by criado_em limit ${limite}`;
      return linhas.map((l) => ({ id: l.id, eventoId: l.evento_id, tipo: l.tipo, dados: l.dados, tentativas: l.tentativas, criadoEm: l.criado_em }));
    },

    async marcarEntregue(id: string): Promise<boolean> {
      const r = await conn`update events_outbox set entregue_em = now() where tenant_id = ${escopo.tenantId} and id = ${id} and entregue_em is null`;
      return r.count === 1;
    },

    async incrementarTentativa(id: string): Promise<number | null> {
      const [l] = await conn<{ tentativas: number }[]>`
        update events_outbox set tentativas = tentativas + 1 where tenant_id = ${escopo.tenantId} and id = ${id} returning tentativas`;
      return l?.tentativas ?? null;
    },

    /**
     * Abandona só com as DUAS condições (Leapy §7): tentativas >= teto E criado_em < agora - idadeMin.
     * Só o teto esvaziaria a fila numa queda curta; só a idade nunca abandonaria a linha envenenada.
     * Devolve quantas linhas abandonou; elas ficam na tabela para serem contadas (métrica outbox_abandonados).
     */
    async abandonar(p: { teto: number; idadeMinMs: number; agora: number }): Promise<number> {
      const agora = new Date(p.agora);
      const limite = new Date(p.agora - p.idadeMinMs);
      const r = await conn`
        update events_outbox set abandonado_em = ${agora}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and entregue_em is null and abandonado_em is null and cancelado_em is null
          and tentativas >= ${p.teto} and criado_em < ${limite}`;
      return r.count;
    },

    async contarAbandonados(): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from events_outbox where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and abandonado_em is not null`;
      return l?.n ?? 0;
    },

    /** Parar (E5.4): frames ainda não entregues da pessoa deixam de sair. */
    async cancelarPendentesDaPessoa(agora: number): Promise<number> {
      const r = await conn`
        update events_outbox set cancelado_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and entregue_em is null and abandonado_em is null and cancelado_em is null`;
      return r.count;
    },
  };
}
