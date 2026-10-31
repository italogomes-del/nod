import type { AutorLote, LoteQuadro, Quadro, StatusTarefa, TarefaQuadro } from "../contracts/quadro.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms, msOuNull } from "./conversao.ts";

interface LinhaQuadro {
  id: string;
  agente_id: string;
  meta: string;
  prazo: string | null;
  cumprido_em: Date | null;
  resumo: string | null;
  criado_em: Date;
  atualizado_em: Date;
}

interface LinhaTarefa {
  id: string;
  quadro_id: string;
  titulo: string;
  descricao: string;
  status: StatusTarefa;
  agente_id: string | null;
  ordem: number;
  linear_id: string | null;
  linear_url: string | null;
  pr_url: string | null;
  pergunta: string | null;
  resposta: string | null;
  de_fora: boolean;
  turno_id: string | null;
  criado_em: Date;
  mudado_em: Date;
}

interface LinhaLote {
  id: string;
  quadro_id: string;
  autor: "pessoa" | "agente";
  autor_agente_id: string | null;
  resumo: string;
  antes: FotoLote;
  tarefa_ids: string[];
  desfeito_em: Date | null;
  criado_em: Date;
}

/** A foto do antes de um lote (o Desfazer volta a ela). `antes: null` = nasceu no lote; `quadro: null` = o quadro nasceu no lote. */
export type FotoLote = {
  quadro: Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo"> | null;
  tarefas: { id: string; antes: TarefaQuadro | null }[];
};

const COLUNAS_Q = "id, agente_id, to_char(prazo, 'YYYY-MM-DD') as prazo, meta, cumprido_em, resumo, criado_em, atualizado_em";
const COLUNAS_T = "id, quadro_id, titulo, descricao, status, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em";
const COLUNAS_L = "id, quadro_id, autor, autor_agente_id, resumo, antes, tarefa_ids, desfeito_em, criado_em";

const paraQuadro = (l: LinhaQuadro): Quadro => ({
  id: l.id,
  agenteId: l.agente_id,
  meta: l.meta,
  prazo: l.prazo,
  cumpridoEm: msOuNull(l.cumprido_em),
  resumo: l.resumo,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
});

const paraTarefa = (l: LinhaTarefa): TarefaQuadro => ({
  id: l.id,
  quadroId: l.quadro_id,
  titulo: l.titulo,
  descricao: l.descricao,
  status: l.status,
  agenteId: l.agente_id,
  ordem: l.ordem,
  linearId: l.linear_id,
  linearUrl: l.linear_url,
  prUrl: l.pr_url,
  pergunta: l.pergunta,
  resposta: l.resposta,
  deFora: l.de_fora,
  turnoId: l.turno_id,
  criadoEm: ms(l.criado_em),
  mudadoEm: ms(l.mudado_em),
});

const paraLote = (l: LinhaLote): LoteQuadro & { antes: FotoLote } => ({
  id: l.id,
  quadroId: l.quadro_id,
  autor: (l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" }) satisfies AutorLote,
  resumo: l.resumo,
  antes: l.antes,
  tarefaIds: l.tarefa_ids,
  desfeitoEm: msOuNull(l.desfeito_em),
  criadoEm: ms(l.criado_em),
});

export type NovaTarefa = Pick<TarefaQuadro, "quadroId" | "titulo" | "descricao" | "status" | "agenteId"> & Partial<Pick<TarefaQuadro, "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora">>;

/** O que muda numa tarefa (tudo menos ids e datas de criação). */
export type CamposTarefa = Pick<TarefaQuadro, "titulo" | "descricao" | "status" | "agenteId" | "ordem" | "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora" | "turnoId">;

/**
 * definido em 2026-10-31 (NOD-442): o quadro-agente, as tarefas e os lotes. Só primitivas: quem aplica um lote (e trava
 * o quadro com `buscarTravado` antes) é src/use-cases/quadro.ts.
 */
export function quadrosRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    async buscar(id: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = ${id}`;
      return l ? paraQuadro(l) : null;
    },
    /** Trava a linha do quadro: um lote por vez em cada quadro (duas abas, dois bots). */
    async buscarTravado(id: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = ${id} for update`;
      return l ? paraQuadro(l) : null;
    },
    async doAgente(agenteId: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and agente_id = ${agenteId}`;
      return l ? paraQuadro(l) : null;
    },
    /**
     * O quadro da tarefa que este turno executa (o turno de uma tarefa mexe no quadro dela). A tarefa guarda o turno que a
     * começou; a retomada (ADR-009: turno novo com `retoma_turno_id`, depois de um cartão, da espera de CI, da resposta de
     * um colega) sobe a cadeia até ele (revisão rodada 6; teto de 50 saltos contra ciclo, como raizDaCadeia).
     */
    async doTurno(turnoId: string): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        with recursive sobe(id, retoma, n) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, t.retoma_turno_id, s.n + 1 from turnos t join sobe s on t.tenant_id = ${escopo.tenantId} and t.id = s.retoma where s.n < 50
        )
        select ${conn.unsafe(COLUNAS_Q)} from quadros where ${dona()} and id = (
          select qt.quadro_id from quadro_tarefas qt join sobe s on qt.turno_id = s.id
          where qt.tenant_id = ${escopo.tenantId} and qt.owner_id = ${escopo.pessoaId} order by s.n limit 1)`;
      return l ? paraQuadro(l) : null;
    },
    /** Os quadros da pessoa (de bots não excluídos), mais recente primeiro. */
    async listar(): Promise<Quadro[]> {
      const ls = await conn<LinhaQuadro[]>`
        select q.id, q.agente_id, to_char(q.prazo, 'YYYY-MM-DD') as prazo, q.meta, q.cumprido_em, q.resumo, q.criado_em, q.atualizado_em
        from quadros q join agentes a on a.tenant_id = q.tenant_id and a.id = q.agente_id
        where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId} and a.excluido_em is null
        order by q.atualizado_em desc`;
      return ls.map(paraQuadro);
    },
    /** null = o bot já tem quadro (um por anfitrião). */
    async criar(q: { agenteId: string; meta: string; prazo: string | null }): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        insert into quadros (tenant_id, owner_id, agente_id, meta, prazo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${q.agenteId}, ${q.meta}, ${q.prazo}::date)
        on conflict (tenant_id, agente_id) do nothing
        returning ${conn.unsafe(COLUNAS_Q)}`;
      return l ? paraQuadro(l) : null;
    },
    async salvar(id: string, q: Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo">): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        update quadros set meta = ${q.meta}, prazo = ${q.prazo}::date, cumprido_em = ${q.cumpridoEm === null ? null : new Date(q.cumpridoEm)},
          resumo = ${q.resumo}, atualizado_em = clock_timestamp()
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_Q)}`;
      return l ? paraQuadro(l) : null;
    },
    /** Só o Desfazer da criação apaga (as tarefas e os lotes vão no CASCADE). */
    async apagar(id: string): Promise<boolean> {
      const r = await conn`delete from quadros where ${dona()} and id = ${id}`;
      return r.count > 0;
    },

    async tarefas(quadroId: string): Promise<TarefaQuadro[]> {
      const ls = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and quadro_id = ${quadroId} order by ordem, criado_em, id`;
      return ls.map(paraTarefa);
    },
    async tarefa(id: string): Promise<TarefaQuadro | null> {
      const [l] = await conn<LinhaTarefa[]>`select ${conn.unsafe(COLUNAS_T)} from quadro_tarefas where ${dona()} and id = ${id}`;
      return l ? paraTarefa(l) : null;
    },
    async inserirTarefa(t: NovaTarefa): Promise<TarefaQuadro> {
      const [l] = await conn<LinhaTarefa[]>`
        insert into quadro_tarefas (tenant_id, owner_id, quadro_id, titulo, descricao, status, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.agenteId},
          (select coalesce(max(ordem), 0) + 1 from quadro_tarefas where ${dona()} and quadro_id = ${t.quadroId}),
          ${t.linearId ?? null}, ${t.linearUrl ?? null}, ${t.prUrl ?? null}, ${t.pergunta ?? null}, ${t.resposta ?? null}, ${t.deFora ?? false})
        returning ${conn.unsafe(COLUNAS_T)}`;
      return paraTarefa(l!);
    },
    async salvarTarefa(id: string, c: CamposTarefa): Promise<TarefaQuadro | null> {
      const [l] = await conn<LinhaTarefa[]>`
        update quadro_tarefas set titulo = ${c.titulo}, descricao = ${c.descricao}, status = ${c.status}, agente_id = ${c.agenteId},
          ordem = ${c.ordem}, linear_id = ${c.linearId}, linear_url = ${c.linearUrl}, pr_url = ${c.prUrl}, pergunta = ${c.pergunta},
          resposta = ${c.resposta}, de_fora = ${c.deFora}, turno_id = ${c.turnoId}, mudado_em = clock_timestamp()
        where ${dona()} and id = ${id}
        returning ${conn.unsafe(COLUNAS_T)}`;
      return l ? paraTarefa(l) : null;
    },
    async apagarTarefa(id: string): Promise<boolean> {
      const r = await conn`delete from quadro_tarefas where ${dona()} and id = ${id}`;
      return r.count > 0;
    },
    /** O Desfazer de uma exclusão: a tarefa volta com o mesmo id e as mesmas datas. */
    async restaurarTarefa(t: TarefaQuadro): Promise<TarefaQuadro> {
      const [l] = await conn<LinhaTarefa[]>`
        insert into quadro_tarefas (tenant_id, owner_id, id, quadro_id, titulo, descricao, status, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.id}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.agenteId}, ${t.ordem},
          ${t.linearId}, ${t.linearUrl}, ${t.prUrl}, ${t.pergunta}, ${t.resposta}, ${t.deFora ?? false}, ${t.turnoId}, ${new Date(t.criadoEm)}, clock_timestamp())
        on conflict (tenant_id, id) do update set titulo = excluded.titulo, descricao = excluded.descricao, status = excluded.status,
          agente_id = excluded.agente_id, ordem = excluded.ordem, linear_id = excluded.linear_id, linear_url = excluded.linear_url,
          pr_url = excluded.pr_url, pergunta = excluded.pergunta, resposta = excluded.resposta, de_fora = excluded.de_fora, turno_id = excluded.turno_id, mudado_em = clock_timestamp()
        returning ${conn.unsafe(COLUNAS_T)}`;
      return paraTarefa(l!);
    },
    /**
     * O estado da execução de cada tarefa, pelo turno que ela guarda (o que a começou): a cadeia de retomadas desce dele
     * e vale o turno vivo mais recente (senão, o mais recente). O que recebeu o Parar e ainda não parou conta como
     * interrompido: não é vivo para o Desfazer nem para quem planeja o lote (revisão rodada 6).
     */
    async estadosDosTurnos(ids: readonly string[]): Promise<Map<string, EstadoTurno>> {
      if (ids.length === 0) return new Map();
      const ls = await conn<{ raiz: string; estado: EstadoTurno; parado: boolean }[]>`
        with recursive desce(raiz, id, n) as (
          select id, id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = any(${conn.array([...ids])}::uuid[])
          union all
          select d.raiz, t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select distinct on (d.raiz) d.raiz, t.estado, t.parar_solicitado_em is not null as parado
        from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id
        order by d.raiz, (t.estado in ('pendente', 'despachando') and t.parar_solicitado_em is null) desc, t.criado_em desc, d.n desc`;
      return new Map(ls.map((l) => [l.raiz, l.parado && (l.estado === "pendente" || l.estado === "despachando") ? "interrompido" : l.estado]));
    },
    /** A cadeia de retomadas que desce do turno de uma tarefa (ele incluso): o Parar vale para ela inteira. */
    async cadeiaDoTurno(turnoId: string): Promise<{ id: string; estado: EstadoTurno }[]> {
      return conn<{ id: string; estado: EstadoTurno }[]>`
        with recursive desce(id, n) as (
          select id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${turnoId}
          union all
          select t.id, d.n + 1 from turnos t join desce d on t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = d.id where d.n < 50
        )
        select t.id, t.estado from desce d join turnos t on t.tenant_id = ${escopo.tenantId} and t.id = d.id`;
    },

    async inserirLote(l: { quadroId: string; autor: AutorLote; resumo: string; antes: FotoLote; tarefaIds: readonly string[] }): Promise<LoteQuadro> {
      const [r] = await conn<LinhaLote[]>`
        insert into quadro_lotes (tenant_id, owner_id, quadro_id, autor, autor_agente_id, resumo, antes, tarefa_ids)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${l.quadroId}, ${l.autor.tipo}, ${l.autor.tipo === "agente" ? l.autor.agenteId : null},
          ${l.resumo}, ${jsonb(conn, l.antes)}, ${conn.array([...l.tarefaIds])}::uuid[])
        returning ${conn.unsafe(COLUNAS_L)}`;
      const { antes: _antes, ...lote } = paraLote(r!);
      return lote;
    },
    async lote(id: string): Promise<(LoteQuadro & { antes: FotoLote }) | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_L)} from quadro_lotes where ${dona()} and id = ${id}`;
      return r ? paraLote(r) : null;
    },
    /** O último lote ainda não desfeito do quadro (só ele se desfaz: a pilha não volta duas casas). */
    async ultimoLote(quadroId: string): Promise<(LoteQuadro & { antes: FotoLote }) | null> {
      const [r] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_L)} from quadro_lotes where ${dona()} and quadro_id = ${quadroId} order by criado_em desc, id desc limit 1`;
      return r && r.desfeito_em === null ? paraLote(r) : null;
    },
    async marcarDesfeito(id: string): Promise<boolean> {
      const r = await conn`update quadro_lotes set desfeito_em = clock_timestamp() where ${dona()} and id = ${id} and desfeito_em is null`;
      return r.count > 0;
    },
  };
}
