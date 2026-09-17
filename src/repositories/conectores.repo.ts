import type { Visibilidade } from "../contracts/agente.ts";
import type { CapacidadeConector, ConectorGuardado, SensibilidadeDeclarada, TransporteConector } from "../contracts/conector.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  visibility: Visibilidade;
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando: string | null;
  args: string[];
  url: string | null;
  env_cifrado: string | null;
  env_chaves: string[];
  declaracao: SensibilidadeDeclarada;
  habilitado: boolean;
  catalogo: CapacidadeConector[];
  sondado_em: Date | null;
  ultima_falha: { motivo: MotivoNegacao; em: number } | null;
  criado_em: Date;
}

const COLUNAS =
  "tenant_id, id, owner_id, visibility, nome, slug, transporte, comando, args, url, env_cifrado, env_chaves, declaracao, habilitado, catalogo, sondado_em, ultima_falha, criado_em";

/**
 * O env do conector fica CIFRADO no servidor (core-features §credencial): o repositório devolve
 * `ConectorGuardado` (src/contracts/conector.ts) — `env` só com as CHAVES e o placeholder `true`
 * (write-only), mais `envCifrado` para o servidor decifrar com src/db/cifra.ts na hora de spawnar.
 * Nada legível sai daqui. Reexportado para quem importava o nome deste módulo.
 */
export type { ConectorGuardado } from "../contracts/conector.ts";

function paraConector(l: Linha): ConectorGuardado {
  const env: Record<string, true> = {};
  for (const k of l.env_chaves) env[k] = true;
  return {
    tenantId: l.tenant_id,
    id: l.id,
    ownerId: l.owner_id,
    visibility: l.visibility,
    nome: l.nome,
    slug: l.slug,
    transporte: l.transporte,
    comando: l.comando,
    args: l.args,
    url: l.url,
    env,
    declaracao: l.declaracao,
    habilitado: l.habilitado,
    catalogo: l.catalogo,
    sondadoEm: msOuNull(l.sondado_em),
    ultimaFalha: l.ultima_falha,
    criadoEm: ms(l.criado_em),
    envCifrado: l.env_cifrado,
  };
}

export type NovoConector = {
  id?: string;
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  envCifrado?: string | null;
  envChaves?: string[];
  declaracao: SensibilidadeDeclarada;
  visibility?: Visibilidade;
};

/** Conector = servidor MCP registrado pela pessoa; nasce desabilitado (ADR-013). CHECKs vivem no banco. */
export function conectoresRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(c: NovoConector): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`
        insert into conectores (tenant_id, id, owner_id, visibility, nome, slug, transporte, comando, args, url, env_cifrado, env_chaves, declaracao)
        values (${escopo.tenantId}, ${c.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${c.visibility ?? "privado"}, ${c.nome}, ${c.slug}, ${c.transporte},
          ${c.comando ?? null}, ${c.args ?? []}::text[], ${c.url ?? null}, ${c.envCifrado ?? null}, ${c.envChaves ?? []}::text[], ${c.declaracao})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async atualizarEndpoint(id: string, url: string, envCifrado: string, envChaves: string[]): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`update conectores set url = ${url}, transporte = 'http', comando = null, args = '{}', declaracao = 'toca', env_cifrado = ${envCifrado}, env_chaves = ${envChaves}::text[], habilitado = false, catalogo = '[]', sondado_em = null, ultima_falha = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async buscar(id: string): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraConector(l) : null;
    },

    async buscarPorSlug(slug: string): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and slug = ${slug} order by (owner_id = ${escopo.pessoaId}) desc, criado_em limit 1`;
      return l ? paraConector(l) : null;
    },

    async listar(): Promise<ConectorGuardado[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} order by criado_em`;
      return linhas.map(paraConector);
    },

    async listarHabilitados(): Promise<ConectorGuardado[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from conectores where tenant_id = ${escopo.tenantId} and habilitado = true order by criado_em`;
      return linhas.map(paraConector);
    },

    /** Resultado da sonda (ADR-013): catálogo com readOnlyHint capturado na DESCOBERTA; falha guarda motivo + instante. */
    async registrarSonda(
      id: string,
      r: { ok: true; catalogo: CapacidadeConector[]; agora: number } | { ok: false; motivo: MotivoNegacao; agora: number },
    ): Promise<ConectorGuardado | null> {
      const [l] = r.ok
        ? await conn<Linha[]>`
            update conectores set catalogo = ${conn.json(r.catalogo)}, habilitado = true, sondado_em = ${data(r.agora)}, ultima_falha = null
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`
        : await conn<Linha[]>`
            update conectores set sondado_em = ${data(r.agora)}, ultima_falha = ${conn.json({ motivo: r.motivo, em: r.agora })}
            where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    async habilitar(id: string, habilitado: boolean): Promise<ConectorGuardado | null> {
      const [l] = await conn<Linha[]>`update conectores set habilitado = ${habilitado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraConector(l) : null;
    },

    /** Troca do env: quem chama já mesclou placeholders `true` com os valores guardados e cifrou o resultado. */
    async atualizarEnv(id: string, p: { envCifrado: string | null; envChaves: string[] }): Promise<boolean> {
      const r = await conn`
        update conectores set env_cifrado = ${p.envCifrado}, env_chaves = ${p.envChaves}::text[] where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    async marcarFalha(id: string, motivo: MotivoNegacao, agora: number): Promise<boolean> {
      const r = await conn`
        update conectores set ultima_falha = ${conn.json({ motivo, em: agora })} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },
  };
}

