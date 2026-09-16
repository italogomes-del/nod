import type { Decisao, DesfechoDecisao, EstadoDecisao, TipoDecisao } from "../contracts/decisao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, iso, isoOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  decisor_id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string | null;
  tipo: TipoDecisao;
  estado: EstadoDecisao;
  prazo_decisao_em: Date;
  prazo_execucao_em: Date | null;
  frase: string;
  desfecho: DesfechoDecisao | null;
  vista_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, decisor_id, agente_id, conversa_id, turno_id, tipo, estado, prazo_decisao_em, prazo_execucao_em, frase, desfecho, vista_em, criado_em";

function paraDecisao(l: Linha): Decisao {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    decisorId: l.decisor_id,
    agenteId: l.agente_id,
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    tipo: l.tipo,
    estado: l.estado,
    prazoDecisaoEm: iso(l.prazo_decisao_em),
    prazoExecucaoEm: isoOuNull(l.prazo_execucao_em),
    frase: l.frase,
    desfecho: l.desfecho,
    vistaEm: isoOuNull(l.vista_em),
    criadoEm: iso(l.criado_em),
  };
}

export type NovaDecisao = {
  id?: string;
  tipo: TipoDecisao;
  /** Default: a própria pessoa da sessão (dona). Pessoa nomeada em pedir_a_pessoa entra aqui (EMENDA 16). */
  decisorId?: string;
  agenteId: string;
  conversaId: string;
  turnoId?: string | null;
  prazoDecisaoEm: number;
  prazoExecucaoEm?: number | null;
  frase: string;
};

/** definido em 2026-09-16: vencidas ficam visíveis em cinza por 7 dias (ADR-007: nunca suprimidas de imediato). */
export const VENCIDAS_VISIVEIS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pendências de "Sua vez" (ADR-007). Duas pernas de RLS (EMENDA 1): dono vê pela owner_id, decisor
 * pela perna extra — e a leitura de listarSuaVez roda sob a policy do role nod_app, nunca com
 * role privilegiado mais filtro na aplicação.
 *
 * Escrita pela DECISORA (0003): marcarVista/decidir/reabrir aceitam dona OU decisora designada —
 * a policy nod_decisora (FOR UPDATE, USING e WITH CHECK por decisor_id) é quem concede; o filtro
 * explícito abaixo existe para a linha 'equipe' de terceiros devolver null em vez de 42501
 * (contrato: repositório devolve null, nunca lança). vencerPendentes e as escritas de laço
 * continuam pela dona (paraCadaPessoa). Provado em tests/integration/repos/decisora-escreve.test.ts.
 */
export function decisoesRepo(conn: Conn, escopo: Escopo) {
  const donaOuDecisora = (): ReturnType<Conn> => conn`(owner_id = ${escopo.pessoaId} or decisor_id = ${escopo.pessoaId})`;
  return {
    async criar(d: NovaDecisao): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`
        insert into decisoes (tenant_id, id, owner_id, decisor_id, agente_id, conversa_id, turno_id, tipo, prazo_decisao_em, prazo_execucao_em, frase)
        values (${escopo.tenantId}, ${d.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${d.decisorId ?? escopo.pessoaId}, ${d.agenteId}, ${d.conversaId},
          ${d.turnoId ?? null}, ${d.tipo}, ${data(d.prazoDecisaoEm)}, ${dataOuNull(d.prazoExecucaoEm)}, ${d.frase})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    async buscar(id: string): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * "Sua vez" da pessoa da sessão como DECISORA: pendentes, reabertas e vencidas recentes, com o
     * estado como COLUNA (vencido em cinza, nunca suprimido). agenteNome vem por LEFT JOIN porque o
     * agente de outra pessoa pode ser invisível para a decisora (RLS): cai em 'agente'.
     */
    async listarSuaVez(agora: number): Promise<(Decisao & { agenteNome: string })[]> {
      const linhas = await conn<(Linha & { agente_nome: string | null })[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `d.${c}`).join(", "))}, a.nome as agente_nome
        from decisoes d left join agentes a on a.tenant_id = d.tenant_id and a.id = d.agente_id
        where d.tenant_id = ${escopo.tenantId} and d.decisor_id = ${escopo.pessoaId}
          and (d.estado in ('pendente', 'reaberta') or (d.estado = 'vencida' and d.prazo_decisao_em >= ${data(agora - VENCIDAS_VISIVEIS_MS)}))
        order by d.criado_em`;
      return linhas.map((l) => ({ ...paraDecisao(l), agenteNome: l.agente_nome ?? "agente" }));
    },

    async pendentesDaConversa(conversaId: string): Promise<Decisao[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from decisoes where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado in ('pendente', 'reaberta') order by criado_em`;
      return linhas.map(paraDecisao);
    },

    async marcarVista(id: string, agora: number): Promise<boolean> {
      const r = await conn`update decisoes set vista_em = coalesce(vista_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id}`;
      return r.count === 1;
    },

    /** Só decide o que está aberto; a segunda chamada devolve null (idempotência na rota). */
    async decidir(id: string, p: { por: string; agora: number }): Promise<Decisao | null> {
      const desfecho: DesfechoDecisao = { tipo: "decidida", por: p.por, em: iso(p.agora) };
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'decidida', desfecho = ${conn.json(desfecho)}, decidida_em = ${data(p.agora)}, decidida_por = ${p.por}
        where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id} and estado in ('pendente', 'reaberta')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /** Reabrir volta ao topo com prazo novo e sem desfecho (ADR-007). */
    async reabrir(id: string, prazoDecisaoEm: number): Promise<Decisao | null> {
      const [l] = await conn<Linha[]>`
        update decisoes set estado = 'reaberta', prazo_decisao_em = ${data(prazoDecisaoEm)}, desfecho = null
        where tenant_id = ${escopo.tenantId} and ${donaOuDecisora()} and id = ${id} and estado = 'vencida'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraDecisao(l) : null;
    },

    /**
     * Varredor de expiração (ADR-007/017): pendentes com prazo vencido viram 'vencida' com o desfecho
     * que diz se alguém VIU (vista_em) — os dois rótulos da métrica de expiração.
     */
    async vencerPendentes(agora: number): Promise<Decisao[]> {
      const em = iso(agora);
      const linhas = await conn<Linha[]>`
        update decisoes set estado = 'vencida',
          desfecho = case when vista_em is null
            then ${conn.json({ tipo: "expirou_sem_ninguem_ver", em })}
            else ${conn.json({ tipo: "expirou_com_alguem_ciente", em })} end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado in ('pendente', 'reaberta') and prazo_decisao_em <= ${data(agora)}
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraDecisao);
    },

    /** Idempotência do varredor (ADR-011): true só na primeira vez de (decisão, tipo_de_evento). */
    async marcarVarrida(id: string, tipoDeEvento: string): Promise<boolean> {
      const linhas = await conn`
        insert into decisao_eventos_varridos (tenant_id, owner_id, decisao_id, tipo_de_evento)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${tipoDeEvento})
        on conflict (tenant_id, decisao_id, tipo_de_evento) do nothing returning id`;
      return linhas.length === 1;
    },

    /** Carimbo de "Nada esperando por você · última decisão em …" (ADR-007). */
    async ultimaDecisaoEm(): Promise<string | null> {
      const [l] = await conn<{ em: Date | null }[]>`
        select max(decidida_em) as em from decisoes where tenant_id = ${escopo.tenantId} and decisor_id = ${escopo.pessoaId}`;
      return isoOuNull(l?.em ?? null);
    },
  };
}
