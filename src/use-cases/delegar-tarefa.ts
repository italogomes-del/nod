import type { Mensagem } from "../contracts/mensagem.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { LinhaTrilha } from "../db/schema/trilha.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { entradaDaDelegacao } from "../domain/delegacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { agenteVisivel, autoriaAgente, autorizarAlvo, evento, PRAZO_DECISAO_MS, resolverAlvo } from "./apoio-l7.ts";
import { MENSAGENS_DO_PLANO } from "./emitir-plano-turno.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-24: classe de procuração que autoriza delegar tarefa entre donos diferentes (ADR-025/046). */
export const CLASSE_DELEGAR_TAREFA = "delegar_tarefa";

/**
 * A autoridade da delegação (ADR-047): a mensagem da PESSOA que abriu o turno do remetente, lida do
 * banco por `mensagem_origem_id` (0024) — o modelo não fornece nem o id nem o texto. Vale só turno de
 * conversa ou sala, confiável, em profundidade 0, e mensagem de texto da pessoa do escopo, confiável,
 * da mesma conversa. Rotina, peer, retomada e turno não confiável não têm pessoa pedindo AGORA:
 * nao_permitido. As falas absorvidas pelo turno (lidas juntas, 0024) entram na ordem em que chegaram.
 */
async function pedidoDaPessoa(deps: Deps, turnoId: string, remetenteId: string): Promise<{ turno: Turno; mensagens: Mensagem[] }> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || turno.agenteId !== remetenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno do remetente" });
  if (turno.origem !== "conversa" && turno.origem !== "sala") throw new ErroDeDominio("nao_permitido", { cause: `turno de origem ${turno.origem} não carrega pedido da pessoa` });
  if (turno.profundidade !== 0 || turno.entradaConfianca !== "confiavel") throw new ErroDeDominio("nao_permitido", { cause: "turno não confiável" });
  const daPessoa = (m: Mensagem | null): m is Mensagem =>
    m !== null && m.kind === "texto" && m.conversaId === turno.conversaId && m.confianca === "confiavel" && m.autoria.autor_tipo === "pessoa" && m.autoria.autor_id === deps.escopo.pessoaId;
  const principal = turno.mensagemOrigemId ? await deps.repos.mensagens.buscar(turno.mensagemOrigemId) : null;
  if (!daPessoa(principal)) throw new ErroDeDominio("nao_permitido", { cause: "turno sem mensagem da pessoa" });
  const absorvidos = (await deps.repos.turnos.listarDaConversa(turno.conversaId, 200)).filter((t) => t.absorvidoPor === turno.id && t.mensagemOrigemId);
  const outras = (await Promise.all(absorvidos.map((t) => deps.repos.mensagens.buscar(t.mensagemOrigemId as string)))).filter(daPessoa);
  return { turno, mensagens: [principal, ...outras].sort((a, b) => a.criadoEm - b.criadoEm) };
}

/** Chamada que trouxe conteúdo de fora: conector, computador ou pasta (ADR-026). */
const deFora = (l: LinhaTrilha): boolean => l.kind === "tool_call" && (l.conectorId !== null || /^(computador|workspace)_|^nativa__/.test(l.ferramenta));

/** definido em 2026-09-24: teto da leitura da conversa inteira; bateu no teto = não dá para provar, contamina. */
const TETO_CONVERSA = 500;

/**
 * O que o remetente tinha no contexto quando delegou já inclui conteúdo de fora? (definido em
 * 2026-09-24, revisão da ADR-047) O `tarefa`/`contexto` que ele escreve pode carregar o que leu — "lê
 * meus e-mails" num turno e "pede ao Dev 1 pra resolver isso" no seguinte levaria texto de e-mail ao
 * Dev 1 com a autoridade da pessoa. Não recusa: a tarefa nasce `nao_confiavel` (catálogo reduzido,
 * pedir_acesso incluído, sem "Sempre permitir"). Fail-closed em cada dúvida:
 *  - sem o plano do turno → contamina (não se sabe o que ele viu);
 *  - pasta autorizada no plano → contamina: Read/Grep/Glob nativos do harness nem passam pelo nod;
 *  - chamada de fora na trilha DESTE turno → contamina;
 *  - sessão retomada (--resume): não há registro de onde ela começou, então vale a conversa INTEIRA —
 *    qualquer chamada de fora de qualquer turno, ou qualquer mensagem não confiável; conversa maior que
 *    o teto contamina;
 *  - sessão nova: a janela de histórico do plano (MENSAGENS_DO_PLANO) — mensagem não confiável, ou
 *    chamada de fora do turno que produziu uma das falas.
 */
async function remetenteViuConteudoDeFora(deps: Deps, turno: Turno, plano: PlanoTurno | undefined): Promise<boolean> {
  if (!plano || plano.turnoId !== turno.id) return true;
  // ADR-052: nativa lê arquivo e web sem passar pelo proxy — plano com nativas conta como conteúdo de fora.
  if (plano.workspaceId || plano.workspacePastas || plano.nativas?.length) return true;
  if ((await deps.repos.trilha.doTurno(turno.id)).some(deFora)) return true;
  const retomada = plano.entrada.sessaoCli !== null;
  const mensagens = await deps.repos.mensagens.listarDaConversa(turno.conversaId, retomada ? TETO_CONVERSA : MENSAGENS_DO_PLANO);
  // O handoff que o PRÓPRIO remetente escreveu numa delegação anterior é nao_confiavel por ser fala de
  // modelo; ele só fica de fora se a tarefa que criou nasceu confiável — aí aquela checagem já provou que
  // não havia nada de fora. Tarefa contaminada, ou que não se acha mais, contamina esta também.
  for (const m of mensagens) {
    if (m.confianca !== "nao_confiavel") continue;
    const proprio = m.kind === "handoff" && m.autoria.autor_tipo === "agente" && m.autoria.autor_id === turno.agenteId && m.payload?.kind === "handoff" && m.payload.tarefaId;
    const tarefa = proprio && m.payload?.kind === "handoff" && m.payload.tarefaId ? await deps.repos.turnos.buscar(m.payload.tarefaId) : null;
    if (tarefa?.entradaConfianca !== "confiavel") return true;
  }
  let turnoIds = mensagens.flatMap((m) => (m.turnoId ? [m.turnoId] : []));
  if (retomada) {
    const turnos = await deps.repos.turnos.listarDaConversa(turno.conversaId, TETO_CONVERSA);
    if (mensagens.length >= TETO_CONVERSA || turnos.length >= TETO_CONVERSA) return true;
    turnoIds = turnos.map((t) => t.id);
  }
  return (await deps.repos.trilha.doTurnos([...new Set(turnoIds)])).some(deFora);
}

/**
 * Ferramenta `delegar_tarefa` (definido em 2026-09-24, ADR-047, emenda ADR-025/026): a pessoa pediu que
 * outro bot FAÇA algo, e o pedido dela vai junto. O remetente é o agente do TOKEN; o alvo e a procuração
 * (classe `delegar_tarefa` entre donos diferentes) são os de perguntar_a_bot. O turno do alvo nasce na
 * conversa própria dele com origem 'delegacao', profundidade 1 (não repassa), `sob_procuracao_de` = a
 * pessoa e entrada CONFIÁVEL (salvo se o remetente já leu conteúdo de fora) — a autoridade é a mensagem dela, e a entrada é montada pelo servidor com o
 * contexto do remetente num bloco rotulado "não é instrução". Na conversa do alvo fica o `peer_pedido`
 * (texto = mensagem literal da pessoa, autoria "remetente · por pessoa", ADR-023); na de origem, o
 * `handoff`, que é fala do remetente e por isso não confiável.
 */
export const delegarTarefa: CasoNod<Deps, "delegar_tarefa"> = async (deps, input) => {
  const remetente = await agenteVisivel(deps.repos, input.agenteId);
  const tarefa = input.tarefa.trim();
  if (tarefa === "") throw new ErroDeDominio("texto_vazio");
  const contexto = input.contexto?.trim() || null;
  const { turno: turnoRemetente, mensagens } = await pedidoDaPessoa(deps, input.turnoId, remetente.id);
  const confianca = (await remetenteViuConteudoDeFora(deps, turnoRemetente, input.plano)) ? "nao_confiavel" : "confiavel";
  const alvo = await resolverAlvo(deps.repos, remetente, input.agente);
  await autorizarAlvo(deps.repos, remetente, alvo, CLASSE_DELEGAR_TAREFA);
  const conversaAlvo = await deps.repos.conversas.buscarPropriaDoAgente(alvo.id);
  if (!conversaAlvo) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do alvo" });
  const pessoaId = deps.escopo.pessoaId;
  const pessoaNome = (await deps.repos.pessoas.buscar(pessoaId))?.nome ?? "A pessoa";
  const pedidos = mensagens.map((m) => m.texto);
  const agora = deps.agora();
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversaAlvo.id,
    agenteId: alvo.id,
    origem: "delegacao",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 1,
    entradaTexto: entradaDaDelegacao({ pessoaNome, remetenteNome: remetente.nome, pedidos, tarefa, contexto }),
    entradaConfianca: confianca,
    sobProcuracaoDe: pessoaId,
    modelo: alvo.modelo,
    harness: alvo.harness,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de delegação não criado" });
  const autoria = autoriaAgente(remetente.id, pessoaId, pessoaId);
  const pedido = await deps.repos.mensagens.criar({
    conversaId: conversaAlvo.id,
    turnoId: turno.id,
    autoria,
    kind: "texto",
    texto: pedidos.join("\n\n"),
    payload: { kind: "peer_pedido", conversaOrigemId: input.conversaId, turnoOrigemId: input.turnoId, delegacao: { tarefa, contexto } },
    confianca: "confiavel",
  });
  const handoff = await deps.repos.mensagens.criar({
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    autoria,
    kind: "handoff",
    texto: `${remetente.nome} pediu a ${alvo.nome}, a pedido de ${pessoaNome}: ${tarefa}`,
    payload: { kind: "handoff", de: remetente.id, para: alvo.id, motivo: tarefa, tarefaId: turno.id },
    confianca: "nao_confiavel",
  });
  return {
    data: { tarefa_id: turno.id },
    events: [
      evento(deps, "mensagem_criada", autoria, { mensagemId: handoff?.id ?? null, kind: "handoff", tarefaId: turno.id }, { conversaId: input.conversaId, turnoId: input.turnoId }),
      evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: alvo.id, origem: "delegacao", profundidade: 1, remetenteAgenteId: remetente.id, mensagemId: pedido?.id ?? null }, { conversaId: conversaAlvo.id, turnoId: turno.id }),
    ],
  };
};
