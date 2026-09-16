export type RegimeAmbiente = "local" | "servidor";

/**
 * Regime LOCAL (ADR-015 revisado, ADR-014 invertido): o CLI é o da pessoa e resolve a própria
 * credencial pelo Keychain; o filho HERDA o ambiente menos a DENYLIST. A sonda de 2026-09-16 mediu
 * (run.sh): removendo exatamente estas variáveis, init.apiKeySource ficou 'none'
 * (cobrança na assinatura claude.ai); com ANTHROPIC_API_KEY herdada viraria API sem aviso.
 * NOD_.* também sai: o filho não vê segredo de sessão, URL do banco nem chave de cifra.
 */
const PREFIXOS_NEGADOS = ["CLAUDE_CODE_", "ANTHROPIC_", "NOD_"] as const;
const NOMES_NEGADOS = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT"] as const;

/** Regime SERVIDOR: parte de {} e copia só a allowlist (ADR-015 B). Sem chave de fornecedor nesta rodada. */
const ALLOWLIST_SERVIDOR = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const;

export function chaveNegada(nome: string): boolean {
  if ((NOMES_NEGADOS as readonly string[]).includes(nome)) return true;
  return PREFIXOS_NEGADOS.some((p) => nome.startsWith(p));
}

export function montarAmbiente(regime: RegimeAmbiente, source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  if (regime === "local") {
    for (const [k, v] of Object.entries(source)) {
      if (v === undefined || chaveNegada(k)) continue;
      out[k] = v;
    }
    return out;
  }
  for (const k of ALLOWLIST_SERVIDOR) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const ALLOWLIST_AMBIENTE_SERVIDOR = ALLOWLIST_SERVIDOR;
