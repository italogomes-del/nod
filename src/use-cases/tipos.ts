import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ServicesNod, UseCasesNod as UseCasesNodContrato } from "../contracts/servicos.ts";
import type { Repos } from "../repositories/tipos.ts";
import type { Escopo, Relogio, Transacao, Tx } from "../shared/types.ts";

/** `Services` concreto: o contrato genérico de src/contracts/servicos.ts fixado em `Tx` (EMENDA 18). */
export type Services = ServicesNod<Tx>;

/**
 * Dependências de todo caso de uso (Leapy §1): repos, services, tx como FÁBRICA, escopo e relógio.
 * `useCases` são as implementações das nove ferramentas nod, para chamar-ferramenta.ts despachar
 * por tabela (EMENDA 5). A rota/serviço grava `events` via repos.events.gravarComOutbox na MESMA tx.
 */
export interface Deps {
  repos: Repos;
  services: Services;
  useCases: UseCasesNod;
  tx: Transacao;
  escopo: Escopo;
  agora: Relogio;
}

export type UseCasesNod = UseCasesNodContrato<Deps>;

export type CasoDeUso<I, O> = (deps: Deps, input: I) => Promise<{ data: O; events?: RuntimeEvent[] }>;
