import type { LoteDeFrentes, ResumoFrente } from "../contracts/frente.ts";
import type { EstadoTrabalho } from "../contracts/trabalho.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms, msOuNull } from "./conversao.ts";

interface LinhaLote {
  id: string;
  agente_id: string;
  aberto_por_turno_id: string;
  trabalho_id: string | null;
  avisar_a_cada_uma: boolean;
  retorno_turno_id: string | null;
  criado_em: Date;
  devolvido_em: Date | null;
}

const COLUNAS_LOTE = "id, agente_id, aberto_por_turno_id, trabalho_id, avisar_a_cada_uma, retorno_turno_id, criado_em, devolvido_em";

const paraLote = (l: LinhaLote): LoteDeFrentes => ({
  id: l.id,
  agenteId: l.agente_id,
  abertoPorTurnoId: l.aberto_por_turno_id,
  trabalhoId: l.trabalho_id,
  avisarACadaUma: l.avisar_a_cada_uma,
  retornoTurnoId: l.retorno_turno_id,
  criadoEm: ms(l.criado_em),
  devolvidoEm: msOuNull(l.devolvido_em),
});

export type NovoLote = {
  agenteId: string;
  abertoPorTurnoId: string;
  /** null (padrão) = lote da conversa do dono. */
  trabalhoId?: string | null;
  avisarACadaUma?: boolean;
};

/** O que o fecho do lote lê de cada frente: o estado, o resumo e se ela leu conteúdo de fora (ADR-047). */
export type FrenteDoLote = {
  id: string;
  titulo: string;
  estado: EstadoTrabalho;
  resumo: ResumoFrente | null;
  terminadoEm: number | null;
  /** Um turno da frente leu conteúdo de fora ou nasceu não confiável: o retorno do lote nasce marcado. */
  deFora: boolean;
};

/**
 * Frentes e lotes (definido em 2026-10-12, ADR-099, 0071). Padrão dos repositórios (tipos.ts): WHERE tenant_id explícito
 * sob RLS, escrita só da dona (owner_id), T | null sem lançar. Só leitura e gravação: quem decide abrir, fechar e
 * devolver é o caso de uso (issues seguintes); nenhum caso de uso chama este repositório ainda.
 */
export function frentesRepo(conn: Conn, escopo: Escopo) {
  return {
    async criarLote(n: NovoLote): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        insert into lotes_de_frentes (tenant_id, owner_id, agente_id, aberto_por_turno_id, trabalho_id, avisar_a_cada_uma)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${n.agenteId}, ${n.abertoPorTurnoId}, ${n.trabalhoId ?? null}, ${n.avisarACadaUma === true})
        returning ${conn.unsafe(COLUNAS_LOTE)}`;
      return l ? paraLote(l) : null;
    },

    async buscarLote(id: string): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraLote(l) : null;
    },

    /** Com trava de linha: o fecho do lote (duas frentes terminando juntas) serializa aqui antes de devolver. */
    async buscarLoteTravado(id: string): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        select ${conn.unsafe(COLUNAS_LOTE)} from lotes_de_frentes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        for no key update`;
      return l ? paraLote(l) : null;
    },

    /**
     * Liga frentes soltas ao lote. Só entra frente (`forma = 'frente'`) ainda sem lote, do mesmo bot do lote e com o lote
     * ainda não devolvido; as outras ficam como estão. Devolve quantas entraram.
     */
    async ligarAoLote(loteId: string, trabalhoIds: readonly string[]): Promise<number> {
      if (trabalhoIds.length === 0) return 0;
      const r = await conn`
        update trabalhos w set lote_id = l.id
        from lotes_de_frentes l
        where l.tenant_id = ${escopo.tenantId} and l.id = ${loteId} and l.devolvido_em is null
          and w.tenant_id = l.tenant_id and w.owner_id = ${escopo.pessoaId} and w.id = any(${[...trabalhoIds]}::uuid[])
          and w.agente_id = l.agente_id and w.forma = 'frente' and w.lote_id is null`;
      return r.count;
    },

    /** O que a frente devolve ao dono (validado antes, em src/domain/resumo-da-frente.ts). Grava por cima do anterior. */
    async gravarResumo(trabalhoId: string, resumo: ResumoFrente): Promise<boolean> {
      const r = await conn`
        update trabalhos set resumo = ${jsonb(conn, resumo)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${trabalhoId} and forma = 'frente'`;
      return r.count === 1;
    },

    /** As frentes do lote, na ordem em que nasceram (pelo índice `trabalhos_por_lote`). */
    async frentesDoLote(loteId: string): Promise<FrenteDoLote[]> {
      const linhas = await conn<{ id: string; titulo: string; estado: EstadoTrabalho; resumo: ResumoFrente | null; terminado_em: Date | null; de_fora: boolean }[]>`
        select w.id, w.titulo, w.estado, w.resumo, w.terminado_em,
          (w.origem = 'colega' or exists (select 1 from turnos x where x.tenant_id = w.tenant_id and x.trabalho_id = w.id
            and (x.contaminado_em is not null or x.entrada_confianca <> 'confiavel'))) as de_fora
        from trabalhos w
        where w.tenant_id = ${escopo.tenantId} and w.lote_id = ${loteId}
        order by w.criado_em, w.id`;
      return linhas.map((l) => ({ id: l.id, titulo: l.titulo, estado: l.estado, resumo: l.resumo, terminadoEm: msOuNull(l.terminado_em), deFora: l.de_fora }));
    },

    /**
     * Marca o lote devolvido, uma vez só: o segundo fecho (já devolvido) não muda nada e devolve null. `retornoTurnoId`
     * é a retomada do dono (UNIQUE na 0071); null = devolvido sem retorno (o dono parou).
     */
    async marcarDevolvido(loteId: string, retornoTurnoId: string | null, agora: number): Promise<LoteDeFrentes | null> {
      const [l] = await conn<LinhaLote[]>`
        update lotes_de_frentes set devolvido_em = ${data(agora)}, retorno_turno_id = ${retornoTurnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${loteId} and devolvido_em is null
        returning ${conn.unsafe(COLUNAS_LOTE)}`;
      return l ? paraLote(l) : null;
    },
  };
}
