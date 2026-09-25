import type { LinhaTrilha } from "../db/schema/trilha.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, iso } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  agente_id: string;
  turno_id: string | null;
  conector_id: string | null;
  ferramenta: string;
  kind: string;
  motivo: string | null;
  regra: string;
  regra_versao: number;
  em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, agente_id, turno_id, conector_id, ferramenta, kind, motivo, regra, regra_versao, em";

const paraLinha = (l: Linha): LinhaTrilha => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  agenteId: l.agente_id,
  turnoId: l.turno_id,
  conectorId: l.conector_id,
  ferramenta: l.ferramenta,
  kind: l.kind,
  motivo: l.motivo,
  regra: l.regra,
  regraVersao: l.regra_versao,
  em: iso(l.em),
});

export type NovaLinhaTrilha = {
  agenteId: string;
  turnoId?: string | null;
  conectorId?: string | null;
  ferramenta: string;
  /** ^[a-z0-9_]+$ (CHECK trilha_sem_texto_livre): 'tool_call', 'negacao', 'aprovacao_executada'… */
  kind: string;
  /** ^[a-z_]+$ ou null: os motivos de src/contracts/motivos.ts. */
  motivo?: string | null;
  /** ^[a-z0-9_:]+$: 'regra:montagem-ferramentas' NÃO passa (hífen); use 'regra:montagem_ferramentas'. */
  regra: string;
  regraVersao: number;
  em?: number;
};

/** Trilha imutável (ADR-004): só INSERT para nod_app; texto livre é recusado pelo CHECK, prosa vai em trilha_prosa. */
export function trilhaRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(t: NovaLinhaTrilha): Promise<LinhaTrilha | null> {
      const [l] = await conn<Linha[]>`
        insert into trilha (tenant_id, owner_id, agente_id, turno_id, conector_id, ferramenta, kind, motivo, regra, regra_versao, em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${t.agenteId}, ${t.turnoId ?? null}, ${t.conectorId ?? null}, ${t.ferramenta}, ${t.kind},
          ${t.motivo ?? null}, ${t.regra}, ${t.regraVersao}, ${t.em === undefined ? conn`now()` : data(t.em)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraLinha(l) : null;
    },

    /** As linhas de UM turno, na ordem em que aconteceram (ADR-047: o turno leu conteúdo de fora?). */
    async doTurno(turnoId: string): Promise<LinhaTrilha[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by em, id`;
      return linhas.map(paraLinha);
    },

    /** As linhas de vários turnos de uma vez (a conversa inteira, na delegação com sessão retomada). */
    async doTurnos(turnoIds: readonly string[]): Promise<LinhaTrilha[]> {
      if (turnoIds.length === 0) return [];
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha where tenant_id = ${escopo.tenantId} and turno_id = any(${[...turnoIds]}::uuid[]) order by em, id`;
      return linhas.map(paraLinha);
    },

    /**
     * GET trilha?dia&agente&conector (E8.4). `dia` é 'AAAA-MM-DD' no fuso dado (default UTC):
     * a comparação é feita no banco com a coluna em timestamptz.
     */
    async filtrar(f: { dia?: string; agenteId?: string; conectorId?: string; fuso?: string; limite?: number } = {}): Promise<LinhaTrilha[]> {
      const fuso = f.fuso ?? "UTC";
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trilha
        where tenant_id = ${escopo.tenantId}
          ${f.dia ? conn`and (em at time zone ${fuso})::date = ${f.dia}::date` : conn``}
          ${f.agenteId ? conn`and agente_id = ${f.agenteId}` : conn``}
          ${f.conectorId ? conn`and conector_id = ${f.conectorId}` : conn``}
        order by em desc, id desc limit ${f.limite ?? 500}`;
      return linhas.map(paraLinha);
    },
  };
}
