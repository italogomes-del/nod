import type { IdHarness } from "./harness.ts";
import type { LimitesIa } from "./inteligencia.ts";
import type { ModoTurno } from "./plano-turno.ts";

/**
 * Raio-X do turno (modo dev, definido em 2026-09-28, 0036): o que foi enviado ao modelo e quanto cada chamada
 * custou. Duas metades da mesma linha de `turno_raio_x`, gravadas em momentos diferentes:
 *  - composição: o servidor monta na EMISSÃO do plano — o prompt por seção, as definições de ferramenta por app,
 *    as nativas e a entrada. Tamanhos sempre; os TEXTOS só com o modo dev da pessoa ligado;
 *  - execução: o driver monta a partir do stream (cada chamada à API com o `usage` dela, as compactações) e
 *    entrega junto do resultado. Só números e nomes de ferramenta.
 *
 * Medido em 2026-09-28 (sessão da Clarice): o nod só guardava o `total_cost_usd` da SESSÃO e os tokens do
 * `result`, e o turno que estourou a janela não deixava ver que a parte fixa ocupava 140 mil dos 200 mil.
 */

/** Uma ferramenta pedida numa chamada e o tamanho do que voltou (null = o resultado não chegou). */
export type FerramentaNaChamada = { nome: string; resultadoChars: number | null; erro: boolean };

export type ChamadaRaioX = {
  /** ms desde o início do turno, no relógio do driver. */
  em: number;
  /** Quanto a chamada ocupou da janela: entrada + cacheLido + cacheNovo. */
  contexto: number;
  entrada: number;
  cacheLido: number;
  cacheNovo: number;
  saida: number;
  pensamento: number;
  /** Chamada de um subagente (Task), não da conversa principal: não conta para o pico do contexto. */
  subagente: boolean;
  ferramentas: FerramentaNaChamada[];
};

/** `system/compact_boundary`: o Claude Code resumiu o histórico. `antes`/`depois` em tokens, quando vierem. */
export type CompactacaoRaioX = { em: number; antes: number | null; depois: number | null; gatilho: string };

export type ExecucaoRaioX = {
  chamadas: ChamadaRaioX[];
  /** Chamadas além de TETO_CHAMADAS_RAIO_X: ficam as primeiras e as últimas, e o total omitido. */
  chamadasOmitidas: number;
  compactacoes: CompactacaoRaioX[];
  /** `result.modelUsage[modelo].contextWindow`. */
  janela: number | null;
  modelo: string | null;
  versaoCli: string | null;
  /** O total da SESSÃO que o CLI informou; o custo do turno é a diferença (custo-turno.ts, 0035). */
  custoSessaoUsd: number | null;
  /** Ferramentas no `init` e se a busca de ferramentas (ToolSearch) estava entre elas. */
  ferramentasNoInit: number;
  buscaDeFerramentas: boolean;
  duracaoMs: number;
};

/**
 * Tetos da execução: ela viaja na MESMA entrega que a fala (corpo HTTP de até 1 MB, fala de até 100 mil
 * caracteres), e um Raio-X grande demais derrubaria a entrega do turno. Com estes tetos, ~100 KB no pior caso.
 */
export const TETO_CHAMADAS_RAIO_X = 300;
export const TETO_FERRAMENTAS_POR_CHAMADA = 20;
export const TETO_FERRAMENTAS_RAIO_X = 600;
export const TETO_COMPACTACOES_RAIO_X = 100;

/** Seções do prompt de sistema do nod, na ordem em que aparecem. */
export const SECOES_DO_PROMPT = ["identidade", "modo", "computador", "colegas", "rotinas", "apps", "ferramentas", "memoria", "contexto"] as const;
export type SecaoDoPrompt = (typeof SECOES_DO_PROMPT)[number];

export type ParteDoPrompt = { secao: SecaoDoPrompt; chars: number; texto?: string };

/** Definições de ferramenta que o proxy lista, agrupadas: `nod`, `computador`, `pastas` ou o slug do app. */
export type GrupoDeFerramentas = { grupo: string; origem: "nod" | "computador" | "workspace" | "conector"; quantidade: number; chars: number };

export type ComposicaoRaioX = {
  modo: ModoTurno;
  modelo: string;
  harness: string | null;
  sessaoRetomada: boolean;
  promptChars: number;
  prompt: ParteDoPrompt[];
  ferramentas: GrupoDeFerramentas[];
  nativas: string[];
  entrada: { chars: number; anexos: number; texto?: string };
  /** Os textos vieram junto (modo dev ligado na emissão). */
  comTexto: boolean;
};

/** GET turnos/:id/raio-x. `custoUsd` é o do turno (turnos.custo_usd), já sem o acumulado da sessão. */
export type RaioXTurno = {
  turnoId: string;
  agenteId: string;
  estado: string;
  custoUsd: number | null;
  criadoEm: number;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
};

/** Uma linha por turno na faixa dev embaixo de cada resposta. */
export type ResumoRaioX = {
  turnoId: string;
  custoUsd: number | null;
  chamadas: number;
  compactacoes: number;
  /** Maior contexto de uma chamada da conversa principal, em tokens. */
  picoContexto: number | null;
  janela: number | null;
  /** Cache lido sobre o contexto total das chamadas, de 0 a 100. */
  cachePct: number | null;
  modelo: string | null;
};

/** GET conversas/:id/raio-x?desde=<epoch ms>: os resumos e o total desde `desde` (a meia-noite da pessoa). */
export type RaioXConversa = { turnos: ResumoRaioX[]; desde: { custoUsd: number; turnos: number } };

/**
 * Preferências da pessoa (0036). `avisosFechados` (0059, definido em 2026-10-06): a chave de cada aviso da tela que ela
 * fechou — por tipo, não por bot (ex.: "modo:total"). Fechou uma vez, não volta.
 */
/**
 * `faixaTrabalhosRecolhida` (definido em 2026-10-07, ADR-083): a faixa de Trabalhos em cima do campo fica recolhida
 * numa pílula. Reversível (diferente dos avisos fechados). revisto em 2026-10-09: a web não lê nem grava mais — a faixa
 * nasce sempre recolhida e abrir vale só enquanto a pessoa está na conversa (web/estado/reducer.ts, `faixaTrabalhosAberta`).
 */
/**
 * `usoDoMac` (definido em 2026-10-08, ADR-085): quanto do Mac os bots podem usar antes de trabalho novo em segundo
 * plano esperar. Ausente = "equilibrado" (o padrão da 0064).
 */
export const USOS_DO_MAC = ["pouco", "equilibrado", "livre"] as const;
export type UsoDoMac = (typeof USOS_DO_MAC)[number];
export const USO_DO_MAC_PADRAO: UsoDoMac = "equilibrado";
/** `maquinaPadraoId` (ADR-090, 0066): onde trabalha o bot sem máquina escolhida; null = qualquer uma. */
/**
 * `ordemIas` (0068, emenda da ADR-036): a ordem das IAs do Automático da pessoa; null = a padrão (ORDEM_IAS_PADRAO).
 * `iasNoLimite`: as IAs que o servidor viu chegar ao limite da assinatura, com o prazo (vencidas podem continuar aqui).
 */
export type Preferencias = { modoDev: boolean; avisosFechados: string[]; faixaTrabalhosRecolhida?: boolean; usoDoMac?: UsoDoMac; maquinaPadraoId?: string | null; ordemIas?: IdHarness[] | null; iasNoLimite?: LimitesIa };
