import { IDADE_MAX_PEDIDO_RETOMAVEL_MS, MOTIVOS_DE_QUEDA, type PedidoParado } from "../domain/pedido-parado.ts";
import type { PedidoAberto } from "../domain/triagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

/** Estados de um trabalho ainda aberto (o mesmo recorte do índice `trabalhos_pedidos_abertos` da 0071). */
const ABERTOS = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"] as const;

/**
 * Os pedidos entre bots vistos pela triagem do dono (definido em 2026-10-12, ADR-099 itens 1a e 8, issue I7 revista).
 * Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito sob RLS. Quem decide é o caso de uso
 * (src/use-cases/pedir-a-bot.ts, pedidos-parados.ts) com as regras puras de src/domain/triagem.ts.
 */
export function pedidosDeColegaRepo(conn: Conn, escopo: Escopo) {
  return {
    /**
     * Serializa os pedidos entre bots do tenant até o fim da transação: a checagem de espera circular lê os pedidos
     * abertos, e dois pedidos cruzados ao mesmo tempo (A→B e B→A) a liam antes de o outro gravar — o mesmo padrão do
     * `travarEsperas` do "Fazer depois da …". Pedidos são raros (um por chamada de ferramenta): a trava é curta.
     */
    async travar(): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext('pedir_a_bot'))`;
    },

    /**
     * Os pedidos ainda sem resposta (a aresta `de → para` da espera circular), de duas fontes:
     * - o `handoff` de quem pediu, desde `desde`, sem `peer_ask` da mesma tarefa (nem resultado nem aviso de falha) e sem
     *   a task de colega de antes já acabada — cobre o pedido de antes (task de colega) e o que entra pela triagem do dono;
     * - a frente aberta para o pedido de um colega (`pedido_por_agente_id`), enquanto ela não acaba.
     */
    async abertos(desde: number, filtro: { de?: string } = {}): Promise<PedidoAberto[]> {
      // NOD-259: com o pedido em si (tarefaId, criadoEm, texto = `motivo` do handoff) e, opcional, só os de um bot.
      const de = filtro.de ?? null;
      const linhas = await conn<{ de: string; para: string; tarefa_id: string | null; criado_em: Date; texto: string | null }[]>`
        select m.payload->>'de' as de, m.payload->>'para' as para, m.payload->>'tarefaId' as tarefa_id, m.criado_em, m.payload->>'motivo' as texto from mensagens m
        where m.tenant_id = ${escopo.tenantId} and m.kind = 'handoff' and m.payload->>'tarefaId' is not null and m.criado_em >= ${data(desde)}
          and (${de}::text is null or m.payload->>'de' = ${de}::text)
          and not exists (select 1 from mensagens r where r.tenant_id = m.tenant_id and r.conversa_id = m.conversa_id and r.kind = 'peer_ask'
            and r.payload->>'tarefaId' = m.payload->>'tarefaId')
          and not exists (select 1 from trabalhos k where k.tenant_id = m.tenant_id and k.id::text = m.payload->>'trabalhoId'
            and k.estado in ('terminado', 'parado', 'falhou'))
        union
        select w.pedido_por_agente_id::text, w.agente_id::text, null, w.criado_em, null from trabalhos w
        where w.tenant_id = ${escopo.tenantId} and w.pedido_por_agente_id is not null and w.estado = any(${[...ABERTOS]}::text[])
          and (${de}::text is null or w.pedido_por_agente_id::text = ${de}::text)`;
      return linhas
        .filter((l) => l.de && l.para)
        .map((l) => ({ de: l.de, para: l.para, tarefaId: l.tarefa_id, criadoEm: l.criado_em.getTime(), texto: l.texto }));
    },

    /**
     * Dos bots dados, os livres agora (ADR-099 item 8, "o bot pode sugerir um colega livre"): sem turno vivo (despachando)
     * e sem turno pronto na fila — a volta marcada para depois não conta, ela só espera.
     */
    async livres(agenteIds: readonly string[], agora: number): Promise<string[]> {
      if (agenteIds.length === 0) return [];
      const linhas = await conn<{ id: string }[]>`
        select a.id from agentes a
        where a.tenant_id = ${escopo.tenantId} and a.id = any(${[...agenteIds]}::uuid[])
          and not exists (select 1 from turnos t where t.tenant_id = a.tenant_id and t.agente_id = a.id
            and (t.estado = 'despachando' or (t.estado = 'pendente' and (t.acordar_em is null or t.acordar_em <= ${data(agora)}))))`;
      const livres = new Set(linhas.map((l) => l.id));
      return agenteIds.filter((id) => livres.has(id));
    },

    /**
     * Quantas frentes ainda abertas há nos lotes que estes turnos abriram e que ainda não foram devolvidos (0071). É o
     * "aguardando_frentes" da entrega ao colega e do desfecho da rotina: o turno de triagem que abriu frentes não é o fim
     * do pedido. A I3 marca o lote devolvido (`marcarDevolvido`) antes de entregar; com isso o lote sai daqui.
     */
    async frentesAbertasDosTurnos(turnoIds: readonly string[]): Promise<number> {
      if (turnoIds.length === 0) return 0;
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from lotes_de_frentes l
        join trabalhos w on w.tenant_id = l.tenant_id and w.lote_id = l.id
        where l.tenant_id = ${escopo.tenantId} and l.aberto_por_turno_id = any(${[...turnoIds]}::uuid[]) and l.devolvido_em is null
          and w.estado = any(${[...ABERTOS]}::text[])`;
      return l?.n ?? 0;
    },

    /**
     * Quantas esperas de comando (0070, ADR-099 parte 2) estes turnos deixaram rodando. A triagem que espera uma dependência
     * por `esperar_comando` não entregou o resultado: ele sai na retomada, quando o comando acaba (aguardando_volta).
     */
    async esperasRodandoDosTurnos(turnoIds: readonly string[]): Promise<number> {
      if (turnoIds.length === 0) return 0;
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from esperas where tenant_id = ${escopo.tenantId} and turno_id = any(${[...turnoIds]}::uuid[]) and estado = 'rodando'`;
      return l?.n ?? 0;
    },

    /**
     * Pedidos que entraram pela triagem do dono e caíram (definido em 2026-10-12, ADR-099 item 8 e emenda à ADR-084): o
     * mesmo formato de `trabalhos.pedidosAColegaParados`, para a mesma regra (src/domain/pedido-parado.ts). Handoff sem
     * `trabalhoId` (o pedido não virou task), feito desde `desde`, sem `peer_ask` da tarefa, com quem pediu ainda no ar; a
     * tarefa é o turno `delegacao` do dono, fora de trabalho, e a cadeia de retomadas dele não tem turno vivo nem na fila
     * e acabou interrompida (o concluído já entregou ou espera frentes, volta ou colega: não é parado). Até 20, os mais
     * antigos primeiro; `adiados` como no outro (#218).
     */
    async triagensParadas(desde: number, agora: number, adiados: readonly string[] = []): Promise<PedidoParado[]> {
      const linhas = await conn<{
        tarefa_id: string; ultimo_id: string; ultimo_motivo: string | null; queda_em: Date | null; quedas: number;
        card_id: string | null; card_estado: string | null; sinal: boolean;
      }[]>`
        with recursive pedidos as (
          select h.id as handoff_id, h.criado_em, d.id as tarefa_id, d.owner_id from mensagens h
          join turnos d on d.tenant_id = h.tenant_id and d.id::text = h.payload->>'tarefaId' and d.origem = 'delegacao' and d.trabalho_id is null
          where h.tenant_id = ${escopo.tenantId} and h.owner_id = ${escopo.pessoaId} and h.kind = 'handoff'
            and h.payload->>'trabalhoId' is null
            -- NOD-241 (revisão): piso da idade do pedido; sem ele, a janela pela queda faria a cadeia recursiva varrer o histórico todo.
            and h.criado_em >= ${data(agora - IDADE_MAX_PEDIDO_RETOMAVEL_MS)}
            and exists (select 1 from agentes a where a.tenant_id = h.tenant_id and a.id::text = h.payload->>'de' and a.excluido_em is null)
            and not exists (select 1 from mensagens r where r.tenant_id = h.tenant_id and r.conversa_id = h.conversa_id and r.kind = 'peer_ask'
              and r.payload->>'tarefaId' = h.payload->>'tarefaId')
            and not (h.payload->>'tarefaId' = any(${[...adiados]}::text[]))
        ), cadeia(raiz, id, n) as (
          select p.tarefa_id, p.tarefa_id, 0 from pedidos p
          union all
          select c.raiz, r.id, c.n + 1 from cadeia c
          join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada'
          where c.n < 10
        )
        select p.tarefa_id, u.id as ultimo_id, u.motivo_interrupcao as ultimo_motivo, coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) as queda_em,
          (select count(*)::int from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
            where c.raiz = p.tarefa_id and q.estado = 'interrompido' and q.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[])) as quedas,
          k.id as card_id, k.estado as card_estado,
          exists (select 1 from turnos v where v.tenant_id = ${escopo.tenantId} and v.owner_id = p.owner_id
            and v.criado_em > coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em)
            and (v.estado = 'concluido' or (v.estado = 'despachando' and v.lease_ate > ${data(agora)}))) as sinal
        from pedidos p
        join lateral (
          select q.id, q.estado, q.motivo_interrupcao, q.ultimo_sinal_em, q.lease_ate, q.criado_em from cadeia c join turnos q on q.tenant_id = ${escopo.tenantId} and q.id = c.id
          where c.raiz = p.tarefa_id and coalesce(q.motivo_interrupcao::text, '') <> 'absorvido'
          order by q.criado_em desc, q.id desc limit 1
        ) u on true
        left join lateral (
          select d.id, d.estado from decisoes d where d.tenant_id = ${escopo.tenantId} and d.turno_id = u.id and d.tipo = 'retomar_turno'
          order by d.criado_em desc limit 1
        ) k on true
        where u.estado = 'interrompido'
          -- NOD-241: a janela conta da queda quando o último turno caiu; senão, do pedido (como antes).
          and (p.criado_em >= ${data(desde)} or (u.motivo_interrupcao::text = any(${[...MOTIVOS_DE_QUEDA]}::text[]) and coalesce(u.ultimo_sinal_em, u.lease_ate, u.criado_em) >= ${data(desde)}))
          and not exists (select 1 from cadeia c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
            where c.raiz = p.tarefa_id and v.estado in ('pendente', 'despachando'))
        order by p.criado_em, p.handoff_id
        limit 20`;
      return linhas.map((l) => {
        const cardAberto = l.card_estado === "pendente" || l.card_estado === "reaberta";
        return {
          tarefaId: l.tarefa_id,
          trabalhoColegaId: null,
          // Sem task, o estado vem do último turno: com o "Retomar" aberto ele espera a pessoa; sem, caiu.
          estadoColega: cardAberto ? "precisa_de_voce" : "falhou",
          ultimoTurnoId: l.ultimo_id,
          ultimoMotivo: l.ultimo_motivo,
          quedaEm: msOuNull(l.queda_em),
          quedas: l.quedas,
          cardRetomar: l.card_id ? { id: l.card_id, aberto: cardAberto } : null,
          sinalDepoisDaQueda: l.sinal,
          textoFinal: null,
          turnoDoTextoFinal: null,
        };
      });
    },
  };
}
