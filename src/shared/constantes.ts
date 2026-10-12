// Constantes compartilhadas. "definido" = escolha com critério; "medido" só quando alguém cronometrou.

/** Lease do turno. definido em 2026-09-16: 3x a renovação, tolera duas batidas perdidas antes de declarar máquina sem contato (ADR-010). */
export const LEASE_MS = 90_000;
/** Batida de renovação. definido em 2026-09-16: um terço do lease (ADR-010/021). */
export const RENOVACAO_MS = 30_000;
/** Máquina sem poll há mais que isto = offline. definido em 2026-09-16: dois pulls de 20s + folga (ADR-021, presença derivada do poll). */
export const OFFLINE_MS = 60_000;
/**
 * revisto em 2026-10-01 (ADR-067): saíram INATIVIDADE_TURNO_MS (5 min de silêncio), VERIFICACAO_INATIVIDADE_MS e
 * ISENCAO_FERRAMENTA_MS (8 min com uma ferramenta aberta). O vigia de 2026-09-18 matava testes, CI e QA legítimos;
 * o turno agora só acaba quando o bot termina, no Parar ou quando o lease vence.
 *
 * Checagem de mensagem nova numa sessão viva. definido em 2026-10-01 (ADR-067): 3 s — a pessoa vê a mensagem entrar
 * quase na hora; é uma renovação de lease a mais por turno vivo a cada 3 s, barata no in-process e na ponte HTTP.
 */
export const CHECAGEM_MENSAGENS_MS = 3_000;
/** Sonda de conector MCP. definido em 2026-09-16: a sonda de hoje viu um turno inteiro com MCP stdio em 8,3 s (mapa-cli); a descoberta tools/list precisa de bem menos. */
export const PROBE_MS = 8_000;
/** Fatia do long-poll de aprovação. definido em 2026-09-16: abaixo do teto do pull da ponte (20s no servidor, ADR-021); o teto real do tools/call do CLI é medido por scripts/sonda-mcp-timeout.ts (L4). */
export const LONGPOLL_APROVACAO_MS = 20_000;
/**
 * definido em 2026-09-28 (0032): quanto o turno espera, com a ferramenta aberta, a pessoa decidir uma aprovação
 * (fatias de LONGPOLL_APROVACAO_MS). Aprovou nesse tempo, o MESMO turno segue — sem retomada e sem resumo
 * repetido. Era abaixo da isenção do vigia (480 s); o vigia saiu em 2026-10-01 (ADR-067) e o valor ficou.
 */
export const ESPERA_APROVACAO_NO_TURNO_MS = 420_000;
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
/** Abandono do outbox exige AMBAS. definido em 2026-09-16: 5 tentativas cobre um despachante a cada 250ms com falha transitória (Práticas §7). */
export const OUTBOX_TETO_TENTATIVAS = 5;
/** definido em 2026-09-16: 30 min — só o teto esvaziaria a fila numa queda curta do consumidor (Práticas §7). */
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

/**
 * Janela em que os pedaços de texto de um turno viram UM frame `turno.delta` (src/services/barramento.ts). O claude-cli
 * manda um evento por pedaço, e cada um era um frame. medido em 2026-09-30: 10 turnos simultâneos com duas abas
 * abertas publicaram 4.631 frames sem juntar e ~900 com 100 ms (bancada do servidor com o catcher a 40 pedaços/s por
 * turno); o texto continua aparecendo ~10 vezes por segundo, e o buffer de replay cobre cinco vezes mais tempo.
 */
export const JUNTAR_DELTAS_MS = 100;

/**
 * Teto de caracteres da fala e do texto do resultado numa Entrega. A rota da máquina
 * (ponte-validacao.ts) recusa acima disso, e o laço (laco.ts) corta antes de entregar, com marcador
 * visível. definido em 2026-09-28: o valor que a rota já aplicava; o corte existe porque a fala agora
 * junta o relatório escrito antes da última ferramenta, e uma recusa derrubava a entrega inteira e
 * deixava o turno sem assentar.
 */
export const TEXTO_ENTREGA_MAX_CHARS = 100_000;

/** definido em 2026-09-16: 15 s — teto de UMA requisição do servidor a um conector (initialize ou tools/call). */
export const CHAMADA_CONECTOR_MS = 15_000;

/**
 * Quanto o proxy da máquina espera o servidor responder a uma ferramenta que não é do computador.
 * definido em 2026-09-24: tem de cobrir o pior caso do servidor — cliente novo (initialize) mais a
 * chamada, cada um até CHAMADA_CONECTOR_MS — com folga. Com 5 s, o proxy desistia antes: a Nina
 * chamou GMAIL_FETCH_EMAILS (20 e-mails, verbose; 3 e-mails já levaram 4,7 s no Composio), o proxy
 * abortou aos 5 s e respondeu "servidor fora há menos de 1 min" sem o servidor registrar nada.
 * Fica abaixo do MCP_TOOL_TIMEOUT do filho (>= 60 s, montarEnvDoFilho).
 * revisto em 2026-10-05 (NOD-157): com nova tentativa, o pior caso do servidor é ORCAMENTO_CONECTOR_MS (30 s,
 * initialize, tentativas e esperas incluídos), que cabe nestes 35 s com 5 s de folga.
 */
export const PRAZO_FERRAMENTA_PROXY_MS = 2 * CHAMADA_CONECTOR_MS + 5_000;

/**
 * Nova tentativa nos conectores HTTP (NOD-157, emenda à ADR-009). definido em 2026-10-05: no máximo 3
 * tentativas por chamada, espera de ~1 s e ~3 s (jitter de ±25%), `Retry-After` acima de 5 s não é
 * esperado, e tudo cabe em 30 s — abaixo dos 35 s de PRAZO_FERRAMENTA_PROXY_MS, que o proxy do Mac espera.
 */
export const TENTATIVAS_MAX_CONECTOR = 3;
export const ESPERAS_NOVA_TENTATIVA_MS: readonly number[] = [1_000, 3_000];
export const JITTER_NOVA_TENTATIVA = 0.25;
export const ORCAMENTO_CONECTOR_MS = 30_000;
export const RETRY_AFTER_MAX_MS = 5_000;

/**
 * Sonda logo depois do login do Composio (NOD-208). definido em 2026-10-12: logo depois do `fixarConta`, a
 * sessão do tool router ainda pode não expor as ferramentas do toolkit (só os meta COMPOSIO_*) ou responder
 * devagar — os conectores do Breno ficaram desligados assim e, minutos depois, a mesma chamada respondeu na
 * hora. O `verificar` repete a sonda com estas esperas (antes de cada tentativa) e não COMEÇA tentativa
 * nova depois de VERIFICAR_TETO_MS contados do início; cada sonda recebe como orçamento o que sobra do teto
 * (revisão do PR #264: sozinha, a sonda http pode levar ORCAMENTO_CONECTOR_MS). Assim a resposta fica em ~20 s
 * mais o banco: com prazo de sonda (PROBE_MS) nas tentativas, são duas em ~18 s; com catálogo vazio que volta
 * na hora, as quatro em ~14 s.
 */
export const ESPERAS_SONDA_VERIFICAR_MS: readonly number[] = [0, 2_000, 4_000, 8_000];
export const VERIFICAR_TETO_MS = 20_000;
