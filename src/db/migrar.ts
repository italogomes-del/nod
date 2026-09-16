import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { log } from "../obs/log.ts";

/**
 * Runner de migrações em SQL puro (sem drizzle-kit push, Leapy §O que não trazer):
 * ordem lexicográfica, pg_advisory_lock(7211) para dois processos não migrarem juntos,
 * schema_migrations (nome PK, aplicada_em), e só o conteúdo ANTES de `-- ROLLBACK:` é aplicado.
 * Conecta como nod_dono (urlDono); a aplicação nunca migra.
 */
const TRAVA = 7211;
// O marcador tem que estar no INÍCIO de uma linha: uma menção dentro de comentário não corta.
// (medido em 2026-09-16: a primeira versão cortava no comentário do cabeçalho e aplicava 302 chars.)
const MARCA_ROLLBACK = /^-- ROLLBACK:/m;

export function trechoAplicavel(conteudo: string): string {
  const m = MARCA_ROLLBACK.exec(conteudo);
  return m ? conteudo.slice(0, m.index) : conteudo;
}

export async function migrar(urlDono: string, dir: string): Promise<{ aplicadas: string[] }> {
  const sql = postgres(urlDono, { prepare: false, max: 1 });
  const aplicadas: string[] = [];
  try {
    await sql`select pg_advisory_lock(${TRAVA})`;
    await sql`create table if not exists schema_migrations (nome text primary key, aplicada_em timestamptz not null default now())`;
    const ja = new Set((await sql`select nome from schema_migrations`).map((r) => r.nome as string));
    const arquivos = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const nome of arquivos) {
      if (ja.has(nome)) continue;
      const conteudo = trechoAplicavel(await readFile(join(dir, nome), "utf8"));
      await sql.begin(async (trx) => {
        await trx.unsafe(conteudo);
        await trx`insert into schema_migrations (nome) values (${nome})`;
      });
      aplicadas.push(nome);
      log("info", "migracao_aplicada", { nome });
    }
    await sql`select pg_advisory_unlock(${TRAVA})`;
  } finally {
    await sql.end({ timeout: 2 });
  }
  return { aplicadas };
}
