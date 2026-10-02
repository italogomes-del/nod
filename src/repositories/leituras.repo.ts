import type { EpochMs } from "../contracts/ids.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";
import { COLUNAS_MENSAGEM, paraMensagem, type LinhaMensagem } from "./mensagens.repo.ts";

/** Uma conversa com fala nova para a pessoa: quantas, desde quando, a mais recente. */
export type ResumoNaoLida = { conversaId: string; tipo: "propria" | "sala"; agenteId: string | null; salaId: string | null; total: number; desde: EpochMs; ultimaEm: EpochMs };

/** A primeira não lida (onde a linha "Novas" entra), as últimas e se alguma veio de rotina. */
export type NaoLidasDaConversa = { primeira: Mensagem; ultimas: Mensagem[]; daRotina: boolean };

/** Até onde a pessoa leu cada conversa (0039). Uma linha por pessoa e conversa; sem linha, tudo é novo. */
export function leiturasRepo(conn: Conn, escopo: Escopo) {
  /**
   * "Não lido" (definido em 2026-09-29, 0039): conta texto e artefato de quem não é a pessoa. Aviso do sistema,
   * execução de rotina e a troca interna entre bots (handoff, peer_ask) ficam de fora: não são fala para ela.
   * A mesma condição nas três consultas; a coluna é comparada com o lido_ate do banco, nunca com um ms da borda.
   */
  const nova = () => conn`m.kind in ('texto', 'artefato') and not (m.autor_tipo = 'pessoa' and m.autor_id = ${escopo.pessoaId})`;
  return {
    /**
     * As conversas da pessoa (os bots dela e as salas que ela lê) com fala nova, a mais recente primeiro.
     *
     * revisto em 2026-09-30: o "lido até" sai pronto da subconsulta (o `offset 0` a impede de ser achatada) e entra no
     * LATERAL como coluna. Escrito como coalesce(l.lido_ate, …) dentro do LATERAL, sob RLS ele ficava no filtro depois
     * das policies em vez de limitar a busca no índice mensagens_por_conversa, e a conta lia todas as mensagens de cada
     * conversa: medido em 2026-09-30 (banco efêmero, 32 conversas, 14,5 mil mensagens), 11.441 buffers e custo 173 mil
     * (acima do limiar do JIT) contra 4.360 buffers e custo 58,6 mil assim; dentro do GET frota, já com jit=off, de 57
     * para 25 ms.
     */
    async resumo(): Promise<ResumoNaoLida[]> {
      const linhas = await conn<{ conversa_id: string; tipo: "propria" | "sala"; agente_id: string | null; sala_id: string | null; total: number; desde: Date; ultima: Date }[]>`
        select c.id as conversa_id, c.tipo, c.agente_id, c.sala_id, x.total, x.desde, x.ultima
        from (
          select c.tenant_id, c.id, c.tipo, c.agente_id, c.sala_id, coalesce(l.lido_ate, '-infinity'::timestamptz) as lido_ate
          from conversas c
          left join leituras l on l.tenant_id = c.tenant_id and l.owner_id = ${escopo.pessoaId} and l.conversa_id = c.id
          where c.tenant_id = ${escopo.tenantId} and (c.tipo = 'sala' or c.owner_id = ${escopo.pessoaId})
          offset 0
        ) c
        cross join lateral (
          select count(*)::int as total, min(m.criado_em) as desde, max(m.criado_em) as ultima
          from mensagens m
          where m.tenant_id = c.tenant_id and m.conversa_id = c.id and m.criado_em > c.lido_ate and ${nova()}
        ) x
        where x.total > 0
        order by x.ultima desc, c.id`;
      return linhas.map((l) => ({ conversaId: l.conversa_id, tipo: l.tipo, agenteId: l.agente_id, salaId: l.sala_id, total: l.total, desde: ms(l.desde), ultimaEm: ms(l.ultima) }));
    },

    /** Para cada conversa pedida: a primeira não lida e as `por` mais recentes, em ordem de criação. */
    async mensagens(conversaIds: readonly string[], por = 3): Promise<Map<string, NaoLidasDaConversa>> {
      const saida = new Map<string, NaoLidasDaConversa>();
      if (conversaIds.length === 0) return saida;
      const colunas = COLUNAS_MENSAGEM.split(", ").map((c) => `m.${c}`).join(", ");
      const linhas = await conn<(LinhaMensagem & { origem: string | null; recente: number; ordem: number })[]>`
        select * from (
          select ${conn.unsafe(colunas)}, t.origem::text as origem,
            row_number() over (partition by m.conversa_id order by m.criado_em desc, m.id desc)::int as recente,
            row_number() over (partition by m.conversa_id order by m.criado_em, m.id)::int as ordem
          from mensagens m
          left join leituras l on l.tenant_id = m.tenant_id and l.owner_id = ${escopo.pessoaId} and l.conversa_id = m.conversa_id
          left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = ${escopo.tenantId} and m.conversa_id = any(${[...conversaIds]}::uuid[])
            and m.criado_em > coalesce(l.lido_ate, '-infinity'::timestamptz) and ${nova()}
        ) r
        where recente <= ${por} or ordem = 1
        order by conversa_id, criado_em, id`;
      for (const l of linhas) {
        const m = paraMensagem(l);
        const atual = saida.get(m.conversaId) ?? { primeira: m, ultimas: [], daRotina: false };
        if (l.recente <= por) atual.ultimas.push(m);
        if (l.origem === "rotina") atual.daRotina = true;
        saida.set(m.conversaId, atual);
      }
      return saida;
    },

    /** Lida até a última mensagem da conversa. Nunca anda para trás (duas abas, um clique atrasado). */
    async marcarLida(conversaId: string): Promise<void> {
      await conn`
        insert into leituras (tenant_id, owner_id, conversa_id, lido_ate)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${conversaId}, coalesce(
          (select max(criado_em) from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}), clock_timestamp()))
        on conflict (tenant_id, owner_id, conversa_id)
        do update set lido_ate = greatest(leituras.lido_ate, excluded.lido_ate), atualizado_em = clock_timestamp()`;
    },

    /**
     * "Marcar como não lido": a última fala de quem não é a pessoa volta a ser nova (a linha "Novas" fica acima
     * dela). Sem fala nenhuma na conversa, não há o que marcar: devolve false.
     */
    async marcarNaoLida(conversaId: string): Promise<boolean> {
      const r = await conn`
        insert into leituras (tenant_id, owner_id, conversa_id, lido_ate)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${conversaId}, max(m.criado_em) - interval '1 microsecond'
        from mensagens m
        where m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and ${nova()}
        having max(m.criado_em) is not null
        on conflict (tenant_id, owner_id, conversa_id)
        do update set lido_ate = excluded.lido_ate, atualizado_em = clock_timestamp()`;
      return r.count === 1;
    },
  };
}
