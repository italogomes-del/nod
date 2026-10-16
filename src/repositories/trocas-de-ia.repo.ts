import type { IdHarness } from "../contracts/harness.ts";
import type { InteligenciaBot } from "../contracts/inteligencia.ts";
import type { DecisaoDaTroca, RecomendacaoDaTroca, TrocaDeIa } from "../contracts/troca-de-ia.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, dataOuNull, jsonb, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  ia_de: IdHarness;
  ia_para: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  volta_em: Date | null;
  criada_em: Date;
  aplicar_em: Date | null;
  decidido_em: Date | null;
  decisao: DecisaoDaTroca | null;
  mensagem_id: string | null;
  fixo: boolean;
  volta_ao_fixo: InteligenciaBot | null;
  restaurado_em: Date | null;
}

const COLUNAS = "id, agente_id, conversa_id, ia_de, ia_para, recomendacao, volta_em, criada_em, aplicar_em, decidido_em, decisao, mensagem_id, fixo, volta_ao_fixo, restaurado_em";

const paraTroca = (l: Linha): TrocaDeIa => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  iaDe: l.ia_de,
  iaPara: l.ia_para,
  recomendacao: l.recomendacao,
  voltaEm: msOuNull(l.volta_em),
  criadaEm: ms(l.criada_em),
  aplicarEm: msOuNull(l.aplicar_em),
  decididoEm: msOuNull(l.decidido_em),
  decisao: l.decisao,
  mensagemId: l.mensagem_id,
  fixo: l.fixo,
  voltaAoFixo: l.volta_ao_fixo,
  restauradoEm: msOuNull(l.restaurado_em),
});

export type NovaTroca = {
  agenteId: string;
  conversaId: string;
  iaDe: IdHarness;
  iaPara: IdHarness | null;
  recomendacao: RecomendacaoDaTroca;
  voltaEm: number | null;
  /** Só "levar": quando o varredor aplica sozinho. Num aviso que já existia, o prazo de antes vale (não recomeça). */
  aplicarEm: number | null;
  fixo: boolean;
  agora: number;
};

/**
 * Os avisos de troca de IA (0080, ADR-108). Um aberto por bot (índice único parcial): `abrir` cria ou atualiza o aberto.
 * Fechar é `UPDATE … WHERE decidido_em IS NULL` — o clique da pessoa e o varredor ao mesmo tempo: o primeiro fecha, o
 * segundo recebe null e não aplica nada.
 */
export function trocasDeIaRepo(conn: Conn, escopo: Escopo) {
  const doDono = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  return {
    /** Cria o aviso do bot ou atualiza o aberto. `nova` = não havia aberto (a tela ganha uma linha nova). */
    async abrir(n: NovaTroca): Promise<{ troca: TrocaDeIa; nova: boolean }> {
      const [l] = await conn<(Linha & { nova: boolean })[]>`
        insert into trocas_de_ia (tenant_id, owner_id, agente_id, conversa_id, ia_de, ia_para, recomendacao, volta_em, criada_em, aplicar_em, fixo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.conversaId}, ${n.iaDe}, ${n.iaPara}, ${n.recomendacao}, ${dataOuNull(n.voltaEm)}, ${data(n.agora)}, ${dataOuNull(n.aplicarEm)}, ${n.fixo})
        on conflict (tenant_id, agente_id) where decidido_em is null do update set
          ia_de = excluded.ia_de, ia_para = excluded.ia_para, recomendacao = excluded.recomendacao, volta_em = excluded.volta_em, fixo = excluded.fixo,
          aplicar_em = case when excluded.recomendacao = 'levar' then coalesce(trocas_de_ia.aplicar_em, excluded.aplicar_em) else null end
        returning ${conn.unsafe(COLUNAS)}, (xmax = 0) as nova`;
      return { troca: paraTroca(l!), nova: l!.nova };
    },

    async definirMensagem(id: string, mensagemId: string): Promise<void> {
      await conn`update trocas_de_ia set mensagem_id = ${mensagemId} where ${doDono()} and id = ${id}`;
    },

    async buscar(id: string): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia where ${doDono()} and id = ${id}`;
      return l ? paraTroca(l) : null;
    },

    async abertaDoAgente(agenteId: string): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from trocas_de_ia where ${doDono()} and agente_id = ${agenteId} and decidido_em is null`;
      return l ? paraTroca(l) : null;
    },

    /**
     * Fecha o aviso UMA vez. null = já estava fechado (outro clique, outra aba ou o varredor chegou antes). `voltaAoFixo`
     * (R6 b) é gravado no mesmo comando.
     */
    async fechar(id: string, decisao: DecisaoDaTroca, agora: number, voltaAoFixo?: InteligenciaBot): Promise<TrocaDeIa | null> {
      const [l] = await conn<Linha[]>`
        update trocas_de_ia set decidido_em = ${data(agora)}, decisao = ${decisao}, volta_ao_fixo = ${voltaAoFixo ? jsonb(conn, voltaAoFixo) : null}
        where ${doDono()} and id = ${id} and decidido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTroca(l) : null;
    },

    /** O bot volta à inteligência de antes (R6 b) UMA vez. */
    async marcarRestaurada(id: string, agora: number): Promise<boolean> {
      const r = await conn`update trocas_de_ia set restaurado_em = ${data(agora)} where ${doDono()} and id = ${id} and volta_ao_fixo is not null and restaurado_em is null returning id`;
      return r.length > 0;
    },

    /** O que o varredor olha: os avisos abertos e os bots fixos que ainda esperam voltar à IA deles. */
    async paraVarrer(): Promise<TrocaDeIa[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from trocas_de_ia
        where ${doDono()} and (decidido_em is null or (volta_ao_fixo is not null and restaurado_em is null))
        order by criada_em limit 200`;
      return linhas.map(paraTroca);
    },
  };
}
