import type { CasoNod } from "../contracts/servicos.ts";
import { autorizarDelegacao } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { agenteVisivel, autoriaAgente, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-16: classe de procuração que autoriza bot-a-bot entre donos diferentes (ADR-025). */
export const CLASSE_PERGUNTAR_A_BOT = "perguntar_a_bot";

/** Moldura do SERVIDOR para a pergunta chegar ao alvo marcada como vinda de outro bot, não da pessoa. */
export function moldurarPergunta(remetenteNome: string, pergunta: string): string {
  return `Pergunta de ${remetenteNome} (outro bot do nod, não supervisionado por pessoa neste turno): ${pergunta}\nResponda em texto, curto e verificável. Você não pode delegar nem encaminhar.`;
}

/**
 * Ferramenta `perguntar_a_bot` (1 salto, E12.4 eixo 1): o remetente é o agente do TOKEN; o alvo é
 * resolvido por nome entre os agentes visíveis. Mesmo dono passa; dono diferente só com
 * procuração prévia (autorizarDelegacao, fail-closed → nao_permitido). O turno do alvo nasce na
 * conversa própria dele, origem 'peer', profundidade 1 (o plano tira perguntar_a_bot/encaminhar
 * estruturalmente), entrada nao_confiavel (veio de outro modelo, ADR-026). A pergunta é gravada na
 * conversa do alvo como mensagem do remetente (autor_id = remetente, turno_id = tarefa): é essa
 * ligação TIPADA que entregarRespostaPeer usa para achar a quem devolver a resposta.
 * definido em 2026-09-16: gastoHoje = 0 — sem rota de procuração nesta rodada, o teto diário não
 * é contado (registrado como pendência).
 */
export const perguntarABot: CasoNod<Deps, "perguntar_a_bot"> = async (deps, input) => {
  const remetente = await agenteVisivel(deps.repos, input.agenteId);
  const alvo = await deps.repos.agentes.buscarPorNome(input.agente.trim().replace(/^@/, ""));
  if (!alvo) throw new ErroDeDominio("nao_encontrado", { cause: "bot alvo" });
  if (alvo.id === remetente.id) throw new ErroDeDominio("entrada_invalida", { cause: "perguntar a si mesmo" });
  const pergunta = input.pergunta.trim();
  if (pergunta === "") throw new ErroDeDominio("texto_vazio");
  if (alvo.ownerId !== remetente.ownerId) {
    const procuracoes = await deps.repos.procuracoes.listarDoBeneficiario(remetente.id);
    const r = autorizarDelegacao(procuracoes, { agenteConcedenteId: alvo.id, agenteBeneficiarioId: remetente.id, classe: CLASSE_PERGUNTAR_A_BOT, gastoHoje: 0 });
    if (!r.autorizado) throw new ErroDeDominio("nao_permitido", { cause: r.motivo });
  }
  const conversaAlvo = await deps.repos.conversas.buscarPropriaDoAgente(alvo.id);
  if (!conversaAlvo) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do alvo" });
  const agora = deps.agora();
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "peer",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 1,
    entradaTexto: moldurarPergunta(remetente.nome, pergunta),
    entradaConfianca: "nao_confiavel",
    modelo: alvo.modelo,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno peer não criado" });
  const autoria = autoriaAgente(remetente.id, deps.escopo.pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaAlvo.id,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: pergunta,
    confianca: "nao_confiavel",
  });
  return {
    data: { tarefa_id: turno.id },
    events: [
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "peer", profundidade: 1, remetenteAgenteId: remetente.id, mensagemId: mensagem?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
