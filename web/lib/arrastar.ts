import type { FrotaDto } from "../../src/contracts/api.ts";

type Bot = FrotaDto["agentes"][number];

/**
 * Arrastar na barra lateral (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): um grupo é a grade de fixados
 * ou uma seção ("" = Meus agentes). Soltar manda ao servidor a ordem inteira do grupo de destino (0041) e a barra se
 * reorganiza na hora, sem esperar a frota voltar.
 */
export type Destino = { grupo: "fixados" } | { grupo: "secao"; secao: string };

const noGrupo = (b: Bot, destino: Destino): boolean => (destino.grupo === "fixados" ? b.fixado : !b.fixado && (b.secao ?? "") === destino.secao);

/** A mesma ordem do servidor: fixados primeiro, depois a posição (null por último), depois a criação. */
export function compararNaBarra(x: Bot, y: Bot): number {
  return Number(y.fixado) - Number(x.fixado) || (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm;
}

/** Os ids do grupo de destino na ordem da barra, com o bot solto em `indice` (fora do alcance = no fim). */
export function ordemAoSoltar(agentes: readonly Bot[], pessoaId: string, id: string, destino: Destino, indice: number): string[] {
  const grupo = agentes.filter((b) => b.ownerId === pessoaId && b.id !== id && !b.excluidoEm && noGrupo(b, destino)).map((b) => b.id);
  grupo.splice(Math.max(0, Math.min(indice, grupo.length)), 0, id);
  return grupo;
}

/** A frota como ela fica depois de soltar: o bot muda de grupo e o grupo inteiro ganha as posições novas. */
export function frotaAoSoltar(agentes: readonly Bot[], id: string, destino: Destino, ordem: readonly string[]): Bot[] {
  const posicao = new Map(ordem.map((x, i) => [x, i]));
  return agentes
    .map((b) => {
      const movido = b.id !== id ? b : destino.grupo === "fixados" ? { ...b, fixado: true } : { ...b, fixado: false, secao: destino.secao };
      return posicao.has(b.id) ? { ...movido, posicao: posicao.get(b.id) ?? null } : movido;
    })
    .sort(compararNaBarra);
}
