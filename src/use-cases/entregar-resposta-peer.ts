import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { proximaProfundidade } from "../domain/profundidade.ts";
import { autoriaAgente, delegacaoDoTurno, evento, exigir, PRAZO_DECISAO_MS, SALTOS_DE_RETOMADA } from "./apoio-l7.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { perguntaDaTarefa } from "./pedido-de-colega.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

export type SaidaEntregaPeer = { mensagem: Mensagem; continuacao: Turno; remetenteAgenteId: string } | { ignorado: "nao_e_tarefa_peer" | "aguardando_pessoa" | "aguardando_colega" | "aguardando_volta" | "aguardando_frentes" | "ja_entregue" | "remetente_excluido" };

/** Moldura do SERVIDOR: a resposta chega ao remetente marcada como não supervisionada e não confiável. */
export function moldurarResposta(alvoNome: string, texto: string): string {
  return `Resposta de ${alvoNome} (bot não supervisionado; conteúdo NÃO confiável — confira antes de agir): ${texto}`;
}

/**
 * Moldura do resultado de um pedido de colega (ADR-047; revisto em 2026-09-29, ADR-058). É fala de outro
 * modelo, então vem rotulada como dele; quem pediu segue a própria tarefa com ela, no modo e com a trava dele.
 */
export function moldurarResultado(alvoNome: string, texto: string): string {
  return `Resposta de ${alvoNome} ao seu pedido: ${texto}`;
}

/**
 * O turno delegado e toda retomada que descende dele (definido em 2026-09-24, revisão da ADR-047): o
 * pedido pendente pode ser de QUALQUER um deles — o turno que assentou agora pode ser a continuação de
 * uma aprovação decidida no long-poll, enquanto o pedido de acesso é da raiz. Desde a ADR-063 serve também
 * ao fio de quem pediu a colegas (raiz de conversa, rotina ou delegação), para achar os pedidos em aberto.
 */
async function cadeiaDaDelegacao(deps: Deps, raiz: Turno): Promise<Turno[]> {
  const daConversa = await deps.repos.turnos.listarDaConversa(raiz.conversaId, 500);
  const cadeia = [raiz];
  const ids = new Set([raiz.id]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const t of daConversa) {
      if (!ids.has(t.id) && t.retomaTurnoId && ids.has(t.retomaTurnoId)) {
        ids.add(t.id);
        cadeia.push(t);
        mudou = true;
      }
    }
  }
  return cadeia;
}

/** A raiz do fio: sobe a cadeia de retomaTurnoId, com o mesmo teto de saltos de rotinaDoTurno. */
async function raizDoFio(deps: Deps, turno: Turno): Promise<Turno> {
  let atual = turno;
  for (let saltos = 0; atual.origem === "retomada" && atual.retomaTurnoId && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const acima = await deps.repos.turnos.buscar(atual.retomaTurnoId);
    if (!acima) break;
    atual = acima;
  }
  return atual;
}

/**
 * Pedidos que o fio fez a colegas e que ainda não voltaram (definido em 2026-09-30, ADR-063): handoff de um turno
 * da cadeia, com tarefaId, sem peer_ask da mesma tarefa na conversa — nem resultado nem aviso de falha. `exceto` é
 * a tarefa que está voltando agora: a peer_ask dela nasce depois da continuação.
 */
async function pedidosEmAberto(deps: Deps, cadeia: readonly Turno[], exceto: string | null = null): Promise<{ tarefaId: string; agenteId: string }[]> {
  const conversaId = cadeia[0]?.conversaId;
  if (!conversaId) return [];
  const ids = new Set(cadeia.map((t) => t.id));
  const mensagens = await deps.repos.mensagens.listarDaConversa(conversaId, 500);
  const voltaram = new Set(mensagens.flatMap((m) => (m.payload?.kind === "peer_ask" ? [m.payload.tarefaId] : [])));
  return mensagens.flatMap((m) =>
    m.payload?.kind === "handoff" && m.turnoId !== null && ids.has(m.turnoId) && m.payload.tarefaId && m.payload.tarefaId !== exceto && !voltaram.has(m.payload.tarefaId)
      ? [{ tarefaId: m.payload.tarefaId, agenteId: m.payload.para }]
      : [],
  );
}

/**
 * Por que a tarefa delegada ainda não entrega (ADR-047; ADR-063): falta a pessoa decidir algo na cadeia, ou quem
 * cumpre o pedido pediu a um colega e a resposta dele ainda não voltou. Sem a segunda, "pedi ao Dev, aguardo" saía
 * como resultado final e a resposta de verdade era descartada como ja_entregue (a entrega é uma por raiz).
 */
async function aindaNaoEntrega(deps: Deps, tarefa: Turno): Promise<"aguardando_pessoa" | "aguardando_colega" | "aguardando_volta" | "aguardando_frentes" | null> {
  if (tarefa.origem !== "delegacao") return null;
  const cadeia = await cadeiaDaDelegacao(deps, tarefa);
  if (await aguardandoPessoa(deps, cadeia)) return "aguardando_pessoa";
  if ((await pedidosEmAberto(deps, cadeia)).length > 0) return "aguardando_colega";
  // ADR-086 (revisão do #212): quem cumpre o pedido marcou uma volta ("vou esperar o CI"). Essa frase não é o resultado:
  // sem esta espera ela saía como entrega final e o resultado de verdade, na volta, era descartado como ja_entregue.
  if (cadeia.some((t) => t.estado === "pendente" && t.acordarEm != null)) return "aguardando_volta";
  // definido em 2026-10-12 (ADR-099, I7 revista): na triagem o dono abriu frentes para o pedido. A fala dele ("comecei")
  // não é o resultado: o resultado é o do lote, que a I3 entrega a quem pediu quando as frentes acabam (marcando o lote
  // devolvido antes, o que o tira desta conta).
  if ((await deps.repos.pedidosDeColega.frentesAbertasDosTurnos(cadeia.map((t) => t.id))) > 0) return "aguardando_frentes";
  return null;
}

function emLista(nomes: readonly string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O fecho da continuação de quem pediu (definido em 2026-09-30, ADR-063): o que ainda falta voltar, ou — quando quem
 * pediu cumpre ele mesmo um pedido de colega e tudo voltou — a quem vai a resposta final. Fio de conversa ou rotina
 * sem pendência não ganha frase: a tarefa original do contexto já diz o que fazer.
 */
async function fechoDaContinuacao(deps: Deps, pediu: Turno, tarefaId: string): Promise<string> {
  const faltam = await pedidosEmAberto(deps, await cadeiaDaDelegacao(deps, await raizDoFio(deps, pediu)), tarefaId);
  if (faltam.length > 0) {
    const nomes = [...new Set(await Promise.all(faltam.map(async (p) => (await deps.repos.agentes.buscar(p.agenteId))?.nome ?? "um colega")))];
    return `\nAinda faltam as respostas de ${emLista(nomes)}; elas chegam em novos turnos. Siga com o que já tem e não repita esses pedidos.`;
  }
  const delegacao = await delegacaoDoTurno(deps.repos, pediu);
  if (!delegacao) return "";
  const pedido = await deps.repos.mensagens.pedidoDaTarefa(delegacao.id);
  const quem = pedido ? (await deps.repos.agentes.buscar(pedido.autoria.autor_id))?.nome : undefined;
  return `\nTodas as respostas que você pediu chegaram: consolide a resposta final para ${quem ?? "quem te pediu"}.`;
}

/**
 * A tarefa delegada deixou algo para a pessoa decidir (acesso, aprovação, pergunta)? Então o turno que
 * terminou não é o fim: a decisão abre uma retomada, e é ELA que entrega. Sem isto o remetente recebia
 * "pedi acesso" como se fosse o resultado (o plano da ADR-047: "o remetente só recebe o resultado final").
 * Olha a CADEIA inteira, não só o turno que assentou (revisão da ADR-047).
 */
async function aguardandoPessoa(deps: Deps, cadeia: readonly Turno[]): Promise<boolean> {
  for (const t of cadeia) {
    const decisoes = await deps.repos.decisoes.doTurno(t.id);
    if (decisoes.some((d) => d.estado === "pendente" || d.estado === "reaberta")) return true;
  }
  const ids = new Set(cadeia.map((t) => t.id));
  // A proposta de acesso tem decisão de MESMO id (ADR-044); vencida a decisão, a proposta segue "pendente"
  // mas ninguém mais vai decidir. Proposta sem decisão é o card de conexão: espera a pessoa só até o
  // PRÓPRIO prazo (criação + PRAZO_DECISAO_PADRAO_MS, o mesmo de uma decisão); depois, o varredor avisa.
  for (const p of await deps.repos.propostas.pendentesDaConversa(cadeia[0]?.conversaId ?? "")) {
    if (p.payload.kind !== "acesso" || typeof p.payload.turnoId !== "string" || !ids.has(p.payload.turnoId)) continue;
    const d = await deps.repos.decisoes.buscar(p.id);
    if (d ? d.estado === "pendente" || d.estado === "reaberta" : deps.agora() < p.criadoEm + PRAZO_DECISAO_PADRAO_MS) return true;
  }
  return false;
}

type Entrega = { tarefa: Turno; texto: string; falha: boolean };

/**
 * Escreve a entrega na conversa do remetente e abre a continuação dele. Tarefa delegada entrega UMA vez
 * por raiz (revisão da ADR-047): a aprovação decidida durante o long-poll do proxy deixava o turno
 * original terminar E criava uma retomada, e as duas entregavam. O aviso de falha também sai uma vez, e
 * não sai se o resultado já saiu; um resultado depois de um aviso (a pessoa retomou) sai normalmente.
 */
async function entregar(deps: Deps, e: Entrega): Promise<{ data: SaidaEntregaPeer; events?: RuntimeEvent[] }> {
  const { tarefa } = e;
  // A pergunta é a mensagem de TEXTO de outro agente ligada à tarefa (perguntaDaTarefa: o mesmo critério que a I3 usa,
  // por pedidoDeColegaDoTurno, para saber a quem devolver o lote de um pedido de colega).
  const pergunta = await perguntaDaTarefa(deps, tarefa);
  if (!pergunta) return { data: { ignorado: "nao_e_tarefa_peer" } };
  const delegada = tarefa.origem === "delegacao";
  const remetenteId = pergunta.autoria.autor_id;
  const alvo = exigir(await deps.repos.agentes.buscar(tarefa.agenteId), "nao_encontrado", "bot alvo");
  // definido em 2026-10-09: quem pediu foi excluído enquanto o colega trabalhava (a Elis, com a fatia 5 do Ze 1 na VM). O
  // 404 desfazia o assentamento inteiro: a máquina tentava entregar de novo, desistia, e o turno do colega caía como
  // "seu Mac parou de responder", com a resposta perdida. Agora a resposta fica na conversa de quem a escreveu e a
  // entrega acaba aqui: não há a quem continuar.
  const remetente = await deps.repos.agentes.buscar(remetenteId);
  if (!remetente) return { data: { ignorado: "remetente_excluido" } };
  const origem = pergunta.payload?.kind === "peer_pedido" ? pergunta.payload : null;
  const conversaRemetente = exigir(origem ? await deps.repos.conversas.buscar(origem.conversaOrigemId) : await deps.repos.conversas.buscarPropriaDoAgente(remetente.id), "nao_encontrado", "conversa do remetente");
  if (delegada) {
    const entregues = (await deps.repos.mensagens.listarDaConversa(conversaRemetente.id, 500)).filter((m) => m.payload?.kind === "peer_ask" && m.payload.tarefaId === tarefa.id);
    const resultadoSaiu = entregues.some((m) => m.payload?.kind === "peer_ask" && !m.payload.falhou);
    if (resultadoSaiu || (e.falha && entregues.length > 0)) return { data: { ignorado: "ja_entregue" } };
  }
  const agora = deps.agora();
  const autoria = autoriaAgente(alvo.id, deps.escopo.pessoaId, delegada ? (tarefa.sobProcuracaoDe ?? null) : remetente.id);
  // definido em 2026-09-29 (ADR-058): a continuação é uma RETOMADA do turno que pediu — mesma confiança e, pela
  // cadeia de retomaTurnoId, mesmo modo e mesma trava (a rotina continua rotina, com o gate dela; a conversa,
  // conversa). Sem o turno que pediu (pedido legado de perguntar_a_bot, ou turno que sumiu), cai no turno 'peer'
  // não confiável de antes.
  // revisto em 2026-09-30 (ADR-063): a resposta que volta é um passe a mais que o turno que pediu (a profundidade
  // da tarefa), e não mais 1 fixo: abaixo do limite, quem recebeu a resposta ainda pede a outro colega. Quem pediu
  // cumprindo um pedido (delegação) mantém a procuração — o modo, a trava e o aviso de falha seguem a cadeia.
  const pediu = delegada && origem ? await deps.repos.turnos.buscar(origem.turnoOrigemId) : null;
  const fecho = pediu ? await fechoDaContinuacao(deps, pediu, tarefa.id) : "";
  const entradaTexto = !delegada
    ? `${moldurarResposta(alvo.nome, e.texto)}\nConsolide a resposta para a pessoa, citando a contribuição do colega e retomando a tarefa original indicada no contexto.`
    : e.falha
      ? `O pedido que você fez a ${alvo.nome} não foi concluído: ${e.texto}.\nSiga a tarefa original indicada no contexto sem inventar o resultado; se ela dependia disso, diga em uma frase o que ficou pendente.${fecho}`
      : `${moldurarResultado(alvo.nome, e.texto)}\nSiga a tarefa original indicada no contexto com essa resposta, citando o colega. Confira o que for afirmar à pessoa.${fecho}`;
  // definido em 2026-09-16 (L9): a continuação nasce ANTES da mensagem peer_ask para a mensagem apontar
  // (turno_id) para o turno que ela dispara — a web e o e2e acham a continuação pela própria mensagem.
  const continuacao = await deps.repos.turnos.enfileirar({
    conversaId: conversaRemetente.id,
    agenteId: remetente.id,
    origem: pediu ? "retomada" : "peer",
    retomaTurnoId: pediu?.id ?? null,
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: proximaProfundidade(pediu?.profundidade ?? 0),
    entradaTexto,
    entradaConfianca: pediu?.entradaConfianca ?? "nao_confiavel",
    sobProcuracaoDe: pediu?.sobProcuracaoDe ?? null,
    modelo: remetente.modelo,
    harness: remetente.harness,
    // ADR-083: a continuação de quem pediu segue no trabalho dele (null = a conversa dele).
    trabalhoId: pediu?.trabalhoId ?? null,
    // NOD-206: o do turno que pediu; sem ele (pedido legado), o da tarefa do colega, na mesma máquina.
    executor: pediu?.executor ?? tarefa.executor,
  });
  if (!continuacao) throw new ErroDeDominio("estado_invalido", { cause: "turno de continuação não criado" });
  // definido em 2026-09-30 (ADR-062, auditoria das aprovações): a resposta traz o que o colega leu. Se a tarefa dele
  // (ou a cadeia dela) leu a web ou nasceu de conteúdo de fora, a continuação herda a marca — senão o pedido a um
  // colega lavava a página lida e quem pediu seguia com "Sempre permitir" e o modo automático valendo.
  const cadeia = delegada ? await cadeiaDaDelegacao(deps, tarefa) : [tarefa];
  const trouxeDeFora = cadeia.some((t) => t.entradaConfianca !== "confiavel") || (await Promise.all(cadeia.map((t) => deps.repos.turnos.contaminado(t.id)))).some(Boolean);
  if (trouxeDeFora || (pediu && (await deps.repos.turnos.contaminado(pediu.id)))) await deps.repos.turnos.contaminar(continuacao.id, agora);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversaRemetente.id,
    turnoId: continuacao.id,
    autoria,
    kind: "peer_ask",
    texto: e.falha ? `${alvo.nome} não concluiu: ${e.texto}` : e.texto,
    payload: { kind: "peer_ask", agenteId: alvo.id, nome: alvo.nome, naoSupervisionado: true, tarefaId: tarefa.id, ...(origem ? { turnoOrigemId: origem.turnoOrigemId } : {}), ...(delegada ? { delegada: true as const } : {}), ...(e.falha ? { falhou: true as const } : {}), ...(tarefa.trabalhoId ? { trabalhoId: tarefa.trabalhoId } : {}) },
    confianca: "nao_confiavel",
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem peer_ask não criada" });
  // Revisão do épico (S3, 2026-10-08): o trabalho de quem pediu esperava esta resposta como `rodando` (aguardandoColega);
  // a continuação já está na fila e a peer_ask gravada, então ele relê o estado agora — nunca passa por `terminado`.
  const doTrabalho = await sincronizarTrabalho(deps, continuacao.trabalhoId ?? null);
  return {
    data: { mensagem, continuacao, remetenteAgenteId: remetente.id },
    events: [
      ...doTrabalho,
      evento(deps, "mensagem_criada", autoria, { mensagemId: mensagem.id, kind: "peer_ask", tarefaId: tarefa.id }, { conversaId: conversaRemetente.id, turnoId: continuacao.id }),
      evento(deps, "turno_criado", autoria, { turnoId: continuacao.id, agenteId: remetente.id, origem: continuacao.origem, profundidade: continuacao.profundidade }, { conversaId: conversaRemetente.id, turnoId: continuacao.id }),
    ],
  };
}

/**
 * Ao assentar o turno de quem cumpria um pedido de colega (origem 'delegacao', ou uma retomada dele; e o
 * 'peer' legado): a resposta vira mensagem kind 'peer_ask' {agenteId, nome, tarefaId} na conversa de quem
 * pediu, e ele ganha a CONTINUAÇÃO, um passe mais funda (ADR-063; até o limite ela ainda pede a colegas). Desde
 * a ADR-058 a continuação é a retomada do turno que pediu, no modo e com a trava dele. A autoria da entrega
 * fica "alvo · por pessoa". Turno sem pedido ligado é a própria continuação: nada a entregar.
 */
export const entregarRespostaPeer: CasoDeUso<{ tarefaId: string; texto: string }, SaidaEntregaPeer> = async (deps, input) => {
  const assentado = exigir(await deps.repos.turnos.buscar(input.tarefaId), "nao_encontrado", "tarefa");
  // definido em 2026-09-24 (ADR-047): tarefa delegada entrega também — ela mesma ou a retomada dela.
  const tarefa = assentado.origem === "peer" ? assentado : await delegacaoDoTurno(deps.repos, assentado);
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  const espera = await aindaNaoEntrega(deps, tarefa);
  if (espera) return { data: { ignorado: espera } };
  return entregar(deps, { tarefa, texto: input.texto, falha: false });
};

/**
 * A tarefa delegada não vai terminar (definido em 2026-09-24, revisão da ADR-047): o turno do alvo foi
 * interrompido ou terminou sem resposta, ou a pessoa recusou (ou deixou vencer) o acesso que ele pediu.
 * O remetente recebe um aviso curto, uma vez por raiz, para contar à pessoa — antes ele esperava calado.
 * `motivo` é texto do SERVIDOR (motivoEmPortugues ou frase fixa), nunca do modelo.
 * revisto em 2026-09-30 (ADR-063): com um pedido a colega ainda em aberto na cadeia, o aviso também espera — a
 * resposta do colega abre uma continuação que segue a tarefa e entrega; se ela também falhar, avisa então.
 */
export const avisarFalhaDelegacao: CasoDeUso<{ turnoId: string; motivo: string; semEsperar?: true }, SaidaEntregaPeer> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const tarefa = turno ? await delegacaoDoTurno(deps.repos, turno) : null;
  if (!tarefa) return { data: { ignorado: "nao_e_tarefa_peer" } };
  // definido em 2026-10-09 (#218): `semEsperar` — o varredor de pedidos parados já decidiu desistir (task parada, queda
  // sem volta; src/domain/pedido-parado.ts): avisa sem esperar pessoa, colega ou volta. Se a pessoa retomar depois e
  // sair um resultado, ele ainda chega a quem pediu (um resultado depois de um aviso sai normalmente, em `entregar`).
  const espera = input.semEsperar ? null : await aindaNaoEntrega(deps, tarefa);
  if (espera) return { data: { ignorado: espera } };
  return entregar(deps, { tarefa, texto: input.motivo, falha: true });
};
