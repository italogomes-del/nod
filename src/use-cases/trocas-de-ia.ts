import type { IaComConta } from "../contracts/contas-ia.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { ContaDaTroca, DecisaoDaPessoa, DecisaoDaTroca, PayloadTrocaDeIa, TrocaDeIa } from "../contracts/troca-de-ia.ts";
import { DECISOES_DA_PESSOA } from "../contracts/troca-de-ia.ts";
import { PRAZO_SEM_HORARIO_MS } from "../domain/contas-da-ia.ts";
import { naFila, voltaDaIa, type ContaDaPessoa } from "../domain/contas-da-pessoa.ts";
import { entradaDaTrocaDeIa } from "../domain/cota-da-ia.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { iasNoLimite, inteligenciaDoAgente, ordemEfetiva, proximaIaNoLimite } from "../domain/inteligencia.ts";
import { aplicarEmDaTroca, fraseDaTroca, nomeDoProvedor, recomendacaoDaTroca } from "../domain/troca-de-ia.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { escolherContaDoTurno, type ContasDaMaquina } from "./contas-do-turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * A troca de IA das tasks no limite (definido em 2026-10-16, ADR-108 R4/R5/R6). O aviso é um por bot
 * (`trocas_de_ia`, índice único parcial): a task que para na IA da sessão dela espera a volta da conta e ganha o aviso com
 * a recomendação (esperar / levar); a pessoa decide pela rota `POST /agentes/:id/troca-de-ia`, e o varredor de 30 s aplica
 * o "levar" vencido, fecha o aviso quando a conta volta e devolve o bot fixo que seguiu noutra IA (R6 b).
 */

const ehIaComConta = (ia: string): ia is IaComConta => (IAS_COM_CONTA as readonly string[]).includes(ia);

export type NovoAvisoDeTroca = {
  agenteId: string;
  /** A conversa do turno, se o bot não tiver a própria (a linha mora na conversa do bot). */
  conversaId: string;
  /** Só o turno da CONVERSA (o "Continuar na conta" refaz ele); o da task levaria a linha para a tela da task. */
  turnoId: string | null;
  iaDe: IdHarness;
  iaPara: IdHarness | null;
  voltaEm: number | null;
  fixo: boolean;
  conta?: ContaDaTroca | null;
  autoria: Autoria;
  agora: number;
};

/**
 * Cria ou atualiza o aviso de troca do bot (R4/R6) e a linha de sistema dele na conversa do bot: uma linha por aviso; a
 * task seguinte que para no limite atualiza a mesma (o número de tasks, a volta e a recomendação).
 */
export async function avisarTrocaDeIa(deps: Deps, p: NovoAvisoDeTroca): Promise<RuntimeEvent[]> {
  const agente = await deps.repos.agentes.buscar(p.agenteId);
  if (!agente) return [];
  const propria = await deps.repos.conversas.buscarPropriaDoAgente(p.agenteId);
  const conversaId = propria?.id ?? p.conversaId;
  // O bot fixo não tem recomendação para aplicar: ele volta sozinho, e os dois caminhos são escolha da pessoa (R6).
  const recomendacao = p.fixo ? "esperar" : recomendacaoDaTroca({ voltaEm: p.voltaEm, agora: p.agora });
  const { troca, nova } = await deps.repos.trocasDeIa.abrir({
    agenteId: p.agenteId,
    conversaId,
    iaDe: p.iaDe,
    iaPara: p.iaPara,
    recomendacao,
    voltaEm: p.voltaEm,
    aplicarEm: p.fixo || !p.iaPara ? null : aplicarEmDaTroca(recomendacao, p.agora),
    fixo: p.fixo,
    agora: p.agora,
  });
  const tasks = await deps.repos.turnos.contarTasksNaIa(p.agenteId, p.iaDe);
  const payload: PayloadTrocaDeIa = payloadDaTroca(troca, tasks, p.conta ?? null);
  const texto = fraseDaTroca({ nomeDe: nomeDoProvedor(troca.iaDe), nomePara: troca.iaPara ? nomeDoProvedor(troca.iaPara) : null, nomeDoBot: agente.nome, recomendacao: troca.recomendacao, tasks, fixo: troca.fixo, voltaEm: troca.voltaEm, quando: (t) => quandoDaFrase(t, p.agora) });
  const events: RuntimeEvent[] = [];
  if (troca.mensagemId && (await deps.repos.mensagens.atualizarSistema(troca.mensagemId, { texto, payload, turnoId: p.turnoId }))) {
    events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria: p.autoria, agora: p.agora, conversaId: troca.conversaId, dados: { agente_id: p.agenteId, acao: "troca_de_ia" } }));
  } else {
    const linha = await deps.repos.mensagens.criar({ conversaId: troca.conversaId, turnoId: p.turnoId, autoria: p.autoria, kind: "sistema", texto, payload, confianca: "confiavel" });
    if (linha) {
      await deps.repos.trocasDeIa.definirMensagem(troca.id, linha.id);
      events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: troca.conversaId, turnoId: p.turnoId, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
  }
  // Só códigos e ids (o "pronto quando" do R4 se mede por aqui).
  log("info", nova ? "troca_de_ia_aberta" : "troca_de_ia_atualizada", { troca_id: troca.id, agente_id: p.agenteId, de: troca.iaDe, para: troca.iaPara, recomendacao: troca.recomendacao, volta_em: troca.voltaEm, tasks, fixo: troca.fixo });
  return events;
}

function payloadDaTroca(t: TrocaDeIa, tasks: number, conta: ContaDaTroca | null): PayloadTrocaDeIa {
  return {
    kind: "troca_de_ia",
    trocaId: t.id,
    agenteId: t.agenteId,
    iaDe: t.iaDe,
    iaPara: t.iaPara,
    recomendacao: t.recomendacao,
    voltaEm: t.voltaEm,
    tasks,
    aplicarEm: t.aplicarEm,
    ...(t.fixo ? { fixo: true as const, conta } : {}),
    ...(t.decisao ? { decisao: t.decisao, decididoEm: t.decididoEm ?? undefined } : {}),
  };
}

/** A linha do aviso ganha o desfecho (a tela troca os botões pelo que aconteceu). */
async function marcarDesfechoNaLinha(deps: Deps, t: TrocaDeIa): Promise<void> {
  if (!t.mensagemId || !t.decisao) return;
  const m = await deps.repos.mensagens.buscar(t.mensagemId);
  if (m?.payload?.kind !== "troca_de_ia") return;
  await deps.repos.mensagens.atualizarSistema(t.mensagemId, { texto: m.texto, payload: { ...m.payload, decisao: t.decisao, ...(t.decididoEm !== null ? { decididoEm: t.decididoEm } : {}) } });
}

/**
 * A fala da conversa que parou no limite do bot fixo (o turno da linha do aviso) volta à fila, uma vez, com a
 * inteligência que o bot tem agora. Nada a refazer (aviso de task, turno já refeito, ou não parou): nada.
 */
async function refazerFalaDoAviso(deps: Deps, t: TrocaDeIa, agora: number): Promise<RuntimeEvent[]> {
  const linha = t.mensagemId ? await deps.repos.mensagens.buscar(t.mensagemId) : null;
  const turno = linha?.turnoId ? await deps.repos.turnos.buscar(linha.turnoId) : null;
  if (!turno || turno.origem !== "conversa" || turno.estado !== "interrompido" || turno.trabalhoId) return [];
  const depois = (await deps.repos.mensagens.listarDaConversa(turno.conversaId, 30)).filter((m) => m.criadoEm > (linha?.criadoEm ?? 0));
  if (depois.some((m) => m.autoria.autor_tipo === "agente")) return [];
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: agora + Math.max(60_000, turno.prazoEm - turno.criadoEm),
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: "auto",
    harness: "auto",
    reenvios: turno.reenvios + 1,
    executor: turno.executor,
    trabalhoId: null,
  });
  return novo ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, turno.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } })] : [];
}

/**
 * "Levar as tasks" (R4/R6 b): os turnos pendentes das tasks do bot na IA que parou passam à IA nova (fixa naquele turno;
 * o modelo e o raciocínio vêm da escolha do bot para ela) e as esperas da cota acordam agora, com a entrada que diz que a
 * task mudou de IA. Devolve quantos turnos mudaram.
 */
async function levar(deps: Deps, t: Pick<TrocaDeIa, "agenteId" | "iaDe" | "iaPara">): Promise<number> {
  if (!t.iaPara) return 0;
  const ids = await deps.repos.turnos.levarTasksDoBot({ agenteId: t.agenteId, iaDe: t.iaDe, harness: t.iaPara, modelo: "auto", entradaDaVolta: entradaDaTrocaDeIa(nomeDoProvedor(t.iaDe), nomeDoProvedor(t.iaPara)) });
  return ids.length;
}

export type SaidaDaDecisao = { decisao: DecisaoDaTroca; aplicada: boolean; tasks: number };

/**
 * `POST /agentes/:id/troca-de-ia {decisao}` (R4/R6): a pessoa escolhe. Quem chega primeiro vence (o fechar é condicional):
 * o segundo clique, outra aba ou o varredor que já aplicou recebem `aplicada: false` com a decisão que valeu.
 */
export const decidirTrocaDeIa: CasoDeUso<{ agenteId: string; decisao: unknown }, SaidaDaDecisao> = async (deps, input) => {
  const decisao = DECISOES_DA_PESSOA.find((d) => d === input.decisao);
  if (!decisao) throw new ErroDeDominio("entrada_invalida", { cause: "decisao" });
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  if (agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  const aberta = await deps.repos.trocasDeIa.abertaDoAgente(agente.id);
  if (!aberta) return { data: { decisao, aplicada: false, tasks: 0 } };
  if ((decisao === "levar" && (aberta.fixo || !aberta.iaPara)) || (decisao === "outra_ia" && (!aberta.fixo || !aberta.iaPara))) throw new ErroDeDominio("entrada_invalida", { cause: "decisao" });
  const antes = inteligenciaDoAgente(agente);
  const fechada = await deps.repos.trocasDeIa.fechar(aberta.id, decisao, agora, decisao === "outra_ia" ? antes : undefined);
  if (!fechada) {
    const valeu = await deps.repos.trocasDeIa.buscar(aberta.id);
    return { data: { decisao: valeu?.decisao ?? decisao, aplicada: false, tasks: 0 } };
  }
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  let tasks = 0;
  if (decisao === "outra_ia") {
    // R6 b: o bot vai ao Automático até a conta voltar (o varredor devolve `volta_ao_fixo`); a IA que parou está no
    // limite, então o Automático escolhe a outra. As tasks vão junto.
    await deps.repos.agentes.atualizarPerfil(agente.id, { inteligencia: { ...antes, modo: "auto", fixa: null } });
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }
  if (decisao === "levar" || decisao === "outra_ia") tasks = await levar(deps, fechada);
  // R6 b na conversa: a fala que parou no limite é refeita no Automático (a outra IA), como o "Seguir com" refaz na conta.
  if (decisao === "outra_ia") events.push(...(await refazerFalaDoAviso(deps, fechada, agora)));
  await marcarDesfechoNaLinha(deps, fechada);
  events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: fechada.conversaId, dados: { agente_id: agente.id, acao: "troca_de_ia", decisao, tasks } }));
  log("info", "troca_de_ia_decidida", { troca_id: fechada.id, agente_id: agente.id, decisao, tasks, quem: "pessoa" });
  return { data: { decisao, aplicada: true, tasks }, events };
};

/**
 * R5 (E8): a pessoa trocou a IA do bot pelo seletor com "Levar as tasks também": as tasks pendentes do bot (em qualquer
 * IA) passam à inteligência nova e as esperas da cota acordam. O aviso aberto do bot fecha como "levar" (já foi feito).
 */
export async function levarTasksParaAInteligencia(deps: Deps, p: { agenteId: string; harness: string; modelo: string; nomeDe: string; nomePara: string; agora: number }): Promise<number> {
  const ids = await deps.repos.turnos.levarTasksDoBot({ agenteId: p.agenteId, iaDe: null, harness: p.harness, modelo: p.modelo, entradaDaVolta: entradaDaTrocaDeIa(p.nomeDe, p.nomePara) });
  const aberta = await deps.repos.trocasDeIa.abertaDoAgente(p.agenteId);
  const fechada = aberta ? await deps.repos.trocasDeIa.fechar(aberta.id, "levar", p.agora) : null;
  if (fechada) await marcarDesfechoNaLinha(deps, fechada);
  log("info", "inteligencia_levou_tasks", { agente_id: p.agenteId, tasks: ids.length, harness: p.harness, troca_id: fechada?.id ?? null });
  return ids.length;
}

/** R6 a ("Continuar na conta …"): a conta escolhida acorda as tasks do bot que esperavam a IA dela e fecha o aviso. */
export async function seguirNaContaFechaATroca(deps: Deps, p: { agenteId: string; ia: IaComConta; agora: number }): Promise<{ acordadas: number; fechou: boolean }> {
  const acordadas = await deps.repos.turnos.acordarEsperasDaCota(p.agenteId, p.ia);
  const aberta = await deps.repos.trocasDeIa.abertaDoAgente(p.agenteId);
  const fechada = aberta && aberta.iaDe === p.ia ? await deps.repos.trocasDeIa.fechar(aberta.id, "conta", p.agora) : null;
  if (fechada) await marcarDesfechoNaLinha(deps, fechada);
  return { acordadas, fechou: fechada !== null };
}

/**
 * A IA voltou a servir? Com conta na lista (ADR-102): alguma da fila (ou, sem fila, qualquer uma) fora do limite. Sem
 * conta nenhuma dessa IA na lista (motor ou app antigo): o limite da IA (`preferencias.ias_no_limite`).
 */
export async function iaVoltou(deps: Pick<Deps, "repos">, ia: IdHarness, agora: number): Promise<boolean> {
  const { contas } = await deps.repos.contasIa.listar();
  if (ehIaComConta(ia) && contas.some((c) => c.ia === ia && c.removidaEm === null)) return voltaDaIa(contas, ia, agora) === null;
  const p = await deps.repos.preferencias.buscar();
  return !iasNoLimite(p.iasNoLimite, agora).includes(ia);
}

/** Quando a IA volta: a primeira conta da fila que sai do limite; sem lista, o limite da IA; sem nada, 1 h. */
export async function quandoAIaVolta(deps: Pick<Deps, "repos">, ia: IdHarness, agora: number, contas?: readonly ContaDaPessoa[]): Promise<number> {
  const lista = contas ?? (await deps.repos.contasIa.listar()).contas;
  const pelaLista = ehIaComConta(ia) ? voltaDaIa(lista, ia, agora) : null;
  if (pelaLista !== null && pelaLista > agora) return pelaLista;
  const renova = (await deps.repos.preferencias.buscar()).iasNoLimite?.[ia]?.renovaEm;
  return renova !== undefined && renova > agora ? renova : agora + PRAZO_SEM_HORARIO_MS;
}

/**
 * A outra IA que levaria as tasks do bot: a próxima da ordem dele, pronta em alguma máquina viva da pessoa e fora do
 * limite; com contas anunciadas na máquina, ela precisa ter uma conta em uso aqui. null = nenhuma (o aviso não oferece
 * "levar": as tasks só esperam).
 */
export async function outraIaParaAsTasks(deps: Pick<Deps, "repos">, p: { agenteId: string; iaDe: IdHarness; prontos: readonly string[]; daMaquina: ContasDaMaquina | null; agora: number }): Promise<IdHarness | null> {
  const [agente, preferencias] = await Promise.all([deps.repos.agentes.buscar(p.agenteId), deps.repos.preferencias.buscar()]);
  if (!agente) return null;
  const inteligencia = inteligenciaDoAgente(agente);
  const ordem = ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null });
  const r = p.daMaquina ? escolherContaDoTurno(p.daMaquina, inteligencia.ordem, p.agora) : null;
  const semConta = IAS_COM_CONTA.filter((ia) => r !== null && ia in r.porIa && r.porIa[ia] === null);
  const noLimite = [...new Set([...iasNoLimite(preferencias.iasNoLimite, p.agora), ...semConta, p.iaDe])];
  return proximaIaNoLimite({ ordem, prontos: p.prontos as IdHarness[], noLimite, atual: p.iaDe });
}

/** A conta fora da fila, livre, da IA do bot fixo, na máquina do turno (R6 a). */
export function contaForaDaFila(c: ContasDaMaquina | null, ia: IdHarness, agora: number): ContaDaTroca | null {
  if (!c) return null;
  const conta = c.contas
    .filter((x) => x.removidaEm === null && x.ia === ia && !naFila(x) && c.naMaquina.has(x.id) && (x.noLimiteAte === null || x.noLimiteAte <= agora))
    .sort((a, b) => a.posicao - b.posicao)[0];
  return conta ? { id: conta.id, apelido: conta.apelido, corporativa: conta.corporativa } : null;
}

/**
 * O bloco do varredor de expiração (30 s, por pessoa): a conta voltou → fecha o aviso ("voltou") e acorda as esperas da
 * cota; o "levar" recomendado venceu sem resposta → aplica ("expirou"); o bot fixo que seguiu noutra IA (R6 b) volta à
 * inteligência de antes quando a conta dele volta. Idempotente: cada passo é condicional (`decidido_em`/`restaurado_em`).
 */
export async function varrerTrocasDeIa(deps: Deps): Promise<{ events: RuntimeEvent[]; fechadas: number; aplicadas: number; restaurados: number }> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  let fechadas = 0;
  let aplicadas = 0;
  let restaurados = 0;
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: "regra:varredor-troca-de-ia" as const };
  for (const t of await deps.repos.trocasDeIa.paraVarrer()) {
    const voltou = await iaVoltou(deps, t.iaDe, agora);
    if (t.decididoEm === null) {
      const decisao: DecisaoDaTroca | null = voltou ? "voltou" : t.recomendacao === "levar" && t.aplicarEm !== null && t.aplicarEm <= agora && t.iaPara ? "expirou" : null;
      if (!decisao) continue;
      const fechada = await deps.repos.trocasDeIa.fechar(t.id, decisao, agora);
      if (!fechada) continue;
      fechadas++;
      const tasks = decisao === "expirou" ? await levar(deps, fechada) : await deps.repos.turnos.acordarEsperasDaCota(fechada.agenteId, fechada.iaDe);
      if (decisao === "expirou") aplicadas++;
      await marcarDesfechoNaLinha(deps, fechada);
      events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: fechada.conversaId, dados: { agente_id: fechada.agenteId, acao: "troca_de_ia", decisao, tasks } }));
      log("info", "troca_de_ia_decidida", { troca_id: fechada.id, agente_id: fechada.agenteId, decisao, tasks, quem: "varredor" });
    } else if (voltou && t.voltaAoFixo && t.restauradoEm === null) {
      if (!(await deps.repos.trocasDeIa.marcarRestaurada(t.id, agora))) continue;
      const agente = await deps.repos.agentes.buscar(t.agenteId);
      // Se a pessoa mexeu na inteligência do bot depois (saiu do Automático), a escolha dela vale: nada a devolver.
      if (!agente || inteligenciaDoAgente(agente).modo !== "auto") continue;
      await deps.repos.agentes.atualizarPerfil(t.agenteId, { inteligencia: t.voltaAoFixo });
      const conversa = await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId);
      if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
      restaurados++;
      events.push(evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: t.conversaId, dados: { agente_id: t.agenteId, acao: "inteligencia", modo: t.voltaAoFixo.modo, fixa: t.voltaAoFixo.fixa } }));
      log("info", "troca_de_ia_restaurou_fixo", { troca_id: t.id, agente_id: t.agenteId, ia: t.voltaAoFixo.fixa });
    }
  }
  return { events, fechadas, aplicadas, restaurados };
}

export type { DecisaoDaPessoa };
