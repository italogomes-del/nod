import type { Conn, Escopo } from "../shared/types.ts";

/**
 * Forma que a tabela `events` exige (autoria composta, ADR-023/025; localidade, ADR-022).
 * PENDÊNCIA DE CONTRATO: o `RuntimeEvent` de src/contracts/evento.ts ainda tem a forma antiga
 * (denials/source); a L2 refaz o contrato para satisfazer este tipo e a L3 troca o parâmetro.
 */
export interface EventoGravavel {
  id?: string;
  kind: string;
  createdAt?: number;
  autoria: {
    autor_tipo: "pessoa" | "agente";
    autor_id: string;
    sob_procuracao_de: string | null;
    conta_de_execucao: string;
    executor: string;
    locality: string;
    locality_reason: string;
    machine_id: string | null;
    decidido_por: string;
    regra_versao: number;
  };
  pessoaDestinoId: string;
  conversaId?: string | null;
  turnoId?: string | null;
  dados?: Record<string, string | number | boolean | null>;
}

export function eventsRepo(conn: Conn, escopo: Escopo) {
  return {
    /** events + events_outbox na MESMA transação (ADR-010 refinado): rollback derruba os dois. */
    async gravarComOutbox(eventos: EventoGravavel[]): Promise<{ ids: string[] }> {
      const ids: string[] = [];
      for (const ev of eventos) {
        const a = ev.autoria;
        const criadoEm = ev.createdAt === undefined ? null : new Date(ev.createdAt);
        const [linha] = await conn<{ id: string }[]>`
          insert into events (tenant_id, owner_id, created_at, kind, autor_tipo, autor_id, sob_procuracao_de,
            conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao,
            pessoa_destino_id, conversa_id, turno_id, dados)
          values (${escopo.tenantId}, ${escopo.pessoaId}, coalesce(${criadoEm}, now()), ${ev.kind}, ${a.autor_tipo}, ${a.autor_id},
            ${a.sob_procuracao_de}, ${a.conta_de_execucao}, ${a.executor}, ${a.locality}, ${a.locality_reason},
            ${a.machine_id}, ${a.decidido_por}, ${a.regra_versao}, ${ev.pessoaDestinoId}, ${ev.conversaId ?? null},
            ${ev.turnoId ?? null}, ${conn.json(ev.dados ?? {})})
          returning id`;
        if (!linha) continue;
        // owner do outbox = pessoa de destino: só ela lê o frame (ADR-016). Sob RLS o WITH CHECK exige
        // owner_id = pessoa da sessão; evento dirigido a outra pessoa é gravado pelo laço da própria pessoa.
        await conn`
          insert into events_outbox (tenant_id, owner_id, evento_id, tipo, dados)
          values (${escopo.tenantId}, ${ev.pessoaDestinoId}, ${linha.id}, ${ev.kind}, ${conn.json(ev.dados ?? {})})`;
        ids.push(linha.id);
      }
      return { ids };
    },

    async listarRecentes(limite = 50): Promise<{ id: string; kind: string; createdAt: string }[]> {
      const linhas = await conn<{ id: string; kind: string; created_at: string }[]>`
        select id, kind, created_at from events where tenant_id = ${escopo.tenantId}
        order by created_at desc limit ${limite}`;
      return linhas.map((l) => ({ id: l.id, kind: l.kind, createdAt: l.created_at }));
    },
  };
}
