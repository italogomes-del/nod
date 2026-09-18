import type { PreferenciaHarness } from "../contracts/harness.ts";
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
  harness?: PreferenciaHarness;
  duplicado_de: string | null;
  secao: string;
  nao_lido: boolean;
  excluido_em: Date | null;
  criado_em: Date;
}

const COLUNAS = "tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, fixado, oculto, confirmado, modelo, harness, duplicado_de, criado_em, secao, nao_lido, excluido_em";

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
    harness: l.harness ?? "auto",
    duplicadoDe: l.duplicado_de,
    secao: l.secao,
    naoLido: l.nao_lido,
    excluidoEm: l.excluido_em ? ms(l.excluido_em) : null,
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
  harness?: PreferenciaHarness;
  duplicadoDe?: string | null;
  confirmado?: boolean;
};

export type PerfilAgente = Partial<Pick<Agente, "nome" | "titulo" | "descricao" | "confirmado" | "modelo" | "harness" | "forma" | "cor">>;

/** dono é imutável (trigger nod_agente_dono_imutavel): não existe método que o altere. */
export function agentesRepo(conn: Conn, escopo: Escopo) {
  return {
    async execucaoBloqueada(turnoId: string): Promise<boolean> {
      const [l] = await conn<{ bloqueada: boolean }[]>`select (a.excluido_em is not null or a.geracao_execucao <> t.geracao_execucao) as bloqueada
        from turnos t join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id
        where t.tenant_id = ${escopo.tenantId} and t.id = ${turnoId}`;
      return l?.bloqueada ?? false;
    },
    async organizar(id: string, campos: { secao?: string; naoLido?: boolean }): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set secao = coalesce(${campos.secao ?? null}, secao),
        nao_lido = coalesce(${campos.naoLido ?? null}, nao_lido)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
    async excluir(id: string, agora: number): Promise<Agente | null> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${id}))`;
      const [l] = await conn<Linha[]>`update agentes set excluido_em = ${new Date(agora)}, fixado = false, geracao_execucao = geracao_execucao + 1
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
        returning ${conn.unsafe(COLUNAS)}`;
      if (!l) return null;
      await conn`update rotinas set estado = 'pausada' where tenant_id = ${escopo.tenantId} and agente_id = ${id}`;
      await conn`delete from concessoes where tenant_id = ${escopo.tenantId} and agente_id = ${id}`;
      await conn`update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa'
        where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'pendente'`;
      await conn`update turnos set parar_solicitado_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'despachando'`;
      await conn`update propostas set estado = 'recusada' where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado = 'pendente'`;
      await conn`update decisoes set estado = 'vencida' where tenant_id = ${escopo.tenantId} and agente_id = ${id} and estado in ('pendente', 'reaberta')`;
      return paraAgente(l);
    },
    async restaurar(id: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`update agentes set excluido_em = null, oculto = false
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is not null
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },
    async criar(a: NovoAgente): Promise<Agente | null> {
      const visibility: Visibilidade = a.visibility ?? (a.dono === "empresa" ? "equipe" : "privado");
      const [l] = await conn<Linha[]>`
        insert into agentes (tenant_id, id, owner_id, visibility, nome, titulo, descricao, dono, forma, cor, modelo, harness, duplicado_de, confirmado)
        values (${escopo.tenantId}, ${a.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${visibility}, ${a.nome}, ${a.titulo ?? ""},
          ${a.descricao ?? ""}, ${a.dono}, ${a.forma}, ${a.cor}, ${a.modelo}, ${a.harness ?? "auto"}, ${a.duplicadoDe ?? null}, ${a.confirmado ?? false})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraAgente(l) : null;
    },

    async buscar(id: string, incluirExcluidos = false): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and id = ${id} ${incluirExcluidos ? conn`` : conn`and excluido_em is null`}`;
      return l ? paraAgente(l) : null;
    },

    /** Resolve por nome entre os agentes visíveis (para encaminhar/perguntar_a_bot por nome). */
    async buscarPorNome(nome: string): Promise<Agente | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId} and excluido_em is null and lower(nome) = lower(${nome}) order by criado_em limit 1`;
      return l ? paraAgente(l) : null;
    },

    /** Frota da pessoa (o que a policy deixa ver): ocultos ficam de fora salvo pedido explícito. */
    async listar(opcoes: { incluirOcultos?: boolean; incluirExcluidos?: boolean } = {}): Promise<Agente[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from agentes where tenant_id = ${escopo.tenantId}
          ${opcoes.incluirExcluidos ? conn`` : conn`and excluido_em is null`}
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
          forma = coalesce(${perfil.forma ?? null}, forma),
          cor = coalesce(${perfil.cor ?? null}, cor),
          modelo = coalesce(${perfil.modelo ?? null}, modelo),
          harness = coalesce(${perfil.harness ?? null}, harness)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and excluido_em is null
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
