import type { Autoria } from "../contracts/evento.ts";
import type { Confianca, KindMensagem, Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

export interface LinhaMensagem {
  tenant_id: string;
  id: string;
  conversa_id: string;
  turno_id: string | null;
  autor_tipo: Autoria["autor_tipo"];
  autor_id: string;
  sob_procuracao_de: string | null;
  conta_de_execucao: string;
  executor: Autoria["executor"];
  locality: Autoria["locality"];
  locality_reason: Autoria["locality_reason"];
  machine_id: string | null;
  decidido_por: Autoria["decidido_por"];
  regra_versao: number;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  parcial: boolean;
  criado_em: Date;
}

export const COLUNAS_MENSAGEM =
  "tenant_id, id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, criado_em";

export function paraMensagem(l: LinhaMensagem): Mensagem {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    autoria: {
      autor_tipo: l.autor_tipo,
      autor_id: l.autor_id,
      sob_procuracao_de: l.sob_procuracao_de,
      conta_de_execucao: l.conta_de_execucao,
      executor: l.executor,
      locality: l.locality,
      locality_reason: l.locality_reason,
      machine_id: l.machine_id,
      decidido_por: l.decidido_por,
      regra_versao: l.regra_versao,
    },
    kind: l.kind,
    texto: l.texto,
    payload: l.payload,
    confianca: l.confianca,
    parcial: l.parcial,
    criadoEm: ms(l.criado_em),
  };
}

export type NovaMensagem = {
  id?: string;
  conversaId: string;
  turnoId?: string | null;
  autoria: Autoria;
  kind: KindMensagem;
  texto: string;
  payload?: PayloadMensagem | null;
  /** NOT NULL no banco (ADR-026): quem grava DECLARA a confiança do conteúdo. */
  confianca: Confianca;
  parcial?: boolean;
  /**
   * Chave de idempotência do envio da pessoa (definido em 2026-10-06, NOD-156). Com ela, o insert vira
   * `on conflict do nothing` no índice único parcial da 0057 e devolve `null` se a chave já existe na conversa.
   */
  idEnvio?: string;
};

/** A linha lida com o turno (ADR-081, S2): a origem do turno, o trabalho e se é a última fala de um turno encerrado. */
type LinhaComTurno = LinhaMensagem & { turno_origem: OrigemTurno | null; trabalho_id: string | null; fim_do_turno: boolean | null };

function paraMensagemComTurno(l: LinhaComTurno): Mensagem {
  return { ...paraMensagem(l), origemTurno: l.turno_origem, trabalhoId: l.trabalho_id, fimDoTurno: l.fim_do_turno === true };
}

/**
 * definido em 2026-10-07 (ADR-081, S2): o que a web usa para agrupar sem adivinhar, no MESMO select (S3 da revisão: a
 * janela `max(criado_em) over (partition by turno_id)`, nunca subconsulta por linha). A fala da pessoa não tem turno
 * próprio: o trabalho dela é o do turno que ela abriu (`mensagem_origem_id`, índice da 0060). `fimDoTurno` olha só as
 * falas de texto do bot e só turno já encerrado; a janela é a mesma página lida, e a última fala de um turno é sempre a
 * mais nova dele, então ela está na página sempre que alguma fala dele estiver.
 */
function selectComTurno(conn: Conn, tenantId: string, recorte: ReturnType<Conn>) {
  return conn<LinhaComTurno[]>`
    select m.*, t.origem as turno_origem, coalesce(t.trabalho_id, o.trabalho_id) as trabalho_id,
      (t.estado in ('concluido', 'interrompido') and m.kind = 'texto' and m.autor_tipo = 'agente'
        and m.criado_em = max(case when m.kind = 'texto' and m.autor_tipo = 'agente' then m.criado_em end) over (partition by m.turno_id)) as fim_do_turno
    from (${recorte}) m
    left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
    left join lateral (
      select x.trabalho_id from turnos x where x.tenant_id = ${tenantId} and x.mensagem_origem_id = m.id and m.turno_id is null
      order by x.criado_em limit 1
    ) o on true
    order by m.criado_em, m.id`;
}

/** Mensagens com autoria composta (ADR-023/025). A da sala é lida por quem tem grant (perna via sala_id). */
export function mensagensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMensagem): Promise<Mensagem | null> {
      const a = m.autoria;
      const [l] = await conn<LinhaMensagem[]>`
        insert into mensagens (tenant_id, id, owner_id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
          executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, id_envio)
        values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.conversaId}, ${m.turnoId ?? null}, ${a.autor_tipo}, ${a.autor_id},
          ${a.sob_procuracao_de}, ${a.conta_de_execucao}, ${a.executor}, ${a.locality}, ${a.locality_reason}, ${a.machine_id}, ${a.decidido_por},
          ${a.regra_versao}, ${m.kind}, ${m.texto}, ${m.payload === undefined || m.payload === null ? null : conn.json(m.payload)}, ${m.confianca}, ${m.parcial ?? false}, ${m.idEnvio ?? null})
        ${m.idEnvio ? conn`on conflict (tenant_id, conversa_id, id_envio) where id_envio is not null do nothing` : conn``}
        returning ${conn.unsafe(COLUNAS_MENSAGEM)}`;
      return l ? paraMensagem(l) : null;
    },

    /** A mensagem gravada com a chave de envio nesta conversa (NOD-156), para o reenvio devolver a mesma fala. */
    async buscarPorIdEnvio(conversaId: string, idEnvio: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and id_envio = ${idEnvio}`;
      return l ? paraMensagem(l) : null;
    },

    async buscar(id: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraMensagem(l) : null;
    },

    /** Em ordem de criação; `limite` corta pelas mais recentes (a resposta volta crescente). */
    async listarDaConversa(conversaId: string, limite = 200): Promise<Mensagem[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select * from (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
          order by criado_em desc, id desc limit ${limite}
        ) recentes order by criado_em, id`;
      return linhas.map(paraMensagem);
    },

    /** listarDaConversa com `origemTurno`, `trabalhoId` e `fimDoTurno` (GET conversas/:id/mensagens, ADR-081). */
    async listarComTurno(conversaId: string, limite = 200): Promise<Mensagem[]> {
      const linhas = await selectComTurno(conn, escopo.tenantId, conn`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
        order by criado_em desc, id desc limit ${limite}`);
      return linhas.map(paraMensagemComTurno);
    },

    /**
     * As mensagens de um trabalho (a tela da task, ADR-081): as falas dos turnos dele, inclusive as do meio, e as da
     * pessoa que abriram um turno dele. As mais recentes, até `limite`.
     */
    async doTrabalho(trabalhoId: string, limite = 300): Promise<Mensagem[]> {
      const linhas = await selectComTurno(conn, escopo.tenantId, conn`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and id in (
          select mm.id from mensagens mm join turnos t on t.tenant_id = mm.tenant_id and t.id = mm.turno_id
          where mm.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${trabalhoId}
          union all
          select t.mensagem_origem_id from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${trabalhoId} and t.mensagem_origem_id is not null)
        order by criado_em desc, id desc limit ${limite}`);
      return linhas.map(paraMensagemComTurno);
    },

    /**
     * A mensagem apontada e as que a precedem dentro da janela, para o relato anexar o contexto
     * (ADR-041). Usa o índice mensagens_por_conversa (tenant_id, conversa_id, criado_em).
     *
     * A âncora entra por `id`, não por comparação de tempo: o Postgres grava clock_timestamp() com
     * microssegundos e `ms()` trunca para milissegundos, então `criado_em <= ${data(ate)}` deixaria
     * a PRÓPRIA mensagem de fora sempre que os microssegundos não fossem zero (medido em
     * 2026-09-21: 18:24:28.352292 no banco contra .352 reconstruído, e a janela voltava vazia).
     * O `limite` é teto de segurança: conversa movimentada não vira dump.
     */
    async janelaAte(conversaId: string, ancoraId: string, desde: number, limite = 100): Promise<Mensagem[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select * from (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
          where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
            and criado_em >= ${data(desde)}
            and (id = ${ancoraId} or criado_em <= (
              select criado_em from mensagens where tenant_id = ${escopo.tenantId} and id = ${ancoraId}))
          order by criado_em desc, id desc limit ${limite}
        ) janela order by criado_em, id`;
      return linhas.map(paraMensagem);
    },

    /**
     * O `peer_pedido` que abriu uma tarefa de colega (definido em 2026-09-29, ADR-058): a ligação tipada até
     * quem pediu. Direto pelo turno, sem a janela de MENSAGENS_DO_PLANO — a trava herdada não pode depender dela.
     */
    async pedidoDaTarefa(turnoId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and payload->>'kind' = 'peer_pedido'
        order by criado_em, id limit 1`;
      return l ? paraMensagem(l) : null;
    },

    async ultimaDaConversa(conversaId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc, id desc limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /** ultimaDaConversa de várias conversas numa consulta (a prévia da frota, definido em 2026-09-30): um LATERAL por conversa no índice mensagens_por_conversa. */
    async ultimasDasConversas(conversaIds: readonly string[]): Promise<Map<string, Mensagem>> {
      if (conversaIds.length === 0) return new Map();
      const linhas = await conn<LinhaMensagem[]>`
        select u.* from unnest(${[...conversaIds]}::uuid[]) as c(id)
        cross join lateral (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
          where tenant_id = ${escopo.tenantId} and conversa_id = c.id
          order by criado_em desc, id desc limit 1
        ) u`;
      return new Map(linhas.map((l) => [l.conversa_id, paraMensagem(l)]));
    },

    async marcarParcial(id: string, parcial: boolean): Promise<boolean> {
      const r = await conn`update mensagens set parcial = ${parcial} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** Turno interrompido no meio do streaming: a fala já gravada fica marcada como parcial (ADR-010). */
    async marcarParciaisDoTurno(turnoId: string): Promise<number> {
      const r = await conn`update mensagens set parcial = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} and autor_tipo = 'agente'`;
      return r.count;
    },
  };
}
