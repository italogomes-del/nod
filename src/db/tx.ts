import { randomUUID } from "node:crypto";
import { ErroDeDominio } from "../domain/erro.ts";
import { executarComContexto } from "../obs/contexto.ts";
import type { Db, Escopo, Transacao, Tx } from "../shared/types.ts";

/**
 * DUAS funções, não uma (Leapy §1 + ADR-003 revisado): withRollback e a fábrica de transação
 * brigam pela propriedade do BEGIN. Produção chama abrirTxEscopada; teste abre o envelope do
 * withRollback e chama vincularEscopo no trx que já existe. Os set_config são LOCAIS
 * (terceiro argumento true = SET LOCAL): morrem com a transação e não vazam para a próxima
 * consulta da mesma conexão do pool — provado em tests/integration/spike-rls-rollback.test.ts
 * e, para o jit, em tests/integration/jit-local.test.ts.
 */

function exigirEscopo(escopo: Escopo): void {
  if (!escopo || typeof escopo.tenantId !== "string" || escopo.tenantId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "tenantId" });
  }
  if (typeof escopo.pessoaId !== "string" || escopo.pessoaId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "pessoaId" });
  }
}

/**
 * Os SET LOCAL do escopo num trx existente, numa consulta só. Lança escopo_vazio para ''/undefined; sem default.
 *
 * `jit = off` vai junto: medido em 2026-09-30 (banco efêmero com 30 bots e 6,8 mil turnos, jit=on padrão do
 * postgres:16): pendentesRenderizaveis de uma conversa com ~1.020 turnos estimava custo 504 mil (acima de
 * jit_optimize_above_cost) e o GET conversa levava 1,45 s, 1,36 s dentro dessa consulta; com jit=off ela
 * rodou em 48 ms. leituras.resumo (custo 173 mil) levava 385–963 ms com JIT e 80–113 ms sem. Consulta curta de
 * OLTP não se paga com compilação. Fica no SET LOCAL, e não em parâmetro de conexão, porque o pooler em modo
 * transação do deploy (ADR-001) não repassa parâmetro de startup; e não em ALTER DATABASE, que só vale para
 * sessão nova e some do código.
 */
export async function vincularEscopo(trx: Tx, escopo: Escopo): Promise<void> {
  exigirEscopo(escopo);
  await trx`select set_config('nod.tenant_id', ${escopo.tenantId}, true), set_config('nod.pessoa_id', ${escopo.pessoaId}, true), set_config('jit', 'off', true)`;
}

/**
 * BEGIN → set_config tenant → set_config pessoa → correlation_id no AsyncLocalStorage → fn.
 * Devolve uma Transacao (fábrica) para injetar nos casos de uso.
 *
 * Só aceita o POOL (Db), nunca uma transação já aberta — e o tipo garante isso: TransactionSql
 * não tem `begin`, então passar um Tx não compila (tests/unit/db/tx.test.ts prova com
 * @ts-expect-error). A guarda em runtime cobre quem chega por JavaScript ou por cast.
 * Motivo (medido em 2026-09-16 no psql): um SET LOCAL feito dentro de um SAVEPOINT PERSISTE
 * depois do RELEASE — abrir a "tx da pessoa B" como savepoint dentro da transação de A deixaria
 * a transação de A rodando como B. Escopo aninhado não existe: quem já tem um trx usa vincularEscopo.
 */
export function abrirTxEscopada(db: Db, escopo: Escopo): Transacao {
  exigirEscopo(escopo);
  if (typeof db.begin !== "function") {
    throw new ErroDeDominio("estado_invalido", { cause: "abrirTxEscopada recebeu uma transação aberta; use vincularEscopo" });
  }
  return async <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => {
    const caixa: { valor?: T } = {};
    await db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      caixa.valor = await executarComContexto(
        { tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, correlationId: randomUUID() },
        () => fn(trx),
      );
    });
    return caixa.valor as T;
  };
}
