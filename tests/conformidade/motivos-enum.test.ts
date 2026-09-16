import { expect, it } from "vitest";
import {
  CODIGOS_ERRO,
  DESFECHOS_ITEM,
  DESFECHOS_ROTINA,
  MOTIVOS_FALHA,
  MOTIVOS_INTERRUPCAO,
  MOTIVOS_LOCALIDADE,
  MOTIVOS_NEGACAO,
  MOTIVOS_PASSE,
} from "../../src/contracts/motivos.ts";
import { ENUMS_DE_ESTADO } from "../../src/db/schema/agentes.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-004: os motivos vivem num enum só. Cada união `as const` de src/contracts/motivos.ts é um
 * CREATE TYPE da 0002, e este gate compara com pg_enum na ORDEM declarada — uma constante nova sem
 * migração (ou o contrário) falha aqui, não em produção.
 */
const MOTIVOS: Record<string, readonly string[]> = {
  motivo_passe: MOTIVOS_PASSE,
  motivo_negacao: MOTIVOS_NEGACAO,
  motivo_interrupcao: MOTIVOS_INTERRUPCAO,
  motivo_falha: MOTIVOS_FALHA,
  motivo_localidade: MOTIVOS_LOCALIDADE,
  desfecho_item: DESFECHOS_ITEM,
  desfecho_rotina: DESFECHOS_ROTINA,
  codigo_erro: CODIGOS_ERRO,
};

async function rotulos(tipo: string): Promise<string[]> {
  const linhas = await db<{ enumlabel: string }[]>`
    select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = ${tipo} order by e.enumsortorder`;
  return linhas.map((l) => l.enumlabel);
}

describeIntegracao("gate: enums de motivo (motivos.ts) == pg_enum", () => {
  for (const [tipo, lista] of Object.entries(MOTIVOS)) {
    it(`${tipo} tem exatamente os valores de motivos.ts, na mesma ordem`, async () => {
      expect(await rotulos(tipo)).toEqual([...lista]);
    });
  }

  for (const [tipo, lista] of Object.entries(ENUMS_DE_ESTADO)) {
    it(`${tipo} (estado) tem exatamente os valores de src/db/schema/agentes.ts`, async () => {
      expect(await rotulos(tipo)).toEqual([...lista]);
    });
  }

  it("nenhuma coluna de motivo em turnos/mensagens/rotina_execucoes/trilha é texto livre sem CHECK", async () => {
    const linhas = await db<{ table_name: string; column_name: string; udt_name: string }[]>`
      select table_name, column_name, udt_name from information_schema.columns
      where table_schema = 'public' and table_name in ('turnos', 'mensagens', 'rotina_execucoes', 'trilha')
        and column_name in ('motivo_interrupcao', 'motivo_falha', 'locality_reason', 'desfecho', 'motivo')
      order by table_name, column_name`;
    // Só as tabelas da 0002 (+ trilha, que já tem o CHECK na 0001). inventario_motores.motivo fica de
    // fora de propósito: é a prosa que a sonda do CLI reporta ("binário não encontrado"), sem dado de
    // aprendiz e sem enum possível (ADR-019). events.locality_reason (0001) é text: pendência da L9.
    expect(linhas.length).toBeGreaterThan(3);
    for (const l of linhas) {
      if (l.udt_name !== "text") continue;
      // As duas colunas `motivo text` (trilha, rotina_execucoes) têm CHECK ^[a-z_]+$ na migração.
      const [c] = await db<{ n: number }[]>`
        select count(*)::int as n from pg_constraint where conrelid = ${l.table_name}::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%motivo%'`;
      expect(c?.n, `${l.table_name}.${l.column_name} é text sem CHECK`).toBeGreaterThan(0);
    }
  });
});
