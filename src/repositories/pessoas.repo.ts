import type { Conn, Escopo } from "../shared/types.ts";

export interface Pessoa {
  tenantId: string;
  id: string;
  nome: string;
  iniciais: string;
}

interface Linha {
  tenant_id: string;
  id: string;
  nome: string;
  iniciais: string;
}

const paraPessoa = (l: Linha): Pessoa => ({ tenantId: l.tenant_id, id: l.id, nome: l.nome, iniciais: l.iniciais });

/** Tabela SEM RLS por pessoa (catálogo de identidade): lida sem escopo pelos laços de fundo. */
export async function listarTodas(conn: Conn): Promise<Pessoa[]> {
  const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais from pessoas order by tenant_id, nome`;
  return linhas.map(paraPessoa);
}

export function pessoasRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscar(id: string): Promise<Pessoa | null> {
      const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais from pessoas where tenant_id = ${escopo.tenantId} and id = ${id}`;
      const l = linhas[0];
      return l ? paraPessoa(l) : null;
    },
    async listarDoTenant(): Promise<Pessoa[]> {
      const linhas = await conn<Linha[]>`select tenant_id, id, nome, iniciais from pessoas where tenant_id = ${escopo.tenantId} order by nome`;
      return linhas.map(paraPessoa);
    },
  };
}
