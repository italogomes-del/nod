import type { RuntimeEvent } from "../contracts/evento.ts";
import type { LoteDeFrentes } from "../contracts/frente.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ehFrente } from "../domain/frente.ts";
import { decidirFecho, destinoDoLote, entradaDoRetorno, respostaAoColega, textoFrentesTerminadas, textoPedidoRespondido, type FrenteNoFecho } from "../domain/retorno-do-lote.ts";
import { trabalhoFinal } from "../domain/trabalho.ts";
import { delegacaoDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { cadeiaDaDelegacao, entregarRespostaPeer } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";

/**
 * O fecho do lote de frentes (definido em 2026-10-12, ADR-099, partes 3/4, issue I3). Antes, o turno da conversa nunca
 * acordava quando uma task terminava: o resultado só virava balão. Agora a frente que chega a um estado final (terminou,
 * falhou ou foi parada) fecha o lote dela quando é a vez — o dono acorda UMA vez com os resumos, ou, se o pedido era de
 * um colega, a resposta vai direto a quem pediu e o dono não acorda (decisões 6 e 7). A regra é pura
 * (src/domain/retorno-do-lote.ts); aqui só leitura, travas e gravação.
 *
 * Travas: quem chama (sincronizarTrabalho, marcarParado) já tem os turnos e o trabalho da frente; o lote vem por último
 * (turnos → trabalho → lote, a ordem de travarTrabalhoComTurnos). Nada aqui trava turno: a retomada do dono é um INSERT
 * (FK = FOR KEY SHARE, que não briga com o UPDATE do Parar), sem a trava de enfileirarRetomada. Duas frentes que
 * fecham juntas serializam na linha do lote: a segunda já vê a primeira como final, ou o lote devolvido.
 */
type DepsFecho = Pick<Deps, "repos" | "escopo" | "agora">;

export async function fecharLoteSePronto(deps: DepsFecho, frente: Trabalho): Promise<RuntimeEvent[]> {
  if (!ehFrente(frente) || !frente.loteId || !trabalhoFinal(frente.estado)) return [];
  const lote = await deps.repos.frentes.buscarLoteTravado(frente.loteId);
  if (!lote || lote.devolvidoEm !== null) return [];
  const abertoPor = await deps.repos.turnos.buscar(lote.abertoPorTurnoId);
  if (!abertoPor) return [];
  const raiz = abertoPor.origem === "peer" ? abertoPor : await delegacaoDoTurno(deps.repos, abertoPor);
  const destino = destinoDoLote(raiz);
  const frentes = await deps.repos.frentes.frentesDoLote(lote.id);
  // O Parar do chat (na mesma transação, ou já gravado) para o dono: o lote fecha sem acordá-lo. Falha na leitura = parado.
  const donoParado = destino === "dono" && (await deps.repos.paradas.ativa(deps.escopo.pessoaId, abertoPor.conversaId)) !== false;
  const fecho = decidirFecho({ destino, avisarACadaUma: lote.avisarACadaUma, devolvido: false, frentes, fechou: frente.id, donoParado });
  if (fecho.acao === "nada") return [];
  if (fecho.acao === "colega") return raiz ? responderAoColega(deps, { lote, abertoPor, raiz, frentes: fecho.frentes }) : [];
  if (fecho.acao === "so_linha") {
    await deps.repos.frentes.marcarDevolvido(lote.id, null, deps.agora());
    return linhaFrentesTerminadas(deps, { lote, conversaId: abertoPor.conversaId, turnoId: null, agenteId: abertoPor.agenteId, frentes: fecho.frentes });
  }
  return devolverAoDono(deps, { lote, abertoPor, total: frentes.length, frentes: fecho.frentes, fechaLote: fecho.fechaLote, cuidado: fecho.cuidado, faltam: fecho.faltam });
}

/**
 * A retomada do turno que abriu o lote, na conversa (ou no trabalho da rotina) dele, com os resumos. A marca de fora não
 * se lava (ADR-062, a regra de entregar-resposta-peer.ts): se uma frente leu conteúdo de fora, ou o turno que abriu já
 * estava marcado, o retorno nasce marcado. O turno seguinte da pessoa nasce limpo (a marca é por turno).
 */
async function devolverAoDono(deps: DepsFecho, p: { lote: LoteDeFrentes; abertoPor: Turno; frentes: FrenteNoFecho[]; fechaLote: boolean; cuidado: boolean; faltam: number; total: number }): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const { abertoPor } = p;
  const retorno = await deps.repos.turnos.enfileirar({
    conversaId: abertoPor.conversaId,
    agenteId: abertoPor.agenteId,
    origem: "retomada",
    retomaTurnoId: abertoPor.id,
    trabalhoId: p.lote.trabalhoId,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: abertoPor.profundidade,
    entradaTexto: entradaDoRetorno({ frentes: p.frentes, faltam: p.faltam, total: p.total }),
    entradaConfianca: abertoPor.entradaConfianca,
    sobProcuracaoDe: abertoPor.sobProcuracaoDe ?? null,
    modelo: abertoPor.modelo,
    harness: abertoPor.harness,
    executor: abertoPor.executor,
  });
  if (!retorno) return [];
  if (p.cuidado || (await deps.repos.turnos.contaminado(abertoPor.id))) await deps.repos.turnos.contaminar(retorno.id, agora);
  // O UNIQUE de retorno_turno_id e o `devolvido_em is null` garantem um retorno por lote (o lote já está travado aqui).
  if (p.fechaLote) await deps.repos.frentes.marcarDevolvido(p.lote.id, retorno.id, agora);
  const autoria = autoriaAgente({ agenteId: abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  return [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: abertoPor.conversaId, turnoId: retorno.id, dados: { origem: retorno.origem, agente_id: abertoPor.agenteId, lote_id: p.lote.id } }),
    ...(await linhaFrentesTerminadas(deps, { lote: p.lote, conversaId: abertoPor.conversaId, turnoId: retorno.id, agenteId: abertoPor.agenteId, frentes: p.frentes })),
  ];
}

/**
 * Lote de um pedido de colega (decisão 7): a resposta, montada dos resumos, vai a quem pediu pelo caminho de sempre
 * (entregarRespostaPeer, a continuação dele) e na conversa do dono fica só "Respondi ao pedido de X". O fio do pedido pode
 * ter aberto mais de um lote: a resposta sai uma vez, quando o último fecha, com as frentes de todos. Se a entrega ainda
 * não pode sair (falta a pessoa decidir algo no fio), o dono acorda com os resumos, e a fala dele entrega depois.
 */
async function responderAoColega(deps: DepsFecho, p: { lote: LoteDeFrentes; abertoPor: Turno; raiz: Turno; frentes: FrenteNoFecho[] }): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const cadeia = await cadeiaDaDelegacao(deps, p.raiz);
  const lotes = await deps.repos.frentes.lotesAbertosPor(cadeia.map((t) => t.id));
  if (lotes.some((l) => l.id !== p.lote.id && l.devolvidoEm === null)) {
    await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
    return [];
  }
  const frentes: FrenteNoFecho[] = [];
  for (const l of lotes) frentes.push(...(l.id === p.lote.id ? p.frentes : await deps.repos.frentes.frentesDoLote(l.id)));
  if (frentes.length === 0) frentes.push(...p.frentes);
  const r = await entregarRespostaPeer(deps, { tarefaId: p.abertoPor.id, texto: respostaAoColega(frentes), doLote: p.lote.id });
  if ("ignorado" in r.data) {
    if (r.data.ignorado === "ja_entregue" || r.data.ignorado === "remetente_excluido") {
      await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
      return [];
    }
    return devolverAoDono(deps, { lote: p.lote, abertoPor: p.abertoPor, frentes, fechaLote: true, cuidado: frentes.some((f) => f.deFora), faltam: 0, total: frentes.length });
  }
  await deps.repos.frentes.marcarDevolvido(p.lote.id, null, agora);
  const quem = await deps.repos.agentes.buscar(r.data.remetenteAgenteId);
  const nome = quem?.nome ?? "um colega";
  const autoria = autoriaAgente({ agenteId: p.abertoPor.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  const m = await deps.repos.mensagens.criar({
    conversaId: p.abertoPor.conversaId,
    turnoId: null,
    autoria,
    kind: "sistema",
    texto: textoPedidoRespondido(nome),
    payload: { kind: "pedido_respondido", loteId: p.lote.id, agenteId: r.data.remetenteAgenteId, nome },
    confianca: "nao_confiavel",
  });
  const linha = m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: p.abertoPor.conversaId, dados: { mensagem_id: m.id, kind: "sistema", lote_id: p.lote.id } })] : [];
  return [...(r.events ?? []), ...linha];
}

/** A linha "3 frentes terminaram" na conversa do dono (payload `frentes_terminadas`, só títulos e estados). */
async function linhaFrentesTerminadas(deps: DepsFecho, p: { lote: LoteDeFrentes; conversaId: string; turnoId: string | null; agenteId: string; frentes: readonly FrenteNoFecho[] }): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente({ agenteId: p.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:frentes" });
  const m = await deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: p.turnoId,
    autoria,
    kind: "sistema",
    texto: textoFrentesTerminadas(p.frentes),
    payload: { kind: "frentes_terminadas", loteId: p.lote.id, frentes: p.frentes.map((f) => ({ trabalhoId: f.id, titulo: f.titulo, estado: f.estado })) },
    confianca: "confiavel",
  });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: p.conversaId, turnoId: p.turnoId, dados: { mensagem_id: m.id, kind: "sistema", lote_id: p.lote.id } })] : [];
}
