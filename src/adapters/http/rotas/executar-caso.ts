import type { Executor } from "../../../contracts/evento.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import type { Inventario } from "../../../contracts/inventario.ts";
import { criarRepos } from "../../../repositories/index.ts";
import type { Escopo, Relogio, Transacao } from "../../../shared/types.ts";
import type { CasoDeUso, Deps, Services, UseCasesNod } from "../../../use-cases/tipos.ts";

/**
 * O que toda rota da L6 precisa para virar Deps de caso de uso. `abrirTx` é a fábrica escopada
 * (produção: `(escopo) => abrirTxEscopada(db, escopo)`; teste: savepoint dentro do withRollback), para
 * a rota nunca segurar um pool nem saber de BEGIN. As constantes de ambiente chegam lidas pela borda.
 */
export type DepsRotas = {
  abrirTx: (escopo: Escopo) => Transacao;
  services: Services;
  useCases: UseCasesNod;
  agora?: Relogio;
  modeloPadrao?: string;
  prazoDecisaoMs?: number;
  executor?: Executor;
  /** #313: as IAs das máquinas vivas da pessoa (modo compartilhado), para a negação do envio nomear a IA do bot. */
  harnessesDaPessoa?: (pessoaId: string) => Partial<Record<IdHarness, Inventario>>;
};

export type Executar = <I, O>(escopo: Escopo, caso: CasoDeUso<I, O>, input: I) => Promise<O>;

/** Abre a tx escopada, monta Deps, roda o caso de uso e grava os eventos pelo outbox na MESMA tx (ADR-010). */
export function criarExecutor(d: DepsRotas): Executar {
  const agora = d.agora ?? (() => Date.now());
  return (escopo, caso, input) =>
    d.abrirTx(escopo)(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: d.services, useCases: d.useCases, tx: (fn) => fn(trx), escopo, agora };
      const r = await caso(deps, input);
      if (r.events?.length) await deps.repos.events.gravarComOutbox(r.events);
      return r.data;
    });
}

export function corpoObjeto(corpo: unknown): Record<string, unknown> {
  return typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};
}

export function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function textoOpcional(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
