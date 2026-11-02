import type { AutorLote, ColunaQuadro, IdColuna, LinhaDeSistema, LoteQuadro, PrDaTarefa, Quadro, TarefaQuadro, TipoLinhaTarefa } from "../contracts/quadro.ts";
import type { EstadoTurno } from "../contracts/turno.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { jsonb, ms, msOuNull } from "./conversao.ts";

interface LinhaQuadro {
  id: string;
  agente_id: string;
  meta: string | null;
  prazo: string | null;
  cumprido_em: Date | null;
  resumo: string | null;
  colunas: ColunaQuadro[] | null;
  criado_em: Date;
  atualizado_em: Date;
  meta_desde: Date;
}

interface LinhaTarefa {
  id: string;
  quadro_id: string;
  titulo: string;
  descricao: string;
  status: IdColuna;
  voltar_para: IdColuna | null;
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
  terminada_em: Date | null;
}

interface LinhaLote {
  id: string;
  quadro_id: string;
  autor: "pessoa" | "agente";
  autor_agente_id: string | null;
  pedido_por: string | null;
  resumo: string;
  antes: FotoLote;
  tarefa_ids: string[];
  desfeito_em: Date | null;
  criado_em: Date;
}

/** A foto do antes de um lote (o Desfazer volta a ela). `antes: null` = nasceu no lote; `quadro: null` = o quadro nasceu no lote. */
export type FotoLote = {
  /** `metaDesde` falta nas fotos de antes da 0136: o Desfazer mantém o valor atual. `colunas` ausente = foto de antes da
   *  NOD-448 (o Desfazer não mexe nas colunas). */
  quadro: (Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo"> & { metaDesde?: number; colunas?: ColunaQuadro[] | null }) | null;
  tarefas: { id: string; antes: TarefaQuadro | null }[];
};

const COLUNAS_Q = "id, agente_id, to_char(prazo, 'YYYY-MM-DD') as prazo, meta, cumprido_em, resumo, colunas, criado_em, atualizado_em, meta_desde";
const COLUNAS_T = "id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em, terminada_em";
const COLUNAS_L = "id, quadro_id, autor, autor_agente_id, pedido_por, resumo, antes, tarefa_ids, desfeito_em, criado_em";

const paraQuadro = (l: LinhaQuadro): Quadro => ({
  id: l.id,
  agenteId: l.agente_id,
  meta: l.meta,
  prazo: l.prazo,
  cumpridoEm: msOuNull(l.cumprido_em),
  resumo: l.resumo,
  colunas: l.colunas ?? null,
  criadoEm: ms(l.criado_em),
  atualizadoEm: ms(l.atualizado_em),
  metaDesde: ms(l.meta_desde),
});

/** O Desfazer devolve o `terminadaEm` da foto; a foto de antes da revisão 3 não tem o campo: fechada = o `mudadoEm` dela. */
function terminadaDaFoto(t: TarefaQuadro): Date | null {
  const v = t.terminadaEm !== undefined ? t.terminadaEm : t.status === "feito" || t.status === "cancelado" ? t.mudadoEm : null;
  return v === null ? null : new Date(v);
}

const paraTarefa = (l: LinhaTarefa): TarefaQuadro => ({
  id: l.id,
  quadroId: l.quadro_id,
  titulo: l.titulo,
  descricao: l.descricao,
  status: l.status,
  voltarPara: l.voltar_para ?? null,
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
  terminadaEm: l.terminada_em ? ms(l.terminada_em) : null,
});

const paraLote = (l: LinhaLote): LoteQuadro & { antes: FotoLote } => ({
  id: l.id,
  quadroId: l.quadro_id,
  autor: (l.autor === "agente" && l.autor_agente_id ? { tipo: "agente", agenteId: l.autor_agente_id } : { tipo: "pessoa" }) satisfies AutorLote,
  pedidoPor: l.pedido_por,
  resumo: l.resumo,
  antes: l.antes,
  tarefaIds: l.tarefa_ids,
  desfeitoEm: msOuNull(l.desfeito_em),
  criadoEm: ms(l.criado_em),
});

export type NovaTarefa = Pick<TarefaQuadro, "quadroId" | "titulo" | "descricao" | "status" | "agenteId"> & Partial<Pick<TarefaQuadro, "voltarPara" | "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora" | "terminadaEm">>;

/** O que muda numa tarefa (tudo menos ids e datas de criação). */
export type CamposTarefa = Pick<TarefaQuadro, "titulo" | "descricao" | "status" | "voltarPara" | "agenteId" | "ordem" | "linearId" | "linearUrl" | "prUrl" | "pergunta" | "resposta" | "deFora" | "turnoId" | "terminadaEm">;

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
        select q.id, q.agente_id, to_char(q.prazo, 'YYYY-MM-DD') as prazo, q.meta, q.cumprido_em, q.resumo, q.colunas, q.criado_em, q.atualizado_em, q.meta_desde
        from quadros q join agentes a on a.tenant_id = q.tenant_id and a.id = q.agente_id
        where q.tenant_id = ${escopo.tenantId} and q.owner_id = ${escopo.pessoaId} and a.excluido_em is null
        order by q.atualizado_em desc`;
      return ls.map(paraQuadro);
    },
    /** null = o bot já tem quadro (um por anfitrião). */
    async criar(q: { agenteId: string; meta: string | null; prazo: string | null; metaDesde?: number }): Promise<Quadro | null> {
      const [l] = await conn<LinhaQuadro[]>`
        insert into quadros (tenant_id, owner_id, agente_id, meta, prazo, meta_desde)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${q.agenteId}, ${q.meta}, ${q.prazo}::date, coalesce(${q.metaDesde === undefined ? null : new Date(q.metaDesde)}::timestamptz, now()))
        on conflict (tenant_id, agente_id) do nothing
        returning ${conn.unsafe(COLUNAS_Q)}`;
      return l ? paraQuadro(l) : null;
    },
    /** `metaDesde` ausente = mantém. `colunas` ausente = não mexe nelas (a foto de antes da NOD-448 e quem só muda a meta). */
    async salvar(id: string, q: Pick<Quadro, "meta" | "prazo" | "cumpridoEm" | "resumo"> & { metaDesde?: number; colunas?: ColunaQuadro[] | null }): Promise<Quadro | null> {
      const mexe = q.colunas !== undefined;
      const colunas = q.colunas ? jsonb(conn, q.colunas) : null;
      const [l] = await conn<LinhaQuadro[]>`
        update quadros set meta = ${q.meta}, prazo = ${q.prazo}::date, cumprido_em = ${q.cumpridoEm === null ? null : new Date(q.cumpridoEm)},
          resumo = ${q.resumo}, colunas = case when ${mexe}::boolean then ${colunas}::jsonb else colunas end,
          meta_desde = coalesce(${q.metaDesde === undefined ? null : new Date(q.metaDesde)}::timestamptz, meta_desde), atualizado_em = clock_timestamp()
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
        insert into quadro_tarefas (tenant_id, owner_id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, terminada_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.voltarPara ?? null}, ${t.agenteId},
          (select coalesce(max(ordem), 0) + 1 from quadro_tarefas where ${dona()} and quadro_id = ${t.quadroId}),
          ${t.linearId ?? null}, ${t.linearUrl ?? null}, ${t.prUrl ?? null}, ${t.pergunta ?? null}, ${t.resposta ?? null}, ${t.deFora ?? false}, ${t.terminadaEm == null ? null : new Date(t.terminadaEm)})
        returning ${conn.unsafe(COLUNAS_T)}`;
      return paraTarefa(l!);
    },
    async salvarTarefa(id: string, c: CamposTarefa): Promise<TarefaQuadro | null> {
      const [l] = await conn<LinhaTarefa[]>`
        update quadro_tarefas set titulo = ${c.titulo}, descricao = ${c.descricao}, status = ${c.status}, voltar_para = ${c.voltarPara ?? null}, agente_id = ${c.agenteId},
          ordem = ${c.ordem}, linear_id = ${c.linearId}, linear_url = ${c.linearUrl}, pr_url = ${c.prUrl}, pergunta = ${c.pergunta},
          resposta = ${c.resposta}, de_fora = ${c.deFora}, turno_id = ${c.turnoId}, mudado_em = clock_timestamp(),
          terminada_em = ${c.terminadaEm === null ? null : new Date(c.terminadaEm)}
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
        insert into quadro_tarefas (tenant_id, owner_id, id, quadro_id, titulo, descricao, status, voltar_para, agente_id, ordem, linear_id, linear_url, pr_url, pergunta, resposta, de_fora, turno_id, criado_em, mudado_em, terminada_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.id}, ${t.quadroId}, ${t.titulo}, ${t.descricao}, ${t.status}, ${t.voltarPara ?? null}, ${t.agenteId}, ${t.ordem},
          ${t.linearId}, ${t.linearUrl}, ${t.prUrl}, ${t.pergunta}, ${t.resposta}, ${t.deFora ?? false}, ${t.turnoId}, ${new Date(t.criadoEm)}, clock_timestamp(), ${terminadaDaFoto(t)})
        on conflict (tenant_id, id) do update set titulo = excluded.titulo, descricao = excluded.descricao, status = excluded.status, voltar_para = excluded.voltar_para,
          agente_id = excluded.agente_id, ordem = excluded.ordem, linear_id = excluded.linear_id, linear_url = excluded.linear_url,
          pr_url = excluded.pr_url, pergunta = excluded.pergunta, resposta = excluded.resposta, de_fora = excluded.de_fora, turno_id = excluded.turno_id, mudado_em = clock_timestamp(), terminada_em = excluded.terminada_em
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

    /** NOD-430: `pedidoPor` = a pessoa que pediu ao bot autor na conversa (só com autor agente; o bot é o `autor_agente_id`). */
    async inserirLote(l: { quadroId: string; autor: AutorLote; pedidoPor?: string | null; resumo: string; antes: FotoLote; tarefaIds: readonly string[] }): Promise<LoteQuadro> {
      const pedidoPor = l.autor.tipo === "agente" && l.pedidoPor ? l.pedidoPor : null;
      const [r] = await conn<LinhaLote[]>`
        insert into quadro_lotes (tenant_id, owner_id, quadro_id, autor, autor_agente_id, pedido_por, resumo, antes, tarefa_ids)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${l.quadroId}, ${l.autor.tipo}, ${l.autor.tipo === "agente" ? l.autor.agenteId : null},
          ${pedidoPor},
          ${l.resumo}, ${jsonb(conn, l.antes)}, ${conn.array([...l.tarefaIds])}::uuid[])
        returning ${conn.unsafe(COLUNAS_L)}`;
      const { antes: _antes, ...lote } = paraLote(r!);
      return lote;
    },
    /**
     * NOD-430: a Atividade da tarefa aberta: os `limite` lotes MAIS RECENTES que a tocaram (os desfeitos fora), em ordem
     * de criação. Desc com limite e vira na aplicação (revisão 1 do PR #627): com `order by criado_em limit 50`, uma
     * tarefa com mais de 50 lotes mostrava os 50 primeiros e nunca o que acabou de acontecer.
     */
    async lotesDaTarefa(quadroId: string, tarefaId: string, limite = 50): Promise<LoteQuadro[]> {
      const rs = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_L)} from quadro_lotes
        where ${dona()} and quadro_id = ${quadroId} and ${tarefaId}::uuid = any(tarefa_ids) and desfeito_em is null
        order by criado_em desc, id desc limit ${limite}`;
      return rs.reverse().map((r) => { const { antes: _antes, ...lote } = paraLote(r); return lote; });
    },
    /** NOD-430 (revisão 2 do PR #627): o lote mais antigo da tarefa (o "criada por"), fora da janela dos 50 recentes. */
    async primeiroLoteDaTarefa(quadroId: string, tarefaId: string): Promise<LoteQuadro | null> {
      const [r] = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_L)} from quadro_lotes
        where ${dona()} and quadro_id = ${quadroId} and ${tarefaId}::uuid = any(tarefa_ids) and desfeito_em is null
        order by criado_em, id limit 1`;
      if (!r) return null;
      const { antes: _antes, ...lote } = paraLote(r);
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
    /**
     * NOD-421 (0142): os PRs ligados às tarefas do quadro, no último estado visto. Lê pelas tarefas que estão no quadro
     * agora (revisão do PR #621): a tarefa que mudou de quadro leva os PRs junto, sem "PR ligado" de novo.
     */
    async prsDoQuadro(quadroId: string): Promise<(PrDaTarefa & { tarefaId: string; mergePendente: boolean })[]> {
      const ls = await conn<LinhaPr[]>`
        select tarefa_id, repo, numero, url, branch, estado, ci, conflito, merge_pendente from quadro_tarefa_prs
        where ${dona()} and tarefa_id in (select id from quadro_tarefas where ${dona()} and quadro_id = ${quadroId}) order by repo, numero`;
      return ls.map((l) => ({ tarefaId: l.tarefa_id, repo: l.repo, numero: l.numero, url: l.url, branch: l.branch, estado: l.estado, ci: l.ci, conflito: l.conflito, mergePendente: l.merge_pendente }));
    },
    /** 4ª revisão do PR #621: o merge pendente da tarefa (fimDosPrs), o mesmo valor em todos os PRs dela. */
    async definirMergePendente(tarefaId: string, pendente: boolean): Promise<void> {
      await conn`update quadro_tarefa_prs set merge_pendente = ${pendente} where ${dona()} and tarefa_id = ${tarefaId} and merge_pendente is distinct from ${pendente}`;
    },
    /**
     * 2ª revisão do PR #621: insert … select da tarefa da DONA. O RLS do insert só confere o owner da linha nova e a FK
     * não passa pelo RLS: com `values`, a Ana gravava um PR na tarefa do Marlon. Tarefa que não é dela = nada (false).
     */
    async salvarPr(quadroId: string, tarefaId: string, p: PrDaTarefa): Promise<boolean> {
      const r = await conn`
        insert into quadro_tarefa_prs (tenant_id, owner_id, quadro_id, tarefa_id, repo, numero, url, branch, estado, ci, conflito)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, id, ${p.repo}, ${p.numero}, ${p.url}, ${p.branch}, ${p.estado}, ${p.ci}, ${p.conflito}
        from quadro_tarefas where ${dona()} and id = ${tarefaId}
        on conflict (tenant_id, tarefa_id, repo, numero) do update set quadro_id = excluded.quadro_id, url = excluded.url, branch = excluded.branch,
          estado = excluded.estado, ci = excluded.ci, conflito = excluded.conflito, visto_em = clock_timestamp()`;
      return r.count > 0;
    },
    /** O card e o resumo da meta leem pr_url: sem PR gravado, o primeiro PR ligado entra (não mexe no mudado_em). */
    async definirPrUrlSeVazio(tarefaId: string, url: string): Promise<boolean> {
      const r = await conn`update quadro_tarefas set pr_url = ${url} where ${dona()} and id = ${tarefaId} and pr_url is null`;
      return r.count > 0;
    },
    /** Como salvarPr: só na tarefa da dona (false = a tarefa não é dela, nada gravado). */
    async inserirLinha(quadroId: string, tarefaId: string, l: { tipo: TipoLinhaTarefa; texto: string; dados: object }): Promise<boolean> {
      const r = await conn`
        insert into quadro_tarefa_linhas (tenant_id, owner_id, quadro_id, tarefa_id, tipo, texto, dados)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${quadroId}, id, ${l.tipo}, ${l.texto}, ${jsonb(conn, l.dados)}
        from quadro_tarefas where ${dona()} and id = ${tarefaId}`;
      return r.count > 0;
    },
    /** NOD-421 (revisão do PR #621): o aviso do GitHub no topo do quadro (null = nada a avisar). */
    async avisoGithub(quadroId: string): Promise<string | null> {
      const [l] = await conn<{ aviso_github: string | null }[]>`select aviso_github from quadros where ${dona()} and id = ${quadroId}`;
      return l?.aviso_github ?? null;
    },
    /** Grava só se mudou (true = mudou): o aviso aparece uma vez até mudar. Não mexe no atualizado_em do quadro. */
    async definirAvisoGithub(quadroId: string, aviso: string | null): Promise<boolean> {
      const r = await conn`update quadros set aviso_github = ${aviso} where ${dona()} and id = ${quadroId} and aviso_github is distinct from ${aviso}`;
      return r.count > 0;
    },
    /** As linhas de sistema das tarefas do quadro (as da tarefa, mesmo de antes de ela mudar de quadro): as `porTarefa` mais recentes de cada, da mais antiga para a mais nova. */
    async linhasDoQuadro(quadroId: string, porTarefa = 20): Promise<(LinhaDeSistema & { tarefaId: string })[]> {
      const ls = await conn<{ tarefa_id: string; tipo: TipoLinhaTarefa; texto: string; criado_em: Date }[]>`
        select tarefa_id, tipo, texto, criado_em from (
          select tarefa_id, tipo, texto, criado_em, row_number() over (partition by tarefa_id order by criado_em desc, id desc) as n
          from quadro_tarefa_linhas where ${dona()} and tarefa_id in (select id from quadro_tarefas where ${dona()} and quadro_id = ${quadroId})
        ) x where n <= ${porTarefa} order by criado_em, tarefa_id`;
      return ls.map((l) => ({ tarefaId: l.tarefa_id, tipo: l.tipo, texto: l.texto, criadoEm: ms(l.criado_em) }));
    },
  };
}

interface LinhaPr {
  tarefa_id: string;
  repo: string;
  numero: number;
  url: string;
  branch: string;
  estado: PrDaTarefa["estado"];
  ci: PrDaTarefa["ci"];
  conflito: boolean;
  merge_pendente: boolean;
}
