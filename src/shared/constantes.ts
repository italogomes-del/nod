// Constantes compartilhadas. "definido" = escolha com critério; "medido" só quando alguém cronometrou.

/** Lease do turno. definido em 2026-09-16: 3x a renovação, tolera duas batidas perdidas antes de declarar máquina sem contato (ADR-010). */
export const LEASE_MS = 90_000;
/** Batida de renovação. definido em 2026-09-16: um terço do lease (ADR-010/021). */
export const RENOVACAO_MS = 30_000;
/** Máquina sem poll há mais que isto = offline. definido em 2026-09-16: dois pulls de 20s + folga (ADR-021, presença derivada do poll). */
export const OFFLINE_MS = 60_000;
/**
 * Silêncio total do agente que caracteriza turno travado. definido em 2026-09-18: substitui o teto
 * de passos (--max-turns), que cortava trabalho legítimo. Vigia ATIVIDADE, não duração: um turno
 * pode durar uma hora enquanto emite eventos. Mais curto que os 20 min do openmausbot de propósito —
 * lá o relógio corre durante o card de permissão, aqui a espera por ferramenta já é isenta.
 */
export const INATIVIDADE_TURNO_MS = 300_000;
/** Verificação do watchdog. definido em 2026-09-18: um quinto da janela, como a batida é do lease. */
export const VERIFICACAO_INATIVIDADE_MS = 60_000;
/**
 * Teto da isenção por ferramenta aberta. definido em 2026-09-18: 2x o timeout de computador_* (240s),
 * a chamada mais lenta do catálogo. Sem ele, um tool_result perdido isentaria o turno para sempre.
 */
export const ISENCAO_FERRAMENTA_MS = 480_000;
/** Sonda de conector MCP. definido em 2026-09-16: a sonda de hoje viu um turno inteiro com MCP stdio em 8,3 s (mapa-cli); a descoberta tools/list precisa de bem menos. */
export const PROBE_MS = 8_000;
/** Fatia do long-poll de aprovação. definido em 2026-09-16: abaixo do teto do pull da ponte (20s no servidor, ADR-021); o teto real do tools/call do CLI é medido por scripts/sonda-mcp-timeout.ts (L4). */
export const LONGPOLL_APROVACAO_MS = 20_000;
/** Conteúdo não confiável menor que isto não é embrulhado. definido em 2026-09-16: copiado do limiar _UNTRUSTED_WRAP_MIN_CHARS do openmausbot (ADR-026). */
export const UNTRUSTED_WRAP_MIN_CHARS = 32;
/**
 * Corte do resultado de ferramenta antes de entrar no contexto (ADR-013). definido em 2026-09-16 como 8.000
 * (~2k tokens, "cabe num turno haiku"); redefinido em 2026-09-28 para o que o Claude Code do terminal passa
 * inline: 25.000 tokens por resposta MCP (MAX_MCP_OUTPUT_TOKENS padrão), ~75.000 caracteres de JSON. Nenhum
 * bot roda em haiku hoje, e 8.000 cortava o ClickUp da Ada, o Gmail da Tarsila e 70 de 104 arquivos de um PR.
 * Acima disso nada se perde: o proxy guarda o resto e o modelo lê com `ler_mais`.
 */
export const ORCAMENTO_RESULTADO_CHARS = 75_000;
/**
 * definido em 2026-09-28: acima do seu próprio teto o Claude Code desvia a resposta MCP para um arquivo e
 * entrega só o caminho — que o bot do nod não abre (--tools "", sem Read). Todo token tem pelo menos um
 * caractere na prática, mas emoji e escrita não latina gastam mais de um token por caractere: o dobro do
 * orçamento garante que a resposta cortada pelo proxy nunca chega a esse teto.
 * medido em 2026-09-28 (CLI 2.1.283, scripts/sonda-saida-mcp.ts): com as duas proteções, 75.000 caracteres
 * de hex chegaram inline (tool_result de 75.016); sem elas, 120.000 viraram um aviso de 1.476 caracteres
 * apontando para ~/.claude/projects/…/tool-results, e o modelo tentou um `grep` que não tinha.
 */
export const MAX_MCP_OUTPUT_TOKENS_FILHO = ORCAMENTO_RESULTADO_CHARS * 2;
/** Anotação por ferramenta no tools/list (`_meta.anthropic/maxResultSizeChars`): texto até isto fica inline. */
export const MAX_RESULTADO_INLINE_CHARS = ORCAMENTO_RESULTADO_CHARS + 5_000;
/** Abandono do outbox exige AMBAS. definido em 2026-09-16: 5 tentativas cobre um despachante a cada 250ms com falha transitória (Leapy §7). */
export const OUTBOX_TETO_TENTATIVAS = 5;
/** definido em 2026-09-16: 30 min — só o teto esvaziaria a fila numa queda curta do consumidor (Leapy §7). */
export const OUTBOX_IDADE_MIN_MS = 1_800_000;
/** definido em 2026-09-16: limite do Grok Bot (docs/grokbot-comparison.md). */
export const ROTINAS_POR_AGENTE = 50;
/** definido em 2026-09-16: limite do Grok Bot. */
export const EXECUCOES_GUARDADAS = 20;
/** definido em 2026-09-16: sala = 2 a 6 bots (Grok Bot, ADR-027). */
export const SALA_MIN = 2;
export const SALA_MAX = 6;
/** Frames guardados por pessoa para replay. definido em 2026-09-16: cobre ~1 min de deltas de um turno; buffer podado → resumed:false (ADR-016). */
export const BUFFER_SSE_FRAMES = 500;

/** definido em 2026-09-16: 15 s — teto de UMA requisição do servidor a um conector (initialize ou tools/call). */
export const CHAMADA_CONECTOR_MS = 15_000;

/**
 * Quanto o proxy da máquina espera o servidor responder a uma ferramenta que não é do computador.
 * definido em 2026-09-24: tem de cobrir o pior caso do servidor — cliente novo (initialize) mais a
 * chamada, cada um até CHAMADA_CONECTOR_MS — com folga. Com 5 s, o proxy desistia antes: a Nina
 * chamou GMAIL_FETCH_EMAILS (20 e-mails, verbose; 3 e-mails já levaram 4,7 s no Composio), o proxy
 * abortou aos 5 s e respondeu "servidor fora há menos de 1 min" sem o servidor registrar nada.
 * Fica abaixo do MCP_TOOL_TIMEOUT do filho (>= 60 s, montarEnvDoFilho).
 */
export const PRAZO_FERRAMENTA_PROXY_MS = 2 * CHAMADA_CONECTOR_MS + 5_000;
