import type { Proposta } from "../contracts/conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Recusar deixa a proposta de lado: nada agendado, nada concedido, agente inalterado (E1.1). */
export const recusarProposta: CasoDeUso<{ propostaId: string }, { proposta: Proposta }> = async (deps, input) => {
  const existente = await deps.repos.propostas.buscar(input.propostaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const proposta = await deps.repos.propostas.decidir(input.propostaId, "recusada");
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });
  // definido em 2026-09-28 (ADR-050): as rotinas que vieram com o perfil saem de lado junto com ele —
  // o card era um só, e elas não têm decisão própria em "Sua vez" para alguém recusar depois.
  if (proposta.payload.kind === "perfil") {
    for (const id of proposta.payload.rotinas ?? []) {
      const rp = await deps.repos.propostas.buscar(id);
      if (rp?.estado === "pendente") await deps.repos.propostas.decidir(id, "recusada");
    }
  }
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: redigir("proposta-recusada", agora),
    confianca: "confiavel",
  });
  const events = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: proposta.agenteId, acao: "proposta_recusada", proposta_id: proposta.id, kind: proposta.kind } })];
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  return { data: { proposta }, events };
};
