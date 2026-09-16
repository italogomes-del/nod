/**
 * Helper único de transação: SET LOCAL nod.tenant_id antes da primeira leitura (ADR-003).
 * A implementação Postgres entra quando DATABASE_URL existir.
 * A primeira versão funcional usa o Store JSON com o mesmo predicado explícito.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("tenant é obrigatório");
  return fn();
}
