import type { SuaVezDto } from "../contracts/api.ts";
import type { TipoDecisao } from "../contracts/decisao.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import { montarFila } from "../domain/fila-frota.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** O que "Sua vez" e "reabrir" precisam de Deps: a rota (e o teste) montam só isto. */
export type DepsSuaVez = Pick<Deps, "repos" | "escopo" | "agora" | "tx">;

/**
 * Tipos cuja decisão nasce com o MESMO id de uma proposta (confirmar-proposta.ts, criar-rotina.ts,
 * rotinas-do-agente.ts, pedir-acesso.ts). definido em 2026-09-24 (ADR-044): o item leva a proposta
 * para a web rotular o botão ("Permitir e rodar agora" quando o pedido veio de uma rotina).
 */
const TIPOS_COM_PROPOSTA: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["acesso", "perfil", "rotina", "rotina_atualizacao", "rotina_exclusao"]);

export type EntradaSuaVez = {
  /**
   * definido em 2026-09-16: listar = ver. Renderizar a fila para a decisora carimba `vista_em`
   * (idempotente, coalesce) — é o único sinal que separa os dois rótulos de expiração do ADR-017
   * (expirou_sem_ninguem_ver vs. expirou_com_alguem_ciente). Desligável para consultas de fundo.
   */
  marcarVista?: boolean;
};

/**
 * "Sua vez" por PESSOA sob RLS de duas pernas (ADR-007, EMENDA 1): a leitura roda como nod_app com
 * a pessoa da sessão como DECISORA — nunca role privilegiado + filtro na aplicação. Vencida fica
 * visível em cinza com desfecho; reaberta volta ao topo (montarFila). Instantes saem em ISO UTC e
 * ms relativos: o cliente só interpola (web/lib/relogio.ts). Estados negativos são ESCRITOS (E3.3):
 * fila vazia leva o carimbo da última decisão; motor indisponível vira item "fora do ar desde".
 */
export async function listarSuaVez(deps: DepsSuaVez, input: EntradaSuaVez = {}): Promise<{ data: SuaVezDto }> {
  const { repos } = deps;
  const agora = deps.agora();
  const marcar = input.marcarVista ?? true;

  const decisoes = await repos.decisoes.listarSuaVez(agora);
  const ultimaDecisaoEm = await repos.decisoes.ultimaDecisaoEm();
  const fila = montarFila({ decisoes, agora, ultimaDecisaoEm });

  const itens: SuaVezDto["itens"] = [];
  for (const item of fila.itens) {
    let decisao = item.decisao;
    const aberta = decisao.estado === "pendente" || decisao.estado === "reaberta";
    if (marcar && aberta && decisao.vistaEm === null && (await repos.decisoes.marcarVista(decisao.id, agora))) {
      decisao = { ...decisao, vistaEm: new Date(agora).toISOString() };
    }
    const itensAprovacao: ItemAprovacao[] = decisao.tipo === "aprovacao" ? await repos.itensAprovacao.listar(decisao.id) : [];
    const proposta = TIPOS_COM_PROPOSTA.has(decisao.tipo) ? await repos.propostas.buscar(decisao.id) : null;
    itens.push({ ...item, decisao, itensAprovacao, proposta });
  }

  const foraDoAr = (await repos.inventario.listar())
    .filter((m) => m.inventario.estado !== "pronto")
    .map((m) => ({ nome: m.motor, desde: m.inventario.em }));

  return { data: { itens, foraDoAr, vazio: fila.vazio, ultimaDecisaoEm: fila.ultimaDecisaoEm } };
}

/** Prova de que a assinatura cabe no contrato CasoDeUso (Deps completo é um DepsSuaVez). */
export const listarSuaVezComoCaso: CasoDeUso<EntradaSuaVez, SuaVezDto> = listarSuaVez;
