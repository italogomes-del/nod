import type { Visibilidade } from "../contracts/agente.ts";
import type { Conversa, TipoConversa } from "../contracts/conversa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  tipo: TipoConversa;
  agente_id: string | null;
  sala_id: string | null;
  sessao_cli: string | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, tipo, agente_id, sala_id, sessao_cli, criado_em";

const paraConversa = (l: Linha): Conversa => ({
  tenantId: l.tenant_id,
  id: l.id,
  ownerId: l.owner_id,
  visibility: l.visibility,
  tipo: l.tipo,
  agenteId: l.agente_id,
  salaId: l.sala_id,
  sessaoCli: l.sessao_cli,
  criadoEm: ms(l.criado_em),
});

export type NovaConversa =
  | { id?: string; tipo: "propria"; agenteId: string; visibility?: Visibilidade }
  | { id?: string; tipo: "sala"; salaId: string; visibility?: Visibilidade };

/** Conversa própria do bot ou da sala. sessao_cli = session_id do `claude -p` (1º --session-id, depois --resume). */
export function conversasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(c: NovaConversa): Promise<Conversa | null> {
      const agenteId = c.tipo === "propria" ? c.agenteId : null;
      const salaId = c.tipo === "sala" ? c.salaId : null;
      const [l] = await conn<Linha[]>`
        insert into conversas (tenant_id, id, owner_id, visibility, tipo, agente_id, sala_id)
        values (${escopo.tenantId}, ${c.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${c.visibility ?? "privado"}, ${c.tipo}, ${agenteId}, ${salaId})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConversa(l) : null;
    },

    async buscar(id: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraConversa(l) : null;
    },

    async buscarPropriaDoAgente(agenteId: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and tipo = 'propria' and agente_id = ${agenteId}
        order by criado_em limit 1`;
      return l ? paraConversa(l) : null;
    },

    async buscarDaSala(salaId: string): Promise<Conversa | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} and tipo = 'sala' and sala_id = ${salaId} order by criado_em limit 1`;
      return l ? paraConversa(l) : null;
    },

    async listar(): Promise<Conversa[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conversas where tenant_id = ${escopo.tenantId} order by criado_em`;
      return linhas.map(paraConversa);
    },

    async atualizarSessaoCli(id: string, sessaoCli: string | null): Promise<boolean> {
      const r = await conn`update conversas set sessao_cli = ${sessaoCli} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },
  };
}
