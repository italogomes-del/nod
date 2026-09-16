import type { Agente } from "../contracts/agente.ts";
import type { Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaConfirmarProposta = { proposta: Proposta; agente: Agente | null; rotina: Rotina | null; decisao: Decisao | null };

/**
 * Nada vale antes daqui (E1.1). 'perfil': aplica nome/título/descrição e marca confirmado; 'rotina':
 * services.rotinas.ativar (L7) na MESMA tx; 'acesso': vira decisão tipo 'acesso' em "Sua vez" (a
 * concessão em si é o decidir da L5). Confirmar duas vezes → estado_invalido (o repositório só sai de pendente).
 */
export const confirmarProposta: CasoDeUso<{ propostaId: string; prazoMs?: number }, SaidaConfirmarProposta> = async (deps, input) => {
  const existente = await deps.repos.propostas.buscar(input.propostaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const proposta = await deps.repos.propostas.decidir(input.propostaId, "confirmada");
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${existente.estado}` });

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const nomePessoa = pessoa?.nome ?? "você";
  const events: RuntimeEvent[] = [];
  let agente: Agente | null = null;
  let rotina: Rotina | null = null;
  let decisao: Decisao | null = null;
  let resumo = "";

  if (proposta.payload.kind === "perfil") {
    const p = proposta.payload;
    agente = await deps.repos.agentes.atualizarPerfil(proposta.agenteId, { nome: p.nome, titulo: p.titulo, descricao: p.descricao, confirmado: true });
    if (!agente) throw new ErroDeDominio("nao_permitido");
    resumo = [p.nome ? `nome: ${p.nome}` : null, p.titulo ? `título: ${p.titulo}` : null, p.descricao ? `descrição: ${p.descricao}` : null].filter((x) => x !== null).join("; ");
    events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: proposta.conversaId, dados: { agente_id: agente.id, acao: "perfil_confirmado", nome: agente.nome, proposta_id: proposta.id } }));
  } else if (proposta.payload.kind === "rotina") {
    rotina = await deps.tx((trx) => deps.services.rotinas.ativar(trx, proposta.id));
    resumo = proposta.payload.resumo;
    events.push(evento(deps.escopo, { kind: "rotina_criada", autoria, agora, conversaId: proposta.conversaId, dados: { rotina_id: rotina.id, proposta_id: proposta.id, proxima_execucao: rotina.proximaExecucao } }));
  } else {
    const p = proposta.payload;
    const agenteDaProposta = await deps.repos.agentes.buscar(proposta.agenteId);
    decisao = await deps.repos.decisoes.criar({
      tipo: "acesso",
      agenteId: proposta.agenteId,
      conversaId: proposta.conversaId,
      prazoDecisaoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
      frase: `Conceder a ${agenteDaProposta?.nome ?? "agente"} ${p.nivel} em ${p.conector}: ${p.capacidades.join(", ")}${p.naoPedido.length ? ` (não pedido: ${p.naoPedido.join(", ")})` : ""}`,
    });
    if (!decisao) throw new ErroDeDominio("nao_permitido");
    resumo = `pedido de acesso a ${p.conector} (${p.capacidades.join(", ")}) aguardando sua decisão`;
    events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: proposta.conversaId, dados: { decisao_id: decisao.id, tipo: "acesso", proposta_id: proposta.id } }));
  }

  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: redigir("proposta-confirmada", agora, { pessoa: nomePessoa, resumo }),
    confianca: "confiavel",
  });
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));

  return { data: { proposta, agente, rotina, decisao }, events };
};
