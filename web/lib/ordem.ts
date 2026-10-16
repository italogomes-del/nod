/**
 * A ordem das IAs depois de arrastar ou de uma seta (definido em 2026-10-10, plano das IAs): puro, sem DOM, para o teste;
 * quem liga os eventos é web/lib/ordem-arrastavel.ts.
 */

/** A ordem nova depois de levar `de` ao lugar de `para` (descendo, fica depois dele; subindo, antes). */
export function ordemArrastada<T extends string>(ordem: readonly T[], de: T, para: T): T[] {
  if (de === para || !ordem.includes(de) || !ordem.includes(para)) return [...ordem];
  const desce = ordem.indexOf(de) < ordem.indexOf(para);
  const sem = ordem.filter((x) => x !== de);
  sem.splice(sem.indexOf(para) + (desce ? 1 : 0), 0, de);
  return sem;
}

/** Um lugar para cima (-1) ou para baixo (+1); na ponta, a ordem fica como está. */
export function ordemComPasso<T extends string>(ordem: readonly T[], de: T, passo: -1 | 1): T[] {
  const i = ordem.indexOf(de);
  const vizinho = ordem[i + passo];
  return i < 0 || vizinho === undefined ? [...ordem] : ordemArrastada(ordem, de, vizinho);
}
