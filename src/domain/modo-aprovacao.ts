import { MODOS_APROVACAO, type ModoAprovacao } from "../contracts/agente.ts";
import type { MotivoAprovacaoManual } from "../contracts/motivos.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";

/**
 * O modo de aprovação do bot (ADR-059), escolhido pela dona no chip do campo. Duas regras NOMEADAS, como as da
 * ADR-042, porque os alcances são opostos: `modo_automatico` para no arriscado e no que vem depois de conteúdo de
 * fora; `modo_total` só para na credencial. Underscore, nunca hífen (CHECK trilha_sem_texto_livre, 0001).
 * A versão sobe quando muda o CONJUNTO de ações que a regra deixa passar (por exemplo, sair um item da lista de
 * arriscados), para a trilha dizer sob qual semântica o bot agiu.
 */
export const REGRA_MODO_AUTOMATICO = "regra:modo_automatico" as const;
export const VERSAO_MODO_AUTOMATICO = 1 as const;
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
  /** O turno leu conteúdo de fora: entrada não confiável (ADR-026) ou web pelas nativas (0033). */
  conteudoDeFora: boolean;
  /** O gate veio da rotina de OUTRO bot (ADR-058): o automático de quem recebe não o desliga. */
  travaHerdada: boolean;
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
 *  3. trava herdada          → para (ADR-058: a trava é da rotina de quem pediu; o automático de quem recebe não a desliga)
 *  4. conteúdo de fora       → para (ADR-042 claim 6: é por aí que um texto de fora manda no bot)
 *  5. arriscada              → para
 *  6. automático             → aprova
 *
 * Quem chama só consulta o modo onde o manual pediria a pessoa: leitura, "o resto desta tarefa" e as regras da
 * ADR-042 continuam valendo antes, e o que o modo não muda (sem plano, origem sensível, concessão) vem antes dele.
 */
export function decidirPeloModo(modo: ModoAprovacao | undefined, s: SituacaoDaAcao): DecisaoDoModo | null {
  if (!modo || modo === "manual") return null;
  if (s.credencial) return { automatico: false, motivo: "toca_credencial" };
  if (modo === "total") return { automatico: true, regra: REGRA_MODO_TOTAL, versao: VERSAO_MODO_TOTAL };
  if (s.travaHerdada) return { automatico: false, motivo: "gate_de_rotina" };
  if (s.conteudoDeFora) return { automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" };
  if (s.arriscada) return { automatico: false, motivo: "acao_arriscada" };
  return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO };
}

/**
 * O gate da rotina (EMENDA 15, `efeitoExternoSoPorAprovacao`) ainda obriga uma pessoa neste modo? No manual,
 * sempre. No automático, só quando veio da rotina de outro bot (ADR-058); a do próprio bot é satisfeita pelo modo
 * que a dona escolheu para ele, e o efeito externo continua passando por item (a trilha não perde nada). No total,
 * nunca. Em qualquer caso a escrita direta segue negada sob o gate (chamar-ferramenta.ts): o caminho é pedir_aprovacao.
 */
export function gateDaRotinaObrigaPessoa(modo: ModoAprovacao | undefined, travaHerdada: boolean): boolean {
  if (!modo || modo === "manual") return true;
  if (modo === "total") return false;
  return travaHerdada;
}
