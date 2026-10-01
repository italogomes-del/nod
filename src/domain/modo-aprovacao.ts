import { MODOS_APROVACAO, type ModoAprovacao } from "../contracts/agente.ts";
import type { MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * O modo de aprovação do bot (ADR-059), escolhido pela dona no chip do campo. Duas regras NOMEADAS, como as da
 * ADR-042, porque os alcances são opostos: `modo_automatico` para no arriscado (revisto em 2026-10-01, ADR-066: não para
 * mais depois de conteúdo de fora); `modo_total` só para na credencial. Underscore, nunca hífen (CHECK trilha_sem_texto_livre, 0001).
 * A versão sobe quando muda o CONJUNTO de ações que a regra deixa passar (por exemplo, sair um item da lista de
 * arriscados), para a trilha dizer sob qual semântica o bot agiu.
 */
export const REGRA_MODO_AUTOMATICO = "regra:modo_automatico" as const;
export const VERSAO_MODO_AUTOMATICO = 2 as const;
export const REGRA_MODO_TOTAL = "regra:modo_total" as const;
export const VERSAO_MODO_TOTAL = 1 as const;
export type RegraDoModo = typeof REGRA_MODO_AUTOMATICO | typeof REGRA_MODO_TOTAL;

/** Nomes que a pessoa lê no menu, na linha da conversa e no prompt. */
export const ROTULO_MODO: Readonly<Record<ModoAprovacao, string>> = {
  manual: "Aprovar manualmente",
  automatico: "Aprovar automaticamente",
  total: "Ignorar todas as aprovações",
};

export function ehModoAprovacao(x: unknown): x is ModoAprovacao {
  return typeof x === "string" && (MODOS_APROVACAO as readonly string[]).includes(x);
}

/**
 * A pessoa está falando com o bot neste turno? (definido em 2026-09-30, emenda da ADR-059). Conversa e criação,
 * inclusive as retomadas delas; rotina, sala e pedido de colega não. No automático, apagar num app e merge que a
 * pessoa pediu na conversa saem sem card — a Clarice parou para excluir 50 tasks que o Marlon tinha acabado de
 * pedir. A lista de arriscados do TERMINAL não usa isto: ali o risco é a máquina, não o escopo do pedido.
 */
export function conversaComAPessoa(modoTurno: ModoTurno | undefined): boolean {
  return modoTurno === "conversa" || modoTurno === "criacao";
}

/** O que o servidor sabe da ação na hora de decidir, já calculado por quem chama. */
export type SituacaoDaAcao = {
  /** `comandoArriscado` no terminal; `acaoArriscadaNoApp` no conector. */
  arriscada: boolean;
  /** O comando toca uma credencial do Mac (`tocaCredencial`). */
  credencial: boolean;
};

export type DecisaoDoModo =
  | { automatico: true; regra: RegraDoModo; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual };

/**
 * O que o modo decide sobre uma ação que, no manual, pediria a pessoa. `null` = modo manual: vale a regra de sempre,
 * sem mudança nenhuma. Ordem fechada, tudo que para antes do que aprova:
 *
 *  1. credencial do Mac      → para, em QUALQUER modo (ADR-055 §3: credencial nunca foi aprovação, é cerca)
 *  2. total                  → aprova
 *  3. arriscada              → para
 *  4. automático             → aprova
 *
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram a trava herdada da rotina de
 * outro bot e a parada depois de conteúdo de fora. O Marlon decidiu: depois de ler algo de fora, o manual pede, e o
 * automático e o total seguem sem pedir. A trava herdada vira, no manual, a marca de conteúdo de fora que passa
 * de quem pediu para quem recebe (pedir-a-bot.ts). A ordem é igual em toda origem de turno.
 *
 * Quem chama só consulta o modo onde o manual pediria a pessoa: leitura, "o resto desta tarefa" e as regras da
 * ADR-042 continuam valendo antes, e o que o modo não muda (sem plano, origem sensível, concessão) vem antes dele.
 */
export function decidirPeloModo(modo: ModoAprovacao | undefined, s: SituacaoDaAcao): DecisaoDoModo | null {
  if (!modo || modo === "manual") return null;
  if (s.credencial) return { automatico: false, motivo: "toca_credencial" };
  if (modo === "total") return { automatico: true, regra: REGRA_MODO_TOTAL, versao: VERSAO_MODO_TOTAL };
  if (s.arriscada) return { automatico: false, motivo: "acao_arriscada" };
  return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO };
}
