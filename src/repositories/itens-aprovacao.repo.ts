import type { DestinoItem, ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, isoOuNull, jsonb } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  decisao_id: string;
  idx: number;
  texto_original: string;
  texto_final: string;
  destino: DestinoItem;
  selecionado: boolean;
  origem_sensivel: boolean;
  justificativa: string | null;
  marcado_por: string | null;
  marcado_em: Date | null;
  editado_por: string | null;
  desfecho: DesfechoItem | null;
  motivo_manual: MotivoAprovacaoManual | null;
}

const COLUNAS = "tenant_id, id, decisao_id, idx, texto_original, texto_final, destino, selecionado, origem_sensivel, justificativa, marcado_por, marcado_em, editado_por, desfecho, motivo_manual";

const paraItem = (l: Linha): ItemAprovacao => ({
  tenantId: l.tenant_id,
  id: l.id,
  decisaoId: l.decisao_id,
  idx: l.idx,
  textoOriginal: l.texto_original,
  textoFinal: l.texto_final,
  destino: l.destino,
  selecionado: l.selecionado,
  origemSensivel: l.origem_sensivel,
  justificativa: l.justificativa,
  marcadoPor: l.marcado_por,
  marcadoEm: isoOuNull(l.marcado_em),
  editadoPor: l.editado_por,
  desfecho: l.desfecho,
  motivoManual: l.motivo_manual,
});

/** Item aprovado que espera a máquina da dona (ADR-048): com quando a decisão fechou e se foi por regra. */
export type ItemNaMaquina = { item: ItemAprovacao; decididaEm: number; porRegra: boolean };

export type NovoItemAprovacao = {
  id?: string;
  idx: number;
  texto: string;
  destino: DestinoItem;
  /** Origem sensível NASCE desmarcada com justificativa (E4.2); marcar exige pessoa (CHECK). */
  origemSensivel: boolean;
  justificativa?: string | null;
  /** NULO = resolvido por regra, sem perguntar (ADR-042). Preenchido = por que precisou de pessoa. */
  motivoManual?: MotivoAprovacaoManual | null;
  /** Item resolvido por regra nasce com desfecho; o resto nasce sem. */
  desfecho?: DesfechoItem | null;
};

/** Aprovação em lista tipada (E4.1/E4.2). O CHECK item_sensivel_marcado_exige_pessoa vive no banco. */
export function itensAprovacaoRepo(conn: Conn, escopo: Escopo) {
  return {
    async criarLote(decisaoId: string, itens: readonly NovoItemAprovacao[]): Promise<ItemAprovacao[]> {
      const criados: ItemAprovacao[] = [];
      for (const i of itens) {
        const [l] = await conn<Linha[]>`
          insert into itens_aprovacao (tenant_id, id, owner_id, decisao_id, idx, texto_original, texto_final, destino, selecionado, origem_sensivel, justificativa, motivo_manual, desfecho)
          values (${escopo.tenantId}, ${i.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${decisaoId}, ${i.idx}, ${i.texto}, ${i.texto},
            ${jsonb(conn, i.destino)}, ${!i.origemSensivel}, ${i.origemSensivel}, ${i.justificativa ?? null}, ${i.motivoManual ?? null}, ${i.desfecho ?? null})
          returning ${conn.unsafe(COLUNAS)}`;
        if (l) criados.push(paraItem(l));
      }
      return criados;
    },

    async listar(decisaoId: string): Promise<ItemAprovacao[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from itens_aprovacao where tenant_id = ${escopo.tenantId} and decisao_id = ${decisaoId} order by idx`;
      return linhas.map(paraItem);
    },

    async buscar(id: string): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from itens_aprovacao where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraItem(l) : null;
    },

    /**
     * A pessoa marca/desmarca e pode editar o texto final; marcado_por é a pessoa da sessão. Dona OU
     * decisora designada (policy nod_decisora da 0003 em itens_aprovacao); o filtro explícito devolve
     * null para quem só lê a linha por 'equipe', em vez de deixar o 42501 subir.
     */
    async marcar(id: string, p: { selecionado: boolean; textoFinal?: string; agora: number }): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set
          selecionado = ${p.selecionado},
          marcado_por = ${escopo.pessoaId},
          marcado_em = ${data(p.agora)},
          texto_final = coalesce(${p.textoFinal ?? null}, texto_final),
          editado_por = case when ${p.textoFinal ?? null}::text is null then editado_por else ${escopo.pessoaId}::uuid end
        where tenant_id = ${escopo.tenantId} and id = ${id}
          and (owner_id = ${escopo.pessoaId} or exists (
            select 1 from decisoes d where d.tenant_id = itens_aprovacao.tenant_id and d.id = itens_aprovacao.decisao_id and d.decisor_id = ${escopo.pessoaId}))
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },

    /**
     * definido em 2026-09-24 (ADR-048): os itens APROVADOS desta pessoa que rodam no gh do Mac dela e
     * ainda não têm desfecho. A execução é derivada, sem coluna nova: decisão decidida + item marcado
     * + `destino.execucao = 'maquina'` + desfecho nulo.
     */
    async pendentesNaMaquina(): Promise<ItemNaMaquina[]> {
      const linhas = await conn<(Linha & { decidida_em: Date | null; tipo_desfecho: string | null })[]>`
        select ${conn.unsafe(COLUNAS.split(", ").map((c) => `i.${c}`).join(", "))}, d.decidida_em, d.desfecho->>'tipo' as tipo_desfecho
        from itens_aprovacao i join decisoes d on d.tenant_id = i.tenant_id and d.id = i.decisao_id
        where i.tenant_id = ${escopo.tenantId} and i.owner_id = ${escopo.pessoaId} and d.estado = 'decidida'
          and i.selecionado and i.desfecho is null and i.destino->>'execucao' = 'maquina'
        order by d.decidida_em, i.idx`;
      return linhas.map((l) => ({ item: paraItem(l), decididaEm: l.decidida_em ? l.decidida_em.getTime() : 0, porRegra: l.tipo_desfecho === "decidida_por_regra" }));
    },

    /** Grava o desfecho só se ainda não havia um: o relato repetido da máquina não sobrescreve. */
    async registrarDesfechoSeAberto(id: string, desfecho: DesfechoItem): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set desfecho = ${desfecho} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and desfecho is null returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },

    async registrarDesfecho(id: string, desfecho: DesfechoItem): Promise<ItemAprovacao | null> {
      const [l] = await conn<Linha[]>`
        update itens_aprovacao set desfecho = ${desfecho} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraItem(l) : null;
    },
  };
}
