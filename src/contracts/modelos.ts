/** definido em 2026-09-17: agentes usam o alias Sonnet do CLI; sondas mantêm Haiku para limitar o custo. */
export const MODELO_AGENTE_PADRAO = "sonnet";
export const MODELO_SONDA_PADRAO = "claude-haiku-4-5-20251001";

/**
 * definido em 2026-10-04 (ADR-072): o modelo do laço de voz, por harness — rápido e sem raciocínio longo. Fixo pelo id
 * (o alias "haiku" pode mudar de modelo sem aviso). O app troca por `NOD_MODELO_LIGACAO_CLAUDE`/`_CODEX` (plano B
 * para a aposentadoria do Haiku 4.5, cuja janela abre em 2026-10-15).
 */
export const MODELO_LIGACAO_CLAUDE = "claude-haiku-4-5-20251001";
export const MODELO_LIGACAO_CODEX = "gpt-6-luna";

/**
 * definido em 2026-10-04: a guia do onboarding no "auto" roda no modelo mais potente do harness, no chat e na ligação.
 * No Claude é o alias `fable` (Claude Code 2.1.289: resolve para claude-fable-5-1), que acompanha o Fable mais novo sem
 * release; medido no mesmo dia, `--model fable` com MAX_THINKING_TOKENS=0 respondeu em 1,8 s, como o Haiku. No Codex é
 * o topo do catálogo editorial.
 */
export const MODELO_MAIS_POTENTE = { "claude-cli": "fable", "codex-cli": "gpt-6-astra" } as const;
