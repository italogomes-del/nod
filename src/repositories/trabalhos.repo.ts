import type { MotivoInterrupcao } from "../contracts/motivos.ts";
import type { EstadoTrabalho, OrigemTrabalho, Trabalho } from "../contracts/trabalho.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import type { FatosTrabalho } from "../domain/trabalho.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  agente_id: string;
  conversa_id: string;
  titulo: string;
  origem: OrigemTrabalho;
  pedido_por_agente_id: string | null;
  rotina_id: string | null;
  trabalho_mae_id: string | null;
  depois_de_trabalho_id: string | null;
  estado: EstadoTrabalho;
  sessao_cli: string | null;
  sessao_harness: string | null;
  pasta: string | null;
  memoria_mb: number | null;
  custo_usd: string | null;
  criado_em: Date;
  iniciado_em: Date | null;
  terminado_em: Date | null;
}

const COLUNAS =
  "tenant_id, id, agente_id, conversa_id, titulo, origem, pedido_por_agente_id, rotina_id, trabalho_mae_id, depois_de_trabalho_id, estado, sessao_cli, sessao_harness, pasta, memoria_mb, custo_usd, criado_em, iniciado_em, terminado_em";

const paraTrabalho = (l: Linha): Trabalho => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  titulo: l.titulo,
  origem: l.origem,
  pedidoPorAgenteId: l.pedido_por_agente_id,
  rotinaId: l.rotina_id,
  trabalhoMaeId: l.trabalho_mae_id,
  depoisDeTrabalhoId: l.depois_de_trabalho_id,
  estado: l.estado,
  sessaoCli: l.sessao_cli,
  sessaoHarness: l.sessao_harness,
  pasta: l.pasta,
  memoriaMb: l.memoria_mb,
  custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
  criadoEm: ms(l.criado_em),
  iniciadoEm: msOuNull(l.iniciado_em),
  terminadoEm: msOuNull(l.terminado_em),
});

export type NovoTrabalho = {
  id?: string;
  agenteId: string;
  conversaId: string;
  titulo: string;
  origem: OrigemTrabalho;
  pedidoPorAgenteId?: string | null;
  rotinaId?: string | null;
  trabalhoMaeId?: string | null;
  depoisDeTrabalhoId?: string | null;
  /** A rede de 2 min já nasce `rodando`, com a sessão do turno promovido. */
  estado?: EstadoTrabalho;
  sessaoCli?: string | null;
  sessaoHarness?: string | null;
  pasta?: string | null;
  iniciadoEm?: number | null;
};

/** O que a faixa, as listas e o prompt mostram além da linha: lido junto, numa consulta. */
/** `turnosAbertos`: pendentes e rodando (o computador ocupado olha os dois). */
export type ExtrasTrabalho = { pedidoPorNome: string | null; rotinaNome: string | null; ultimaFala: string | null; turnoVivoId: string | null; turnosAbertos: string[] };

/**
 * Trabalhos do bot (ADR-081, 0060). Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito sob RLS, escrita só
 * da dona (owner_id), T | null sem lançar. O estado é decidido em src/domain/trabalho.ts (estadoDoTrabalho) a partir de
 * `fatos`; aqui só se grava.
 */
export function trabalhosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(n: NovoTrabalho): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        insert into trabalhos (tenant_id, id, owner_id, agente_id, conversa_id, titulo, origem, pedido_por_agente_id, rotina_id, trabalho_mae_id,
          depois_de_trabalho_id, estado, sessao_cli, sessao_harness, pasta, iniciado_em)
        values (${escopo.tenantId}, ${n.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.titulo}, ${n.origem},
          ${n.pedidoPorAgenteId ?? null}, ${n.rotinaId ?? null}, ${n.trabalhoMaeId ?? null}, ${n.depoisDeTrabalhoId ?? null}, ${n.estado ?? "na_fila"},
          ${n.sessaoCli ?? null}, ${n.sessaoHarness ?? null}, ${n.pasta ?? null}, ${n.iniciadoEm === undefined || n.iniciadoEm === null ? null : data(n.iniciadoEm)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    async buscar(id: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraTrabalho(l) : null;
    },

    /** Com trava de linha: quem recalcula o estado serializa com o Parar e com a outra sincronização. */
    async buscarTravado(id: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and id = ${id} for update`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * Os abertos e os que terminaram desde `terminadosDesde` (a tela filtra "hoje" no fuso dela), do bot ou de todos
     * os bots da pessoa. Abertos primeiro, mais novos primeiro.
     */
    async listar(p: { agenteId?: string; terminadosDesde: number }): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} ${p.agenteId ? conn`and agente_id = ${p.agenteId}` : conn``}
          and (estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso') or terminado_em >= ${data(p.terminadosDesde)})
        order by (terminado_em is null) desc, criado_em desc, id desc
        limit 200`;
      return linhas.map(paraTrabalho);
    },

    async abertosDoAgente(agenteId: string): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and estado in ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso')
        order by criado_em, id`;
      return linhas.map(paraTrabalho);
    },

    /** Os trabalhos que uma task de rotina abriu (profundidade 1). */
    async filhos(maeId: string): Promise<Trabalho[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos where tenant_id = ${escopo.tenantId} and trabalho_mae_id = ${maeId} order by criado_em, id`;
      return linhas.map(paraTrabalho);
    },

    /** Grava o estado e os carimbos: `iniciado_em` na primeira vez que roda; `terminado_em` só nos finais (CHECK da 0060). */
    async mudarEstado(id: string, estado: EstadoTrabalho, agora: number): Promise<Trabalho | null> {
      const final = estado === "terminado" || estado === "parado" || estado === "falhou";
      const [l] = await conn<Linha[]>`
        update trabalhos set estado = ${estado},
          iniciado_em = case when ${estado === "rodando" || estado === "precisa_de_voce"} then coalesce(iniciado_em, ${data(agora)}) else iniciado_em end,
          terminado_em = ${final ? data(agora) : null}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    /** A sessão do CLI do trabalho (nunca a da conversa) e o harness que a criou, como conversas.sessao_harness (0030). */
    async atualizarSessao(id: string, sessaoCli: string, harness: string | null): Promise<boolean> {
      const r = await conn`
        update trabalhos set sessao_cli = ${sessaoCli}, sessao_harness = ${harness}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    async somarCusto(id: string, custoUsd: number): Promise<boolean> {
      const r = await conn`
        update trabalhos set custo_usd = coalesce(custo_usd, 0) + ${custoUsd}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** #194: a última leitura de memória do grupo de processos de cada turno lido, no trabalho dele. */
    async atualizarMemoria(porTurno: readonly { turnoId: string; mb: number }[]): Promise<number> {
      if (porTurno.length === 0) return 0;
      const r = await conn`
        update trabalhos w set memoria_mb = l.mb
        from (select unnest(${porTurno.map((p) => p.turnoId)}::uuid[]) as turno_id, unnest(${porTurno.map((p) => Math.max(0, Math.round(p.mb)))}::int[]) as mb) l
        join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = l.turno_id
        where w.tenant_id = ${escopo.tenantId} and w.owner_id = ${escopo.pessoaId} and w.id = t.trabalho_id`;
      return r.count;
    },

    /** "Fazer depois da …": grava a espera. Null tira. */
    async marcarDepoisDe(id: string, depoisDeId: string | null): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        update trabalhos set depois_de_trabalho_id = ${depoisDeId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTrabalho(l) : null;
    },

    /**
     * A rede de 2 min (#193): a próxima mensagem da conversa segue numa CÓPIA desta sessão quando ela é de um trabalho
     * `rede` (o turno promovido continua nela).
     */
    async redeComSessao(conversaId: string, sessaoCli: string): Promise<Trabalho | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trabalhos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and origem = 'rede' and sessao_cli = ${sessaoCli}
        order by criado_em desc limit 1`;
      return l ? paraTrabalho(l) : null;
    },

    /** O que decide o estado (src/domain/trabalho.ts), numa consulta. */
    async fatos(id: string): Promise<Omit<FatosTrabalho, "estadoAtual" | "iniciado"> | null> {
      const [l] = await conn<{ parando: number; despachando: number; pendentes: number; esperando: boolean; decisao: boolean; colega: boolean; ultimo_estado: EstadoTurno | null; ultimo_motivo: MotivoInterrupcao | null }[]>`
        select
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'despachando' and t.parar_solicitado_em is not null) as parando,
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'despachando' and t.parar_solicitado_em is null) as despachando,
          (select count(*)::int from turnos t where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado = 'pendente') as pendentes,
          exists (select 1 from trabalhos x join trabalhos dep on dep.tenant_id = x.tenant_id and dep.id = x.depois_de_trabalho_id
            where x.tenant_id = ${escopo.tenantId} and x.id = ${id} and dep.estado not in ('terminado', 'parado', 'falhou')) as esperando,
          exists (select 1 from decisoes d join turnos t on t.tenant_id = d.tenant_id and t.id = d.turno_id
            where d.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and d.estado in ('pendente', 'reaberta')) as decisao,
          -- definido em 2026-10-08 (revisão do épico, S3): pedido a colega feito por um turno do trabalho que não voltou —
          -- handoff com tarefaId sem peer_ask da mesma tarefa (a regra de pedidosEmAberto). O trabalho do colega já
          -- acabado sem peer_ask (a pessoa o parou) não segura este: senão ele ficaria rodando para sempre.
          exists (select 1 from mensagens h join turnos t on t.tenant_id = h.tenant_id and t.id = h.turno_id
            where h.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and h.kind = 'handoff' and h.payload->>'tarefaId' is not null
              and not exists (select 1 from mensagens r where r.tenant_id = h.tenant_id and r.conversa_id = h.conversa_id and r.kind = 'peer_ask'
                and r.payload->>'tarefaId' = h.payload->>'tarefaId')
              and not exists (select 1 from trabalhos c where c.tenant_id = h.tenant_id and c.id::text = h.payload->>'trabalhoId'
                and c.estado in ('terminado', 'parado', 'falhou'))) as colega,
          u.estado as ultimo_estado, u.motivo_interrupcao as ultimo_motivo
        from (select 1) um
        left join lateral (
          select estado, motivo_interrupcao from turnos t
          where t.tenant_id = ${escopo.tenantId} and t.trabalho_id = ${id} and t.estado in ('concluido', 'interrompido')
            and coalesce(t.motivo_interrupcao::text, '') <> 'absorvido'
          order by t.criado_em desc, t.id desc limit 1
        ) u on true`;
      return l ? { parando: l.parando, despachando: l.despachando, pendentes: l.pendentes, esperandoOutro: l.esperando, decisaoPendente: l.decisao, aguardandoColega: l.colega, ultimo: l.ultimo_estado ? { estado: l.ultimo_estado, motivo: l.ultimo_motivo } : null } : null;
    },

    /** Nome de quem pediu, da rotina, a última fala e o turno vivo de cada trabalho, numa consulta. */
    async extras(ids: readonly string[]): Promise<Map<string, ExtrasTrabalho>> {
      if (ids.length === 0) return new Map();
      const linhas = await conn<{ id: string; pedido_por_nome: string | null; rotina_instrucao: string | null; ultima_fala: string | null; turno_vivo_id: string | null; abertos: string[] | null }[]>`
        select w.id, a.nome as pedido_por_nome, r.instrucao as rotina_instrucao, f.texto as ultima_fala, v.id as turno_vivo_id,
          (select array_agg(t.id order by t.criado_em) from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado in ('pendente', 'despachando')) as abertos
        from trabalhos w
        left join agentes a on a.tenant_id = w.tenant_id and a.id = w.pedido_por_agente_id
        left join rotinas r on r.tenant_id = w.tenant_id and r.id = w.rotina_id
        left join lateral (
          select m.texto from mensagens m join turnos t on t.tenant_id = m.tenant_id and t.id = m.turno_id
          where m.tenant_id = w.tenant_id and t.trabalho_id = w.id and m.kind = 'texto' and m.autor_tipo = 'agente'
          order by m.criado_em desc, m.id desc limit 1
        ) f on true
        left join lateral (
          select t.id from turnos t where t.tenant_id = w.tenant_id and t.trabalho_id = w.id and t.estado = 'despachando' order by t.criado_em limit 1
        ) v on true
        where w.tenant_id = ${escopo.tenantId} and w.id = any(${[...ids]}::uuid[])`;
      return new Map(linhas.map((l) => [l.id, { pedidoPorNome: l.pedido_por_nome, rotinaNome: l.rotina_instrucao, ultimaFala: l.ultima_fala, turnoVivoId: l.turno_vivo_id, turnosAbertos: l.abertos ?? [] }]));
    },
  };
}
