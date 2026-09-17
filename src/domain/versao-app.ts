/** definido em 2026-09-17: versões major.minor.patch e candidatas -rc.N; entrada inválida falha fechado. */
function componentes(valor: unknown): number[] | null {
  if (typeof valor !== "string") return null;
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(valor);
  if (!m) return null;
  const partes = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!partes.every(Number.isSafeInteger)) return null;
  if (m[4] === undefined) return [...partes, Infinity];
  const rc = Number(m[4]);
  return Number.isSafeInteger(rc) ? [...partes, rc] : null;
}

export function versaoAceita(atual: unknown, minima: string): boolean {
  const a = componentes(atual), b = componentes(minima);
  if (!a || !b) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return true;
}
