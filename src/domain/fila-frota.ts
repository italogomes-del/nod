import type { Decisao, EstadoColunaFila, ItemFila } from "../contracts/decisao.ts";

export type DecisaoComNomes = Decisao & { agenteNome: string };

export type GrupoFila = { pessoaId: string; agenteId: string; agenteNome: string; itens: ItemFila[] };

export type FilaMontada = {
  itens: ItemFila[];
  grupos: GrupoFila[];
  vazio: boolean;
  /** Carimbo para "Nada esperando por você · última decisão em …" (ADR-007). */
  ultimaDecisaoEm: string | null;
};

function estadoColuna(d: Decisao, agora: number): EstadoColunaFila {
  if (d.estado === "reaberta") return "reaberto";
  if (d.estado === "vencida" || Date.parse(d.prazoDecisaoEm) <= agora) return "vencido";
  return "pendente";
}

/**
 * Monta "Sua vez" por PESSOA (decisor) e por agente (ADR-007 revisado). Item vencido continua
 * visível em cinza com desfecho, nunca suprimido. Instantes chegam em ISO UTC; aqui viram ms
 * relativos para o cliente só interpolar.
 */
export function montarFila(entrada: { decisoes: readonly DecisaoComNomes[]; agora: number; ultimaDecisaoEm?: string | null }): FilaMontada {
  const itens: ItemFila[] = entrada.decisoes.map((d) => {
    const criadoEm = Date.parse(d.criadoEm);
    const prazo = Date.parse(d.prazoDecisaoEm);
    return {
      decisao: d,
      estadoColuna: estadoColuna(d, entrada.agora),
      agenteNome: d.agenteNome,
      aguardandoHaMs: Math.max(0, entrada.agora - criadoEm),
      recusaAutomaticaEmMs: Math.max(0, prazo - entrada.agora),
    };
  });
  // reabertos primeiro (voltam ao topo), depois por criação; vencidos ficam onde a criação os põe (cinza, visíveis)
  itens.sort((a, b) => {
    const ra = a.estadoColuna === "reaberto" ? 0 : 1;
    const rb = b.estadoColuna === "reaberto" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm);
  });
  const grupos: GrupoFila[] = [];
  for (const item of itens) {
    const chave = `${item.decisao.decisorId}:${item.decisao.agenteId}`;
    let g = grupos.find((x) => `${x.pessoaId}:${x.agenteId}` === chave);
    if (!g) {
      g = { pessoaId: item.decisao.decisorId, agenteId: item.decisao.agenteId, agenteNome: item.agenteNome, itens: [] };
      grupos.push(g);
    }
    g.itens.push(item);
  }
  return { itens, grupos, vazio: itens.length === 0, ultimaDecisaoEm: entrada.ultimaDecisaoEm ?? null };
}
