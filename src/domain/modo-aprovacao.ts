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
/**
 * definido em 2026-10-18 (plano dos modos de aprovação, 3a): com o revisor ligado o conjunto do automático muda — o
 * arriscado e o envio para fora depois de conteúdo de fora vão ao revisor em vez de parar ou passar direto.
 */
export const VERSAO_MODO_AUTOMATICO_COM_REVISOR = 3 as const;
export const REGRA_MODO_TOTAL = "regra:modo_total" as const;
export const VERSAO_MODO_TOTAL = 1 as const;
/** ADR-115: a ação que o revisor liberou fecha por esta regra (trilha e desfecho da decisão). */
export const REGRA_REVISOR = "regra:revisor" as const;
export const VERSAO_REGRA_REVISOR = 1 as const;
export type RegraDoModo = typeof REGRA_MODO_AUTOMATICO | typeof REGRA_MODO_TOTAL;

/** Nomes que a pessoa lê no menu, na linha da conversa e no prompt. */
export const ROTULO_MODO: Readonly<Record<ModoAprovacao, string>> = {
  manual: "Aprovar manualmente",
  automatico: "Aprovar automaticamente",
  total: "Ignorar todas as aprovações",
};

/**
 * O que cada modo faz, dito à pessoa: a descrição do menu do botão (web/telas/aprovacoes.ts, que não importa valores
 * de src e repete as frases — tests/unit/web/aprovacoes.test.ts confere que são iguais) e a linha gravada na troca.
 * revisto em 2026-10-18 (Fase 4, PR 2): o texto dizia que o automático para depois de ler a web ou um e-mail; desde
 * a ADR-066 não para. As frases descrevem o que a regra de hoje faz (`decidirPeloModo`, `nativas.ts` nega a leitura
 * de arquivo de credencial); as do revisor entram com ele.
 */
export const DESCRICAO_MODO: Readonly<Record<ModoAprovacao, string>> = {
  manual: "Pede você antes de tudo que muda algo: commit, push, mensagem, arquivo fora da pasta.",
  automatico: "Roda sem perguntar o que não for arriscado. Para no arriscado e no que tocar uma credencial do Mac.",
  total: "Faz tudo sem perguntar. Não abre arquivos de credencial do Mac, e comandos com elas pedem você.",
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
  /** Só pesa com o revisor ligado: escrita num app que não é ler nem apagar, todo MCP da pessoa, `enviaPeloTerminal`. */
  envioParaFora?: boolean;
  /** Só pesa com o revisor ligado: o turno, ou outro turno da conversa nas últimas 24 h, leu conteúdo de fora. */
  contaminado?: boolean;
};

export type DecisaoSemRevisor =
  | { automatico: true; regra: RegraDoModo; versao: number }
  | { automatico: false; motivo: MotivoAprovacaoManual };
/** O terceiro desfecho (ADR-115): a ação vai ao revisor. Cada chamador diz o que faz com ele (`semRevisor`). */
export type DecisaoDoModo = DecisaoSemRevisor | { revisar: true; gatilho: GatilhoDeRevisao };

/**
 * O que o modo decide sobre uma ação que, no manual, pediria a pessoa. `null` = modo manual: vale a regra de sempre,
 * sem mudança nenhuma.
 *
 * Revisor DESLIGADO (`revisor` falso, o padrão; a chave `NOD_REVISOR`): a regra de hoje, byte a byte, e `envioParaFora`
 * e `contaminado` não pesam. Ordem fechada, tudo que para antes do que aprova:
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
 * Revisor LIGADO (definido em 2026-10-18, plano dos modos de aprovação, 3a; ADR-115): o total segue igual (a credencial
 * dele continua cartão até o PR 6); no automático, credencial é cartão sem revisor (decisão do Marlon), e o resto segue
 * `gatilhoDeRevisao` — arriscada ou envio para fora depois de conteúdo de fora → `revisar`; senão aprova, na versão 3.
 *
 * Quem chama só consulta o modo onde o manual pediria a pessoa: leitura, "o resto desta tarefa" e as regras da
 * ADR-042 continuam valendo antes, e o que o modo não muda (sem plano, origem sensível, concessão) vem antes dele.
 */
export function decidirPeloModo(modo: ModoAprovacao | undefined, s: SituacaoDaAcao, revisor = false): DecisaoDoModo | null {
  if (!modo || modo === "manual") return null;
  if (s.credencial) return { automatico: false, motivo: "toca_credencial" };
  if (modo === "total") return { automatico: true, regra: REGRA_MODO_TOTAL, versao: VERSAO_MODO_TOTAL };
  if (!revisor) {
    if (s.arriscada) return { automatico: false, motivo: "acao_arriscada" };
    return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO };
  }
  const gatilho = gatilhoDeRevisao({ arriscada: s.arriscada, credencial: false, envioParaFora: s.envioParaFora === true, contaminado: s.contaminado === true });
  if (vaiAoRevisor(gatilho)) return { revisar: true, gatilho };
  return { automatico: true, regra: REGRA_MODO_AUTOMATICO, versao: VERSAO_MODO_AUTOMATICO_COM_REVISOR };
}

/**
 * Os caminhos SEM revisor na v1 (plano, 3a): rotina e acesso pelo modo, o pré-voo da rotina, o `gerir_bots` do Nod e o
 * `esperar_comando`. Neles "revisar" vira o cartão de hoje: o arriscado para (`acao_arriscada`) e o envio depois de
 * conteúdo de fora também (no `esperar_comando`, que não abre cartão, o comando não roda por ali).
 */
export function semRevisor(d: DecisaoDoModo | null): DecisaoSemRevisor | null {
  if (d === null || !("revisar" in d)) return d;
  return { automatico: false, motivo: "acao_arriscada" };
}

/** A ação vai ao revisor do Automático novo por um destes motivos (plano dos modos de aprovação, Parte 3a). */
export type GatilhoDeRevisao = "arriscado" | "envio_apos_fora";

/**
 * O que o Automático novo faz com a ação: `credencial` é cartão direto, sem revisor; os outros dois vão ao revisor.
 * definido em 2026-10-18 (decisão do Marlon sobre a decisão em aberto 5 do plano): credencial no Automático é sempre
 * cartão na v1, em turno limpo ou não — o "turno limpo" não vê a leitura pelo Bash nem o e-mail lido no turno anterior.
 */
export type GatilhoDoAutomatico = "credencial" | GatilhoDeRevisao;

/** O que o Automático novo precisa saber além da `SituacaoDaAcao`. */
export type SituacaoParaRevisao = SituacaoDaAcao & {
  /** Escrita num app que não é ler nem apagar, todo MCP da pessoa (ADR-103) e `enviaPeloTerminal` no terminal. */
  envioParaFora: boolean;
  /** O turno, ou outro turno da mesma conversa nas últimas 24 h, leu conteúdo de fora (revisão de engenharia, item 11). */
  contaminado: boolean;
};

export function vaiAoRevisor(g: GatilhoDoAutomatico | null): g is GatilhoDeRevisao {
  return g === "arriscado" || g === "envio_apos_fora";
}

/**
 * O gatilho do Automático novo para uma ação que, no manual, pediria a pessoa. Puro e sem modo: o PR 1 do plano mede
 * quantas revisões ele faria em TODO bot, e o PR 3 o chama de dentro de `decidirPeloModo` no ramo do automático (uma
 * fonte só para o gatilho, revisão de engenharia, item 24). Ordem fechada:
 *
 *  1. credencial                    → `credencial` (cartão, nunca o revisor)
 *  2. arriscada                     → `arriscado`
 *  3. envio para fora e contaminado → `envio_apos_fora`
 *  4. senão                         → null (o Automático roda sem perguntar)
 *
 * `arriscada` aqui é a de quem chama SEM o alívio da conversa (`conversaComAPessoa`): no Automático novo o apagar pedido na
 * conversa também vai ao revisor (o A4 do protótipo). Ainda não muda decisão nenhuma.
 */
export function gatilhoDeRevisao(s: SituacaoParaRevisao): GatilhoDoAutomatico | null {
  if (s.credencial) return "credencial";
  if (s.arriscada) return "arriscado";
  if (s.envioParaFora && s.contaminado) return "envio_apos_fora";
  return null;
}
