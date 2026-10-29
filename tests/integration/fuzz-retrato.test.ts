import { expect, it } from "vitest";
import { planoDeFuzz } from "../../src/domain/fuzz/gerador.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import type { Tx } from "../../src/shared/types.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { executarFuzz, sqlDoRetrato, type AlvoDoFuzz } from "../helpers/fuzz.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Sentinela do fuzz (NOD-398) contra o Postgres de verdade: o retrato que o fuzz usa (sqlDoRetrato, sob o RLS da
 * pessoa) ENXERGA uma escrita deixada por um pedido que respondeu erro. Se o retrato parar de medir (tabela fora da
 * consulta, RLS escondendo a própria pessoa), esta falha antes de o fuzz ficar verde à toa.
 */

const PLANO = planoDeFuzz({
  registro: [{ id: "f.escreve_e_falha", titulo: "f", risco: "muda", cartaoNoChat: false, chat: { estado: "nunca", motivo: "fixture" } }],
  rotas: [{ metodo: "POST", padrao: "^\\/x$", acao: "f.escreve_e_falha" }],
  semente: 1,
  n: 2,
  ids: { daPessoa: [], deOutraPessoa: [] },
});

describeIntegracao("fuzz: o retrato de verdade pega dado pela metade (NOD-398)", () => {
  it("uma ação que cria um bot e responde 400 vira violação em `agentes`; a que não escreve, não", async () => {
    const sql = await sqlDoRetrato(dbDono);
    await withRollback(MARLON, async (trx: Tx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const retrato = async () => Object.fromEntries((await trx.unsafe<{ t: string; h: string }[]>(sql)).map((l) => [l.t, l.h]));
      const alvo = (escreve: boolean): AlvoDoFuzz => ({
        chamar: async () => {
          if (escreve) await executar(deps, criarAgente, { dono: "pessoa" });
          return { status: 400, corpo: '{"codigo":"entrada_invalida"}' };
        },
        saude: async () => true,
        retrato,
      });
      expect(await executarFuzz(alvo(false), PLANO.casos)).toEqual([]);
      const v = await executarFuzz(alvo(true), PLANO.casos);
      expect(v.length).toBe(PLANO.casos.length);
      expect(v[0]?.motivo).toMatch(/status 400 e o banco da pessoa mudou em: .*agentes/);
    });
  });

  it("um UPDATE num bot que já existe (a contagem não muda) também vira violação: o retrato compara o conteúdo (QA, bug 5)", async () => {
    const sql = await sqlDoRetrato(dbDono);
    await withRollback(MARLON, async (trx: Tx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { agente } = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const retrato = async () => Object.fromEntries((await trx.unsafe<{ t: string; h: string }[]>(sql)).map((l) => [l.t, l.h]));
      let n = 0;
      const alvo: AlvoDoFuzz = {
        chamar: async () => {
          await trx`update agentes set nome = ${`renomeado ${++n}`} where id = ${agente.id}`;
          return { status: 400, corpo: '{"codigo":"entrada_invalida"}' };
        },
        saude: async () => true,
        retrato,
      };
      const v = await executarFuzz(alvo, PLANO.casos);
      expect(v.length).toBe(PLANO.casos.length);
      expect(v[0]?.motivo).toMatch(/status 400 e o banco da pessoa mudou em: .*agentes/);
    });
  });
});
