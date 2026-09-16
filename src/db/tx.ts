import { randomUUID } from "node:crypto";
import { ErroDeDominio } from "../domain/erro.ts";
import { executarComContexto } from "../obs/contexto.ts";
import type { Conn, Escopo, Transacao, Tx } from "../shared/types.ts";

/**
 * DUAS funções, não uma (Leapy §1 + ADR-003 revisado): withRollback e a fábrica de transação
 * brigam pela propriedade do BEGIN. Produção chama abrirTxEscopada; teste abre o envelope do
 * withRollback e chama vincularEscopo no trx que já existe. Os dois set_config são LOCAIS
 * (terceiro argumento true = SET LOCAL): morrem com a transação e não vazam para a próxima
 * consulta da mesma conexão do pool — provado em tests/integration/spike-rls-rollback.test.ts.
 */

function exigirEscopo(escopo: Escopo): void {
  if (!escopo || typeof escopo.tenantId !== "string" || escopo.tenantId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "tenantId" });
  }
  if (typeof escopo.pessoaId !== "string" || escopo.pessoaId === "") {
    throw new ErroDeDominio("escopo_vazio", { cause: "pessoaId" });
  }
}

/** Só os dois SET LOCAL num trx existente. Lança escopo_vazio para ''/undefined; sem default. */
export async function vincularEscopo(trx: Tx, escopo: Escopo): Promise<void> {
  exigirEscopo(escopo);
  await trx`select set_config('nod.tenant_id', ${escopo.tenantId}, true)`;
  await trx`select set_config('nod.pessoa_id', ${escopo.pessoaId}, true)`;
}

/**
 * BEGIN → set_config tenant → set_config pessoa → correlation_id no AsyncLocalStorage → fn.
 * Devolve uma Transacao (fábrica) para injetar nos casos de uso.
 */
function ehTransacao(conn: Conn): conn is Tx {
  return "savepoint" in conn && typeof conn.savepoint === "function";
}

export function abrirTxEscopada(db: Conn, escopo: Escopo): Transacao {
  exigirEscopo(escopo);
  // Aceita Conn: dentro de um trx (withRollback passando o envelope como "db") o postgres.js só
  // oferece savepoint — `begin` não existe no objeto da transação (medido em 2026-09-16: TypeError).
  // O SET LOCAL num SAVEPOINT morre no ROLLBACK TO e persiste no RELEASE — aceitável para o laço de fundo sob teste.
  const envelope: <T>(cb: (trx: Tx) => Promise<T>) => Promise<unknown> = ehTransacao(db) ? (cb) => db.savepoint(cb) : (cb) => db.begin(cb);
  return async <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => {
    const caixa: { valor?: T } = {};
    await envelope(async (trx) => {
      await vincularEscopo(trx, escopo);
      caixa.valor = await executarComContexto(
        { tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, correlationId: randomUUID() },
        () => fn(trx),
      );
    });
    return caixa.valor as T;
  };
}
