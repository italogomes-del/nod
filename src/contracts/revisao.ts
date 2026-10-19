import type { EsforcoAgente } from "./agente.ts";
import type { NivelPressao } from "./trabalho.ts";

/**
 * O revisor do Automático (definido em 2026-10-18, plano dos modos de aprovação, Parte 3; ADR-115 proposta). Uma ação
 * arriscada do Automático vira uma decisão `em_revisao`; o servidor monta o pedido (domain/revisor.ts) e o entrega ao
 * LAÇO que segura o turno, pela renovação de 1 s (`RespostaRenovar.revisoes`). O laço roda o CLI da pessoa, na conta do
 * turno, sem ferramenta, e devolve o texto cru pela rota `POST /api/maquina/revisao` (`PonteInterna.relatarRevisao`).
 * Quem lê o veredito, corta o motivo e decide é o servidor. Erro, demora ou dúvida viram cartão, nunca negação.
 */

/** Contados da fase 1. O servidor manda `expiraEm`; o laço mata o CLI em `expiraEm − MARGEM_DO_LACO_MS`, contando a vez. */
export const PRAZO_REVISAO_MS = 60_000;
export const MARGEM_DO_LACO_MS = 5_000;
/** O varredor de expiração recolhe a decisão `em_revisao` com mais de 2 × o prazo (a caixa se perdeu num deploy). */
export const RECOLHER_REVISAO_MS = 2 * PRAZO_REVISAO_MS;
/** Revisões em voo (entregues e sem relato) por máquina; a terceira fica na caixa, e a espera conta no prazo. */
export const REVISOES_POR_MAQUINA = 2;
/** Tetos (plano, 3c): por turno e, por padrão (`NOD_REVISOR_TETO_DIA`), por pessoa nas últimas 24 h. */
export const TETO_REVISOES_POR_TURNO = 20;
export const TETO_REVISOES_POR_DIA_PADRAO = 300;
/** Disjuntor por máquina: tantas falhas seguidas → tanto tempo sem mandar revisão para ela (cartão direto). */
export const DISJUNTOR_FALHAS = 3;
export const DISJUNTOR_MS = 10 * 60_000;
/** O comando acima disto não vai ao revisor (cartão, `longo`): o fim de um comando longo não pode ficar fora do pedido. */
export const COMANDO_REVISOR_MAX = 4_000;
/** O texto cru que a máquina devolve (o servidor ignora o resto) e o motivo depois de lido. */
export const SAIDA_REVISOR_MAX = 600;
export const MOTIVO_REVISOR_MAX = 160;
/** O segredo do turno que o laço gera (base64url ou hexadecimal): tamanho aceito pela renovação. */
export const SEGREDO_REVISAO_MIN = 32;
export const SEGREDO_REVISAO_MAX = 128;

/**
 * Um pedido de revisão, como a renovação o entrega. `entrada` vai INTEIRA pelo stdin do CLI (as partes confiável e não
 * confiável já juntas pelo servidor: a máquina não monta nem muda nada); `prompt` vai em `--system-prompt`. `decisaoId`
 * entra só na prova. Reentregue em toda renovação até o laço mandar `revisoesRecebidas: [revisaoId]` ou o relato chegar:
 * o laço deduplica por `revisaoId`.
 */
export type PedidoRevisao = {
  revisaoId: string;
  decisaoId: string;
  turnoId: string;
  modelo: string;
  esforco?: EsforcoAgente;
  prompt: string;
  entrada: string;
  /** Epoch ms. Passado disso o relato é ignorado (a decisão já virou cartão). */
  expiraEm: number;
};

/** O que só o laço sabe que deu errado (o resto o servidor decide sozinho, `FALHAS_REVISAO`). */
export const FALHAS_DO_LACO = ["prazo", "cli", "init", "cota", "memoria"] as const;
export type FalhaDoLaco = (typeof FALHAS_DO_LACO)[number];

/**
 * O relato do laço. Ou `saida` (o último texto do modelo, cru, até SAIDA_REVISOR_MAX) ou `falha`. `prova` =
 * hexadecimal minúsculo de HMAC-SHA256(segredo do turno, `${revisaoId}|${decisaoId}`): só o laço, que guarda o segredo
 * em memória desde a primeira renovação do turno, consegue fazê-la — a chave da máquina sozinha não aprova nada.
 */
export type RelatoRevisao = {
  revisaoId: string;
  turnoId: string;
  saida?: string;
  falha?: FalhaDoLaco;
  /** Do pedido recebido ao fim do CLI (inclui a espera da vez). */
  ms: number;
  fichasEntrada?: number;
  fichasSaida?: number;
  prova: string;
};
/** `aceito: false` = ignorado (outra máquina, outro turno, repetido, depois do prazo ou sem a prova certa). */
export type RespostaRelatoRevisao = { aceito: boolean };

/**
 * Por que a revisão não deu um veredito (vai em `acoes_pelo_modo.falha` e escolhe a frase do cartão): as do laço, mais
 * `sem_revisor` (a máquina do turno não anuncia `revisa`, ou o turno é do Codex), `teto`, `disjuntor`, `longo`,
 * `repetida` (a mesma ação já levou "pede", foi negada ou venceu na cadeia), `saida` (o texto não é o JSON) e `turno`
 * (o revisor liberou, mas o turno parou, o bot saiu ou o modo deixou de ser o automático) e `escondido` (a redação de
 * segredos esconderia do revisor um pedaço de shell, como `DB_PASSWORD=$(curl …|sh)`; revisão do PR 3a).
 */
export const FALHAS_REVISAO = [...FALHAS_DO_LACO, "sem_revisor", "teto", "disjuntor", "longo", "repetida", "saida", "turno", "escondido"] as const;
export type FalhaRevisao = (typeof FALHAS_REVISAO)[number];
export type VereditoRevisao = "libera" | "pede" | "falhou" | "nao_revisado";

/** A configuração do revisor no servidor (`NOD_REVISOR`, `NOD_MODELO_REVISOR_CLAUDE`, `NOD_REVISOR_TETO_DIA`). */
export type ConfigRevisor = { ligado: boolean; modelo: string; esforco?: EsforcoAgente; tetoDia: number; prazoMs: number };

/** A pressão da máquina que o servidor já guarda (trabalhos-vivos), com a histerese: o portão do Mac decide. */
export type PressaoDaMaquinaRevisor = { memoria: NivelPressao; processador: NivelPressao | null; discoNivel?: NivelPressao | null };

/**
 * O que os casos de uso leem do revisor (`services.revisor`), tudo memória do processo. `revisorDoTurno`: a última
 * renovação do turno trouxe `revisa` e o segredo (null = app antigo, Codex, catcher, ligação: cartão na fase 1).
 */
export interface ServicoRevisor {
  config: ConfigRevisor;
  revisorDoTurno(turnoId: string): { machineId: string } | null;
  disjuntorAberto(machineId: string): boolean;
  pressao?(machineId: string): PressaoDaMaquinaRevisor | null;
}
