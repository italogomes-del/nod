import type { Agente } from "../contracts/agente.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { cotaSegura } from "../domain/cota-da-ia.ts";
import { entradaDoPedido } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { cicloDoPedido, horarioDoPedido, instrucaoEsperaCircular, instrucaoJaPedido, instrucaoPedidoRecebido, instrucaoPedidosAbertos, repeticaoDoPedido } from "../domain/triagem.ts";
import { agenteVisivel, autoriaAgente, autorizarAlvo, evento, PRAZO_DECISAO_MS, resolverAlvo } from "./apoio-l7.ts";
import { JANELA_PEDIDOS_ABERTOS_MS } from "./pedidos-abertos.ts";
import type { Deps } from "./tipos.ts";
import { ehColega } from "./ver-colegas.ts";
import { situacaoDoBotPelaCota } from "./cota-dos-bots.ts";

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

/** A janela dos pedidos abertos (ADR-099 item 8): mora em pedidos-abertos.ts desde o NOD-259, que a usa também no prompt. */
export { JANELA_PEDIDOS_ABERTOS_MS };

/** Os colegas de quem pediu que estão livres agora (sem turno vivo nem pronto na fila), fora o alvo. */
async function colegasLivres(deps: Deps, remetente: Agente, alvoId: string, agora: number): Promise<Agente[]> {
  const colegas = (await deps.repos.agentes.listar()).filter((a) => ehColega(remetente, a) && a.id !== alvoId);
  const livres = new Set(await deps.repos.pedidosDeColega.livres(colegas.map((a) => a.id), agora));
  return colegas.filter((a) => livres.has(a.id));
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
 * origem, o `handoff`. revisto em 2026-10-18 (chat limpo, PR 3): os dois guardam o nome do outro bot no momento (`nome`,
 * `nomePara`), para a troca agrupada dizer o nome do bot de outro dono ou já excluído. Os dois são texto de modelo e continuam marcados não confiáveis (ADR-026: a marca é
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
  // definido em 2026-10-12 (ADR-099 item 8, I7 revista): espera circular. A trava por tenant serializa os pedidos
  // cruzados (A→B e B→A ao mesmo tempo): o segundo espera o primeiro gravar o handoff e então enxerga o ciclo.
  const agora = deps.agora();
  await deps.repos.pedidosDeColega.travar();
  const abertos = await deps.repos.pedidosDeColega.abertos(agora - JANELA_PEDIDOS_ABERTOS_MS);
  const ciclo = cicloDoPedido(abertos, remetente.id, alvo.id);
  if (ciclo) {
    const nomes = await Promise.all(ciclo.map(async (id) => (id === remetente.id ? remetente.nome : (await deps.repos.agentes.buscar(id))?.nome ?? "um colega")));
    return { data: { ok: false, erro: "espera_circular", instrucao: instrucaoEsperaCircular(nomes) } };
  }
  // definido em 2026-10-15 (NOD-259): o mesmo pedido repetido. Cada janela de uma rotina é um fio novo e pedia de novo ao
  // mesmo colega (19–22 pendentes do Leonardo ao Ze 1 em 24 h, 9 num turno só em 3 s). Ainda dentro da trava, que
  // serializa os pedidos simultâneos: o mesmo texto de um aberto, ou o teto do par, é recusado (`ja_pedido`); abaixo do
  // teto o pedido passa com o aviso dos que já esperam resposta.
  const repeticao = repeticaoDoPedido(abertos, remetente.id, alvo.id, pedido);
  if (repeticao.tipo === "recusa") {
    return { data: { ok: false, erro: "ja_pedido", instrucao: instrucaoJaPedido(alvo.nome, repeticao, horarioDoPedido(repeticao.desde, agora)) } };
  }
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "a pessoa";
  const pedidos = (await mensagensDaPessoa(deps, turnoRemetente)).map((m) => m.texto);
  // revisto em 2026-10-12 (ADR-099 itens 1, 1a e 8, I7 revista; era uma task de quem recebe, ADR-083 S7): o pedido entra na
  // fila do DONO de quem recebe — um turno curto de triagem na conversa própria dele (faixa da conversa, sem trabalho),
  // que o `reivindicar` põe depois das falas da pessoa. Ali o dono responde já, abre frentes (o lote fica ligado a este
  // turno e o resultado vai direto a quem pediu, I3), junta a uma frente que já mexe na mesma coisa ou espera.
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "delegacao",
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
  // A marca de quem pediu (ADR-062/066) vai no turno de triagem e, dele, nas frentes que ele abrir (frentes.ts).
  if (turnoRemetente.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turnoRemetente.id))) await deps.repos.turnos.contaminar(turno.id, agora);
  const autoria = autoriaAgente(remetente.id, pessoaId, pessoaId);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaAlvo.id,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: contexto ? `${pedido}\n\n${contexto}` : pedido,
    payload: { kind: "peer_pedido", conversaOrigemId: input.conversaId, turnoOrigemId: input.turnoId, nome: remetente.nome },
    confianca: "nao_confiavel",
  });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: `${remetente.nome} pediu a ${alvo.nome}: ${pedido}`,
    payload: { kind: "handoff", de: remetente.id, para: alvo.id, motivo: pedido, tarefaId: turno.id, nomePara: alvo.nome },
    confianca: "nao_confiavel",
  });
  const livres = await colegasLivres(deps, remetente, alvo.id, agora);
  const aviso = repeticao.tipo === "aviso" ? instrucaoPedidosAbertos(alvo.nome, repeticao.abertos, horarioDoPedido(repeticao.desde, agora)) : "";
  // NOD-302 (continuação da NOD-253): a cota da IA de quem recebe segura o fundo novo (a triagem do pedido é fundo novo,
  // tipoParaCota) — quem pediu sabe que o pedido espera e até quando.
  const cota = await situacaoDoBotPelaCota(deps, alvo);
  const espera = cota.situacao !== "livre" && cota.ia && cotaSegura("fundo_novo", cota.situacao) ? { ia: cota.ia, situacao: cota.situacao, voltaEm: cota.voltaEm, agora } : undefined;
  return {
    data: { ok: true, tarefa_id: turno.id, instrucao: [aviso, instrucaoPedidoRecebido(alvo.nome, livres.map((a) => a.nome), espera)].filter(Boolean).join(" "), livres: livres.map((a) => ({ id: a.id, nome: a.nome })) },
    events: [
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "delegacao", profundidade: turno.profundidade, remetenteAgenteId: remetente.id, mensagemId: mensagem?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
