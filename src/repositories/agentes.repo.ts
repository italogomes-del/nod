import type { Agente, CorAgente, DonoAgente, FormaAgente, Visibilidade } from "../contracts/agente.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  nome: string;
  titulo: string;
  descricao: string;
  dono: DonoAgente;
  forma: FormaAgente;
  cor: CorAgente;
  fixado: boolean;
  oculto: boolean;
  confirmado: boolean;
  modelo: string;
  duplicado_de: string | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, fixado, oculto, confirmado, modelo, duplicado_de, criado_em";

function paraAgente(l: Linha): Agente {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    visibility: l.visibility,
    nome: l.nome,
    titulo: l.titulo,
    descricao: l.descricao,
    dono: l.dono,
    forma: l.forma,
    cor: l.cor,
    fixado: l.fixado,
    oculto: l.oculto,
    confirmado: l.confirmado,
    modelo: l.modelo,
    duplicadoDe: l.duplicado_de,
    criadoEm: ms(l.criado_em),
  };
}

export type NovoAgente = {
  id?: string;
  nome: string;
  titulo?: string;
  descricao?: string;
  dono: DonoAgente;
  /** definido em 2026-09-16: agente de empresa nasce 'equipe' (visível a todas as pessoas do tenant); de pessoa nasce 'privado'. */
  visibility?: Visibilidade;
  forma: FormaAgente;
  cor: CorAgente;
  modelo: string;
  duplicadoDe?: string | null;
  confirmado?: boolean;
};

export type PerfilAgente = Partial<Pick<Agente, "nome" | "titulo" | "descricao" | "confirmado" | "modelo">>;

/** dono é imutável (trigger nod_agente_dono_imutavel): não existe método que o altere. */
export function agentesRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(a: NovoAgente): Promise<Agente | null> {
      const visibility: Visibilidade = a.visibility ?? (a.dono === "empresa" ? "equipe" : "privado");
      const [l] = await conn<Linha[]>`
        insert into agentes (tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, modelo, duplicado_de, confirmado)
        values (${escopo.tenantId}, ${a.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${visibility}, ${a.nome}, ${a.titulo ?? ""},
          ${a.descricao ?? ""}, ${a.dono}, ${a.forma}, ${a.cor}, ${a.modelo}, ${a.duplicadoDe ?? null}, ${a.confirmado ?? false})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async buscar(id: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraAgente(l) : null;
    },

    /** Resolve por nome entre os agentes visíveis (para encaminhar/perguntar_a_bot por nome). */
    async buscarPorNome(nome: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and lower(nome) = lower(${nome}) order by criado_em limit 1`;
      return l ? paraAgente(l) : null;
    },

    /** Frota da pessoa (o que a policy deixa ver): ocultos ficam de fora salvo pedido explícito. */
    async listar(opcoes: { incluirOcultos?: boolean } = {}): Promise<Agente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId}
          ${opcoes.incluirOcultos ? conn`` : conn`and oculto = false`}
        order by fixado desc, criado_em`;
      return linhas.map(paraAgente);
    },

    async atualizarPerfil(id: string, perfil: PerfilAgente): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`
        update agentes set
          nome = coalesce(${perfil.nome ?? null}, nome),
          titulo = coalesce(${perfil.titulo ?? null}, titulo),
          descricao = coalesce(${perfil.descricao ?? null}, descricao),
          confirmado = coalesce(${perfil.confirmado ?? null}, confirmado),
          modelo = coalesce(${perfil.modelo ?? null}, modelo)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async fixar(id: string, fixado: boolean): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set fixado = ${fixado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async ocultar(id: string, oculto: boolean): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set oculto = ${oculto} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
  };
}
