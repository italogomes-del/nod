import type { Memoria, TipoMemoria } from "../contracts/memoria.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  agente_id: string;
  tipo: TipoMemoria;
  texto: string;
  origem: "pessoa" | "agente";
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, agente_id, tipo, texto, origem, criado_em";

const paraMemoria = (l: Linha): Memoria => ({
  tenantId: l.tenant_id,
  id: l.id,
  agenteId: l.agente_id,
  tipo: l.tipo,
  texto: l.texto,
  origem: l.origem,
  criadoEm: ms(l.criado_em),
});

export type NovaMemoria = { id?: string; agenteId: string; tipo: TipoMemoria; texto: string; origem: "pessoa" | "agente" };

/** Memória por bot: editável pela pessoa; injetada no prompt com "não substitui fonte autoritativa". */
export function memoriasRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(m: NovaMemoria): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`
        insert into agente_memorias (tenant_id, id, owner_id, agente_id, tipo, texto, origem)
        values (${escopo.tenantId}, ${m.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${m.agenteId}, ${m.tipo}, ${m.texto}, ${m.origem})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraMemoria(l) : null;
    },

    async buscar(id: string): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agente_memorias where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraMemoria(l) : null;
    },

    async listarDoAgente(agenteId: string): Promise<Memoria[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agente_memorias where tenant_id = ${escopo.tenantId} and agente_id = ${agenteId} order by criado_em, id`;
      return linhas.map(paraMemoria);
    },

    async atualizar(id: string, campos: { texto?: string; tipo?: TipoMemoria }): Promise<Memoria | null> {
      const [l] = await conn<Linha[]>`
        update agente_memorias set texto = coalesce(${campos.texto ?? null}, texto), tipo = coalesce(${campos.tipo ?? null}, tipo)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraMemoria(l) : null;
    },

    async apagar(id: string): Promise<boolean> {
      const r = await conn`delete from agente_memorias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },
  };
}
