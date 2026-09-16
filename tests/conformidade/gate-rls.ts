import type { Conn } from "../../src/shared/types.ts";

/**
 * O gate de RLS lê o CATÁLOGO (pg_class, pg_policies, pg_inherits), nunca arquivos de migração
 * (Leapy §4). Toda tabela ou cumpre a regra ou está em EXCECOES com motivo ESCRITO.
 * Vive fora do *.test.ts para o teste NEGATIVO (rls-negativo) poder chamá-lo na mesma transação
 * em que cria uma tabela desguardada.
 *
 * Partições (EMENDA 2, opção b): policy em tabela particionada vale para toda consulta pelo PAI;
 * a partição é exceção nomeada com o motivo "coberta pela policy do pai; nod_app sem GRANT direto
 * nas partições" — e o gate PROVA as duas metades: o pai passa e nod_app não tem nenhum privilégio
 * direto na partição. Partição nova criada por garantirParticoes (L7) com a forma de
 * src/db/schema/events.ts passa por esta mesma regra.
 */
export const EXCECOES: Record<string, string> = {
  schema_migrations: "controle do runner de migração; só nod_dono toca; sem tenant_id",
  tenants: "catálogo de identidade sem dado de aprendiz; lido para enumerar donos dos laços de fundo",
  pessoas: "catálogo de identidade sem dado de aprendiz; lido para enumerar donos dos laços de fundo",
};

export interface Tabela {
  nome: string;
  particao: boolean;
  pai: string | null;
  rls: boolean;
  force: boolean;
  temTenantId: boolean;
  permissiva: boolean;
  restritiva: boolean;
  privilegiosApp: string[];
}

export async function lerTabelas(conn: Conn): Promise<Tabela[]> {
  /* eslint-disable no-restricted-syntax -- a palavra aparece como NOME de privilégio consultado, não como comando */
  const linhas = await conn<
    {
      nome: string;
      particao: boolean;
      pai: string | null;
      rls: boolean;
      force: boolean;
      tem_tenant_id: boolean;
      permissiva: boolean;
      restritiva: boolean;
      privilegios: string[];
    }[]
  >`
    select c.relname as nome,
           c.relispartition as particao,
           (select p.relname from pg_inherits i join pg_class p on p.oid = i.inhparent where i.inhrelid = c.oid limit 1) as pai,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tem_tenant_id,
           exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'nod_pessoa' and p.polpermissive) as permissiva,
           exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'nod_tenant' and not p.polpermissive) as restritiva,
           array(select priv from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) priv
                 where has_table_privilege('nod_app', c.oid, priv)) as privilegios
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and (n.nspname = 'public' or n.oid = pg_my_temp_schema())
    order by c.relname`;
  /* eslint-enable no-restricted-syntax */
  return linhas.map((l) => ({
    nome: l.nome,
    particao: l.particao,
    pai: l.pai,
    rls: l.rls,
    force: l.force,
    temTenantId: l.tem_tenant_id,
    permissiva: l.permissiva,
    restritiva: l.restritiva,
    privilegiosApp: l.privilegios,
  }));
}

/** Devolve a lista de violações (vazia = gate verde). Uma string por tabela, legível no CI. */
export function avaliar(tabelas: Tabela[]): string[] {
  const porNome = new Map(tabelas.map((t) => [t.nome, t]));
  const violacoes: string[] = [];
  for (const t of tabelas) {
    if (EXCECOES[t.nome]) continue;
    if (t.particao) {
      const pai = t.pai ? porNome.get(t.pai) : undefined;
      if (!pai) violacoes.push(`${t.nome}: partição sem pai visível`);
      else if (!(pai.rls && pai.force && pai.permissiva && pai.restritiva)) violacoes.push(`${t.nome}: o pai ${pai.nome} não está escopado`);
      if (t.privilegiosApp.length > 0) violacoes.push(`${t.nome}: nod_app tem GRANT direto na partição (${t.privilegiosApp.join(",")}) — a policy do pai não cobre acesso direto`);
      continue;
    }
    if (!t.temTenantId) violacoes.push(`${t.nome}: sem coluna tenant_id e sem exceção escrita`);
    if (!t.rls) violacoes.push(`${t.nome}: sem ENABLE ROW LEVEL SECURITY`);
    if (!t.force) violacoes.push(`${t.nome}: sem FORCE ROW LEVEL SECURITY`);
    if (!t.permissiva) violacoes.push(`${t.nome}: sem policy PERMISSIVE nod_pessoa`);
    if (!t.restritiva) violacoes.push(`${t.nome}: sem policy RESTRICTIVE nod_tenant`);
  }
  return violacoes;
}
