import type { EfeitoAposCommit } from "../contracts/acoes.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { SituacaoConta } from "../contracts/ferramentas-conta.ts";
import type { ServicesNod, UseCasesNod as UseCasesNodContrato } from "../contracts/servicos.ts";
import type { Repos } from "../repositories/tipos.ts";
import type { Escopo, Relogio, Transacao, Tx } from "../shared/types.ts";

/** `Services` concreto: o contrato genérico de src/contracts/servicos.ts fixado em `Tx` (EMENDA 18). */
export type Services = ServicesNod<Tx>;

/**
 * Dependências de todo caso de uso (Práticas §1): repos, services, tx como FÁBRICA, escopo e relógio.
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
  /** Fuso da pessoa enquanto ainda não há preferência individual persistida. */
  fusoPadrao?: string;
  /**
   * NOD-391 (ADR-135 §4): agenda um efeito fora do banco para DEPOIS do commit desta transação (desligar o computador
   * do bot excluído). Ausente = quem montou os Deps não roda efeito pós-commit (o efeito se perde, como antes).
   */
  aposCommit?: (efeito: EfeitoAposCommit) => void;
  /**
   * O modelo do bot criado sem modelo pelo `bots.criar` (NOD_MODELO; ausente = "auto"). Mora nos Deps para a tela e o
   * lote do Nod criarem com o mesmo padrão (NOD-391, QA do #563).
   */
  modeloPadrao?: string;
  /**
   * NOD-351: a situação da conta da pessoa do escopo (situacaoDaConta, na transação do turno), para abrir_conta escolher o cartão. Ausente =
   * contas desligadas (NOD_CONTAS≠1): a ferramenta volta sem cartão, `indisponivel`.
   */
  situacaoConta?: () => Promise<SituacaoConta>;
}

export type UseCasesNod = UseCasesNodContrato<Deps>;

export type CasoDeUso<I, O> = (deps: Deps, input: I) => Promise<{ data: O; events?: RuntimeEvent[] }>;
