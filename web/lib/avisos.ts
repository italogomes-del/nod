import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { AlvoAviso, AvisoDesktop } from "../../src/contracts/desktop.ts";
import { chaveDoItem, umPorFio } from "./perguntas.ts";

/**
 * O que vira aviso (definido em 2026-09-24, "aviso no Mac"): lógica pura sobre a leitura de "Sua vez",
 * sem DOM nem relógio — as regras de silêncio (foco, agrupar, um por minuto) moram em avisador.ts.
 *
 * Um PEDIDO é o que a faixa do topo conta: decisão aberta (um por grupo "×N") ou pergunta aberta (um
 * por fio). Vencido nunca avisa — já não pede ação. Aviso de queda (`incidentes`) nunca avisa — é
 * status, e a queda se resolve sozinha (ADR-045).
 */
type Item = SuaVezDto["itens"][number];

/** Um pedido que a web ainda não tinha visto na fila. */
export type PedidoNovo = {
  /** A decisão que representa o pedido: a mais antiga do grupo "×N" ou do fio. */
  id: string;
  /** Todas as decisões do pedido: as rodadas abertas do fio e as gêmeas do "×N". */
  ids: readonly string[];
  agenteId: string;
  agenteNome: string;
  conversaId: string;
  /** A dona da conversa: a decisora designada que não é dona responde em "Sua vez" (RLS). */
  ownerId: string;
  frase: string;
};

export type Aviso = AvisoDesktop;

/** Onde os avisos saem e se estão ligados — o que "Seu espaço" escreve (web/telas/espaco.ts). */
export type SituacaoAvisos = "ligados" | "desligados" | "bloqueados" | "indisponiveis";
/**
 * `som` (NOD-115): a escolha "Tocar som" guardada neste Mac. Só vem quando a ponte tem `definirSom`; no navegador e no
 * app antigo fica ausente e a tela não mostra o interruptor.
 */
export type EstadoAvisos = { onde: "mac" | "navegador"; situacao: SituacaoAvisos; som?: boolean };

/** O corpo do aviso de UM pedido: a frase do agente, cortada. */
export const CORPO_MAX = 140;

/** Os pedidos abertos, um por fio, na ordem do servidor — a MESMA lista da faixa do topo (renderChamada). */
export function pedidosAbertos(suaVez: SuaVezDto | null): Item[] {
  return umPorFio((suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido"));
}

/** O número do Dock e do título da aba: o mesmo que a faixa do topo diz ("3 pedidos esperando por você"). */
export function contarAbertas(suaVez: SuaVezDto | null): number {
  return pedidosAbertos(suaVez).length;
}

function idsDe(item: Item): string[] {
  return [item.decisao.id, ...item.gemeas];
}

/**
 * Os pedidos abertos que ainda não estavam na fila. `conhecidas` null = primeira leitura desta sessão:
 * ela só fixa a linha de base (o que já esperava ao abrir o nod não é novidade) e não devolve nada.
 *
 * Conhece-se por id de DECISÃO, de qualquer estado: gêmea nova de um "×N" já conhecido não é pedido
 * novo; reaberta (gesto da pessoa) não é novidade; a rodada seguinte de uma pergunta respondida é —
 * o agente voltou a esperar. O conjunto só cresce durante a sessão, então nada avisa duas vezes.
 */
export function novasAbertas(conhecidas: ReadonlySet<string> | null, suaVez: SuaVezDto): { novas: PedidoNovo[]; conhecidas: Set<string> } {
  const todas = new Set(conhecidas ?? []);
  for (const item of suaVez.itens) for (const id of idsDe(item)) todas.add(id);
  if (conhecidas === null) return { novas: [], conhecidas: todas };
  const porPedido = new Map<string, Item[]>();
  for (const item of suaVez.itens) {
    if (item.estadoColuna === "vencido") continue;
    const chave = chaveDoItem(item);
    porPedido.set(chave, [...(porPedido.get(chave) ?? []), item]);
  }
  const novas: PedidoNovo[] = [];
  for (const itens of porPedido.values()) {
    const ids = itens.flatMap(idsDe);
    const [primeiro] = itens;
    if (!primeiro || ids.some((id) => conhecidas.has(id))) continue;
    const d = primeiro.decisao;
    novas.push({ id: d.id, ids, agenteId: d.agenteId, agenteNome: primeiro.agenteNome, conversaId: d.conversaId, ownerId: d.ownerId, frase: d.frase });
  }
  return { novas, conhecidas: todas };
}

/** Espaços colapsados e no máximo `max` caracteres, reticências incluídas. */
export function cortar(texto: string, max: number): string {
  const letras = Array.from(texto.replace(/\s+/g, " ").trim());
  return letras.length <= max ? letras.join("") : `${letras.slice(0, max - 1).join("").trimEnd()}…`;
}

/** "Nina", "Nina e Taga", "Nina, Taga e mais 1": nomes sem repetir, na ordem da fila. */
function quem(nomes: readonly string[]): string {
  const unicos = [...new Set(nomes)];
  if (unicos.length <= 2) return unicos.join(" e ");
  return `${unicos.slice(0, 2).join(", ")} e mais ${unicos.length - 2}`;
}

/**
 * A redação do aviso — as mesmas palavras da faixa do topo. Um pedido: "{agente} precisa de você", a
 * frase do agente no corpo, e o clique abre a conversa (ou "Sua vez", se a conversa é de outra pessoa:
 * a decisora designada não a lê). Vários: "{N} pedidos esperando por você", quem pede no corpo, e o
 * clique abre "Sua vez". Nenhum → null.
 */
export function redigirAviso(novas: readonly PedidoNovo[], pessoaId: string | null = null): Aviso | null {
  const [um] = novas;
  if (!um) return null;
  if (novas.length === 1) {
    const alvo: AlvoAviso = pessoaId !== null && um.ownerId !== pessoaId ? { tipo: "sua-vez" } : { tipo: "conversa", conversaId: um.conversaId, agenteId: um.agenteId };
    return { titulo: `${um.agenteNome} precisa de você`, corpo: cortar(um.frase, CORPO_MAX), alvo };
  }
  return { titulo: `${novas.length} pedidos esperando por você`, corpo: quem(novas.map((n) => n.agenteNome)), alvo: { tipo: "sua-vez" } };
}
