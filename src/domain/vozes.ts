import { VOZES_NOD, type GeneroVoz, type IdVozNod } from "../contracts/vozes.ts";

/** definido em 2026-10-04 (ADR-071): o contrato só tem dados; as funções sobre o catálogo de vozes moram aqui. */
export function ehIdVoz(x: unknown): x is IdVozNod {
  return typeof x === "string" && VOZES_NOD.some((v) => v.id === x);
}

/** O gênero de uma voz do catálogo; id desconhecido cai em feminina (a voz padrão do produto). */
export function generoDaVoz(id: string): GeneroVoz {
  return VOZES_NOD.find((v) => v.id === id)?.genero ?? "feminina";
}
