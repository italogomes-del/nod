import { expect, it } from "vitest";
import { particoesIniciais } from "../../src/db/schema/events.ts";
import { db } from "../helpers/db.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { avaliar, EXCECOES, lerTabelas } from "./gate-rls.ts";

/**
 * Gate contra a REALIDADE (pg_catalog): uma tabela nova que nasce desguardada falha aqui.
 * Sem withRollback: só leitura do catálogo.
 */
describeIntegracao("gate: RLS por pessoa em toda tabela", () => {
  it("o role da suíte é nod_app e não escapa da RLS (rolbypassrls = false)", async () => {
    const [r] = await db`select current_user as usuario, rolbypassrls from pg_roles where rolname = current_user`;
    expect(r?.usuario).toBe("nod_app");
    expect(r?.rolbypassrls).toBe(false);
  });

  it("toda tabela tem ENABLE+FORCE e as policies nod_pessoa (PERMISSIVE) e nod_tenant (RESTRICTIVE), salvo exceção com motivo", async () => {
    const tabelas = await lerTabelas(db);
    expect(tabelas.length).toBeGreaterThan(0);
    expect(avaliar(tabelas)).toEqual([]);
    for (const nome of Object.keys(EXCECOES)) {
      expect(EXCECOES[nome]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("as exceções existem de verdade (nenhuma entrada morta) e nenhuma delas tem RLS por pessoa", async () => {
    const tabelas = await lerTabelas(db);
    const nomes = new Set(tabelas.map((t) => t.nome));
    for (const nome of Object.keys(EXCECOES)) expect(nomes.has(nome), `exceção morta: ${nome}`).toBe(true);
  });

  it("as 12 partições iniciais de events existem, são partições e nod_app não tem GRANT direto nelas", async () => {
    const tabelas = await lerTabelas(db);
    const porNome = new Map(tabelas.map((t) => [t.nome, t]));
    for (const nome of particoesIniciais()) {
      const p = porNome.get(nome);
      expect(p, `partição ausente: ${nome}`).toBeDefined();
      expect(p?.particao).toBe(true);
      expect(p?.pai).toBe("events");
      expect(p?.privilegiosApp).toEqual([]);
    }
    const pai = porNome.get("events");
    expect(pai?.rls && pai.force && pai.permissiva && pai.restritiva).toBe(true);
    // Sem DEFAULT: nenhuma partição sem faixa.
    const [semFaixa] = await db`select count(*)::int as n from pg_class c join pg_inherits i on i.inhrelid = c.oid
      where i.inhparent = 'events'::regclass and pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`;
    expect(semFaixa?.n).toBe(0);
  });

  it("ler qualquer tabela escopada sem escopo falha fechado (parâmetro ausente), nunca devolve zero linhas em silêncio", async () => {
    await expect(db`select count(*) from trilha`).rejects.toThrow(/unrecognized configuration parameter/);
  });
});
