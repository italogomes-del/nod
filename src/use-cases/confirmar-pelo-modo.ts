import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { conversaComAPessoa, decidirPeloModo, type DecisaoDoModo, type RegraDoModo } from "../domain/modo-aprovacao.ts";
import { autoriaAgente, autoriaPessoa } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/** Quem fechou um pedido sem pessoa: a regra do modo, com a versão (ADR-042 claim 4, ADR-059). */
export type PorRegra = { regra: RegraDoModo; regraVersao: number };

/**
 * Autoria de quem aplica uma proposta: a pessoa, quando clicou; o AGENTE sob a regra, quando o modo confirmou
 * (ADR-042 claim 4: regra da pessoa não transforma o ato do agente em ato da pessoa).
 */
export function autoriaDeQuemConfirma(deps: Deps, agenteId: string, porRegra: PorRegra | undefined): Autoria {
  return porRegra ? { ...autoriaAgente(agenteId, deps.escopo.pessoaId), decidido_por: porRegra.regra, regra_versao: porRegra.regraVersao } : autoriaPessoa(deps.escopo.pessoaId);
}

/** Confirmada pelo modo na mesma chamada, a decisão nunca foi card: o frame "decisão criada" só faria a tela piscar. */
export function semCard(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  return events.filter((e) => e.kind !== "decisao_criada");
}

/** Fecha a decisão de mesmo id da proposta: pela pessoa que clicou, ou pela regra (decidida_por nulo). */
export async function fecharDecisaoDaProposta(deps: Deps, id: string, agora: number, porRegra: PorRegra | undefined): Promise<Decisao | null> {
  return porRegra ? deps.repos.decisoes.fecharPorRegra(id, { ...porRegra, agora }) : deps.repos.decisoes.decidir(id, { por: deps.escopo.pessoaId, agora });
}

/**
 * O modo do bot sobre um pedido que a pessoa confirmaria num card (definido em 2026-09-30, emenda da ADR-059):
 * criar, mudar ou excluir rotina e conceder acesso a um app já conectado. Às 08:20 de 30/09 a Clarice, em
 * aprovação automática, parou duas vezes para "mudança de rotina proposta" e às 08:37 para pedir o acesso de
 * excluir tasks — nenhum desses pedidos passava pelo modo, só `pedir_aprovacao`, o terminal e o computador.
 *
 * Mesma regra e mesmo modo ATUAL do agente que decidem as ações; sem plano (chamada fora de turno), manual.
 * `arriscada` só pesa fora da conversa com a pessoa. Devolve a regra quando o modo confirma; senão, null — e o
 * pedido segue para o card de sempre.
 */
export async function confirmacaoPeloModo(deps: Deps, ctx: { agenteId: string; turnoId: string; plano?: PlanoTurno | null }, o: { arriscada: boolean }): Promise<PorRegra | null> {
  if (!ctx.plano) return null;
  const agente = await deps.repos.agentes.buscar(ctx.agenteId);
  const modo = agente?.modoAprovacao;
  if (!modo || modo === "manual") return null;
  const conteudoDeFora = ctx.plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(ctx.turnoId));
  const d: DecisaoDoModo | null = decidirPeloModo(modo, {
    arriscada: o.arriscada && !conversaComAPessoa(ctx.plano.modoTurno),
    credencial: false,
    conteudoDeFora,
    travaHerdada: ctx.plano.politicaExecucao.travaHerdada === true,
  });
  return d?.automatico ? { regra: d.regra, regraVersao: d.versao } : null;
}
