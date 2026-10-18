import type { Autoria } from "../contracts/evento.ts";
import type { Assunto, Destino } from "../contracts/destino-no-chat.ts";
import type { Confianca, KindMensagem, Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import { assuntoNaLeitura } from "../domain/assunto-do-texto.ts";
import { ASSUNTOS_ANEXO, ASSUNTOS_ATIVIDADE, assuntoDe, destinoDe } from "../domain/destino-no-chat.ts";
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
  /** 0091 (chat limpo): o que a mensagem é; null = fala ou linha sem backfill. Fica no servidor: a web recebe o destino. */
  assunto: string | null;
}

export const COLUNAS_MENSAGEM =
  "tenant_id, id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, criado_em, assunto";

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

type BaseNovaMensagem = {
  id?: string;
  conversaId: string;
  turnoId?: string | null;
  autoria: Autoria;
  texto: string;
  /** NOT NULL no banco (ADR-026): quem grava DECLARA a confiança do conteúdo. */
  confianca: Confianca;
  parcial?: boolean;
  /**
   * Chave de idempotência do envio da pessoa (definido em 2026-10-06, NOD-156). Com ela, o insert vira
   * `on conflict do nothing` no índice único parcial da 0057 e devolve `null` se a chave já existe na conversa.
   */
  idEnvio?: string;
};

/** Os kinds em que, sem payload, só quem grava sabe o que a linha é: o aviso de sistema e o recibo automático. */
type KindQueEscolheAssunto = "sistema" | "resultado_aprovacao";

/**
 * definido em 2026-10-18 (chat limpo, PR 1; ADR-114, decisão 9): `sistema` e `resultado_aprovacao` sem payload EXIGEM o
 * `assunto` no tipo — o compilador obriga cada produtor a escolher, sem padrão implícito (um aviso novo que devia ficar
 * no chat não cai na Atividade em silêncio). Com payload, o assunto sai do payload e da autoria (assuntoDe) e o
 * `assunto` dado é ignorado; o terceiro ramo é o do payload condicional (`...(x ? { payload } : {})`).
 */
export type NovaMensagem =
  | (BaseNovaMensagem & { kind: Exclude<KindMensagem, KindQueEscolheAssunto>; payload?: PayloadMensagem | null; assunto?: Assunto })
  | (BaseNovaMensagem & { kind: KindQueEscolheAssunto; payload: PayloadMensagem; assunto?: Assunto })
  | (BaseNovaMensagem & { kind: KindMensagem; payload?: PayloadMensagem | null; assunto: Assunto });

/** O assunto gravado: o do payload quando há; senão o que o produtor escolheu; senão o do kind (fala = null). */
export function assuntoDaNova(m: { kind: KindMensagem; payload?: PayloadMensagem | null; autoria: Pick<Autoria, "decidido_por">; assunto?: Assunto }): Assunto | null {
  const payload = m.payload ?? null;
  if (payload) return assuntoDe(m.kind, payload, m.autoria);
  return m.assunto ?? assuntoDe(m.kind, null, m.autoria);
}

/** A linha lida com o turno (ADR-083, S2): a origem do turno, o trabalho e se é a última fala de um turno encerrado. */
type LinhaComTurno = LinhaMensagem & { turno_origem: OrigemTurno | null; trabalho_id: string | null; fim_do_turno: boolean | null; raiz_id: string | null; raiz_origem: OrigemTurno | null; primeira?: boolean | null };

/**
 * definido em 2026-10-18 (chat limpo, PR 2): teto dos `anexo` que a janela traz desde o corte (o plano, 1b). Os `anexo`
 * (linhas de frente e task, "Respondi ao pedido", falas do meio das tasks) não viram linha, mas a web precisa deles para
 * desenhar outra coisa; os mais recentes ficam.
 */
export const TETO_ANEXOS_DA_JANELA = 300;

/**
 * A coluna `primeira` da linha `m` (definido em 2026-10-18, chat limpo, PR 2): é a primeira mensagem da conversa — a da
 * criação do bot (criar-agente.ts), que o backfill reconhece por isso, qualquer que seja a frase. Só calculada para o que o
 * backfill ainda não alcançou (`sistema` sem payload e sem assunto): uma consulta no índice mensagens_por_conversa por linha
 * assim, nenhuma depois do backfill.
 */
export function colunaPrimeira(conn: Conn, alias: string) {
  const m = conn.unsafe(alias);
  return conn`(${m}.assunto is null and ${m}.kind = 'sistema' and ${m}.payload is null and not exists (
    select 1 from mensagens o where o.tenant_id = ${m}.tenant_id and o.conversa_id = ${m}.conversa_id
      and (o.criado_em < ${m}.criado_em or (o.criado_em = ${m}.criado_em and o.id < ${m}.id)))) as primeira`;
}

/**
 * O destino de uma linha da conversa própria (definido em 2026-10-18, chat limpo, PR 2): pelo assunto gravado, ou, nulo,
 * pelo que o backfill gravaria (assuntoNaLeitura). `primeira` só vem quando a consulta a calculou (colunaPrimeira).
 */
export function destinoDaLinha(l: LinhaMensagem & { primeira?: boolean | null }): Destino {
  return destinoDe(assuntoNaLeitura({ assunto: l.assunto, kind: l.kind, payload: l.payload, texto: l.texto, decididoPor: l.decidido_por, primeiraDaConversa: l.primeira === true }));
}

function paraMensagemComTurno(l: LinhaComTurno): Mensagem {
  return { ...paraMensagem(l), origemTurno: l.turno_origem, trabalhoId: l.trabalho_id, fimDoTurno: l.fim_do_turno === true, ...(l.raiz_id && l.raiz_origem ? { raiz: { turnoId: l.raiz_id, origem: l.raiz_origem } } : {}) };
}

/**
 * definido em 2026-10-07 (ADR-083, S2): o que a web usa para agrupar sem adivinhar, no MESMO select (S3 da revisão: a
 * janela `max(criado_em) over (partition by turno_id)`, nunca subconsulta por linha). A fala da pessoa não tem turno
 * próprio: o trabalho dela é o do turno que ela abriu (`mensagem_origem_id`, índice da 0063). `fimDoTurno` olha só as
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
    left join lateral (
      with recursive c(id, origem, retoma, n) as (
        select t.id, t.origem, t.retoma_turno_id, 0 where t.origem = 'retomada'
        union all
        select p.id, p.origem, p.retoma_turno_id, c.n + 1 from c join turnos p on p.tenant_id = ${tenantId} and p.id = c.retoma
        where c.origem = 'retomada' and c.n < 10
      ) select c.id as raiz_id, c.origem as raiz_origem from c where c.n > 0 order by c.n desc limit 1
    ) rz on true
    order by m.criado_em, m.id`;
}

/**
 * A fala de um turno de trabalho (task ou frente) na passada do corte (definido em 2026-10-18, chat limpo, PR 2; revisão
 * de engenharia, item 8): tem assunto nulo, mas a web a esconde (mora na tela da task); conta como `anexo`, senão um dia de
 * cinco frentes enchia a janela delas. Só a fala do bot: a da pessoa fica no chat (a da rede foi escrita no chat).
 */
const falaDeTrabalho = (conn: Conn) => conn`(m.assunto is null and m.kind = 'texto' and m.autor_tipo = 'agente' and t.trabalho_id is not null)`;

/**
 * O recorte da janela da conversa própria (listarComTurno com `comDestino`): `chat` são os `limite` itens de chat mais
 * recentes; `corte` é o `criado_em` do mais antigo deles quando a janela encheu (senão, nenhum corte); a resposta é a
 * união dos dois lados, com a coluna `primeira` para o destino na leitura das linhas sem backfill.
 *
 * A janela não tem buracos (revisão do PR 2, 18/10): quando os anexos batem no teto, o mais antigo deles vira o piso e os
 * itens de chat de antes dele ficam de fora. Sem isso, entre o piso e o corte ficavam as falas da pessoa sem o resultado
 * da task (a fala do bot num turno de trabalho é anexo), sem a pergunta aberta da task e sem a linha "Rotina executou"
 * (o resultado virava "nada para você"). No pior caso a janela é mais curta, como a de antes do PR 2, nunca furada.
 *
 * Os dois lados são CTEs `materialized` e a resposta é um join pela chave primária, nunca `id in (… union all …)`: medido em
 * 2026-10-18 (EXPLAIN ANALYZE na conversa sintética do Eng 1, 6.300 linhas), com o `in` o Postgres refazia a passada dos
 * anexos para cada linha da conversa (6.102 voltas, 5,5 milhões de buffers, 20 s).
 */
function recorteDaJanela(conn: Conn, tenantId: string, conversaId: string, limite: number): ReturnType<Conn> {
  const daConversa = conn`m.tenant_id = ${tenantId} and m.conversa_id = ${conversaId}`;
  const comTurno = conn`left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id`;
  const naoContam = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
  return conn`
    with chat as materialized (
      select m.id, m.criado_em from mensagens m ${comTurno}
      where ${daConversa} and (m.assunto is null or m.assunto <> all(${naoContam}::text[])) and not ${falaDeTrabalho(conn)}
      order by m.criado_em desc, m.id desc limit ${limite}
    ), corte as (
      select case when count(*) >= ${limite} then min(criado_em) end as em from chat
    ), anexos as materialized (
      select m.id, m.criado_em from mensagens m ${comTurno}
      where ${daConversa} and (m.assunto = any(${[...ASSUNTOS_ANEXO]}::text[]) or ${falaDeTrabalho(conn)})
        and m.criado_em >= coalesce((select em from corte), '-infinity'::timestamptz)
      order by m.criado_em desc, m.id desc limit ${TETO_ANEXOS_DA_JANELA}
    ), piso as (
      select case when count(*) >= ${TETO_ANEXOS_DA_JANELA} then min(criado_em) end as em from anexos
    )
    select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m0.${c}`).join(", "))}, ${colunaPrimeira(conn, "m0")}
    from (select id from chat where criado_em >= coalesce((select em from piso), '-infinity'::timestamptz) union all select id from anexos) j
    join mensagens m0 on m0.tenant_id = ${tenantId} and m0.id = j.id`;
}

/** Mensagens com autoria composta (ADR-023/025). A da sala é lida por quem tem grant (perna via sala_id). */
export function mensagensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMensagem): Promise<Mensagem | null> {
      const a = m.autoria;
      const [l] = await conn<LinhaMensagem[]>`
        insert into mensagens (tenant_id, id, owner_id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
          executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, id_envio, assunto)
        values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.conversaId}, ${m.turnoId ?? null}, ${a.autor_tipo}, ${a.autor_id},
          ${a.sob_procuracao_de}, ${a.conta_de_execucao}, ${a.executor}, ${a.locality}, ${a.locality_reason}, ${a.machine_id}, ${a.decidido_por},
          ${a.regra_versao}, ${m.kind}, ${m.texto}, ${m.payload === undefined || m.payload === null ? null : conn.json(m.payload)}, ${m.confianca}, ${m.parcial ?? false}, ${m.idEnvio ?? null},
          ${assuntoDaNova(m)})
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

    /**
     * listarDaConversa com `origemTurno`, `trabalhoId` e `fimDoTurno` (GET conversas/:id/mensagens, ADR-083).
     *
     * `comDestino` (definido em 2026-10-18, chat limpo; ADR-114, emenda do PR 2): a conversa é própria e a janela conta só
     * o que o chat mostra. As `limite` mais recentes que são item de chat (assunto nulo ou de destino `chat`, menos a fala
     * de um turno de trabalho, que mora na tela da task) e, desde a mais antiga delas (o corte), os `anexo` e as falas de
     * trabalho, até TETO_ANEXOS_DA_JANELA; os de destino `atividade` ficam de fora (moram na Atividade do bot). Duas passadas
     * no índice mensagens_por_conversa (tenant_id, conversa_id, criado_em), sem índice novo. Cada mensagem leva o destino,
     * resolvido aqui (destinoDaLinha).
     *
     * Antes do backfill (assunto nulo nas linhas antigas), o SQL conta a linha sem assunto como chat — conservador: nada
     * some por causa da janela, só cabem menos itens visíveis nas conversas antigas até o backfill rodar —, e o destino da
     * linha é resolvido na leitura pelo texto, como o backfill faria, então o aviso antigo também sai do chat na tela.
     *
     * A sala não muda: as `limite` mais recentes, sem destino (lá a conversa entre bots é o conteúdo).
     */
    async listarComTurno(conversaId: string, limite = 200, opcoes: { comDestino?: boolean } = {}): Promise<Mensagem[]> {
      if (!opcoes.comDestino) {
        const linhas = await selectComTurno(conn, escopo.tenantId, conn`
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
          order by criado_em desc, id desc limit ${limite}`);
        return linhas.map(paraMensagemComTurno);
      }
      const linhas = await selectComTurno(conn, escopo.tenantId, recorteDaJanela(conn, escopo.tenantId, conversaId, limite));
      return linhas.map((l) => ({ ...paraMensagemComTurno(l), destino: destinoDaLinha(l) }));
    },

    /**
     * As mensagens de um trabalho (a tela da task, ADR-083): as falas dos turnos dele, inclusive as do meio, e as da
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
    async janelaAte(conversaId: string, ancoraId: string, desde: number, limite = 100, opcoes: { comDestino?: boolean } = {}): Promise<Mensagem[]> {
      const daJanela = conn`
        m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and m.criado_em >= ${data(desde)}
          and (m.id = ${ancoraId} or m.criado_em <= (select criado_em from mensagens where tenant_id = ${escopo.tenantId} and id = ${ancoraId}))`;
      if (!opcoes.comDestino) {
        const linhas = await conn<LinhaMensagem[]>`
          select * from (
            select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens m where ${daJanela}
            order by criado_em desc, id desc limit ${limite}
          ) janela order by criado_em, id`;
        return linhas.map(paraMensagem);
      }
      // ADR-041, emenda do PR 2 do chat limpo (2026-10-18): na conversa própria o relato conta `limite` itens de chat, como a
      // janela da conversa (no Eng 1, 100 mensagens cruas davam umas 5 falas), e leva junto o que estava na Atividade nos
      // mesmos 15 min, desde o corte (até TETO_ANEXOS_DA_JANELA), cada um com o destino: o relato registra o que a pessoa viu.
      const comTurno = conn`left join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id`;
      const naoContam = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
      const contaNoChat = conn`(m.assunto is null or m.assunto <> all(${naoContam}::text[])) and not ${falaDeTrabalho(conn)}`;
      const linhas = await conn<(LinhaMensagem & { primeira: boolean | null })[]>`
        with chat as materialized (
          select m.id, m.criado_em from mensagens m ${comTurno} where ${daJanela} and ${contaNoChat}
          order by m.criado_em desc, m.id desc limit ${limite}
        ), corte as (
          select case when count(*) >= ${limite} then min(criado_em) end as em from chat
        ), fora as materialized (
          select m.id from mensagens m ${comTurno} where ${daJanela} and not (${contaNoChat})
            and m.criado_em >= coalesce((select em from corte), '-infinity'::timestamptz)
          order by m.criado_em desc, m.id desc limit ${TETO_ANEXOS_DA_JANELA}
        )
        select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m0.${c}`).join(", "))}, ${colunaPrimeira(conn, "m0")}
        from (select id from chat union all select id from fora) j
        join mensagens m0 on m0.tenant_id = ${escopo.tenantId} and m0.id = j.id
        order by m0.criado_em, m0.id`;
      return linhas.map((l) => ({ ...paraMensagem(l), destino: destinoDaLinha(l) }));
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

    /**
     * definido em 2026-10-15 (NOD-270): o balão `pedido_a_pessoa` de uma decisão — é ele que diz quem perguntou (a autoria
     * `decidido_por` da regra das voltas sem novidade), porque a decisão pendente não guarda a regra. Pelo turno da
     * decisão (o balão nasce no mesmo turno, na mesma transação), sem varrer a conversa.
     */
    async pedidoAPessoaDaDecisao(turnoId: string, decisaoId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and payload->>'kind' = 'pedido_a_pessoa' and payload->>'decisaoId' = ${decisaoId}
        order by criado_em, id limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * definido em 2026-10-18 (plano "pergunta com botões", Parte 4): os balões `pedido_a_pessoa` dos turnos das perguntas
     * de "Sua vez" numa consulta só (`turno_id = any(…)`, no índice mensagens_por_turno) — no lugar de uma
     * pedidoAPessoaDaDecisao por item —, com a origem do turno e a raiz da cadeia de retomadas (a mesma da conversa). A
     * RLS de mensagens decide o que volta: a decisora que não é dona da conversa não lê o balão (0002), e fica sem ele.
     */
    async pedidosAPessoaDasDecisoes(turnoIds: readonly string[]): Promise<Mensagem[]> {
      if (turnoIds.length === 0) return [];
      const linhas = await selectComTurno(conn, escopo.tenantId, conn`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
        where tenant_id = ${escopo.tenantId} and turno_id = any(${[...new Set(turnoIds)]}::uuid[]) and payload->>'kind' = 'pedido_a_pessoa'`);
      return linhas.map(paraMensagemComTurno);
    },

    async ultimaDaConversa(conversaId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc, id desc limit 1`;
      return l ? paraMensagem(l) : null;
    },

    /**
     * ultimaDaConversa de várias conversas numa consulta (a prévia da frota, definido em 2026-09-30): um LATERAL por conversa
     * no índice mensagens_por_conversa.
     *
     * revisto em 2026-10-18 (QA do PR 2 do chat limpo, ADR-114): a prévia é a última que o chat mostra. O que mora na
     * Atividade ou é anexo ("Anotei …", a negação, "Virou a frente", "Rotina executou") saiu do chat e não vira prévia; a
     * linha sem assunto (antes do backfill) continua entrando, como na janela.
     */
    async ultimasDasConversas(conversaIds: readonly string[]): Promise<Map<string, Mensagem>> {
      if (conversaIds.length === 0) return new Map();
      const foraDoChat = [...ASSUNTOS_ANEXO, ...ASSUNTOS_ATIVIDADE];
      const linhas = await conn<LinhaMensagem[]>`
        select u.* from unnest(${[...conversaIds]}::uuid[]) as c(id)
        cross join lateral (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
          where tenant_id = ${escopo.tenantId} and conversa_id = c.id and (assunto is null or assunto <> all(${foraDoChat}::text[]))
          order by criado_em desc, id desc limit 1
        ) u`;
      return new Map(linhas.map((l) => [l.conversa_id, paraMensagem(l)]));
    },

    async marcarParcial(id: string, parcial: boolean): Promise<boolean> {
      const r = await conn`update mensagens set parcial = ${parcial} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * ADR-108: o aviso de troca de IA é UM por bot — a segunda task que para atualiza a linha de sistema dele (texto e
     * payload), e a decisão grava o desfecho nela. Só linha de sistema da dona. `turnoId` liga a linha sem turno à fala da
     * conversa que parou depois (o "Continuar na conta" refaz essa fala); a que já tem turno fica com ele.
     */
    async atualizarSistema(id: string, m: { texto: string; payload: NonNullable<NovaMensagem["payload"]>; turnoId?: string | null }): Promise<boolean> {
      // Chat limpo (PR 1): o payload regravado recalcula o assunto (a troca de IA decidida continua "ia.troca").
      const r = await conn`update mensagens set texto = ${m.texto}, payload = ${conn.json(m.payload)}, turno_id = coalesce(turno_id, ${m.turnoId ?? null}),
          assunto = ${assuntoDe("sistema", m.payload, null)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and kind = 'sistema'`;
      return r.count === 1;
    },

    /** Turno interrompido no meio do streaming: a fala já gravada fica marcada como parcial (ADR-010). */
    async marcarParciaisDoTurno(turnoId: string): Promise<number> {
      const r = await conn`update mensagens set parcial = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} and autor_tipo = 'agente'`;
      return r.count;
    },
  };
}
