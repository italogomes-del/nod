import type { EpochMs } from "../contracts/ids.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";
import { COLUNAS_MENSAGEM, paraMensagem, type LinhaMensagem } from "./mensagens.repo.ts";

/** Uma conversa com fala nova para a pessoa: quantas, desde quando, a mais recente. */
export type ResumoNaoLida = { conversaId: string; tipo: "propria" | "sala"; agenteId: string | null; salaId: string | null; total: number; desde: EpochMs; ultimaEm: EpochMs };

/** A primeira não lida (onde a linha "Novas" entra), as últimas e se alguma veio de rotina. */
export type NaoLidasDaConversa = { primeira: Mensagem; ultimas: Mensagem[]; avisos: Mensagem[]; daRotina: boolean };

/**
 * NOD-114 (revisão 2): as falas que são aviso por si (o avisar_pessoa e a linha da rotina que falhou ou não rodou). Saem
 * mesmo fora das `por` mais recentes — até `AVISOS_FORA_DA_JANELA` —, senão três falas depois do aviso o apagavam do
 * navegador sem a pessoa ter lido.
 */
const AVISOS_FORA_DA_JANELA = 10;

/** Até onde a pessoa leu cada conversa (0039). Uma linha por pessoa e conversa; sem linha, tudo é novo. */
export function leiturasRepo(conn: Conn, escopo: Escopo) {
  /**
   * "Não lido" (definido em 2026-09-29, 0039): conta texto e artefato de quem não é a pessoa. Aviso do sistema,
   * execução de rotina e a troca interna entre bots (handoff, peer_ask) ficam de fora: não são fala para ela.
   * A mesma condição nas três consultas; a coluna é comparada com o lido_ate do banco, nunca com um ms da borda.
   * revisto em 2026-10-28 (NOD-114): a linha da rotina que falhou ou não rodou também conta — é o aviso de que algo que a
   * pessoa esperava não aconteceu, e o navegador e o desktop avisam a partir desta lista. Ela sai com a autoria da pessoa
   * pela regra que decidiu (disparar-rotina.ts), então não passa pelo filtro da fala da própria pessoa. A interrompida fica
   * de fora: é o Parar dela; a bloqueada não escreve no chat.
   */
  const nova = () =>
    conn`((m.kind in ('texto', 'artefato') and not (m.autor_tipo = 'pessoa' and m.autor_id = ${escopo.pessoaId})) or (m.kind = 'rotina_execucao' and m.payload->>'desfecho' in ('falhou', 'nao_rodou')))`;
  const avisa = () => conn`(coalesce(m.payload->>'kind', '') = 'aviso_pessoa' or (m.kind = 'rotina_execucao' and m.payload->>'desfecho' in ('falhou', 'nao_rodou')))`;
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
      const linhas = await conn<(LinhaMensagem & { origem: OrigemTurno | null; trabalho_id: string | null; fim_do_turno: boolean | null; recente: number; ordem: number; avisa: boolean; raiz_id: string | null; raiz_origem: OrigemTurno | null })[]>`
        select r.*, rz.raiz_id, rz.raiz_origem::text as raiz_origem from (
          select ${conn.unsafe(colunas)}, t.origem::text as origem, t.trabalho_id, t.retoma_turno_id as retoma,
            -- NOD-114: a última fala de texto do bot num turno concluído ("terminou"). A fala final é sempre a mais nova do
            -- turno, então está entre as não lidas sempre que alguma fala dele estiver; o aviso (avisar_pessoa) não conta.
            (t.estado = 'concluido' and m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa'
              and m.criado_em = max(case when m.kind = 'texto' and m.autor_tipo = 'agente' and coalesce(m.payload->>'kind', '') <> 'aviso_pessoa' then m.criado_em end) over (partition by m.turno_id)) as fim_do_turno,
            ${avisa()} as avisa,
            row_number() over (partition by m.conversa_id order by m.criado_em desc, m.id desc)::int as recente,
            row_number() over (partition by m.conversa_id, ${avisa()} order by m.criado_em desc, m.id desc)::int as recente_do_tipo,
            row_number() over (partition by m.conversa_id order by m.criado_em, m.id)::int as ordem
          from mensagens m
          left join leituras l on l.tenant_id = m.tenant_id and l.owner_id = ${escopo.pessoaId} and l.conversa_id = m.conversa_id
          left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = ${escopo.tenantId} and m.conversa_id = any(${[...conversaIds]}::uuid[])
            and m.criado_em > coalesce(l.lido_ate, '-infinity'::timestamptz) and ${nova()}
        ) r
        -- NOD-114 (revisão 2): a origem da raiz da retomada (a mesma cadeia de mensagens.repo.ts, ADR-099), para o "terminou"
        -- da conversa que a pessoa aprovou e deixou rodando. Roda depois do corte: só nas poucas linhas que saem.
        left join lateral (
          with recursive c(id, origem, retoma, n) as (
            select null::uuid, r.origem::origem_turno, r.retoma, 0 where r.origem = 'retomada'
            union all
            select p.id, p.origem, p.retoma_turno_id, c.n + 1 from c join turnos p on p.tenant_id = ${escopo.tenantId} and p.id = c.retoma
            where c.origem = 'retomada' and c.n < 10
          ) select c.id as raiz_id, c.origem as raiz_origem from c where c.n > 0 order by c.n desc limit 1
        ) rz on true
        where r.recente <= ${por} or r.ordem = 1 or (r.avisa and r.recente_do_tipo <= ${AVISOS_FORA_DA_JANELA})
        order by r.conversa_id, r.criado_em, r.id`;
      for (const l of linhas) {
        // NOD-114: a origem, a task e o fim do turno de cada uma, para o aviso do navegador e do desktop escolher o tipo e o alvo.
        const m: Mensagem = { ...paraMensagem(l), origemTurno: l.origem, trabalhoId: l.trabalho_id, fimDoTurno: l.fim_do_turno === true, ...(l.raiz_id && l.raiz_origem ? { raiz: { turnoId: l.raiz_id, origem: l.raiz_origem } } : {}) };
        const atual = saida.get(m.conversaId) ?? { primeira: m, ultimas: [], avisos: [], daRotina: false };
        if (l.recente <= por) atual.ultimas.push(m);
        else if (l.avisa) atual.avisos.push(m);
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
