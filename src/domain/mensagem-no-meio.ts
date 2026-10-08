import type { EventoStream } from "../contracts/turno.ts";

/**
 * Mensagem da pessoa no meio de um turno (definido em 2026-10-07, ADR-081 §6, emenda da ADR-067). Comum a todos os
 * drivers: o laço põe a moldura antes de entregar ao adapter, e cada driver usa o rastreador para achar a resposta.
 *
 * Medido no diário (7 dias até 07/10): 38 mensagens absorvidas no meio de um turno; a resposta curta que o modelo
 * escrevia antes da ferramenta seguinte era descartada como narração (NARRACAO_MAX_CHARS) e a pessoa não via nada.
 */
export function molduraMensagemNoMeio(texto: string): string {
  return `A pessoa escreveu enquanto você trabalhava: «${texto}». Responda a ela primeiro, em poucas frases, e depois continue o trabalho.`;
}

/**
 * O primeiro bloco de texto depois de uma mensagem absorvida é a resposta a ela: sempre fala gravada, de qualquer
 * tamanho. `falados` = os blocos que o driver já mandou como fala intermediária (saem da fala final, senão a pessoa
 * leria duas vezes); `obrigatorios` = os que não puderam sair na hora (sem sink de fala) e entram na fala final
 * mesmo curtos. Os dois conjuntos guardam o próprio objeto do evento, que é o mesmo nas fatias de cada rodada.
 */
export type FalaDoMeio = {
  /** O adapter escreveu uma mensagem da pessoa na sessão. */
  absorveu(): void;
  /**
   * Chamado com cada evento, na ordem. Devolve o texto quando este é a resposta à mensagem do meio (uma vez por
   * absorção; duas mensagens antes de qualquer texto têm uma resposta só). `falouNaHora` diz se o driver vai mandá-la
   * como fala intermediária agora.
   */
  avaliar(ev: EventoStream, falouNaHora: boolean): string | null;
  readonly falados: ReadonlySet<EventoStream>;
  readonly obrigatorios: ReadonlySet<EventoStream>;
};

export function criarFalaDoMeio(): FalaDoMeio {
  let esperando = false;
  const falados = new Set<EventoStream>();
  const obrigatorios = new Set<EventoStream>();
  return {
    absorveu() {
      esperando = true;
    },
    avaliar(ev, falouNaHora) {
      if (!esperando || ev.tipo !== "texto_bloco" || ev.texto.trim() === "") return null;
      esperando = false;
      (falouNaHora ? falados : obrigatorios).add(ev);
      return ev.texto;
    },
    falados,
    obrigatorios,
  };
}
