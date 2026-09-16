export type TenantId = string;
export type EntidadeId = string;

/** Par composto — todo identificador que sai do servidor (ADR-005). */
export type ParId = {
  tenantId: TenantId;
  id: EntidadeId;
};

export function parIgual(a: ParId, b: ParId): boolean {
  return a.tenantId === b.tenantId && a.id === b.id;
}

export function parChave(p: ParId): string {
  return `${p.tenantId}:${p.id}`;
}
