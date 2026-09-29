import type { Mensagem } from "../contracts/mensagem.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { entradaDoPedido } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { agenteVisivel, autoriaAgente, autorizarAlvo, evento, PRAZO_DECISAO_MS, resolverAlvo } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";

/**
 * Classes de procuração que autorizam pedir a bot de OUTRO dono (ADR-025). definido em 2026-09-29 (ADR-058):
 * `pedir_a_bot` é a nova; as procurações antigas, dadas para perguntar_a_bot ou delegar_tarefa, continuam valendo.
 */
export const CLASSES_PEDIR_A_BOT = ["pedir_a_bot", "delegar_tarefa", "perguntar_a_bot"] as const;

/** O turno de quem pede: dele, e em profundidade 0 — quem cumpre um pedido de colega não repassa (ADR-058). */
async function turnoDoRemetente(deps: Deps, turnoId: string, remetenteId: string): Promise<Turno> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== remetenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno do remetente" });
  if (turno.profundidade !== 0) throw new ErroDeDominio("nao_permitido", { cause: "quem cumpre um pedido de colega não repassa" });
  return turno;
}

/**
 * A mensagem da PESSOA que abriu o turno de quem pede, lida do banco por `mensagem_origem_id` (0024), mais as
 * falas absorvidas pelo mesmo turno, na ordem em que chegaram. Vai junto como contexto literal (ADR-058); não
 * é mais condição: turno de rotina ou retomada não tem, e pede do mesmo jeito.
 */
async function mensagensDaPessoa(deps: Deps, turno: Turno): Promise<Mensagem[]> {
  if (!turno.mensagemOrigemId || turno.entradaConfianca !== "confiavel") return [];
  const daPessoa = (m: Mensagem | null): m is Mensagem =>
    m !== null && m.kind === "texto" && m.conversaId === turno.conversaId && m.confianca === "confiavel" && m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === deps.escopo.pessoaId;
  const principal = await deps.repos.mensagens.buscar(turno.mensagemOrigemId);
  if (!daPessoa(principal)) return [];
  const absorvidos = (await deps.repos.turnos.listarDaConversa(turno.conversaId, 200)).filter((t) => t.absorvidoPor === turno.id && t.mensagemOrigemId);
  const outras = (await Promise.all(absorvidos.map((t) => deps.repos.mensagens.buscar(t.mensagemOrigemId as string)))).filter(daPessoa);
  return [principal, ...outras].sort((a, b) => a.criadoEm - b.criadoEm);
}

/**
 * Ferramenta `pedir_a_bot` (definido em 2026-09-29, ADR-058; substitui perguntar_a_bot e delegar_tarefa): um
 * bot pede a um colega uma resposta ou um trabalho, e o colega resolve com os acessos DELE. O remetente é o
 * agente do TOKEN; o alvo, um colega do mesmo dono (outro dono só com procuração). Vale de conversa, sala,
 * rotina ou retomada, em profundidade 0.
 *
 * O turno do alvo nasce na conversa própria dele: origem 'delegacao', profundidade 1 (não repassa),
 * `sob_procuracao_de` = a pessoa dona dos dois e entrada CONFIÁVEL — catálogo inteiro das concessões dele.
 * A trava da rotina de onde o pedido nasceu é resolvida no plano (travaDoPedido, emitir-plano-turno.ts).
 * Na conversa do alvo fica o `peer_pedido` (fala do remetente, "remetente · por pessoa", ADR-023); na de
 * origem, o `handoff`. Os dois são texto de modelo e continuam marcados não confiáveis (ADR-026: a marca é
 * do conteúdo); o que mudou é que ela não reduz mais o catálogo de quem recebe.
 */
export const pedirABot: CasoNod<Deps, "pedir_a_bot"> = async (deps, input) => {
  const remetente = await agenteVisivel(deps.repos, input.agenteId);
  const pedido = input.pedido.trim();
  if (pedido === "") throw new ErroDeDominio("texto_vazio");
  const contexto = input.contexto?.trim() || null;
  const turnoRemetente = await turnoDoRemetente(deps, input.turnoId, remetente.id);
  const alvo = await resolverAlvo(deps.repos, remetente, input.agente);
  await autorizarAlvo(deps.repos, remetente, alvo, CLASSES_PEDIR_A_BOT);
  const conversaAlvo = await deps.repos.conversas.buscarPropriaDoAgente(alvo.id);
  if (!conversaAlvo) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do alvo" });
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "a pessoa";
  const pedidos = (await mensagensDaPessoa(deps, turnoRemetente)).map((m) => m.texto);
  const agora = deps.agora();
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "delegacao",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 1,
    entradaTexto: entradaDoPedido({ pessoaNome, remetenteNome: remetente.nome, pedidos, pedido, contexto }),
    entradaConfianca: "confiavel",
    sobProcuracaoDe: pessoaId,
    modelo: alvo.modelo,
    harness: alvo.harness,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno do pedido não criado" });
  const autoria = autoriaAgente(remetente.id, pessoaId, pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaAlvo.id,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: contexto ? `${pedido}\n\n${contexto}` : pedido,
    payload: { kind: "peer_pedido", conversaOrigemId: input.conversaId, turnoOrigemId: input.turnoId },
    confianca: "nao_confiavel",
  });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: `${remetente.nome} pediu a ${alvo.nome}: ${pedido}`,
    payload: { kind: "handoff", de: remetente.id, para: alvo.id, motivo: pedido, tarefaId: turno.id },
    confianca: "nao_confiavel",
  });
  return {
    data: { tarefa_id: turno.id },
    events: [
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "delegacao", profundidade: 1, remetenteAgenteId: remetente.id, mensagemId: mensagem?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
