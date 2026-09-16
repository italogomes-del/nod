const ALLOWLIST = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SLACK_BOT_TOKEN",
  "NOTION_TOKEN",
] as const;

export type ChavesPermitidas = (typeof ALLOWLIST)[number];

/**
 * Parte de objeto VAZIO. Nunca spread de process.env (ADR-015).
 */
export function montarAmbienteExecutor(entrada: {
  credenciais: Readonly<Partial<Record<ChavesPermitidas, string>>>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ALLOWLIST) {
    const v = entrada.credenciais[k];
    if (v) out[k] = v;
  }
  return out;
}

export const ALLOWLIST_AMBIENTE = ALLOWLIST;
