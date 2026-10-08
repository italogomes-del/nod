import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ehNova } from "../../scripts/migracao-aditiva.ts";
import { trechoAplicavel, trechoDeRollback } from "../../src/db/migrar.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-195: o rollback de cada migração nova (> BASE_ADITIVA) desfaz de verdade. Num banco descartável, criado
 * como nod_dono (CREATEDB, o mesmo mecanismo do banco por worktree), aplica as migrações até a 0058 e, para
 * cada nova em ordem: foto do schema → aplica → aplica o rollback → foto igual à de antes → reaplica.
 *
 * Fica em conformidade porque lê pg_catalog, como os outros gates de schema; não usa o banco de teste da
 * worktree (nod_test_<hash>) nem o nod_test do CI: o banco é próprio e é apagado no afterAll, mesmo com falha.
 */
type Sql = postgres.Sql;

const DIR = new URL("../../src/db/migrations/", import.meta.url);
const BANCO = `nod_rollback_${process.pid}_${randomBytes(4).toString("hex")}`;
const ESQUEMAS = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'";

/**
 * ACL nula é a padrão do dono, e GRANT + REVOKE deixa essa mesma padrão explícita, nunca nula de novo: sem
 * normalizar, o rollback certo de um GRANT em tipo, função ou tabela de ACL nula falhava (QA NOD-195; hoje 14
 * tabelas, 47 funções e os tipos estão assim). Os itens vão ordenados: REVOKE e depois GRANT do mesmo privilégio
 * põe o item no fim do array, e a ordem não muda o acesso. `tipo` é o do acldefault: 'n' schema, 'T' tipo,
 * 'f' função, 'r'/'s'.
 */
const acl = (coluna: string, tipo: string, dono: string) =>
  `' acl=' || coalesce((select string_agg(i::text, ',' order by i::text) from unnest(coalesce(${coluna}, acldefault(${tipo}, ${dono}))) i), '')`;

/** Cada categoria vira uma lista ordenada de linhas de texto, sem OID (nomes por regclass/regtype/regprocedure). */
const CONSULTAS: Record<string, string> = {
  esquemas: `select n.nspname || ${acl("n.nspacl", "'n'", "n.nspowner")} as l from pg_namespace n where ${ESQUEMAS}`,
  // ALTER DEFAULT PRIVILEGES: o rollback que esquece de desfazer muda o grant de toda tabela criada depois.
  privilegios_padrao: `select pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text
                         || ' ' || d.defaclacl::text as l
                       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace`,
  extensoes: `select extname || ' ' || extversion as l from pg_extension`,
  relacoes: `select c.oid::regclass::text || ' kind=' || c.relkind::text || ' rls=' || c.relrowsecurity || '/' || c.relforcerowsecurity
               || ' persistencia=' || c.relpersistence::text || ' opcoes=' || coalesce(c.reloptions::text, '-')
               || ${acl("c.relacl", "case c.relkind when 'S' then 's' else 'r' end::\"char\"", "c.relowner")} as l
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where ${ESQUEMAS} and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
  colunas: `select c.oid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
              || case when a.attnotnull then ' not null' else '' end
              || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
              || case when a.attidentity <> '' then ' identity=' || a.attidentity::text else '' end
              || case when a.attgenerated <> '' then ' generated=' || a.attgenerated::text else '' end
              || ' acl=' || coalesce(a.attacl::text, '-') as l
            from pg_attribute a
            join pg_class c on c.oid = a.attrelid
            join pg_namespace n on n.oid = c.relnamespace
            left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where ${ESQUEMAS} and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,
  constraints: `select coalesce(nullif(co.conrelid, 0)::regclass::text, nullif(co.contypid, 0)::regtype::text) || ' ' || co.conname
                  || ' ' || pg_get_constraintdef(co.oid) as l
                from pg_constraint co join pg_namespace n on n.oid = co.connamespace where ${ESQUEMAS}`,
  indices: `select schemaname || '.' || indexname || ' ' || indexdef as l from pg_indexes n where ${ESQUEMAS.replaceAll("n.nspname", "n.schemaname")}`,
  tipos: `select t.oid::regtype::text || ' ' || t.typtype::text || ${acl("t.typacl", "'T'", "t.typowner")}
            || coalesce(' enum=' || (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')
            || case when t.typtype = 'd' then ' base=' || format_type(t.typbasetype, t.typtypmod) || case when t.typnotnull then ' not null' else '' end
                    || coalesce(' default ' || t.typdefault, '') else '' end as l
          from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
          left join pg_class c on c.oid = t.typrelid
          where ${ESQUEMAS} and (t.typtype in ('e', 'd', 'r', 'm') or (t.typtype = 'c' and c.relkind = 'c'))`,
  funcoes: `select p.oid::regprocedure::text || ' ' || p.prokind::text || ${acl("p.proacl", "'f'", "p.proowner")}
              || case when p.prokind in ('f', 'p') then E'\\n' || pg_get_functiondef(p.oid) else '' end as l
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${ESQUEMAS}`,
  views: `select c.oid::regclass::text || ' ' || pg_get_viewdef(c.oid) as l
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${ESQUEMAS} and c.relkind in ('v', 'm')`,
  triggers: `select pg_get_triggerdef(t.oid) || ' enabled=' || t.tgenabled::text as l
             from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
             where ${ESQUEMAS} and not t.tgisinternal`,
  policies: `select schemaname || '.' || tablename || ' ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd
               || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-') as l
             from pg_policies n where ${ESQUEMAS.replaceAll("n.nspname", "n.schemaname")}`,
  regras: `select schemaname || '.' || tablename || ' ' || rulename || ' ' || definition as l
           from pg_rules n where ${ESQUEMAS.replaceAll("n.nspname", "n.schemaname")}`,
};

type Foto = Record<string, string[]>;

async function foto(sql: Sql): Promise<Foto> {
  const r: Foto = {};
  for (const [categoria, consulta] of Object.entries(CONSULTAS)) {
    r[categoria] = (await sql.unsafe<{ l: string }[]>(consulta)).map((x) => x.l).sort();
  }
  return r;
}

/** O que mudou entre as fotos, uma linha por objeto: "sobrou constraints: …" ou "faltou colunas: …". */
function diferencas(antes: Foto, depois: Foto): string[] {
  const r: string[] = [];
  for (const categoria of Object.keys(CONSULTAS)) {
    const a = new Set(antes[categoria]);
    const d = new Set(depois[categoria]);
    for (const x of d) if (!a.has(x)) r.push(`sobrou ${categoria}: ${x}`);
    for (const x of a) if (!d.has(x)) r.push(`faltou ${categoria}: ${x}`);
  }
  return r;
}

async function aplicar(sql: Sql, trecho: string): Promise<void> {
  await sql.begin(async (trx) => {
    await trx.unsafe(trecho);
  });
}

describeIntegracao("NOD-195: o ROLLBACK de cada migração nova volta o schema e ela reaplica", () => {
  let admin: Sql | undefined;
  let sql: Sql | undefined;

  beforeAll(async () => {
    const urlDono = process.env.DATABASE_URL_DONO;
    if (!urlDono) throw new Error("DATABASE_URL_DONO ausente: o teste de rollback cria um banco descartável como nod_dono");
    admin = postgres(urlDono, { prepare: false, max: 1, onnotice: () => {} });
    // Nome gerado aqui (só [a-z0-9_]): CREATE DATABASE não aceita parâmetro.
    await admin.unsafe(`create database ${BANCO}`);
    const url = new URL(urlDono);
    url.pathname = `/${BANCO}`;
    sql = postgres(url.toString(), { prepare: false, max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 2 });
    await admin?.unsafe(`drop database if exists ${BANCO} with (force)`);
    await admin?.end({ timeout: 2 });
  }, 60_000);

  it("até a 0058 aplica; cada nova: foto → ida → rollback → foto igual → ida de novo", async () => {
    if (!sql) throw new Error("banco descartável não foi criado");
    const arquivos = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    const ler = (nome: string) => readFile(new URL(nome, DIR), "utf8");
    for (const nome of arquivos.filter((f) => !ehNova(f))) await aplicar(sql, trechoAplicavel(await ler(nome)));

    const novas = arquivos.filter((f) => ehNova(f));
    expect(novas.length).toBeGreaterThan(0);
    for (const nome of novas) {
      const conteudo = await ler(nome);
      const ida = trechoAplicavel(conteudo);
      const rollback = trechoDeRollback(conteudo);
      expect(rollback?.trim(), `${nome}: sem bloco -- ROLLBACK: (o fence:migrations também acusa)`).toBeTruthy();

      const antes = await foto(sql);
      await aplicar(sql, ida);
      await aplicar(sql, rollback ?? "");
      expect(diferencas(antes, await foto(sql)), `${nome}: o rollback não volta o schema ao de antes`).toEqual([]);
      await aplicar(sql, ida);
    }
  }, 300_000);

  // Regressão (QA NOD-195): a foto em si. Roda depois do teste acima, no mesmo banco, num schema próprio.
  it("a foto aceita o rollback certo de GRANT em ACL nula e acusa UNLOGGED/opções esquecidos", async () => {
    if (!sql) throw new Error("banco descartável não foi criado");
    await aplicar(sql, `create schema qa_foto;
      create table qa_foto.t (id int);
      create type qa_foto.e as enum ('a');
      create function qa_foto.f() returns int language sql as 'select 1';`);
    const idaVolta = async (ida: string, rollback: string) => {
      const antes = await foto(sql!);
      await aplicar(sql!, ida);
      await aplicar(sql!, rollback);
      return diferencas(antes, await foto(sql!));
    };

    // Rollback certo: o REVOKE deixa a ACL padrão explícita, não nula. Antes da normalização era falso positivo.
    expect(await idaVolta("grant select on qa_foto.t to public", "revoke select on qa_foto.t from public")).toEqual([]);
    expect(await idaVolta("revoke usage on type qa_foto.e from public", "grant usage on type qa_foto.e to public")).toEqual([]);
    expect(await idaVolta("revoke execute on function qa_foto.f() from public", "grant execute on function qa_foto.f() to public")).toEqual([]);
    expect(await idaVolta("grant usage on schema qa_foto to public", "revoke usage on schema qa_foto from public")).toEqual([]);

    // Rollback que esquece persistência ou opções da tabela: antes passava calado.
    const unlogged = await idaVolta("alter table qa_foto.t set unlogged", "select 1");
    expect(unlogged.join("\n")).toMatch(/sobrou relacoes: qa_foto\.t .*persistencia=u/);
    const opcoes = await idaVolta("alter table qa_foto.t set (fillfactor = 70)", "select 1");
    expect(opcoes.join("\n")).toMatch(/sobrou relacoes: qa_foto\.t .*fillfactor=70/);

    // E um GRANT esquecido de verdade continua acusado.
    const grant = await idaVolta("grant insert on qa_foto.t to public", "select 1");
    expect(grant.join("\n")).toMatch(/sobrou relacoes: qa_foto\.t .*=a\//);
  }, 60_000);
});
