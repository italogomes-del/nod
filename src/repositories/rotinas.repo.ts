import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  conversa_id: string;
  cron: string;
  fuso_iana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limites_aprovacao: string;
  politica_sem_dado: string;
  exige_aprovacao: boolean;
  estado: EstadoRotina;
  proxima_execucao: Date;
  criado_em: Date;
  excluido_em: Date | null;
}

const COLUNAS =
  "tenant_id, id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao, politica_sem_dado, exige_aprovacao, case when exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.geracao_execucao = rotinas.geracao_execucao and a.excluido_em is null) then estado else 'pausada'::estado_rotina end as estado, proxima_execucao, criado_em, excluido_em";

const paraRotina = (l: Linha): Rotina => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  ownerId: l.owner_id,
  cron: l.cron,
  fusoIana: l.fuso_iana,
  instrucao: l.instrucao,
  fonte: l.fonte,
  entregavel: l.entregavel,
  limitesAprovacao: l.limites_aprovacao,
  politicaSemDado: l.politica_sem_dado,
  exigeAprovacao: l.exige_aprovacao,
  estado: l.estado,
  proximaExecucao: ms(l.proxima_execucao),
  criadoEm: ms(l.criado_em),
  excluidoEm: l.excluido_em ? ms(l.excluido_em) : null,
});

export type NovaRotina = {
  id?: string;
  agenteId: string;
  conversaId: string;
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** Omitido = DEFAULT true da coluna (E7.3): o gate nasce ligado por schema. */
  exigeAprovacao?: boolean;
  estado?: EstadoRotina;
  proximaExecucao: number;
};

/** Rotinas (ADR-011): quem avalia cron é o servidor; o repositório só guarda proxima_execucao. */
export function rotinasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(r: NovaRotina): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        insert into rotinas (tenant_id, id, owner_id, agente_id, conversa_id, cron, fuso_iana, instrucao, fonte, entregavel, limites_aprovacao,
          politica_sem_dado, exige_aprovacao, estado, proxima_execucao)
        values (${escopo.tenantId}, ${r.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${r.agenteId}, ${r.conversaId}, ${r.cron}, ${r.fusoIana},
          ${r.instrucao}, ${r.fonte}, ${r.entregavel}, ${r.limitesAprovacao}, ${r.politicaSemDado},
          ${r.exigeAprovacao === undefined ? conn`default` : r.exigeAprovacao}, ${r.estado ?? "ativa"}, ${data(r.proximaExecucao)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    async buscar(id: string): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraRotina(l) : null;
    },

    async listar(): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and excluido_em is null and exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.excluido_em is null) order by criado_em`;
      return linhas.map(paraRotina);
    },

    async listarDoAgente(agenteId: string): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from rotinas where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and excluido_em is null order by criado_em`;
      return linhas.map(paraRotina);
    },

    /** Para podeCriarRotina (50 por bot, src/domain/rotina-limites.ts). */
    async contarDoAgente(agenteId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from rotinas where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and excluido_em is null`;
      return l?.n ?? 0;
    },

    /** O tick do scheduler (L7): ativas da pessoa cuja próxima execução já passou. */
    async ativasVencidas(agora: number): Promise<Rotina[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from rotinas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'ativa' and excluido_em is null and exists (select 1 from agentes a where a.tenant_id = rotinas.tenant_id and a.id = rotinas.agente_id and a.excluido_em is null and a.geracao_execucao = rotinas.geracao_execucao) and proxima_execucao <= ${data(agora)}
        order by proxima_execucao`;
      return linhas.map(paraRotina);
    },

    async atualizarEstado(id: string, estado: EstadoRotina): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`update rotinas set estado = ${estado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    /**
     * Aplica a atualização JÁ NORMALIZADA do payload da proposta (E7.1). Campo ausente fica como
     * está — por isso `coalesce` com null em vez de montar SQL dinâmico. Só a dona: como em
     * atualizarEstado/reagendar, devolve null para quem não é (a perna de equipe só abre LEITURA).
     * O trigger nod_rotina_agente_ativo é `UPDATE OF estado ... WHEN (NEW.estado = 'ativa')`
     * (0011), então este UPDATE não passa por ele: mexer em cron/instrução de rotina de agente
     * excluído não levanta 23514 — conferido em 2026-09-21.
     */
    async atualizar(id: string, campos: Partial<Pick<Rotina, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado" | "proximaExecucao">>): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set
          cron = coalesce(${campos.cron ?? null}, cron),
          fuso_iana = coalesce(${campos.fusoIana ?? null}, fuso_iana),
          instrucao = coalesce(${campos.instrucao ?? null}, instrucao),
          fonte = coalesce(${campos.fonte ?? null}, fonte),
          entregavel = coalesce(${campos.entregavel ?? null}, entregavel),
          limites_aprovacao = coalesce(${campos.limitesAprovacao ?? null}, limites_aprovacao),
          politica_sem_dado = coalesce(${campos.politicaSemDado ?? null}, politica_sem_dado),
          proxima_execucao = coalesce(${campos.proximaExecucao === undefined ? null : data(campos.proximaExecucao)}, proxima_execucao)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    /**
     * Exclusão RECUPERÁVEL (ADR-034): carimba excluido_em e some das listagens, do teto e do tick.
     * Nunca DELETE — a trilha é imutável (ADR-004) e as execuções passadas continuam existindo.
     * Idempotente: `excluido_em is null` faz a segunda chamada devolver null sem reescrever a data.
     */
    async excluir(id: string, em: number): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set excluido_em = ${data(em)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },

    async reagendar(id: string, proximaExecucao: number): Promise<Rotina | null> {
      const [l] = await conn<Linha[]>`
        update rotinas set proxima_execucao = ${data(proximaExecucao)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraRotina(l) : null;
    },
  };
}
