import { abrirTxEscopada } from "../../db/tx.ts";
import { log } from "../../obs/log.ts";
import { listarTodas } from "../../repositories/pessoas.repo.ts";
import type { Conn, Escopo, Transacao } from "../../shared/types.ts";

/**
 * TODO laço de fundo (scheduler, varredores, despachante do outbox) passa por aqui: lista as
 * pessoas (tabela sem RLS por pessoa, exceção nomeada no gate) e abre abrirTxEscopada por pessoa.
 * Não existe "transação sem pessoa": esquecer o escopo lança escopo_vazio em vez de devolver
 * zero linhas em silêncio (ADR-003 revisado). Uma pessoa que falha não impede as outras: o erro
 * é entregue ao `aoFalhar` e o laço segue.
 */
export async function paraCadaPessoa(
  db: Conn,
  fn: (escopo: Escopo, tx: Transacao) => Promise<void>,
  aoFalhar: (escopo: Escopo, erro: unknown) => void = (escopo, erro) =>
    log("erro", "laco_de_fundo_falhou", {
      tenant_id: escopo.tenantId,
      pessoa_id: escopo.pessoaId,
      erro: erro instanceof Error ? erro.name : "desconhecido",
      // nunca err.message: pode carregar dado da linha (ADR-002/004)
    }),
): Promise<void> {
  const pessoas = await listarTodas(db);
  for (const p of pessoas) {
    const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
    try {
      await fn(escopo, abrirTxEscopada(db, escopo));
    } catch (e) {
      aoFalhar(escopo, e);
    }
  }
}
