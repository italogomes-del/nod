import { contextoAtual } from "./contexto.ts";

/**
 * Wrapper ÚNICO de log (Leapy §10): uma linha JSON por evento com ts, tenant_id, pessoa_id e
 * correlation_id do contexto. Fora do domínio (ADR-018). A borda loga; o domínio devolve o que
 * aconteceu. Nunca ecoa o campo `texto` — é o canal por onde dado pessoal vazaria (ADR-002/004).
 */
export type Nivel = "info" | "aviso" | "erro";

export type CamposLog = Record<string, string | number | boolean | null | undefined>;

export function log(nivel: Nivel, evento: string, campos: CamposLog = {}): string {
  const ctx = contextoAtual();
  const { texto: _texto, ...semTexto } = campos;
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    tenant_id: ctx?.tenantId ?? null,
    pessoa_id: ctx?.pessoaId ?? null,
    correlation_id: ctx?.correlationId ?? null,
    ...semTexto,
  });
  // eslint-disable-next-line no-console -- único ponto de saída do processo (definido em 2026-09-16: no-console sem allow)
  console.log(linha);
  return linha;
}
