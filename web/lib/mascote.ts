import type { Agente, FormaAgente } from "../../src/contracts/agente.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc } from "./escape.ts";

/**
 * Adaptador do motor SVG temporário Bloub/GrokBot.
 * Mantém forma, estado e desenho isolados para a identidade definitiva poder substituí-lo sem
 * alterar contratos, banco ou telas. Referência e licença registradas em THIRD_PARTY_NOTICES.md.
 */
export type EstadoMascote = "disponivel" | "pensando" | "trabalhando" | "aguardando" | "pausado";

export const FORMAS_MASCOTE = ["shape-square", "shape-hex", "shape-circle", "shape-pebble", "shape-capsule", "shape-triangle", "shape-cloud", "shape-drop"] as const satisfies readonly FormaAgente[];
export const CORES_MASCOTE = ["c-red", "c-pink", "c-purple", "c-blue", "c-teal", "c-green", "c-orange", "c-black", "c-brown", "c-amber", "c-gray", "c-cream"] as const;

export const ESTADOS_BLOUB = { disponivel: "idle", pensando: "thinking", trabalhando: "orbit", aguardando: "notify", pausado: "sleep" } as const;
/** `xxl` (definido em 2026-10-04): o mascote da tela cheia da ligação, o maior da interface. */
export type TamanhoMascote = "" | "sm" | "md" | "lg" | "xl" | "xxl";
const ROTULOS = { disponivel: "disponível", pensando: "pensando", trabalhando: "trabalhando", aguardando: "aguardando você", pausado: "pausado (reservado)" };
export function htmlMascote(a: Pick<Agente, "nome" | "cor" | "forma">, tamanho: TamanhoMascote = "", estado: EstadoMascote = "disponivel", extra = ""): string {
  return `<nod-mascote class="icon mascote ${esc(a.cor)} ${esc(a.forma)}${tamanho ? ` ${tamanho}` : ""}" data-mascote data-estado="${estado}" state="${ESTADOS_BLOUB[estado]}" shape="${a.forma}" role="img" aria-label="${esc(a.nome)} · ${ROTULOS[estado]}" title="${esc(a.nome)} · ${ROTULOS[estado]}" ${extra}></nod-mascote>`;
}
type ElementoMascote = {
  classList: Iterable<string> & { remove(...tokens: string[]): void; add(...tokens: string[]): void };
  setAttribute(nome: string, valor: string): void;
};
export function atualizarMascote(elemento: ElementoMascote, forma: FormaAgente, cor: string): void {
  for (const classe of [...elemento.classList]) {
    if (classe.startsWith("shape-") || classe.startsWith("c-")) elemento.classList.remove(classe);
  }
  elemento.classList.add(forma, cor);
  elemento.setAttribute("shape", forma);
}

/**
 * Traduz somente fatos já tipados da web em expressão visual; o estado não é persistido no avatar.
 * definido em 2026-10-08 (QA do épico #188, K8 variante 3: "um sinal por bot"): o turno de uma task não anima o mascote —
 * quem diz que o bot tem task rodando é o chip com o número ao lado do nome. Antes, com uma task rodando, o mascote
 * girava (a variante 1, recusada) e o chip piscava ao mesmo tempo. A lista de `GET trabalhos` diz qual turno é de task
 * (`turnoVivoId`), além do `trabalhoId` que o turno vivo já traz; `conversas` fica de fora (a barra relê pelo que lê).
 */
export function estadoMascoteNaConversa(estado: Estado, conversaId: string): EstadoMascote {
  const deTask = new Set((estado.trabalhos?.trabalhos ?? []).flatMap((t) => (t.turnoVivoId ? [t.turnoVivoId] : [])));
  const vivos = Object.values(estado.turnosVivos).filter((turno) => turno.conversaId === conversaId && !turno.trabalhoId && !deTask.has(turno.turnoId));
  if (vivos.some(t => t.estado === "rodando")) return "trabalhando";
  if (vivos.some(t => t.estado === "na_fila")) return "pensando";
  const aguarda = estado.suaVez?.itens.some((item) => item.decisao.conversaId === conversaId && item.estadoColuna !== "vencido");
  return aguarda ? "aguardando" : "disponivel";
}
