import { createHash } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { AutorLote, ColunaQuadro, ComentarioTarefa, EntradaHistoricoDto, LinhaDeSistema, LoteQuadro, MudancaTarefa, OpQuadro, PrNaTela, Quadro, QuadroDaPessoaDto, QuadroDto, ResumoQuadroParaBot, TarefaDto, TarefaPorCodigoDto, TarefaQuadro } from "../contracts/quadro.ts";
import { ehNod } from "../domain/nod.ts";
import { branchSugerido, codigoDaTarefa, formatarCodigo, lerCodigo, prefixoDoNome } from "../domain/codigo-tarefa.ts";
import { mudancasDaTarefa, statusNoDestino } from "../domain/historico-tarefa.ts";
import { type AgenteDoQuadro, chaveDeBusca, entradaDaResposta, entradaDaTarefa, etapaDaTarefa, execucaoDoTurno, metaCumprida, planejarLote, progresso, recusaDoLimite, resolverTarefa, tarefasDaMeta, resumoDaMeta, resumoDoLote, terminadaDepois, terminou } from "../domain/quadro.ts";
import { acionaNaColuna, colunaDeEspera, colunasDe, colunasDto, COLUNAS_PADRAO, papelDe, responsavelDe } from "../domain/colunas.ts";
import { TAREFA_PASSOU_A_VOCE } from "../domain/comentarios-quadro.ts";
import { resumoDoPr } from "../domain/prs-da-tarefa.ts";
import type { FotoLote } from "../repositories/quadros.repo.ts";
import type { EstadoExecucao, ExecucoesDaTarefa, TrabalhoParaBot } from "../contracts/quadro-execucoes.ts";
import { autoriaAgente, autoriaPessoa, ehUuid, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import type { Profundidade } from "../contracts/turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { avisarRiscoDoQuadro } from "./risco-quadro.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/**
 * O quadro-agente (definido em 2026-10-31, NOD-442). Um só caminho para a pessoa (as rotas) e para qualquer bot (a
 * ferramenta gerir_quadro): cada chamada é um lote, tudo ou nada, com a foto do antes para o Desfazer. As tarefas com
 * responsável que entram em A fazer começam sozinhas: o turno nasce na conversa própria do bot (origem delegacao, sob
 * procuração da pessoa, como um pedido de colega).
 */

/** NOD-418: `estado_invalido` = o Repetir com o trabalho rodando (cancele antes). NOD-416: `conflito` = a tarefa mudou de quadro no meio do mover. */
export type FalhaQuadro = "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "estado_invalido" | "conflito";

export type PedidoLote = {
  autor: AutorLote;
  /** O quadro: id, ou nome/id do bot anfitrião. */
  quadro?: string;
  /** O bot da tela (a rota é /agentes/:id/quadro): o anfitrião quando não veio `quadro`. */
  anfitriaoId?: string;
  ops: readonly OpQuadro[];
  /** Onde rodam os turnos que o lote começa (o do turno de quem chamou; a rota, o do servidor). */
  executor: Executor;
  /** O turno de quem chamou (a ferramenta), para a trilha. */
  turnoId?: string | null;
  conversaId?: string | null;
  /**
   * A profundidade do turno de quem chamou (a pessoa, pela tela: 0). O turno que o lote começa soma 1; no limite
   * (PROFUNDIDADE_MAXIMA, ADR-063) nada começa sozinho — senão dois bots se passavam a tarefa sem fim (revisão do PR #612).
   */
  profundidade?: Profundidade;
  /**
   * O turno de quem fez o lote era confiável e limpo (ADR-062). A pessoa pela tela: true (o padrão). O bot: o turno dele
   * confiável e não contaminado. Falso contamina o turno que o lote começa, como o pedir_a_bot (revisão do PR #612).
   */
  origemConfiavel?: boolean;
  /** O bot fala num turno da pessoa (conversa/ligação): começa até a tarefa que já é dele. */
  autorNaConversa?: boolean;
  /**
   * NOD-430: "total" = a pessoa pela tela (o padrão dela), ou o bot a pedido dela na conversa, num turno limpo (o lote grava
   * pedido_por = a pessoa, via = o bot). "normal" = o bot sozinho (tarefa, rotina, colega, turno contaminado); é o padrão do bot (limiteDe).
   */
  limite?: "total" | "normal";
  /**
   * NOD-430: o id do card 'quadro_exclusao' confirmado (pela pessoa ou pelo modo): o remover_quadro do bot passa, e os
   * outros cards abertos do mesmo quadro fecham (este o caso de uso fecha como confirmado). Só o caso de uso põe.
   */
  exclusaoConfirmada?: string;
};

/** `entregue`: o recado entra no próximo passo (agora), quando o trabalho da fila começar, ou virou um trabalho novo. */
export type TrabalhoFeito = { numero: number | null; estado: EstadoExecucao | null; entregue?: "agora" | "quando_comecar" | "novo"; cancelados?: number };

/**
 * O limite do lote (NOD-430). Sem `limite`, a pessoa (a tela) tem o total e o bot o normal: o total do bot só vem de quem
 * conferiu a conversa e o turno limpo e o diz de propósito (gerir_quadro). Revisão 1 do PR #627: antes, todo pedido
 * sem limite valia total, e um caminho novo de bot esquecido abriria o controle da tela.
 */
export const limiteDe = (p: Pick<PedidoLote, "autor" | "limite">): "total" | "normal" => p.limite ?? (p.autor.tipo === "agente" ? "normal" : "total");

/** NOD-430: o bot age a pedido da pessoa, na conversa e num turno limpo: o histórico mostra "Você, pela <bot>". */
export const pedidoDaPessoa =(p: PedidoLote): boolean => p.autor.tipo === "agente" && limiteDe(p) !== "normal" && p.autorNaConversa === true && p.origemConfiavel !== false;

export type Comecou = { tarefaId: string; agenteId: string; agenteNome: string; turnoId: string };

export type ResultadoLote =
  | { ok: true; quadro: QuadroDto | null; lote: LoteQuadro | null; comecaram: Comecou[]; desfeito: boolean; /** NOD-416: a tarefa que mudou de quadro (o código novo e o antigo, que continua abrindo). */ movida?: { tarefaId: string; codigo: string; codigoAntigo: string }; /** No limite da corrente: o que ia começar e ficou em A fazer. */ seguradas?: number; /** Um passo de coluna foi para a posição válida mais próxima (NOD-448). */ ajustada?: boolean; /** NOD-415: o quadro foi removido (o bot voltou a agente comum). */ removido?: boolean; /** Revisão 3 do PR #623: o id da tarefa de cada criar_tarefa, na ordem dos passos (null se o mesmo lote a excluiu). */ criadas?: (string | null)[]; /** NOD-417: o comentário gravado (op comentar) e quantos gatilhos se juntaram a um turno da fila (comentário ou lote). */ comentario?: ComentarioTarefa; juntados?: number; /** NOD-418: Repetir, Cancelar ou recado: o trabalho que ficou e a vista da tarefa aberta. */ trabalho?: TrabalhoFeito; trabalhos?: ExecucoesDaTarefa; /** Revisão 4 do PR #622: o comentário numa tarefa fora do andamento não acionou o responsável. */ responsavelForaDoAndamento?: { agenteNome: string; coluna: string } }
  | { ok: false; erro: FalhaQuadro; detalhe: string; /** Revisão 7 do PR #623: a chave da recusa do mover que a tela distingue (a rota não mapeia texto). */ motivo?: RecusaDoMover };

const falha = (erro: FalhaQuadro, detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });
/** Revisão 7 do PR #623: a recusa do mover leva a CHAVE tipada; o texto da lista segue como detalhe (bot e log). */
const recusaDoMover = (erro: FalhaQuadro, motivo: RecusaDoMover): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe: RECUSAS_DO_MOVER[motivo], motivo } });

export async function experimentoLigado(deps: Deps): Promise<boolean> {
  return (await deps.repos.preferencias.buscar()).experimentos?.quadro === true;
}

export async function agentesDaPessoa(deps: Deps): Promise<Agente[]> {
  return (await deps.repos.agentes.listar()).filter((a) => a.ownerId === deps.escopo.pessoaId);
}

export const paraAgenteDoQuadro = (a: Agente): AgenteDoQuadro => ({ id: a.id, nome: a.nome, nod: ehNod(a) });

/**
 * NOD-416 (ADR-144): o prefixo do quadro. O quadro novo nasce com ele; o que o servidor de antes criou (sem prefixo)
 * ganha no próximo lote. A escolha é serializada por pessoa (dois quadros novos ao mesmo tempo não pegam o mesmo).
 */
async function escolherPrefixo(deps: Deps, anfitriao: string, agentes: readonly Agente[]): Promise<string> {
  await deps.repos.quadros.travarPrefixos();
  const nome = agentes.find((a) => a.id === anfitriao)?.nome ?? (await deps.repos.agentes.buscar(anfitriao, true))?.nome ?? "";
  return prefixoDoNome(nome, await deps.repos.quadros.prefixosUsados());
}

async function comPrefixo(deps: Deps, q: Quadro, agentes: readonly Agente[]): Promise<Quadro> {
  if (q.prefixo !== null) return q;
  await deps.repos.quadros.definirPrefixo(q.id, await escolherPrefixo(deps, q.agenteId, agentes));
  return (await deps.repos.quadros.buscar(q.id)) ?? q;
}

/**
 * As tarefas sem número (o servidor de antes as criou) ganham o seu, e o código fica guardado para o link. A consulta já
 * vem filtrada (revisão 5 do PR #623): o lote comum não relê o quadro inteiro só para achar nenhuma.
 */
async function numerarFaltantes(deps: Deps, q: Quadro): Promise<void> {
  if (q.prefixo === null) return;
  const sem = await deps.repos.quadros.tarefasSemNumero(q.id);
  if (sem.length === 0) return;
  const primeiro = await deps.repos.quadros.reservarNumeros(q.id, sem.length);
  for (const [i, t] of sem.entries()) await deps.repos.quadros.numerarTarefa(t.id, primeiro + i);
  await deps.repos.quadros.guardarCodigos(sem.map((t, i) => ({ prefixo: q.prefixo!, numero: primeiro + i, tarefaId: t.id })));
}

/**
 * Revisão 5 do PR #623: o código de outro prefixo que é de uma tarefa DESTE quadro (ela veio de outro quadro, e o bot
 * ainda a chama pelo código de lá). Vira um mapa código → id para o `resolverTarefa`, pelo histórico de códigos.
 */
export async function codigosAntigosDaqui(deps: Deps, ops: readonly OpQuadro[], q: Quadro, tarefas: readonly TarefaQuadro[]): Promise<Map<string, string>> {
  const daqui = new Set(tarefas.map((t) => t.id));
  const m = new Map<string, string>();
  for (const op of ops) {
    if (!("tarefa" in op) || typeof op.tarefa !== "string") continue;
    const c = lerCodigo(op.tarefa);
    if (!c || c.prefixo === q.prefixo) continue;
    const chave = formatarCodigo(c.prefixo, c.numero);
    if (m.has(chave)) continue;
    const id = await deps.repos.quadros.tarefaDoCodigo(c.prefixo, c.numero);
    if (id && daqui.has(id)) m.set(chave, id);
  }
  return m;
}

/**
 * O código antigo de uma tarefa que mudou de quadro: a dica para o bot que ainda a procura no quadro velho. Revisão 7 do
 * PR #623: o id (uuid) também ganha a dica. O id não muda no mover, então o bot que guardou o id da tarefa e a procura no
 * quadro de antes ouve onde ela está agora, como quem passou o código antigo.
 */
async function dicaDoCodigo(deps: Deps, ops: readonly OpQuadro[], q: Quadro): Promise<string | null> {
  const repo = deps.repos.quadros;
  for (const op of ops) {
    if (!("tarefa" in op) || typeof op.tarefa !== "string") continue;
    const ref = op.tarefa.trim();
    const c = lerCodigo(ref);
    const id = ehUuid(ref) ? ref.toLowerCase() : c ? await repo.tarefaDoCodigo(c.prefixo, c.numero) : null;
    const t = id ? await repo.tarefa(id) : null;
    if (!t || t.quadroId === q.id) continue;
    const onde = await repo.buscar(t.quadroId);
    if (!onde) continue;
    const anfitriao = (await deps.repos.agentes.buscar(onde.agenteId, true))?.nome ?? "outro bot";
    const agora = codigoDaTarefa(onde.prefixo, t);
    if (!c) return `a tarefa ${t.id} está no quadro de ${anfitriao}, como ${agora} (passe quadro "${anfitriao}")`;
    return `${formatarCodigo(c.prefixo, c.numero)} mudou de quadro: agora é ${agora}, no quadro de ${anfitriao} (passe quadro "${anfitriao}")`;
  }
  return null;
}

/** O bot anfitrião que a ferramenta nomeou ao criar o quadro: id ou nome exato (um só); o Nod também pode ter quadro. */
function anfitriaoPeloNome(ref: string, agentes: readonly Agente[]): string | null {
  const r = ref.trim().replace(/^@/, "");
  if (ehUuid(r)) return agentes.some((a) => a.id === r) ? r : null;
  const achados = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  return achados.length === 1 ? achados[0]!.id : null;
}

/** Acha o quadro: id do quadro, ou o bot anfitrião (id ou nome); sem referência, o do bot da tela ou do autor, senão o único. */
export async function acharQuadro(deps: Deps, p: PedidoLote, agentes: readonly Agente[]): Promise<Quadro | null | { ambiguo: Quadro[] } | { semNome: string; nomes: string[] }> {
  const repo = deps.repos.quadros;
  if (p.quadro !== undefined && p.quadro.trim() !== "") {
    const ref = p.quadro.trim().replace(/^@/, "");
    if (ehUuid(ref)) return (await repo.buscar(ref)) ?? (await repo.doAgente(ref));
    const donos = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(ref));
    if (donos.length === 1) return repo.doAgente(donos[0]!.id);
    // NOD-430: o nome que não bate devolve os quadros da pessoa (o bot pergunta em qual); o repetido, as candidatas.
    const todos = await repo.listar();
    if (donos.length > 1) {
      const deles = todos.filter((q) => donos.some((a) => a.id === q.agenteId));
      return deles.length === 1 ? deles[0]! : deles.length === 0 ? null : { ambiguo: deles };
    }
    return { semNome: ref, nomes: todos.map((q) => agentes.find((a) => a.id === q.agenteId)?.nome).filter((n): n is string => !!n) };
  }
  if (p.anfitriaoId) return repo.doAgente(p.anfitriaoId);
  if (p.autor.tipo === "agente") {
    // O bot no turno de uma tarefa mexe, por padrão, no quadro dessa tarefa, não no dele (revisão rodada 4).
    const daTarefa = p.turnoId ? await repo.doTurno(p.turnoId) : null;
    if (daTarefa) return daTarefa;
    const proprio = await repo.doAgente(p.autor.agenteId);
    if (proprio) return proprio;
  }
  const todos = await repo.listar();
  if (todos.length === 1) return todos[0]!;
  return todos.length === 0 ? null : { ambiguo: todos };
}

/** A falha de um quadro que não se achou de primeira (vários, ou nome que não bate), já com o que o bot pergunta. */
export function falhaDoAchado(achado: { ambiguo: Quadro[] } | { semNome: string; nomes: string[] }, agentes: readonly Agente[]): { erro: FalhaQuadro; detalhe: string } {
  if ("semNome" in achado) {
    const lista = achado.nomes.length ? `Os quadros da pessoa: ${achado.nomes.join(", ")}. Pergunte em qual deles` : "A pessoa ainda não tem quadro";
    return { erro: "nao_encontrado", detalhe: `não há um quadro "${achado.semNome}". ${lista}` };
  }
  const nomes = achado.ambiguo.map((x) => `${agentes.find((a) => a.id === x.agenteId)?.nome ?? "?"} (${x.id})`).slice(0, 5).join(", ");
  return { erro: "sem_quadro", detalhe: `a pessoa tem ${achado.ambiguo.length} quadros: diga qual em quadro (o nome do bot anfitrião ou o id): ${nomes}. Se ela não disse, pergunte` };
}

/** O quadro como a tela e o bot leem (tarefas, execução de cada uma, nomes, o último lote). */
export async function montarQuadro(deps: Pick<Deps, "repos">, q: Quadro): Promise<QuadroDto> {
  const repo = deps.repos.quadros;
  const tarefas = await repo.tarefas(q.id);
  const estados = await repo.estadosDosTurnos(tarefas.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const colunas = colunasDe(q);
  const ids = new Set([q.agenteId, ...tarefas.map((t) => t.agenteId).filter((id): id is string => id !== null), ...colunas.map((c) => c.responsavel).filter((id): id is string => Boolean(id))]);
  const nomes = new Map<string, string>();
  for (const id of ids) {
    const a = await deps.repos.agentes.buscar(id, true);
    if (a) nomes.set(id, a.nome);
  }
  const ultimoSemBarreira = await repo.ultimoLote(q.id);
  // O lote que um mover_quadro invalidou não aparece para desfazer (revisão 2 do PR #623).
  const ultimo = ultimoSemBarreira && !(await repo.mudouDeQuadroDepois(ultimoSemBarreira.id, q.id)) ? ultimoSemBarreira : null;
  // NOD-421: os PRs ligados e as linhas de sistema (uma consulta cada, agrupadas por tarefa).
  // O branch fica de fora do DTO: nome de fora que a tela não mostra (o casamento é no servidor).
  const prs = new Map<string, PrNaTela[]>();
  for (const { tarefaId, branch: _branch, mergePendente: _pendente, ...p } of await repo.prsDoQuadro(q.id)) prs.set(tarefaId, [...(prs.get(tarefaId) ?? []), p]);
  const avisoGithub = await repo.avisoGithub(q.id);
  const linhas = new Map<string, LinhaDeSistema[]>();
  for (const { tarefaId, ...l } of await repo.linhasDoQuadro(q.id)) linhas.set(tarefaId, [...(linhas.get(tarefaId) ?? []), l]);
  const dtos: TarefaDto[] = tarefas.map((t) => ({
    ...t,
    codigo: codigoDaTarefa(q.prefixo, t),
    branch: branchSugerido(codigoDaTarefa(q.prefixo, t), t.titulo),
    // Só o que ainda está em jogo mostra a execução (um turno concluído de uma tarefa feita não acende nada).
    // A coluna com passagem (ADR-142) é uma etapa em andamento onde ela aciona (revisão 3: o Backlog com passagem não).
    execucao: ["fazendo", "afazer"].includes(papelDe(colunas, t.status)) || (responsavelDe(colunas, t.status) && acionaNaColuna(colunas, t.status)) ? execucaoDoTurno(t.turnoId ? estados.get(t.turnoId) : null) : null,
    agenteNome: t.agenteId ? nomes.get(t.agenteId) ?? null : null,
    prs: prs.get(t.id) ?? [],
    linhas: linhas.get(t.id) ?? [],
  }));
  // NOD-415 (ADR-141): o que terminou antes de a meta ser posta não entra no "N de M".
  const { feitas, total } = progresso(tarefasDaMeta(tarefas, q.metaDesde, colunas), colunas);
  return {
    ...q,
    agenteNome: nomes.get(q.agenteId) ?? "",
    colunas: colunasDto(colunas).map((c) => (c.responsavel ? { ...c, responsavelNome: nomes.get(c.responsavel) ?? null } : c)),
    tarefas: dtos,
    ultimoLote: ultimo ? { id: ultimo.id, quadroId: ultimo.quadroId, autor: ultimo.autor, resumo: ultimo.resumo, tarefaIds: ultimo.tarefaIds, desfeitoEm: ultimo.desfeitoEm, criadoEm: ultimo.criadoEm } : null,
    feitas,
    total,
    avisoGithub,
  };
}

/** `trabalhos`: o trabalho atual de cada tarefa (trabalhosParaBot); a tarefa que nunca teve trabalho fica sem o campo. */
export function resumoParaBot(q: QuadroDto, trabalhos: ReadonlyMap<string, TrabalhoParaBot> = new Map()): ResumoQuadroParaBot {
  return {
    id: q.id,
    anfitriao: q.agenteNome,
    meta: q.meta,
    prazo: q.prazo,
    cumprida: q.cumpridoEm !== null,
    resumo: q.resumo,
    colunas: q.colunas.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo, ...(c.responsavelNome ? { passa_para: c.responsavelNome } : {}), ...(c.instrucoes ? { instrucoes: c.instrucoes } : {}) })),
    tarefas: q.tarefas.map((t) => ({ id: t.id, codigo: t.codigo, titulo: t.titulo, status: t.status, agente: t.agenteNome, linear: t.linearId, pr: t.prUrl, pergunta: t.status === "voce" ? t.pergunta : null, execucao: t.execucao, ...(trabalhos.has(t.id) ? { trabalho: trabalhos.get(t.id)! } : {}), ...(t.prs?.length ? { prs: t.prs.map(resumoDoPr) } : {}) })),
    ...(q.avisoGithub ? { avisoGithub: q.avisoGithub } : {}),
  };
}

export function eventoQuadro(deps: Deps, p: Pick<PedidoLote, "autor" | "conversaId" | "turnoId">, q: { id: string; agenteId: string }, loteId: string | null, tarefas: readonly string[], removido = false): RuntimeEvent {
  const autoria = p.autor.tipo === "agente" ? autoriaAgente(p.autor.agenteId, deps.escopo.pessoaId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId);
  return evento(deps, "quadro_mudou", autoria, { quadroId: q.id, agenteId: q.agenteId, loteId, tarefas: tarefas.join(","), autor: p.autor.tipo, ...(removido ? { removido: true } : {}) }, { conversaId: p.conversaId ?? null, turnoId: p.turnoId ?? null });
}

/**
 * O turno na fila serve para juntar mais um gatilho (NOD-417, revisão do PR #622)? Não quando ele já atende o pedido de
 * OUTRO bot (o `peer_pedido` dele): a entrega do resultado é pelo turno, e iria ao bot errado. `de` é quem pede agora
 * (o bot remetente ou o autor do lote; a pessoa = null). O pedir_a_bot com a tarefa e o lote usam a mesma regra.
 */
export async function podeJuntarNoTurno(deps: Deps, turnoId: string, de: string | null): Promise<boolean> {
  const quem = (await deps.repos.mensagens.pedidoDaTarefa(turnoId))?.autoria.autor_id;
  return quem === undefined || quem === de;
}

/** A tarefa que o turno executa (o dele ou uma retomada dele), entre as do autor: o `terminei` sem tarefa vale para ela. */
async function tarefaDoTurnoDe(deps: Deps, tarefas: readonly TarefaQuadro[], agenteId: string, turnoId: string): Promise<string | null> {
  for (const t of tarefas) {
    if (t.agenteId !== agenteId || !t.turnoId) continue;
    if (t.turnoId === turnoId || (await deps.repos.quadros.cadeiaDoTurno(t.turnoId)).some((x) => x.id === turnoId)) return t.id;
  }
  return null;
}

/** Abre o turno do bot responsável (o começo da tarefa ou a volta depois da resposta). null = o bot não tem conversa. */
export async function abrirTurno(deps: Deps, p: PedidoLote, agente: Agente, entradaTexto: string, deFora: boolean): Promise<{ turnoId: string; events: RuntimeEvent[] } | null> {
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) return null;
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem: "delegacao",
    prazoEm: deps.agora() + PRAZO_DECISAO_MS,
    // A corrente de quem moveu a tarefa, mais um (a pessoa pela tela começa em 0).
    profundidade: proximaProfundidade(p.profundidade ?? 0),
    entradaTexto,
    // Confiável como o pedir_a_bot (ADR-062); contaminado logo abaixo quando o pedido traz dado de fora.
    entradaConfianca: "confiavel",
    sobProcuracaoDe: deps.escopo.pessoaId,
    modelo: agente.modelo,
    harness: agente.harness,
    executor: p.executor,
  });
  if (!turno) return null;
  // Dado de fora: a tarefa foi escrita por um turno não confiável (deFora, pegajoso) ou o turno de quem fez o lote não era
  // confiável. O Linear é conteúdo interno (ADR-062 §1, conteudoInterno). Suposição registrada no PR: tarefa criada pela
  // pessoa ou por um bot num turno limpo é pedido confiável.
  if (deFora || p.origemConfiavel === false) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  const autoria = p.autor.tipo === "agente" ? autoriaAgente(p.autor.agenteId, deps.escopo.pessoaId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId);
  return {
    turnoId: turno.id,
    events: [evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: agente.id, origem: "delegacao", profundidade: turno.profundidade }, { conversaId: conversa.id, turnoId: turno.id })],
  };
}

/**
 * O turno de uma tarefa que deixou de valer (Desfazer, outro responsável, excluída, cancelada): o que está na fila sai;
 * o que já roda recebe o Parar (revisão do PR #612). Nunca o turno de quem chamou (ele está aplicando este lote).
 */
export async function pararTurno(deps: Deps, p: PedidoLote, turnoId: string): Promise<void> {
  // A cadeia inteira (revisão rodada 6): a tarefa guarda o turno que a começou, e quem roda agora pode ser uma retomada
  // dele (depois de um cartão, da espera de CI, da resposta de um colega). Se quem chamou está nela, nada para.
  const cadeia = await deps.repos.quadros.cadeiaDoTurno(turnoId);
  if (cadeia.some((t) => t.id === p.turnoId)) return;
  for (const t of cadeia) {
    if (t.estado !== "pendente" && t.estado !== "despachando") continue;
    if (!(await deps.repos.turnos.cancelarPendente(t.id))) await deps.repos.turnos.pedirInterrupcao([t.id], deps.agora());
  }
}

/** O aviso na conversa própria do responsável. NOD-418: o Bloqueado manda o texto dele e a chave de dedup do trabalho. */
export async function avisarComVoce(deps: Deps, t: TarefaQuadro, quemPergunta: string, outro?: { texto: string; chave: string }): Promise<RuntimeEvent | null> {
  if (!t.agenteId) return null;
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId);
  if (!conversa) return null;
  // A autoria é de quem escreveu a pergunta (o bot do lote); a pessoa pela tela, o responsável.
  const autoria = autoriaAgente(quemPergunta, deps.escopo.pessoaId);
  const h = createHash("sha256").update(outro ? `quadro-aviso:${outro.chave}` : `quadro-voce:${t.id}:${t.mudadoEm}`).digest("hex");
  const m = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    turnoId: null,
    autoria,
    kind: "texto",
    texto: outro?.texto ?? `Preciso de você no quadro, em "${t.titulo}": ${t.pergunta ?? ""}`.trim(),
    payload: { kind: "aviso_pessoa" },
    confianca: "nao_confiavel",
    idEnvio: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
  });
  return m ? evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null }) : null;
}

/** O quadro é todo do bot: ele fez o lote da criação e nenhum comentário das tarefas é de outro (a pessoa ou outro bot). */
async function soDoBot(deps: Deps, q: Quadro, autorDoLote: AutorLote, agenteId: string): Promise<boolean> {
  if (autorDoLote.tipo !== "agente" || autorDoLote.agenteId !== agenteId) return false;
  // Revisão 4 do PR #627: uma consulta pelo quadro (antes, uma por tarefa).
  return !(await deps.repos.quadroComentarios.temDeOutroNoQuadro(q.id, agenteId));
}

/** Desfaz o último lote do quadro: volta à foto do antes e cancela os turnos que ele abriu e ainda não começaram. */
async function desfazer(deps: Deps, p: PedidoLote, q: Quadro, loteId: string | undefined): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const ultimo = await repo.ultimoLote(q.id);
  if (!ultimo) return falha("nao_encontrado", "não há o que desfazer neste quadro");
  if (loteId && loteId !== ultimo.id) return falha("entrada_invalida", "só o último lote do quadro se desfaz");
  // Um bot desfaz só num turno limpo; o lote da pessoa ou de outro bot, só a pedido dela na conversa (revisão rodada 4).
  if (p.autor.tipo === "agente") {
    if (p.origemConfiavel === false) return falha("entrada_invalida", "desfazer só num turno limpo, em que nada de fora entrou");
    const meu = ultimo.autor.tipo === "agente" && ultimo.autor.agenteId === p.autor.agenteId;
    if (!meu && p.autorNaConversa !== true) return falha("entrada_invalida", "o último lote não é seu: o da pessoa ou de outro bot só se desfaz a pedido dela, na conversa com você");
    // Revisão 3 do PR #627: no limite normal o bot só desfaz o que ele poderia ter feito nele, o lote dele sem a pessoa
    // (pedido_por nulo). O lote feito a pedido dela (o controle da tela) ou o de outro só se desfaz na conversa limpa.
    if (limiteDe(p) === "normal" && (!meu || ultimo.pedidoPor != null)) return falha("entrada_invalida", recusaDoLimite("desfazer um lote feito a pedido da pessoa ou por outro"));
  }
  // Revisão 2 do PR #623 (a barreira): um mover_quadro que entrou ou saiu deste quadro depois do lote o invalida. A foto
  // não conhece a tarefa que chegou: o Desfazer do lote que criou o quadro a apagava, e o de colunas a deixava fora delas.
  if (await repo.mudouDeQuadroDepois(ultimo.id, q.id)) return falha("entrada_invalida", "uma tarefa mudou de quadro (entrou ou saiu deste) depois do último lote: ele não se desfaz mais. Para voltar a tarefa, use mover_quadro; o resto, desfaça mudando à mão");
  const foto: FotoLote = ultimo.antes;
  const atuais = new Map((await repo.tarefas(q.id)).map((t) => [t.id, t]));
  for (const { id, antes } of foto.tarefas) {
    const atual = atuais.get(id);
    if (atual?.turnoId && atual.turnoId !== (antes?.turnoId ?? null)) await pararTurno(deps, p, atual.turnoId);
  }
  if (foto.quadro === null) {
    // Revisão 2 do PR #627: desfazer a criação apaga o quadro, sem Desfazer. O bot só faz isso no quadro que ele criou e
    // que só tem conteúdo dele; o da pessoa, de outro bot ou com comentário de outro vai pelo card (remover_quadro).
    if (p.autor.tipo === "agente" && !(await soDoBot(deps, q, ultimo.autor, p.autor.agenteId))) {
      return falha("entrada_invalida", "desfazer a criação apagaria um quadro com conteúdo da pessoa ou de outro bot: para excluí-lo, peça com remover_quadro (vira o card que a pessoa confirma)");
    }
    // Os códigos ficam e reservam o prefixo (revisão 5 do PR #623): o quadro que nascer depois não reusa o link velho.
    await repo.apagarHistorico([...atuais.keys()]);
    await repo.apagar(q.id);
    return { data: { ok: true, quadro: null, lote: null, comecaram: [], desfeito: true }, events: [eventoQuadro(deps, p, q, ultimo.id, []), ...(await fecharExclusoesPendentes(deps, q.id))] };
  }
  const estadosAntes = await repo.estadosDosTurnos(foto.tarefas.map((t) => t.antes?.turnoId).filter((id): id is string => !!id));
  // As colunas da foto (ou as de agora, na foto de antes da NOD-448): a tarefa restaurada cai numa coluna que existe.
  const colunasDaFoto = colunasDe(foto.quadro.colunas !== undefined ? { colunas: foto.quadro.colunas } : q);
  const historico: MudancaTarefa[] = [];
  const criadasNoLote = foto.tarefas.filter((t) => t.antes === null).map((t) => t.id);
  for (const { id, antes } of foto.tarefas) {
    if (antes === null) { await repo.apagarTarefa(id); continue; }
    // A foto no andamento com um turno que já parou (o Desfazer interrompeu, ou acabou): volta à espera, sem turno, para
    // não ficar em "falhou" sem ninguém (revisão rodada 3). Recomeça a pedido (mudar_tarefa status afazer).
    const vivo = antes.turnoId !== null && ["pendente", "despachando"].includes(estadosAntes.get(antes.turnoId) ?? "");
    // Só a tarefa cujo turno ESTE lote trocou (passou de mão, parou): a que ele só mudou de coluna (remover, substituir)
    // volta exatamente para onde estava, com o turno que tinha (revisão do PR #615, rodada 2).
    const mexeuNoTurno = (atuais.get(id)?.turnoId ?? null) !== (antes.turnoId ?? null);
    // E a que tinha um turno que não terminou bem (o lote o parou ao mandá-la para Cancelado/Backlog, ou ele caiu): sem
    // isso ela voltaria ao andamento como "Falhou", sem ninguém (revisão 4). Só o turno concluído volta como estava.
    // Só quando o lote a tirou do andamento: a que já estava parada lá e o lote só editou volta igual (revisão 5).
    const atual = atuais.get(id);
    const saiuDoAndamento = !!atual && papelDe(colunasDe(q), atual.status) !== "fazendo";
    const turnoMorto = antes.turnoId !== null && estadosAntes.get(antes.turnoId) !== "concluido" && saiuDoAndamento;
    const andava = papelDe(colunasDaFoto, antes.status) === "fazendo" && (mexeuNoTurno || turnoMorto);
    // A foto de antes da 0136 não tem `terminadaEm`: terminada = o grupo da coluna dela, desde o `mudadoEm` (revisão do merge).
    const daFoto = (antes.terminadaEm as number | null | undefined) !== undefined ? antes : { ...antes, terminadaEm: terminou(colunasDaFoto, antes.status) ? antes.mudadoEm : null };
    const restaurada = await repo.restaurarTarefa(andava && !vivo ? { ...daFoto, status: colunaDeEspera(colunasDaFoto), turnoId: null, terminadaEm: null } : daFoto);
    // NOD-416: o Desfazer também é uma mudança, de quem desfez.
    const de = atuais.get(id);
    if (de) historico.push(...mudancasDaTarefa({ tarefaId: id, antes: de, pedido: restaurada, final: restaurada, autor: p.autor }));
    // A que o lote excluiu volta: "restaurada", na coluna de agora, por quem desfez (revisão 5 do PR #623).
    else historico.push({ tarefaId: id, campo: "restaurada", de: null, para: restaurada.status, autor: p.autor });
  }
  // A tarefa que o lote criou e o Desfazer apagou não deixa o código nem o histórico para trás.
  await repo.apagarCodigosEHistorico(criadasNoLote);
  await repo.registrarHistorico(q.id, historico, null);
  await repo.salvar(q.id, foto.quadro);
  await repo.marcarDesfeito(ultimo.id);
  const atualizado = await repo.buscar(q.id);
  return {
    data: { ok: true, quadro: atualizado ? await montarQuadro(deps, atualizado) : null, lote: null, comecaram: [], desfeito: true },
    events: [eventoQuadro(deps, p, q, ultimo.id, foto.tarefas.map((t) => t.id))],
  };
}

/**
 * Aplica um lote (a ferramenta manda vários passos; cada rota, um). Planeja tudo em memória primeiro (o erro volta sem
 * gravar nada), trava o quadro (um lote por vez: duas abas, dois bots), grava, começa as tarefas e fecha a meta.
 */
export async function aplicarLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  if (p.ops.length === 0) return falha("entrada_invalida", "acoes vazio");
  const repo = deps.repos.quadros;
  const agentes = await agentesDaPessoa(deps);
  const criando = p.ops[0]!.tipo === "criar_quadro";

  let q: Quadro | null;
  if (criando) {
    // O anfitrião: o bot da tela; senão o que a ferramenta nomeou em `quadro` (id ou nome); senão o próprio bot.
    const anfitriao = p.anfitriaoId ?? (p.quadro?.trim() ? anfitriaoPeloNome(p.quadro, agentes) : p.autor.tipo === "agente" ? p.autor.agenteId : null);
    if (!anfitriao || !agentes.some((a) => a.id === anfitriao)) return falha("nao_encontrado", "bot anfitrião do quadro");
    q = await repo.doAgente(anfitriao);
    if (!q) {
      const sozinha = p.ops.find((o) => o.tipo === "desfazer" || o.tipo === "remover_quadro" || o.tipo === "mover_quadro");
      if (sozinha) return falha("entrada_invalida", `${sozinha.tipo} vai sozinho na chamada`);
      return criarComLote(deps, p, anfitriao, agentes);
    }
  } else if (p.ops[0]!.tipo === "mover_quadro") {
    if (p.ops.length > 1) return falha("entrada_invalida", "mover_quadro vai sozinho na chamada");
    return moverDeQuadro(deps, p, p.ops[0]!, agentes);
  } else {
    const achado = await acharQuadro(deps, p, agentes);
    if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
    q = achado;
  }
  if (!q) return falha("sem_quadro", "não há quadro: crie com criar_quadro (meta e prazo são opcionais)");
  const travado = (await travarQuadros(deps, [q])).get(q.id) ?? null;
  if (!travado) return falha("sem_quadro", "o quadro sumiu");
  // Com a trava na mão, de novo (codex rodada 4): o lote que trocou a tarefa de mão pode ter parado este turno enquanto
  // ele esperava a trava. O turno parado não escreve por cima do novo responsável.
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  const so = p.ops[0]!;
  if (so.tipo === "desfazer") {
    if (p.ops.length > 1) return falha("entrada_invalida", "desfazer vai sozinho na chamada");
    return desfazer(deps, p, travado, so.lote);
  }
  if (so.tipo === "remover_quadro") {
    if (p.ops.length > 1) return falha("entrada_invalida", "remover_quadro vai sozinho na chamada");
    return removerQuadro(deps, p, travado);
  }
  return aplicarNoQuadro(deps, p, travado, agentes, false);
}

/**
 * A tarefa de um mover: id; o identificador do Linear no quadro achado (ganha do código, revisão do PR #623); o código
 * (de qualquer quadro da pessoa; o antigo também vale); senão o título no quadro achado.
 */
async function tarefaDoMover(deps: Deps, p: PedidoLote, ref: string, agentes: readonly Agente[]): Promise<TarefaQuadro | { erro: FalhaQuadro; detalhe: string }> {
  const repo = deps.repos.quadros;
  const r = ref.trim();
  if (ehUuid(r)) return (await repo.tarefa(r.toLowerCase())) ?? { erro: "nao_encontrado", detalhe: `tarefa "${r}" não encontrada` };
  const achado = await acharQuadro(deps, p, agentes);
  const quadro = achado && !("ambiguo" in achado) && !("semNome" in achado) ? achado : null;
  const daqui = quadro ? await repo.tarefas(quadro.id) : null;
  const doLinear = daqui?.filter((t) => t.linearId !== null && chaveDeBusca(t.linearId) === chaveDeBusca(r)) ?? [];
  if (doLinear.length === 1) return doLinear[0]!;
  const c = lerCodigo(r);
  if (c) {
    const id = await repo.tarefaDoCodigo(c.prefixo, c.numero);
    const t = id ? await repo.tarefa(id) : null;
    if (t) return t;
  }
  if (achado && "ambiguo" in achado) return { erro: "sem_quadro", detalhe: `diga a tarefa pelo código (ex.: ZE-12) ou pelo id: a pessoa tem ${achado.ambiguo.length} quadros` };
  if (achado && "semNome" in achado) return falhaDoAchado(achado, agentes);
  if (!quadro || !daqui) return { erro: "nao_encontrado", detalhe: `tarefa "${r}" não encontrada` };
  const t = resolverTarefa(daqui, r, { prefixo: quadro.prefixo });
  return "erro" in t ? { erro: "nao_encontrado", detalhe: t.erro } : t;
}

/**
 * O quadro de destino: id do quadro, nome (ou id) do bot anfitrião, ou o prefixo (ZE). O quadro de um bot excluído não é
 * destino (revisão do PR #623): a tarefa sumiria da vista da pessoa.
 */
async function quadroDoMover(deps: Deps, ref: string, agentes: readonly Agente[]): Promise<Quadro | null> {
  const repo = deps.repos.quadros;
  const r = ref.trim().replace(/^@/, "");
  const prefixo = r.toUpperCase();
  const vivo = async (q: Quadro | null): Promise<Quadro | null> => (q && (await deps.repos.agentes.buscar(q.agenteId)) ? q : null);
  if (ehUuid(r)) return vivo((await repo.buscar(r)) ?? (await repo.doAgente(r)));
  const donos = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  if (donos.length === 1) {
    const q = await vivo(await repo.doAgente(donos[0]!.id));
    if (q) return q;
  }
  const porPrefixo = (await repo.listar()).filter((q) => q.prefixo !== null && q.prefixo === prefixo);
  return porPrefixo.length === 1 ? vivo(porPrefixo[0]!) : null;
}

/**
 * Trava quadros para um lote, sempre na mesma ordem (revisão do PR #623): primeiro o advisory dos prefixos da pessoa, se
 * algum deles ainda não tem prefixo (o `comPrefixo` vai escolher um), e depois o FOR UPDATE de cada quadro em ordem de id.
 * O `criarComLote` também pega o advisory antes do FOR UPDATE; com a ordem invertida aqui, um lote que esperava o
 * advisory segurando o quadro e uma criação que esperava o quadro segurando o advisory se travavam. O advisory é por
 * sessão e reentrante: o `escolherPrefixo` que vem depois o pega de novo sem esperar.
 */
async function travarQuadros(deps: Deps, quadros: readonly Quadro[]): Promise<Map<string, Quadro>> {
  // O prefixo nunca volta a nulo: lido sem trava e não nulo, continua não nulo sob a trava.
  if (quadros.some((q) => q.prefixo === null)) await deps.repos.quadros.travarPrefixos();
  const travados = new Map<string, Quadro>();
  for (const id of [...new Set(quadros.map((q) => q.id))].sort()) {
    const t = await deps.repos.quadros.buscarTravado(id);
    if (t) travados.set(id, t);
  }
  return travados;
}

/**
 * Revisão 2 do PR #623: os porquês do mover que a tela distingue. A rota manda só a CHAVE, como `motivo` (lista branca,
 * como a NOD-346); o texto segue sendo o detalhe para o bot e o log (ADR-002: a causa nunca atravessa a resposta).
 * Revisão 7: a chave viaja tipada na falha (`recusaDoMover`), não é deduzida do texto.
 */
export const RECUSAS_DO_MOVER = {
  ja_neste_quadro: "a tarefa já está neste quadro",
  fora_do_quadro: "a tarefa não está no quadro deste bot",
  tarefa_sumiu: "a tarefa sumiu",
  quadro_sumiu: "a tarefa ou o quadro sumiu",
  mudou_de_quadro: "a tarefa mudou de quadro enquanto este pedido esperava: leia o quadro de novo e repita, se ainda quiser",
} as const;
export type RecusaDoMover = keyof typeof RECUSAS_DO_MOVER;

/**
 * NOD-416 (ADR-144): a tarefa muda de quadro. Ganha o código do destino (o que ela já teve lá, se voltou; senão o próximo
 * número) e o antigo continua abrindo. Cai na mesma coluna, se o destino a tem, ou na padrão do mesmo grupo. Não aciona
 * ninguém nem para o turno que ela já tem: só muda de lugar. Não vira lote (o Desfazer é mover de volta). Os dois quadros
 * são travados em ordem de id (dois movers cruzados não se travam).
 */
async function moverDeQuadro(deps: Deps, p: PedidoLote, op: OpQuadro, agentes: readonly Agente[]): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (op.tipo !== "mover_quadro") return falha("entrada_invalida", "mover_quadro");
  const repo = deps.repos.quadros;
  // Revisão do PR #623: o mover é "muda" sem card e sem Desfazer (emenda da ADR-135). Por isso o bot só move num turno
  // limpo, como o Desfazer e as colunas, e não no fim da corrente de bots (ADR-063), como o começo de tarefa.
  if (p.autor.tipo === "agente") {
    if (p.origemConfiavel === false) return falha("entrada_invalida", "mover_quadro só num turno limpo, em que nada de fora entrou (não tem Desfazer): diga à pessoa o que sugere");
    if (!podeRepassar(p.profundidade ?? 0)) return falha("entrada_invalida", "mover_quadro não sai no fim da corrente de bots: diga à pessoa o que sugere");
  }
  const achada = await tarefaDoMover(deps, p, op.tarefa, agentes);
  if ("erro" in achada) return falha(achada.erro, achada.detalhe);
  // A rota é /agentes/:id/quadro/tarefas/:tid/mover: a tarefa tem de estar no quadro de :id (revisão do PR #623).
  if (p.anfitriaoId) {
    const daRota = await repo.doAgente(p.anfitriaoId);
    if (!daRota || daRota.id !== achada.quadroId) return recusaDoMover("nao_encontrado", "fora_do_quadro");
  }
  const alvo = await quadroDoMover(deps, op.quadro, agentes);
  if (!alvo) return falha("nao_encontrado", `quadro "${op.quadro}" não encontrado: passe o nome do bot anfitrião, o prefixo do quadro ou o id`);
  if (alvo.id === achada.quadroId) return recusaDoMover("entrada_invalida", "ja_neste_quadro");
  const daOrigemSemTrava = await repo.buscar(achada.quadroId);
  // Revisão 7 do PR #623: o retorno da trava é o que vale. Um quadro que não voltou travado (removido enquanto este
  // pedido esperava) recusa aqui, antes de qualquer leitura ou escrita; e origem e destino seguem pelas linhas lidas
  // sob o FOR UPDATE, não por uma releitura solta.
  const travados = await travarQuadros(deps, daOrigemSemTrava ? [daOrigemSemTrava, alvo] : [alvo]);
  const origemSemPrefixo = travados.get(achada.quadroId);
  const destinoSemPrefixo = travados.get(alvo.id);
  if (!origemSemPrefixo || !destinoSemPrefixo) return recusaDoMover("nao_encontrado", "quadro_sumiu");
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  // Com as travas na mão, de novo: outro mover pode ter levado a tarefa enquanto este esperava.
  const t = await repo.tarefa(achada.id);
  if (!t) return recusaDoMover("nao_encontrado", "tarefa_sumiu");
  if (t.quadroId === alvo.id) return recusaDoMover("entrada_invalida", "ja_neste_quadro");
  // Revisão 2 do PR #623: só se move a partir do quadro de origem que foi TRAVADO. A tarefa que outro mover levou a um
  // terceiro quadro (não travado aqui) recusa; seguir leria e escreveria aquele quadro sem trava, e o prefixo dele
  // pegaria o advisory depois do FOR UPDATE (a ordem invertida que trava com a criação).
  if (t.quadroId !== achada.quadroId) return recusaDoMover("conflito", "mudou_de_quadro");
  const origem = await comPrefixo(deps, origemSemPrefixo, agentes);
  const destino = await comPrefixo(deps, destinoSemPrefixo, agentes);
  await numerarFaltantes(deps, origem);
  const daOrigem = (await repo.tarefa(t.id)) ?? t;
  const codigoAntigo = codigoDaTarefa(origem.prefixo, daOrigem);
  const numero = (await repo.numeroAntigo(t.id, destino.prefixo!)) ?? (await repo.reservarNumeros(destino.id, 1));
  const colunasOrigem = colunasDe(origem);
  const colunasDestino = colunasDe(destino);
  const estadoDoTurno = daOrigem.turnoId ? (await repo.estadosDosTurnos([daOrigem.turnoId])).get(daOrigem.turnoId) : undefined;
  const turnoVivo = ["pendente", "despachando"].includes(estadoDoTurno ?? "");
  const status = statusNoDestino(colunasOrigem, daOrigem.status, colunasDestino, daOrigem.agenteId, turnoVivo);
  const esperando = status === "voce" || status === "bloqueado";
  // Com responsável, a volta da resposta abre o turno (voltaDaResposta): a tarefa vai rodar, então volta para a execução
  // como se o turno estivesse vivo (revisão 9 do PR #623). Sem responsável, a mesma regra de quem não roda.
  const voltarPara = esperando && daOrigem.voltarPara !== null ? statusNoDestino(colunasOrigem, daOrigem.voltarPara, colunasDestino, daOrigem.agenteId, turnoVivo || daOrigem.agenteId !== null) : null;
  const ordem = (await repo.tarefas(destino.id)).reduce((m, x) => Math.max(m, x.ordem), 0) + 1;
  const movida = await repo.moverTarefa(t.id, { quadroId: destino.id, status, voltarPara, ordem, numero, terminadaEm: terminadaDepois({ status, terminadaEm: daOrigem.terminadaEm }, deps.agora(), colunasDestino) });
  if (!movida) return recusaDoMover("nao_encontrado", "tarefa_sumiu");
  await repo.guardarCodigos([{ prefixo: destino.prefixo!, numero, tarefaId: t.id }]);
  const historico: MudancaTarefa[] = [{ tarefaId: t.id, campo: "quadro", de: origem.id, para: destino.id, autor: p.autor }];
  if (status !== daOrigem.status) historico.push({ tarefaId: t.id, campo: "status", de: daOrigem.status, para: status, autor: { tipo: "regra" } });
  await repo.registrarHistorico(destino.id, historico, null);
  // A meta dos dois quadros muda com a tarefa: a origem pode fechar e o destino reabrir (revisão 2 do PR #623).
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  for (const q of [origem, destino]) {
    const fecho = fechoDaMeta({ meta: q.meta, prazo: q.prazo, metaDesde: q.metaDesde, anterior: q }, await repo.tarefas(q.id), colunasDe(q), nomes, deps.agora());
    await repo.salvar(q.id, { meta: q.meta, prazo: q.prazo, ...fecho });
  }
  const atual = (await repo.buscar(destino.id)) ?? destino;
  return {
    data: { ok: true, quadro: await montarQuadro(deps, atual), lote: null, comecaram: [], desfeito: false, movida: { tarefaId: t.id, codigo: codigoDaTarefa(atual.prefixo, movida), codigoAntigo } },
    events: [eventoQuadro(deps, p, origem, null, [t.id]), eventoQuadro(deps, p, atual, null, [t.id])],
  };
}

/**
 * NOD-415 (ADR-141): o bot volta a ser um agente comum. Para os turnos que as tarefas abriram e ainda rodam, e apaga o
 * quadro (tarefas e lotes vão junto, em cascata). A conversa, a memória, as rotinas e os acessos do bot não são do quadro
 * e ficam. Não tem Desfazer: um bot só remove a pedido da pessoa, agora, na conversa com ele e num turno limpo.
 */
async function removerQuadro(deps: Deps, p: PedidoLote, q: Quadro): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  // NOD-430: o bot não apaga na hora. O remover_quadro dele vira o card 'quadro_exclusao' (gerir_quadro →
  // proporExclusaoDoQuadro, que confere o pedido, o turno limpo e o nome em `bot`); aqui só chega o card confirmado.
  if (p.autor.tipo === "agente" && p.exclusaoConfirmada === undefined) return falha("entrada_invalida", "remover o quadro pela conversa vira um card que a pessoa confirma (gerir_quadro)");
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  for (const t of tarefas) if (t.turnoId) await pararTurno(deps, p, t.turnoId);
  // Os códigos ficam, sem tarefa (revisão 5 do PR #623): reservam o prefixo, e o link velho dá "não encontrada".
  await deps.repos.quadros.apagarHistorico(tarefas.map((t) => t.id));
  await deps.repos.quadros.apagar(q.id);
  const fechados = await fecharExclusoesPendentes(deps, q.id, p.exclusaoConfirmada);
  return { data: { ok: true, quadro: null, lote: null, comecaram: [], desfeito: false, removido: true }, events: [eventoQuadro(deps, p, q, null, tarefas.map((t) => t.id), true), ...fechados] };
}

/** NOD-430 (revisão 1 do PR #627): o quadro saiu, o card de excluí-lo não tem mais o que pedir. */
export const REGRA_QUADRO_JA_REMOVIDO = "regra:quadro_ja_removido" as const;
/** NOD-430 (revisão 1 do PR #627): a pessoa pediu de novo depois de o quadro mudar; o card velho dá lugar ao novo. */
export const REGRA_EXCLUSAO_SUBSTITUIDA = "regra:quadro_exclusao_substituida" as const;

/**
 * Fecha por regra os cards 'quadro_exclusao' ainda abertos do quadro que saiu (pela tela, pelo Desfazer da criação ou
 * por outro card), menos o `exceto` (o card que está sendo confirmado agora fecha como confirmado no caso de uso dele).
 * A proposta vai a recusada: nada foi excluído por ela. Sem isto o card ficava na Sua vez com botões mortos.
 */
export async function fecharExclusoesPendentes(deps: Deps, quadroId: string, exceto?: string, regra: typeof REGRA_QUADRO_JA_REMOVIDO | typeof REGRA_EXCLUSAO_SUBSTITUIDA = REGRA_QUADRO_JA_REMOVIDO): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const fechadas: Decisao[] = [];
  for (const proposta of await deps.repos.propostas.exclusoesPendentesDoQuadro(quadroId)) {
    if (proposta.id === exceto) continue;
    await deps.repos.propostas.decidir(proposta.id, "recusada");
    const d = await deps.repos.decisoes.fecharPorRegra(proposta.id, { regra, regraVersao: 1, agora });
    if (!d) continue;
    fechadas.push(d);
    events.push(evento(deps, "decisao_decidida", autoriaPessoa(deps.escopo.pessoaId, regra), { decisao_id: d.id, tipo: d.tipo, regra }, { conversaId: d.conversaId, turnoId: d.turnoId }));
  }
  return [...events, ...(fechadas.length ? await sincronizarDasDecisoes(deps, fechadas) : [])];
}

/**
 * A prévia de um lote (NOD-448): o mesmo planejamento do aplicar, sem gravar nem travar. O substituir_colunas pela
 * conversa usa para validar e montar o card antes de a pessoa confirmar.
 */
export async function preverLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ ok: true; quadro: Quadro; tarefas: TarefaQuadro[]; colunas: ColunaQuadro[] } | { ok: false; erro: FalhaQuadro; detalhe: string }> {
  if (!(await experimentoLigado(deps))) return { ok: false, erro: "experimento_desligado", detalhe: "o quadro está desligado nos experimentos da pessoa" };
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) return { ok: false, ...falhaDoAchado(achado, agentes) };
  if (!achado) return { ok: false, erro: "sem_quadro", detalhe: "não há quadro: crie com criar_quadro (meta e prazo são opcionais)" };
  const tarefas = await deps.repos.quadros.tarefas(achado.id);
  const codigosAntigos = await codigosAntigosDaqui(deps, p.ops, achado, tarefas);
  const plano = planejarLote({ quadro: { meta: achado.meta, prazo: achado.prazo, colunas: achado.colunas, prefixo: achado.prefixo }, quadroId: achado.id, tarefas, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, codigosAntigos, limite: limiteDe(p) });
  if ("erro" in plano) return { ok: false, erro: "entrada_invalida", detalhe: plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro };
  return { ok: true, quadro: achado, tarefas, colunas: colunasDe(plano.quadro) };
}

/** O lote que cria o quadro: o quadro nasce dentro dele (o Desfazer apaga o quadro). */
async function criarComLote(deps: Deps, p: PedidoLote, anfitriao: string, agentes: readonly Agente[]): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const op = p.ops[0]!;
  if (op.tipo !== "criar_quadro") return falha("entrada_invalida", "criar_quadro primeiro");
  // Planeja antes de criar: um passo inválido não deixa quadro órfão.
  const plano = planejarLote({ quadro: null, quadroId: "novo", tarefas: [], agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, limite: limiteDe(p) });
  if ("erro" in plano) return falha("entrada_invalida", plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro);
  const prefixo = await escolherPrefixo(deps, anfitriao, agentes);
  const criado = await deps.repos.quadros.criar({ agenteId: anfitriao, meta: op.meta ?? null, prazo: op.prazo ?? null, metaDesde: deps.agora(), prefixo });
  // Outro lote criou no mesmo instante (o índice único): o segundo lê o quadro dele e aplica o resto por cima.
  const q = criado ?? (await deps.repos.quadros.doAgente(anfitriao));
  if (!q) return falha("sem_quadro", "o quadro não foi criado");
  const travado = (await deps.repos.quadros.buscarTravado(q.id)) ?? q;
  return aplicarNoQuadro(deps, { ...p, ops: p.ops.slice(1) }, travado, agentes, criado !== null);
}

/**
 * A meta fecha (ou reabre) pelo estado final das tarefas; sem meta (fluxo contínuo, ADR-141) nada fecha. A meta que já
 * estava cumprida guarda o momento e o resumo de quando fechou. Usado pelo lote e pelo mover (revisão 2 do PR #623).
 */
function fechoDaMeta(q: { meta: string | null; prazo: string | null; metaDesde: number; anterior: { cumpridoEm: number | null; resumo: string | null } }, finais: readonly TarefaQuadro[], colunas: readonly ColunaQuadro[], nomes: ReadonlyMap<string, string>, agora: number): { cumpridoEm: number | null; resumo: string | null } {
  const daMeta = tarefasDaMeta(finais, q.metaDesde, colunas);
  if (q.meta === null || !metaCumprida(daMeta, colunas)) return { cumpridoEm: null, resumo: null };
  const { anterior } = q;
  return { cumpridoEm: anterior.cumpridoEm ?? agora, resumo: anterior.cumpridoEm !== null && anterior.resumo ? anterior.resumo : resumoDaMeta({ prazo: q.prazo, colunas }, daMeta, nomes, agora) };
}

async function aplicarNoQuadro(deps: Deps, p: PedidoLote, qSemPrefixo: Quadro, agentes: readonly Agente[], nasceuAgora: boolean): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const agora = deps.agora();
  // NOD-416: o quadro e as tarefas que o servidor de antes criou ganham prefixo e número antes de o lote os ler.
  const q = await comPrefixo(deps, qSemPrefixo, agentes);
  await numerarFaltantes(deps, q);
  const tarefasAntes = await repo.tarefas(q.id);
  const autorAgenteId = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  const podeComecar = podeRepassar(p.profundidade ?? 0);
  const estados = await repo.estadosDosTurnos(tarefasAntes.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const vivas = new Set(tarefasAntes.filter((t) => t.turnoId && ["pendente", "despachando"].includes(estados.get(t.turnoId) ?? "")).map((t) => t.id));
  const codigosAntigos = await codigosAntigosDaqui(deps, p.ops, q, tarefasAntes);
  const tarefaDoTurno = autorAgenteId && p.turnoId && p.ops.some((o) => o.tipo === "terminei" && !o.tarefa) ? await tarefaDoTurnoDe(deps, tarefasAntes, autorAgenteId, p.turnoId) : null;
  const plano = planejarLote({ quadro: { meta: q.meta, prazo: q.prazo, colunas: q.colunas, prefixo: q.prefixo }, quadroId: q.id, tarefas: tarefasAntes, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId, ops: p.ops, agora, podeComecar, vivas, origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true, codigosAntigos, limite: limiteDe(p), tarefaDoTurno });
  if ("erro" in plano) {
    // O quadro que nasceu neste lote não fica de pé sem o resto (tudo ou nada). Não acontece: criarComLote já planejou.
    if (nasceuAgora) await repo.apagar(q.id);
    const naoAchou = plano.erro.includes("não está no quadro") || plano.erro.includes("não encontrado");
    const dica = naoAchou ? await dicaDoCodigo(deps, p.ops, q) : null;
    const detalhe = plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro;
    return falha(naoAchou ? "nao_encontrado" : "entrada_invalida", dica ? `${detalhe}. ${dica}` : detalhe);
  }
  const antesPorId = new Map(tarefasAntes.map((t) => [t.id, t]));
  const colunasFinais = colunasDe(plano.quadro);
  const espera = colunaDeEspera(colunasFinais);
  const porAgente = new Map(agentes.map((a) => [a.id, a]));
  const idReal = new Map<string, string>();
  const gravadas = new Map<string, TarefaQuadro>();

  // O turno que a tarefa tinha e deixou de valer: excluída, cancelada, de volta ao backlog ou com outro responsável.
  for (const id of plano.apagadas) {
    const velho = antesPorId.get(id)?.turnoId;
    if (velho) await pararTurno(deps, p, velho);
    await repo.apagarTarefa(id);
  }
  for (const id of plano.tocadas) {
    const a = antesPorId.get(id);
    const t = plano.tarefas.find((x) => x.id === id);
    // NOD-448: pelo papel da coluna (a da pessoa em Não iniciado espera como o Backlog; em Fechado, como Cancelado).
    const papel = t ? papelDe(colunasFinais, t.status) : null;
    // Revisão 3 do PR #622: espera é onde a coluna não aciona (acionaNaColuna); com passagem ou sem, o Backlog para o turno.
    const naEspera = !!t && papel === "backlog" && !acionaNaColuna(colunasFinais, t.status);
    if (a?.turnoId && t && (t.agenteId !== a.agenteId || papel === "cancelado" || naEspera)) await pararTurno(deps, p, a.turnoId);
  }
  // NOD-416: as novas pegam números seguidos do quadro (sob a trava dele) e o código delas fica guardado.
  const quantasNovas = plano.tarefas.filter((t) => t.nova && plano.tocadas.includes(t.id)).length;
  let proximo = quantasNovas > 0 && q.prefixo !== null ? await repo.reservarNumeros(q.id, quantasNovas) : null;
  const codigos: { prefixo: string; numero: number; tarefaId: string }[] = [];
  for (const id of plano.tocadas) {
    const t = plano.tarefas.find((x) => x.id === id);
    if (!t) continue;
    if (t.nova) {
      const numero = proximo !== null ? proximo++ : null;
      const nova = await repo.inserirTarefa({ quadroId: q.id, titulo: t.titulo, descricao: t.descricao, status: t.status, agenteId: t.agenteId, linearId: t.linearId, linearUrl: t.linearUrl, prUrl: t.prUrl, pergunta: t.pergunta, resposta: t.resposta, deFora: t.deFora, terminadaEm: t.terminadaEm, numero });
      idReal.set(id, nova.id);
      gravadas.set(nova.id, nova);
      if (numero !== null && q.prefixo !== null) codigos.push({ prefixo: q.prefixo, numero, tarefaId: nova.id });
    } else {
      const salva = await repo.salvarTarefa(id, t);
      if (salva) gravadas.set(id, salva);
    }
  }
  await repo.guardarCodigos(codigos);

  // Quem começa: o turno nasce agora; a tarefa guarda o turno (o card mostra Na fila / Rodando / Falhou).
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const deQuem = autorAgenteId ? porAgente.get(autorAgenteId)?.nome ?? null : null;
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  let juntados = 0;
  const abrir = async (idPlano: string, texto: (t: TarefaQuadro) => string, origem: "inicio" | "resposta") => {
    const id = idReal.get(idPlano) ?? idPlano;
    const t = gravadas.get(id);
    if (!t) return;
    const agente = t.agenteId ? porAgente.get(t.agenteId) : undefined;
    // O responsável oculto ou excluído não recebe turno: a tarefa volta a A fazer, sem ficar em Fazendo (revisão rodada 5).
    if (!agente) {
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null, terminadaEm: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    // Um trabalho por gatilho (NOD-417): se o mesmo agente já tem um turno na fila para esta tarefa (o da tarefa ou o de
    // um comentário), o gatilho se junta a ele em vez de abrir outro.
    // Revisão 2 do PR #622: a mesma regra do pedir_a_bot com a tarefa (o turno que atende o pedido de outro bot não serve),
    // e o turno juntado fica com a maior profundidade (o gatilho não sai do limite da corrente por juntar).
    let naFila = await deps.repos.quadroComentarios.turnoNaFila(id, agente.id, t.turnoId);
    if (naFila && !(await podeJuntarNoTurno(deps, naFila.id, autorAgenteId))) naFila = null;
    // Juntar num turno de comentário (não o da própria tarefa): a menção pedia para não mexer no status; agora pode.
    const junto = naFila && naFila.id !== t.turnoId ? `${TAREFA_PASSOU_A_VOCE}\n\n${texto(t)}` : texto(t);
    const juntada = naFila ? await deps.repos.turnos.juntarEntrada(naFila.id, junto, [], { profundidade: proximaProfundidade(p.profundidade ?? 0) }) : null;
    if (juntada) {
      if (t.deFora || p.origemConfiavel === false) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      if (t.turnoId && t.turnoId !== juntada.id) await pararTurno(deps, p, t.turnoId);
      const salva = await repo.salvarTarefa(id, { ...t, turnoId: juntada.id });
      if (salva) gravadas.set(id, salva);
      // NOD-418: o turno juntado já é um trabalho (o mesmo turno raiz não vira dois).
      await deps.repos.quadroExecucoes.inserir({ tarefaId: id, origem, turnoId: juntada.id });
      comecaram.push({ tarefaId: id, agenteId: agente.id, agenteNome: agente.nome, turnoId: juntada.id });
      juntados++;
      return;
    }
    // Um turno novo para a tarefa: o anterior não roda em dobro (na fila, cancela; rodando, pede a interrupção).
    if (t.turnoId) await pararTurno(deps, p, t.turnoId);
    const aberto = await abrirTurno(deps, p, agente, texto(t), t.deFora);
    if (!aberto) {
      // Sem turno (o bot sem conversa própria): a tarefa não fica em Fazendo sem ninguém; volta a A fazer (revisão rodada 4).
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null, terminadaEm: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    const salva = await repo.salvarTarefa(id, { ...t, turnoId: aberto.turnoId });
    if (salva) gravadas.set(id, salva);
    // NOD-418: cada gatilho é um trabalho da tarefa (a lista na tarefa aberta, o retry e o Bloqueado partem daqui).
    await deps.repos.quadroExecucoes.inserir({ tarefaId: id, origem, turnoId: aberto.turnoId });
    comecaram.push({ tarefaId: id, agenteId: agente.id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    events.push(...aberto.events);
  };
  const meta = plano.quadro.meta;
  const prazo = plano.quadro.prazo;
  for (const id of plano.comecam) {
    await abrir(id, (t) => entradaDaTarefa({ quadroId: q.id, meta, prazo, tarefa: t, pessoaNome, deQuem: deQuem && t.agenteId !== autorAgenteId ? deQuem : null, etapa: etapaDaTarefa(colunasFinais, t.status) }), "inicio");
  }
  for (const r of plano.respondidas) {
    await abrir(r.id, (t) => entradaDaResposta({ quadroId: q.id, tarefa: t, resposta: r.resposta, pessoaNome }), "resposta");
  }

  // "Com você": a pessoa fica sabendo sem abrir o quadro (revisão do PR #612). Um aviso na conversa do responsável, como
  // o avisar_pessoa (o sino e o push da web); marcado não confiável, porque a pergunta pode ter vindo de conteúdo de fora.
  for (const id of plano.tocadas) {
    const t = gravadas.get(idReal.get(id) ?? id);
    const a = antesPorId.get(idReal.get(id) ?? id);
    if (!t || t.status !== "voce" || a?.status === "voce" || !t.agenteId) continue;
    // Como o avisar_pessoa: de turno não confiável ou com pergunta de fora, só o card muda (revisão rodada 3).
    if (p.origemConfiavel === false || t.deFora) continue;
    const ev = await avisarComVoce(deps, t, autorAgenteId ?? t.agenteId);
    if (ev) events.push(ev);
  }

  // A meta fecha (ou reabre) pelo estado final das tarefas. Sem meta (fluxo contínuo, ADR-141) nada fecha.
  const finais = await repo.tarefas(q.id);
  // A meta foi POSTA neste lote (não havia), ou uma meta NOVA veio depois de a anterior ser cumprida: ela conta a partir
  // de agora (revisões 2, 3 e 4) — o feito antes dela não a cumpre, e o período do risco começa aqui. Corrigir o texto de
  // uma meta ainda aberta, ou trocar o prazo, não recomeça a contagem.
  const metaNova = meta !== null && (q.meta === null || (q.cumpridoEm !== null && meta !== q.meta));
  const metaDesde = metaNova ? agora : q.metaDesde;
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const { cumpridoEm, resumo } = fechoDaMeta({ meta, prazo, metaDesde, anterior: metaNova ? { cumpridoEm: null, resumo: null } : q }, finais, colunasFinais, nomes, agora);
  const mudouQuadro = meta !== q.meta || prazo !== q.prazo || cumpridoEm !== q.cumpridoEm || resumo !== q.resumo;
  const mudouColunas = plano.mudouColunas;
  if (mudouQuadro || mudouColunas || plano.tocadas.length > 0 || plano.apagadas.length > 0) await repo.salvar(q.id, { meta, prazo, cumpridoEm, resumo, metaDesde, ...(mudouColunas ? { colunas: plano.quadro.colunas } : {}) });

  const tarefaIds = [...plano.tocadas.map((id) => idReal.get(id) ?? id), ...plano.apagadas];
  const foto: FotoLote = {
    quadro: nasceuAgora ? null : { meta: q.meta, prazo: q.prazo, cumpridoEm: q.cumpridoEm, resumo: q.resumo, metaDesde: q.metaDesde, colunas: q.colunas },
    tarefas: tarefaIds.map((id) => ({ id, antes: antesPorId.get(id) ?? null })),
  };
  const opsDoResumo: OpQuadro[] = nasceuAgora ? [{ tipo: "criar_quadro", meta: q.meta }, ...p.ops] : [...p.ops];
  const lote = nasceuAgora || tarefaIds.length > 0 || mudouQuadro || mudouColunas ? await repo.inserirLote({ quadroId: q.id, autor: p.autor, ...(pedidoDaPessoa(p) ? { pedidoPor: deps.escopo.pessoaId } : {}), resumo: resumoDoLote(opsDoResumo, plano.frasesDasColunas), antes: foto, tarefaIds }) : null;
  // NOD-416: o histórico de cada tarefa tocada: o que o autor pediu é dele; o que o motor fez depois, da regra.
  const historico: MudancaTarefa[] = [];
  for (const id of plano.tocadas) {
    const real = idReal.get(id) ?? id;
    const final = gravadas.get(real);
    const pedido = plano.pedidos.get(id);
    if (!final || !pedido) continue;
    historico.push(...mudancasDaTarefa({ tarefaId: real, antes: antesPorId.get(real) ?? null, pedido, final, autor: p.autor, statusPorRegra: plano.porRegra.has(id) }));
  }
  await repo.registrarHistorico(q.id, historico, lote?.id ?? null);
  const atualizado = (await repo.buscar(q.id)) ?? q;
  events.unshift(eventoQuadro(deps, p, atualizado, lote?.id ?? null, tarefaIds));
  // NOD-415 (ADR-141): o risco de prazo (só com meta e prazo), uma vez por (quadro, meta, prazo).
  const risco = await avisarRiscoDoQuadro(deps, atualizado, finais);
  if (risco) events.push(risco);
  // No limite da corrente: o que ia começar e ficou em A fazer (o bot avisa; a pessoa começa pelo quadro).
  const seguradas = plano.seguradas.length;
  const criadas = plano.criadas.map((id) => idReal.get(id) ?? null);
  return { data: { ok: true, quadro: await montarQuadro(deps, atualizado), lote, comecaram, desfeito: false, ...(seguradas ? { seguradas } : {}), ...(plano.ajustada ? { ajustada: true } : {}), ...(criadas.length ? { criadas } : {}), ...(juntados ? { juntados } : {}) }, events };
}

/** A aba Quadro de um bot: o quadro dele montado (ou null, ainda sem quadro). Experimento desligado = nao_permitido. */
export const verQuadro: CasoDeUso<{ agenteId: string }, { quadro: QuadroDto | null }> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const q = await deps.repos.quadros.doAgente(input.agenteId);
  return { data: { quadro: q ? await montarQuadro(deps, q) : null } };
};

async function exigirQuadroLigado(deps: Deps): Promise<void> {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
}

/**
 * NOD-416: o link da tarefa (`?tarefa=ZE-12`). O código atual ou um antigo (a tarefa mudou de quadro) leva a ela, no quadro
 * em que está hoje; o id também vale. Outro dono não acha (a RLS e o filtro do dono): nao_encontrado.
 */
export const verTarefaPorCodigo: CasoDeUso<{ codigo: string }, TarefaPorCodigoDto> = async (deps, input) => {
  await exigirQuadroLigado(deps);
  const repo = deps.repos.quadros;
  const ref = input.codigo.trim();
  const c = lerCodigo(ref);
  const id = c ? await repo.tarefaDoCodigo(c.prefixo, c.numero) : ehUuid(ref) ? ref.toLowerCase() : null;
  const t = id ? await repo.tarefa(id) : null;
  const q = t ? await repo.buscar(t.quadroId) : null;
  if (!t || !q) throw new ErroDeDominio("nao_encontrado", { cause: `tarefa ${ref}` });
  const codigoAtual = codigoDaTarefa(q.prefixo, t);
  return { data: { agenteId: q.agenteId, quadroId: q.id, tarefaId: t.id, codigo: c ? formatarCodigo(c.prefixo, c.numero) : codigoAtual, codigoAtual } };
};

/** NOD-416: o histórico da tarefa aberta, com os nomes resolvidos (a coluna, o bot, o anfitrião do quadro). */
export const historicoDaTarefa: CasoDeUso<{ agenteId: string; tarefaId: string }, { historico: EntradaHistoricoDto[] }> = async (deps, input) => {
  await exigirQuadroLigado(deps);
  const repo = deps.repos.quadros;
  const q = await repo.doAgente(input.agenteId);
  const t = ehUuid(input.tarefaId) ? await repo.tarefa(input.tarefaId) : null;
  if (!q || !t || t.quadroId !== q.id) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora deste quadro" });
  const linhas = await repo.historico(t.id);
  // Revisão 2 do PR #623: os quadros e os bots citados numa leitura só (antes, uma busca por linha), e a coluna pelo
  // quadro em que a mudança aconteceu (antes, a coluna da pessoa no quadro de origem saía com o id cru).
  const ehId = (v: string | null): v is string => v !== null && ehUuid(v);
  const idsQuadros = new Set<string>([q.id, ...linhas.map((l) => l.quadroId)]);
  for (const l of linhas) if (l.campo === "quadro") for (const v of [l.de, l.para]) if (ehId(v)) idsQuadros.add(v);
  const quadros = new Map((await repo.buscarVarios([...idsQuadros])).map((x) => [x.id, x]));
  const nomesBot = new Map((await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).map((a) => [a.id, a.nome]));
  const nomeDoBot = (id: string | null): string | null => (id === null ? null : nomesBot.get(id) ?? null);
  const nomeDoQuadro = (id: string | null): string | null => {
    const outro = id === null ? undefined : quadros.get(id);
    return outro ? nomeDoBot(outro.agenteId) : null;
  };
  const nomeDaColuna = (quadroId: string | undefined, id: string | null): string | null => {
    if (id === null) return null;
    const daqui = quadroId !== undefined ? quadros.get(quadroId) : undefined;
    const c = colunasDe(daqui ?? q).find((x) => x.id === id);
    if (c) return c.nome;
    for (const outro of quadros.values()) { const x = colunasDe(outro).find((y) => y.id === id); if (x) return x.nome; }
    return COLUNAS_PADRAO.find((x) => x.id === id)?.nome ?? id;
  };
  const historico: EntradaHistoricoDto[] = [];
  // No mover, a linha de status vem logo depois da de quadro: o `de` dela é uma coluna da origem.
  let origemDoMover: string | undefined;
  for (const l of linhas) {
    const deQuadro = l.campo === "status" && origemDoMover !== undefined ? origemDoMover : l.quadroId;
    origemDoMover = l.campo === "quadro" && ehId(l.de) ? l.de : undefined;
    const nome = (v: string | null, quadroId: string) => (l.campo === "agente" ? nomeDoBot(v) : l.campo === "quadro" ? nomeDoQuadro(v) : nomeDaColuna(quadroId, v));
    const { quadroId: _quadroId, ...linha } = l;
    historico.push({ ...linha, deNome: nome(l.de, deQuadro), paraNome: nome(l.para, l.quadroId), autorNome: l.autor === "agente" ? nomeDoBot(l.autorAgenteId) : null });
  }
  return { data: { historico } };
};

/** NOD-416: os quadros da pessoa, para o "Mover para…" da tarefa aberta. */
export const listarQuadros: CasoDeUso<Record<string, never>, { quadros: QuadroDaPessoaDto[] }> = async (deps) => {
  await exigirQuadroLigado(deps);
  // Revisão 3 do PR #623: uma leitura dos bots (ocultos e excluídos também, como o buscar de antes), não uma por quadro.
  const nomes = new Map((await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).map((a) => [a.id, a.nome]));
  const quadros: QuadroDaPessoaDto[] = (await deps.repos.quadros.listar()).map((q) => ({ id: q.id, agenteId: q.agenteId, agenteNome: nomes.get(q.agenteId) ?? "", prefixo: q.prefixo }));
  return { data: { quadros } };
};
