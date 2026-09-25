import type { EstadoProposta, KindProposta, PayloadProposta, PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

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
  /** O pedido de rotina pendente para (agente, app) — a linha do índice único da 0026, se houver. */
  async function acessoDeRotinaAberto(agenteId: string, conector: string): Promise<Proposta | null> {
    const [l] = await conn<Linha[]>`
      select ${conn.unsafe(COLUNAS)} from propostas
      where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and payload->>'conector' = ${conector}
        and kind = 'acesso' and estado = 'pendente' and payload ? 'rotinaId'`;
    return l ? paraProposta(l) : null;
  }

  return {
    acessoDeRotinaAberto,

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

    /**
     * Pedido de acesso vindo de ROTINA (definido em 2026-09-24, emenda da ADR-044): UM pendente por
     * (dona, agente, app), qualquer que seja a rotina — índice propostas_acesso_de_rotina_aberta (0026).
     * INSERT ... ON CONFLICT DO NOTHING e, perdendo, devolve o que já estava: duas rotinas no mesmo tick,
     * ou pedir_acesso contra o pré-voo, nunca viram 23505. Quem perde para uma tx ainda aberta espera o
     * commit dela no índice e então lê a linha commitada. `criada` diz quem inseriu (só ele abre a decisão).
     */
    async criarAcessoDeRotina(p: { id?: string; conversaId: string; agenteId: string; payload: PayloadPropostaAcesso & { rotinaId: string } }): Promise<{ proposta: Proposta; criada: boolean } | null> {
      const [l] = await conn<Linha[]>`
        insert into propostas (tenant_id, id, owner_id, conversa_id, agente_id, kind, payload)
        values (${escopo.tenantId}, ${p.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${p.conversaId}, ${p.agenteId}, 'acesso', ${conn.json(p.payload)})
        on conflict (tenant_id, owner_id, agente_id, (payload->>'conector')) where kind = 'acesso' and estado = 'pendente' and payload ? 'rotinaId' do nothing
        returning ${conn.unsafe(COLUNAS)}`;
      if (l) return { proposta: paraProposta(l), criada: true };
      const existente = await acessoDeRotinaAberto(p.agenteId, p.payload.conector);
      return existente ? { proposta: existente, criada: false } : null;
    },

    /** Pedidos de acesso pendentes que ESTA rotina abriu (pelo pré-voo ou por pedir_acesso num turno dela). */
    async pendentesDeAcessoDaRotina(rotinaId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and kind = 'acesso' and estado = 'pendente' and payload->>'rotinaId' = ${rotinaId}
        order by criado_em, id`;
      return linhas.map(paraProposta);
    },

    /**
     * definido em 2026-09-25: os cards "Conecte o X" desta pessoa ainda abertos, em qualquer conversa —
     * quando o login do app termina, cada um vira o card de permitir sem a pessoa voltar a ele (ao-conectar-app.ts).
     */
    async conexoesPendentes(conector: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and kind = 'acesso' and estado = 'pendente'
          and payload->>'conector' = ${conector} and payload ? 'conectar'
        order by criado_em, id`;
      return linhas.map(paraProposta);
    },

    async pendentesDaConversa(conversaId: string): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'pendente' order by criado_em`;
      return linhas.map(paraProposta);
    },

    /** Pendentes de acesso criadas em [desde, ate): o varredor acha o card de conexão que venceu (ADR-047). */
    async acessosPendentesCriadosEntre(desde: number, ate: number): Promise<Proposta[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from propostas where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente' and kind = 'acesso'
          and criado_em >= ${data(desde)} and criado_em < ${data(ate)} order by criado_em`;
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
