import type { Autoria } from "../contracts/evento.ts";
import type { Confianca, KindMensagem, Mensagem, PayloadMensagem } from "../contracts/mensagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

export interface LinhaMensagem {
  tenant_id: string;
  id: string;
  conversa_id: string;
  turno_id: string | null;
  autor_tipo: Autoria["autor_tipo"];
  autor_id: string;
  sob_procuracao_de: string | null;
  conta_de_execucao: string;
  executor: Autoria["executor"];
  locality: Autoria["locality"];
  locality_reason: Autoria["locality_reason"];
  machine_id: string | null;
  decidido_por: Autoria["decidido_por"];
  regra_versao: number;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  parcial: boolean;
  criado_em: Date;
}

export const COLUNAS_MENSAGEM =
  "tenant_id, id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial, criado_em";

export function paraMensagem(l: LinhaMensagem): Mensagem {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    turnoId: l.turno_id,
    autoria: {
      autor_tipo: l.autor_tipo,
      autor_id: l.autor_id,
      sob_procuracao_de: l.sob_procuracao_de,
      conta_de_execucao: l.conta_de_execucao,
      executor: l.executor,
      locality: l.locality,
      locality_reason: l.locality_reason,
      machine_id: l.machine_id,
      decidido_por: l.decidido_por,
      regra_versao: l.regra_versao,
    },
    kind: l.kind,
    texto: l.texto,
    payload: l.payload,
    confianca: l.confianca,
    parcial: l.parcial,
    criadoEm: ms(l.criado_em),
  };
}

export type NovaMensagem = {
  id?: string;
  conversaId: string;
  turnoId?: string | null;
  autoria: Autoria;
  kind: KindMensagem;
  texto: string;
  payload?: PayloadMensagem | null;
  /** NOT NULL no banco (ADR-026): quem grava DECLARA a confiança do conteúdo. */
  confianca: Confianca;
  parcial?: boolean;
};

/** Mensagens com autoria composta (ADR-023/025). A da sala é lida por quem tem grant (perna via sala_id). */
export function mensagensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMensagem): Promise<Mensagem | null> {
      const a = m.autoria;
      const [l] = await conn<LinhaMensagem[]>`
        insert into mensagens (tenant_id, id, owner_id, conversa_id, turno_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
          executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, payload, confianca, parcial)
        values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.conversaId}, ${m.turnoId ?? null}, ${a.autor_tipo}, ${a.autor_id},
          ${a.sob_procuracao_de}, ${a.conta_de_execucao}, ${a.executor}, ${a.locality}, ${a.locality_reason}, ${a.machine_id}, ${a.decidido_por},
          ${a.regra_versao}, ${m.kind}, ${m.texto}, ${m.payload === undefined || m.payload === null ? null : conn.json(m.payload)}, ${m.confianca}, ${m.parcial ?? false})
        returning ${conn.unsafe(COLUNAS_MENSAGEM)}`;
      return l ? paraMensagem(l) : null;
    },

    async buscar(id: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraMensagem(l) : null;
    },

    /** Em ordem de criação; `limite` corta pelas mais recentes (a resposta volta crescente). */
    async listarDaConversa(conversaId: string, limite = 200): Promise<Mensagem[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select * from (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
          order by criado_em desc, id desc limit ${limite}
        ) recentes order by criado_em, id`;
      return linhas.map(paraMensagem);
    },

    /**
     * A mensagem apontada e as que a precedem dentro da janela, para o relato anexar o contexto
     * (ADR-041). Usa o índice mensagens_por_conversa (tenant_id, conversa_id, criado_em).
     *
     * A âncora entra por `id`, não por comparação de tempo: o Postgres grava clock_timestamp() com
     * microssegundos e `ms()` trunca para milissegundos, então `criado_em <= ${data(ate)}` deixaria
     * a PRÓPRIA mensagem de fora sempre que os microssegundos não fossem zero (medido em
     * 2026-09-21: 18:24:28.352292 no banco contra .352 reconstruído, e a janela voltava vazia).
     * O `limite` é teto de segurança: conversa movimentada não vira dump.
     */
    async janelaAte(conversaId: string, ancoraId: string, desde: number, limite = 100): Promise<Mensagem[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select * from (
          select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens
          where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId}
            and criado_em >= ${data(desde)}
            and (id = ${ancoraId} or criado_em <= (
              select criado_em from mensagens where tenant_id = ${escopo.tenantId} and id = ${ancoraId}))
          order by criado_em desc, id desc limit ${limite}
        ) janela order by criado_em, id`;
      return linhas.map(paraMensagem);
    },

    async ultimaDaConversa(conversaId: string): Promise<Mensagem | null> {
      const [l] = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM)} from mensagens where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc, id desc limit 1`;
      return l ? paraMensagem(l) : null;
    },

    async marcarParcial(id: string, parcial: boolean): Promise<boolean> {
      const r = await conn`update mensagens set parcial = ${parcial} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** Turno interrompido no meio do streaming: a fala já gravada fica marcada como parcial (ADR-010). */
    async marcarParciaisDoTurno(turnoId: string): Promise<number> {
      const r = await conn`update mensagens set parcial = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and turno_id = ${turnoId} and autor_tipo = 'agente'`;
      return r.count;
    },
  };
}
