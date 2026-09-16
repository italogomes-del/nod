import type { EstadoProposta, KindProposta, PayloadProposta, Proposta } from "../contracts/conversa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  conversa_id: string;
  agente_id: string;
  kind: KindProposta;
  estado: EstadoProposta;
  payload: PayloadProposta;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, conversa_id, agente_id, kind, estado, payload, criado_em";

const paraProposta = (l: Linha): Proposta => ({
  tenantId: l.tenant_id,
  id: l.id,
  conversaId: l.conversa_id,
  agenteId: l.agente_id,
  kind: l.kind,
  estado: l.estado,
  payload: l.payload,
  criadoEm: ms(l.criado_em),
});

export type NovaProposta = { id?: string; conversaId: string; agenteId: string; payload: PayloadProposta };

/** Proposta do modelo (ferramenta tipada): nada aplicado antes da confirmação (E1.1). kind vem do payload. */
export function propostasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(p: NovaProposta): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`
        insert into propostas (tenant_id, id, owner_id, conversa_id, agente_id, kind, payload)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.conversaId}, ${p.agenteId}, ${p.payload.kind}, ${conn.json(p.payload)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProposta(l) : null;
    },

    async buscar(id: string): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraProposta(l) : null;
    },

    async pendentesDaConversa(conversaId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'pendente' order by criado_em`;
      return linhas.map(paraProposta);
    },

    /** Só sai de 'pendente': confirmar/recusar duas vezes devolve null (idempotência para a rota). */
    async decidir(id: string, estado: "confirmada" | "recusada"): Promise<Proposta | null> {
      const [l] = await conn<Linha[]>`
        update propostas set estado = ${estado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente' returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraProposta(l) : null;
    },
  };
}
