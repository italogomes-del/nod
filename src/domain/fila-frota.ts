import type { Decisao } from "../contracts/decisao.ts";

export type EstadoItemFila = "pendente" | "vencido" | "reaberto";

export type ItemFila = {
  decisao: Decisao;
  estado: EstadoItemFila;
  empresaId: string;
};

/**
 * Ordena a fila. Item vencido continua visível (ADR-007). Nunca suprime.
 */
export function montarFila(entrada: {
  decisoes: readonly (Decisao & { empresaId: string })[];
  agora: number;
}): ItemFila[] {
  const itens: ItemFila[] = entrada.decisoes.map((d) => {
    let estado: EstadoItemFila = "pendente";
    if (d.estado === "reaberta") estado = "reaberto";
    else if (d.estado === "vencida" || d.expiresAt <= entrada.agora) estado = "vencido";
    return { decisao: d, estado, empresaId: d.empresaId };
  });
  itens.sort((a, b) => a.decisao.criadoEm - b.decisao.criadoEm);
  return itens;
}
