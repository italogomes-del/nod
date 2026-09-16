import { abrirTxEscopada } from "../../db/tx.ts";
import { log } from "../../obs/log.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import type { Db, Escopo, Transacao } from "../../shared/types.ts";

export interface OpcoesLaco {
  /**
   * Fonte das pessoas. Default: `listarTodas(db)` (tabela sem RLS por pessoa, só leitura para
   * nod_app). Injetável para o teste enumerar linhas criadas sob rollback como nod_dono — nunca
   * para pular a tabela em produção.
   */
  listarPessoas?: () => Promise<Pick<Pessoa, "tenantId" | "id">[]>;
  /** Uma pessoa que falha não impede as outras. Default: log sem `message` (ADR-002/004). */
  aoFalhar?: (escopo: Escopo, erro: unknown) => void;
}

const logarFalha = (escopo: Escopo, erro: unknown): void => {
  log("erro", "laco_de_fundo_falhou", {
    tenant_id: escopo.tenantId,
    pessoa_id: escopo.pessoaId,
    erro: erro instanceof Error ? erro.name : "desconhecido",
    // nunca err.message: pode carregar dado da linha (ADR-002/004)
  });
};

/**
 * TODO laço de fundo (scheduler, varredores, despachante do outbox) passa por aqui: lista as
 * pessoas e abre `abrirTxEscopada(db, escopo)` por pessoa — uma transação REAL (BEGIN) por
 * pessoa, nunca um savepoint dentro de outra: o escopo de uma pessoa não pode nascer dentro da
 * transação de outra (ver src/db/tx.ts). Não existe "transação sem pessoa": esquecer o escopo
 * lança escopo_vazio em vez de devolver zero linhas em silêncio (ADR-003 revisado).
 */
export async function paraCadaPessoa(
  db: Db,
  fn: (escopo: Escopo, tx: Transacao) => Promise<void>,
  opcoes: OpcoesLaco = {},
): Promise<void> {
  const listar = opcoes.listarPessoas ?? (() => listarTodas(db));
  const aoFalhar = opcoes.aoFalhar ?? logarFalha;
  const pessoas = await listar();
  for (const p of pessoas) {
    const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
    try {
      await fn(escopo, abrirTxEscopada(db, escopo));
    } catch (e) {
      aoFalhar(escopo, e);
    }
  }
}
