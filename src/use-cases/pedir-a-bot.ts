import type { Mensagem } from "../contracts/mensagem.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { entradaDoPedido } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { agenteVisivel, autoriaAgente, autorizarAlvo, evento, PRAZO_DECISAO_MS, resolverAlvo } from "./apoio-l7.ts";
import type { Deps } from "./tipos.ts";
import { criarTrabalho } from "./trabalhos.ts";

/**
 * Classes de procuração que autorizam pedir a bot de OUTRO dono (ADR-025). definido em 2026-09-29 (ADR-058):
 * `pedir_a_bot` é a nova; as procurações antigas, dadas para perguntar_a_bot ou delegar_tarefa, continuam valendo.
 */
export const CLASSES_PEDIR_A_BOT = ["pedir_a_bot", "delegar_tarefa", "perguntar_a_bot"] as const;

/**
 * O turno de quem pede: dele, e abaixo do limite da corrente (revisto em 2026-09-30, ADR-063: era só profundidade 0,
 * "um salto" da ADR-058). O catálogo já tira pedir_a_bot no limite; esta checagem é a segunda camada.
 */
async function turnoDoRemetente(deps: Deps, turnoId: string, remetenteId: string): Promise<Turno> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== remetenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno do remetente" });
  if (!podeRepassar(turno.profundidade)) throw new ErroDeDominio("nao_permitido", { cause: "limite da corrente de pedidos entre bots" });
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
 * rotina, retomada e — desde 2026-09-30 (ADR-063) — de quem cumpre um pedido, abaixo do limite da corrente.
 *
 * O turno do alvo nasce na conversa própria dele: origem 'delegacao', um passe a mais que o de quem pediu,
 * `sob_procuracao_de` = a pessoa dona dos dois e entrada CONFIÁVEL — catálogo inteiro das concessões dele.
 * revisto em 2026-10-01 (ADR-066): a trava da rotina de onde o pedido nasceu saiu. No lugar dela, se quem pediu já
 * tinha lido algo de fora (entrada marcada ou turno contaminado), o turno de quem recebe nasce com a mesma marca —
 * ela só pesa no modo manual, e a página lida não se lava pelo pedido (ADR-062).
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
  // definido em 2026-09-30 (ADR-063, como a Jornada 02 de 2026-09-16 já previa): entre donos diferentes continua um
  // salto só. A procuração (ADR-025) é de um bot para outro; sem esta trava, o bot da Ana, cumprindo por procuração
  // um pedido do Marlon, chamaria outro bot dela, que nunca deu procuração a ninguém.
  if (turnoRemetente.profundidade > 0 && (remetente.ownerId !== deps.escopo.pessoaId || alvo.ownerId !== deps.escopo.pessoaId)) {
    throw new ErroDeDominio("nao_permitido", { cause: "entre donos diferentes, a corrente é de um salto" });
  }
  await autorizarAlvo(deps.repos, remetente, alvo, CLASSES_PEDIR_A_BOT);
  const conversaAlvo = await deps.repos.conversas.buscarPropriaDoAgente(alvo.id);
  if (!conversaAlvo) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do alvo" });
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "a pessoa";
  const pedidos = (await mensagensDaPessoa(deps, turnoRemetente)).map((m) => m.texto);
  const agora = deps.agora();
  // definido em 2026-10-07 (ADR-083, S7): o pedido de colega é sempre uma task de quem RECEBE (origem `colega`), na
  // conversa dele, com os acessos dele (ADR-058): roda em paralelo com a conversa e com as outras tasks dele.
  // ADR-085 (revisão do #209): pedido feito na conversa com a pessoa (turno dela, fora de task) — ela espera a resposta,
  // e o Mac apertado não o segura. O pedido que nasce numa task ou numa rotina segue a regra do segundo plano.
  const pessoaEsperando = !turnoRemetente.trabalhoId && ["conversa", "sala", "ligacao"].includes(turnoRemetente.origem);
  const { trabalho, events: doTrabalho } = await criarTrabalho(deps, { agenteId: alvo.id, conversaId: conversaAlvo.id, titulo: pedido, origem: "colega", pedidoPorAgenteId: remetente.id, pessoaEsperando });
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "delegacao",
    trabalhoId: trabalho.id,
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: proximaProfundidade(turnoRemetente.profundidade),
    entradaTexto: entradaDoPedido({ pessoaNome, remetenteNome: remetente.nome, pedidos, pedido, contexto }),
    entradaConfianca: "confiavel",
    sobProcuracaoDe: pessoaId,
    modelo: alvo.modelo,
    harness: alvo.harness,
    // NOD-206 (#200): o do turno de quem pede (o bot local delega na mesma máquina); o plano grava o real.
    executor: turnoRemetente.executor,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno do pedido não criado" });
  if (turnoRemetente.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turnoRemetente.id))) await deps.repos.turnos.contaminar(turno.id, agora);
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
    payload: { kind: "handoff", de: remetente.id, para: alvo.id, motivo: pedido, tarefaId: turno.id, trabalhoId: trabalho.id },
    confianca: "nao_confiavel",
  });
  return {
    data: { tarefa_id: turno.id },
    events: [
      ...doTrabalho,
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "delegacao", profundidade: turno.profundidade, remetenteAgenteId: remetente.id, mensagemId: mensagem?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
