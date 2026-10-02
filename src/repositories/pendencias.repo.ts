import type { EstadoPendencia, Pendencia } from "../contracts/pendencia.ts";
import { paraProfundidade } from "../domain/profundidade.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string | null;
  texto: string;
  a_partir_de: Date | null;
  cuidado: boolean;
  profundidade: number;
  estado: EstadoPendencia;
  resolvida_em: Date | null;
  resolvida_por: "bot" | "pessoa" | null;
  motivo: string | null;
  pedida_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, agente_id, conversa_id, turno_id, texto, a_partir_de, cuidado, profundidade, estado, resolvida_em, resolvida_por, motivo, pedida_em, criado_em";

const paraPendencia = (l: Linha): Pendencia => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  turnoId: l.turno_id,
  texto: l.texto,
  aPartirDe: msOuNull(l.a_partir_de),
  cuidado: l.cuidado,
  profundidade: paraProfundidade(l.profundidade),
  estado: l.estado,
  resolvidaEm: msOuNull(l.resolvida_em),
  resolvidaPor: l.resolvida_por,
  motivo: l.motivo,
  pedidaEm: msOuNull(l.pedida_em),
  criadoEm: ms(l.criado_em),
});

export type NovaPendencia = {
  agenteId: string;
  conversaId: string;
  turnoId: string | null;
  texto: string;
  aPartirDe: number | null;
  cuidado: boolean;
  profundidade: number;
};

export type Resolucao = { estado: "feita" | "descartada"; por: "bot" | "pessoa"; turnoId: string | null; motivo: string | null; agora: number };

/** Pendências do bot (ADR-064, 0044): o que ele deixou para depois, aberta até concluir ou descartar. */
export function pendenciasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(n: NovaPendencia): Promise<Pendencia | null> {
      const [l] = await conn<Linha[]>`
        insert into pendencias (tenant_id, owner_id, agente_id, conversa_id, turno_id, texto, a_partir_de, cuidado, profundidade)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.turnoId}, ${n.texto}, ${dataOuNull(n.aPartirDe)}, ${n.cuidado}, ${n.profundidade})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraPendencia(l) : null;
    },

    async buscar(id: string): Promise<Pendencia | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from pendencias where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraPendencia(l) : null;
    },

    /** As abertas do bot, com hora futura ou não: a tela mostra todas; o prompt filtra (pendenciasDoPrompt). */
    async abertasDoAgente(agenteId: string): Promise<Pendencia[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from pendencias
        where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} and estado = 'aberta'
        order by criado_em desc, id desc`;
      return linhas.map(paraPendencia);
    },

    /** Só resolve a que ainda está aberta: duas resoluções simultâneas, a segunda volta null. */
    async resolver(id: string, r: Resolucao): Promise<Pendencia | null> {
      const [l] = await conn<Linha[]>`
        update pendencias set estado = ${r.estado}, resolvida_em = ${data(r.agora)}, resolvida_por = ${r.por},
          resolvida_no_turno_id = ${r.turnoId}, motivo = ${r.motivo}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'aberta'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraPendencia(l) : null;
    },

    /** O "Fazer agora": marca o pedido se o último foi há mais de `repedirAposMs`; senão volta null (duplo clique). */
    async marcarPedida(id: string, agora: number, repedirAposMs: number): Promise<Pendencia | null> {
      const [l] = await conn<Linha[]>`
        update pendencias set pedida_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'aberta'
          and (pedida_em is null or pedida_em <= ${data(agora - repedirAposMs)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraPendencia(l) : null;
    },

    /** Quantas o turno resolveu: na rotina, resolver uma pendência é novidade (sem-novidade.ts). */
    async resolvidasNoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from pendencias where tenant_id = ${escopo.tenantId} and resolvida_no_turno_id = ${turnoId}`;
      return l?.n ?? 0;
    },
  };
}
