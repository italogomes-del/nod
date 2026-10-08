import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * O que se GRAVA em `events` é o `RuntimeEvent` do contrato (src/contracts/evento.ts) menos o que
 * o banco/escopo preenche: tenant_id vem do escopo, id e created_at têm DEFAULT (opcionais para o
 * teste de partição fixar a data). `kind` é a união fechada e `autoria.locality_reason` é
 * MotivoLocalidade — a coluna virou enum na 0003, e o tipo fecha antes do CHECK do banco.
 */
export type EventoGravavel = Omit<RuntimeEvent, "tenantId" | "id" | "createdAt" | "dados"> & Partial<Pick<RuntimeEvent, "id" | "createdAt" | "dados">>;

export function eventsRepo(conn: Conn, escopo: Escopo) {
  return {
    /** events + events_outbox na MESMA transação (ADR-010 refinado): rollback derruba os dois. */
    async gravarComOutbox(eventos: EventoGravavel[]): Promise<{ ids: string[] }> {
      const ids: string[] = [];
      for (const ev of eventos) {
        const a = ev.autoria;
        const criadoEm = ev.createdAt === undefined ? null : new Date(ev.createdAt);
        const [linha] = await conn<{ id: string }[]>`
          insert into events (tenant_id, owner_id, id, created_at, kind, autor_tipo, autor_id, sob_procuracao_de,
            conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao,
            pessoa_destino_id, conversa_id, turno_id, dados)
          values (${escopo.tenantId}, ${escopo.pessoaId}, coalesce(${ev.id ?? null}::uuid, gen_random_uuid()), coalesce(${criadoEm}, now()), ${ev.kind}, ${a.autor_tipo}, ${a.autor_id},
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

    /**
     * definido em 2026-10-07 (ADR-081, #191): a telemetria das linhas do chat vai só para `events`, sem outbox — nenhum
     * frame sai dela (a web que mandou já sabe). Mesmas colunas de gravarComOutbox.
     */
    async gravarSemOutbox(eventos: EventoGravavel[]): Promise<number> {
      let n = 0;
      for (const ev of eventos) {
        const a = ev.autoria;
        await conn`
          insert into events (tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality,
            locality_reason, machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${ev.kind}, ${a.autor_tipo}, ${a.autor_id}, ${a.sob_procuracao_de}, ${a.conta_de_execucao},
            ${a.executor}, ${a.locality}, ${a.locality_reason}, ${a.machine_id}, ${a.decidido_por}, ${a.regra_versao}, ${ev.pessoaDestinoId},
            ${ev.conversaId ?? null}, ${ev.turnoId ?? null}, ${conn.json(ev.dados ?? {})})`;
        n += 1;
      }
      return n;
    },

    /** #191: por tipo de linha, quantas chaves distintas a pessoa viu e abriu desde `desde` (a taxa do Modo dev). */
    async contarLinhas(desde: number): Promise<{ tipo: string; mostradas: number; abertas: number }[]> {
      return conn<{ tipo: string; mostradas: number; abertas: number }[]>`
        select dados->>'tipo' as tipo,
          count(distinct dados->>'chave_linha') filter (where kind = 'linha_mostrada')::int as mostradas,
          count(distinct dados->>'chave_linha') filter (where kind = 'linha_aberta')::int as abertas
        from events
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and kind in ('linha_mostrada', 'linha_aberta') and created_at >= ${new Date(desde)}
        group by 1`;
    },

    async listarRecentes(limite = 50): Promise<{ id: string; kind: string; createdAt: string }[]> {
      const linhas = await conn<{ id: string; kind: string; created_at: string }[]>`
        select id, kind, created_at from events where tenant_id = ${escopo.tenantId}
        order by created_at desc limit ${limite}`;
      return linhas.map((l) => ({ id: l.id, kind: l.kind, createdAt: l.created_at }));
    },
  };
}
