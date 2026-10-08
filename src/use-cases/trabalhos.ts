import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { LeituraMemoria, NivelPressao, Trabalho, TrabalhoDetalheDto, TrabalhoDto, TrabalhosDto } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { deveSegurar } from "../domain/memoria-mac.ts";
import { pastaDoBot } from "../domain/nativas.ts";
import { estadoDoTrabalho, pastaDoTrabalho, textoTrabalhoAberto, tituloDoTrabalho, trabalhoAberto, trabalhoFinal } from "../domain/trabalho.ts";
import type { NovoTrabalho } from "../repositories/trabalhos.repo.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Trabalhos (definido em 2026-10-07, ADR-083, épico #188): criar, manter o estado e montar o que a tela recebe. O
 * estado nunca é transição solta: quem mexe num turno ou numa decisão de um trabalho chama `sincronizarTrabalho`, que
 * relê os fatos e decide por `estadoDoTrabalho` (src/domain/trabalho.ts).
 */

type DepsTrabalho = Pick<Deps, "repos" | "escopo" | "agora">;

/** O frame `trabalho.mudou` sai pelo outbox: só ids e estado (KindEvento `trabalho_mudou`). */
export function eventoTrabalhoMudou(deps: DepsTrabalho, t: Pick<Trabalho, "id" | "agenteId" | "conversaId" | "estado" | "origem">): RuntimeEvent {
  return evento(deps.escopo, {
    kind: "trabalho_mudou",
    autoria: autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:trabalhos" }),
    agora: deps.agora(),
    conversaId: t.conversaId,
    dados: { trabalhoId: t.id, agenteId: t.agenteId, conversaId: t.conversaId, estado: t.estado, origem: t.origem },
  });
}

/**
 * Cria o trabalho. A pasta é `~/nod/<bot>/<slug>` (ADR-065), salvo quando quem chama já decidiu outra. revisto em
 * 2026-10-08 (revisão do épico, S13): toda origem ganha a sua — rotina e rede também. `pasta: null` = a pasta do bot.
 */
export async function criarTrabalho(deps: DepsTrabalho, n: Omit<NovoTrabalho, "titulo"> & { titulo: string }): Promise<{ trabalho: Trabalho; events: RuntimeEvent[] }> {
  const titulo = tituloDoTrabalho(n.titulo);
  const id = n.id ?? randomUUID();
  let pasta = n.pasta;
  if (pasta === undefined) {
    const agente = await deps.repos.agentes.buscar(n.agenteId);
    pasta = agente ? pastaDoTrabalho(pastaDoBot(agente.nome), titulo, id) : null;
  }
  const trabalho = await deps.repos.trabalhos.criar({ ...n, id, titulo, pasta });
  if (!trabalho) throw new ErroDeDominio("estado_invalido", { cause: "trabalho não criado" });
  return { trabalho, events: [eventoTrabalhoMudou(deps, trabalho)] };
}

/**
 * Relê os fatos do trabalho e grava o estado novo, se mudou (com trava de linha: duas sincronizações seguidas não se
 * atropelam). Devolve o evento `trabalho_mudou` só na mudança. Sem trabalho, nada.
 */
export async function sincronizarTrabalho(deps: DepsTrabalho, trabalhoId: string | null | undefined): Promise<RuntimeEvent[]> {
  if (!trabalhoId) return [];
  const atual = await deps.repos.trabalhos.buscarTravado(trabalhoId);
  if (!atual) return [];
  const fatos = await deps.repos.trabalhos.fatos(trabalhoId);
  if (!fatos) return [];
  const novo = estadoDoTrabalho({ ...fatos, estadoAtual: atual.estado, iniciado: atual.iniciadoEm !== null });
  if (novo === atual.estado) return [];
  const mudou = await deps.repos.trabalhos.mudarEstado(trabalhoId, novo, deps.agora());
  return mudou ? [eventoTrabalhoMudou(deps, mudou)] : [];
}

/**
 * O evento `pressao_memoria` (#194): o nível que a pessoa vê mudou. Pelo outbox ele vira o frame `memoria.mudou {nivel}`
 * (despachar-outbox.ts); grava também o anterior e o total, só números (DadosEvento é escalar).
 */
export function eventoPressao(deps: DepsTrabalho, mudanca: { nivel: NivelPressao; anterior: NivelPressao | null }, leitura: Pick<LeituraMemoria, "totalMb">): RuntimeEvent {
  return evento(deps.escopo, {
    kind: "pressao_memoria",
    autoria: autoriaPessoa(deps.escopo),
    agora: deps.agora(),
    dados: { nivel: mudanca.nivel, anterior: mudanca.anterior, totalMb: Math.round(leitura.totalMb) },
  });
}

/** O turno pertence a um trabalho? Sincroniza o dele. */
export function sincronizarDoTurno(deps: DepsTrabalho, turno: Pick<Turno, "trabalhoId"> | null | undefined): Promise<RuntimeEvent[]> {
  return sincronizarTrabalho(deps, turno?.trabalhoId ?? null);
}

/**
 * definido em 2026-10-08 (revisão do épico, S2): uma decisão saiu de aberta (decidida, respondida, dispensada, vencida,
 * fechada por regra) — o trabalho do turno dela relê os fatos. Sem isto a task ficava `precisa_de_voce` para sempre, e
 * a que esperava por ela (`depois_de`) nunca começava. É o ponto comum de todos esses caminhos; roda na transação da
 * DONA (mudarEstado exige owner = pessoa) e depois de a retomada, se houver, já estar na fila.
 */
export async function sincronizarDasDecisoes(deps: DepsTrabalho, decisoes: readonly Pick<Decisao, "turnoId">[]): Promise<RuntimeEvent[]> {
  const trabalhos = new Set<string>();
  for (const d of decisoes) {
    const turno = d.turnoId ? await deps.repos.turnos.buscar(d.turnoId) : null;
    if (turno?.trabalhoId) trabalhos.add(turno.trabalhoId);
  }
  const events: RuntimeEvent[] = [];
  for (const id of trabalhos) events.push(...(await sincronizarTrabalho(deps, id)));
  return events;
}

/** A regra que fecha as decisões de uma task parada (revisão do épico, S1). */
export const REGRA_TRABALHO_PARADO = "regra:trabalho_parado" as const;

/**
 * definido em 2026-10-08 (revisão do épico, S1): o Parar da task, o "Fazer aqui" e o Parar do chat fecham por regra as
 * decisões ainda abertas dos turnos do trabalho (a proposta de mesmo id, pendente, sai recusada, como em fecharGemeas).
 * Antes a aprovação aberta voltava a task para `precisa_de_voce` e, aprovada depois do Parar, abria uma retomada que a
 * reabria. Na transação da dona (fecharPorRegra exige owner = pessoa).
 */
export async function fecharDecisoesDoTrabalho(deps: DepsTrabalho, trabalhoId: string): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: REGRA_TRABALHO_PARADO };
  for (const d of await deps.repos.decisoes.abertasDoTrabalho(trabalhoId)) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(d.id, { regra: REGRA_TRABALHO_PARADO, regraVersao: 1, agora });
    if (!fechada) continue;
    // Ninguém continua esta decisão: sem a marca, o assentamento do turno parado (continuarAprovacoesDoTurno) via uma
    // aprovação 'decidida' sem continuação e abria a retomada que reabria a task (medido no teste da S1).
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    const proposta = await deps.repos.propostas.buscar(fechada.id);
    if (proposta?.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_TRABALHO_PARADO, trabalho_id: trabalhoId } }));
  }
  return events;
}

/**
 * A linha centralizada "Abriu a task …" (mensagem `sistema` com payload `trabalho_aberto`) na conversa do trabalho.
 * `turnoId`: o turno que abriu (a conversa coordenadora, ou o turno promovido pela rede); null quando a fixture ou a
 * pessoa abre.
 */
export async function linhaTrabalhoAberto(deps: DepsTrabalho, t: Trabalho, turnoId: string | null): Promise<RuntimeEvent[]> {
  const autoria = autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:trabalhos" });
  const m = await deps.repos.mensagens.criar({
    conversaId: t.conversaId,
    turnoId,
    autoria,
    kind: "sistema",
    texto: textoTrabalhoAberto(t.titulo, t.origem),
    payload: { kind: "trabalho_aberto", trabalhoId: t.id, titulo: t.titulo, origem: t.origem },
    confianca: "confiavel",
  });
  return m ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: t.conversaId, turnoId, dados: { mensagem_id: m.id, kind: "sistema", trabalho_id: t.id } })] : [];
}

/**
 * O que a web recebe (TrabalhoDto): sem sessão nem tenant, com o nome de quem pediu, a rotina (a primeira linha da
 * instrução), o último passo (a última fala do bot no trabalho, curta) e o turno vivo. `esperandoComputadorDe` vem do
 * serviço do computador (S5), quando há.
 */
export async function trabalhosParaDto(deps: Pick<Deps, "repos" | "services">, trabalhos: readonly Trabalho[]): Promise<TrabalhoDto[]> {
  const extras = await deps.repos.trabalhos.extras(trabalhos.map((t) => t.id));
  return trabalhos.map((t): TrabalhoDto => {
    const { tenantId: _tenant, sessaoCli: _sessao, sessaoHarness: _harness, sessaoExecutor: _executor, ...publico } = t;
    const e = extras.get(t.id);
    const vivo = e?.turnoVivoId ?? null;
    return {
      ...publico,
      pedidoPorNome: e?.pedidoPorNome ?? null,
      rotinaNome: e?.rotinaNome ? tituloDoTrabalho(e.rotinaNome) : null,
      // O nome da última ferramenta do turno vivo (o processo sabe) ganha da última fala, que pode ser de minutos atrás.
      ultimoPasso: (vivo ? deps.services.trabalhosVivos?.ultimaFerramenta(vivo) : null) ?? (e?.ultimaFala ? tituloDoTrabalho(e.ultimaFala) : null),
      turnoVivoId: vivo,
      // revisto em 2026-10-08 (ADR-085): a memória é a do processo vivo. Sem turno vivo (esperando você, um colega ou a
      // vez na fila) não há processo, e a última leitura gravada fazia "Todos os trabalhos" somar vários GB que o Mac
      // não usava (o topo dizia 606 MB e as linhas, 18 × 200–400 MB).
      memoriaMb: vivo ? t.memoriaMb : null,
      deFora: e?.deFora ?? false,
      esperandoComputadorDe: (e?.turnosAbertos ?? []).map((id) => deps.services.computadores?.esperandoPor?.(id) ?? null).find((x) => x !== null) ?? null,
    };
  });
}

/** definido em 2026-10-07: "Terminados hoje" — o servidor manda as últimas 24 h e a tela corta no dia dela. */
export const JANELA_TERMINADOS_MS = 24 * 60 * 60_000;

/**
 * GET trabalhos(?agenteId=): os abertos e os terminados nas últimas 24 h, do bot ou de todos os bots da pessoa, e a
 * pressão de memória dos Macs dela (null = nenhum Mac mandou leitura nos últimos 2 min).
 */
export const listarTrabalhos: CasoDeUso<{ agenteId?: string }, TrabalhosDto> = async (deps, input) => {
  if (input.agenteId && !(await deps.repos.agentes.buscar(input.agenteId))) throw new ErroDeDominio("nao_encontrado");
  const trabalhos = await deps.repos.trabalhos.listar({ agenteId: input.agenteId, terminadosDesde: deps.agora() - JANELA_TERMINADOS_MS });
  const memoria = deps.services.trabalhosVivos?.memoria(deps.escopo.pessoaId) ?? null;
  const processador = memoria?.processador ?? null;
  // ADR-085: a pessoa vê que trabalho novo está esperando pelo mesmo critério do puxar (o pior Mac dela).
  const segurando = memoria !== null && deveSegurar("pouco", memoria.nivel, processador)
    && deveSegurar((await deps.repos.preferencias.buscar()).usoDoMac ?? "equilibrado", memoria.nivel, processador);
  return { data: { trabalhos: await trabalhosParaDto(deps, trabalhos), pressao: memoria?.nivel ?? null, memoriaTotalMb: memoria?.totalMb ?? null, processador, cargaProcessador: memoria?.carga ?? null, segurando } };
};

/** Os abertos do bot da conversa (ConversaDto.trabalhos, a faixa). Conversa de sala não tem bot próprio: lista vazia. */
export async function trabalhosAbertosDaConversa(deps: Pick<Deps, "repos" | "services">, agenteId: string | null): Promise<TrabalhoDto[]> {
  if (!agenteId) return [];
  return trabalhosParaDto(deps, await deps.repos.trabalhos.abertosDoAgente(agenteId));
}

/**
 * GET trabalhos/:id (a tela da task): o trabalho e as mensagens dele — as falas dos turnos dele (inclui as do meio) e
 * as falas da pessoa que abriram um turno dele (`mensagem_origem_id`).
 */
export const detalharTrabalho: CasoDeUso<{ trabalhoId: string }, TrabalhoDetalheDto> = async (deps, input) => {
  const t = await deps.repos.trabalhos.buscar(input.trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  const [dto] = await trabalhosParaDto(deps, [t]);
  const mensagens: Mensagem[] = await deps.repos.mensagens.doTrabalho(t.id);
  return { data: { trabalho: dto!, mensagens } };
};

/**
 * #194: a memória do Mac apertou e a task esperava a pessoa dentro do turno — a espera é solta (o turno encerra e o
 * processo fecha), a task fica `fechado_ocioso` e volta do mesmo ponto (--resume) quando a pessoa responder. A conversa
 * ganha uma linha curta. Turno sem trabalho não é fechado (a conversa é a da pessoa).
 */
export async function fecharPorMemoria(deps: DepsTrabalho, turnoId: string): Promise<{ fechou: boolean; events: RuntimeEvent[] }> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno?.trabalhoId) return { fechou: false, events: [] };
  const t = await deps.repos.trabalhos.buscarTravado(turno.trabalhoId);
  if (!t || !trabalhoAberto(t.estado)) return { fechou: false, events: [] };
  if (t.estado === "fechado_ocioso") return { fechou: true, events: [] };
  const fechado = await deps.repos.trabalhos.mudarEstado(t.id, "fechado_ocioso", deps.agora());
  if (!fechado) return { fechou: false, events: [] };
  const autoria = autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:memoria" });
  const linha = await deps.repos.mensagens.criar({ conversaId: t.conversaId, autoria, kind: "sistema", texto: `Fechei a task "${t.titulo}", parada esperando você, para liberar memória. Ela volta do mesmo ponto quando você responder.`, confianca: "confiavel" });
  const events = [eventoTrabalhoMudou(deps, fechado)];
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: deps.agora(), conversaId: t.conversaId, dados: { mensagem_id: linha.id, kind: "sistema", trabalho_id: t.id } }));
  return { fechou: true, events };
}

/**
 * Os abertos de um trabalho que o Parar mexe: o trabalho é parado mesmo que o turno ainda esteja acabando, e as decisões
 * abertas dele fecham por regra (S1) — `parado` vence a decisão na derivação, e nenhuma aprovação depois o reabre.
 */
export async function marcarParado(deps: DepsTrabalho, t: Trabalho): Promise<RuntimeEvent[]> {
  if (trabalhoFinal(t.estado)) return [];
  const events = await fecharDecisoesDoTrabalho(deps, t.id);
  const parado = await deps.repos.trabalhos.mudarEstado(t.id, "parado", deps.agora());
  if (parado) events.push(eventoTrabalhoMudou(deps, parado));
  return events;
}

/**
 * definido em 2026-10-08 (revisão do épico, S20): a ORDEM ÚNICA das travas de um trabalho — as linhas dos turnos abertos
 * dele primeiro (em ordem de criação), depois a do trabalho. É a ordem da renovação e da entrega (turno → recados →
 * trabalho, via sincronizarTrabalho). O Parar e o "Fazer aqui" travavam o trabalho e depois os turnos: 40P01 contra uma
 * entrega em curso, e se a vítima era a entrega a resposta do bot se perdia.
 */
export async function travarTrabalhoComTurnos(deps: Pick<Deps, "repos">, trabalhoId: string): Promise<Trabalho & { turnos: Turno[] }> {
  if (!(await deps.repos.trabalhos.buscar(trabalhoId))) throw new ErroDeDominio("nao_encontrado");
  const turnos = await deps.repos.turnos.travarAbertosDoTrabalho(trabalhoId);
  const t = await deps.repos.trabalhos.buscarTravado(trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  return { ...t, turnos };
}

/**
 * Parar uma task só (POST trabalhos/:id/parar): interrompe os pendentes dela, pede a interrupção do que roda (a
 * próxima renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor. Não abre parada: a conversa e as outras
 * tasks seguem.
 */
export const pararTrabalho: CasoDeUso<{ trabalhoId: string }, { trabalho: TrabalhoDto; interrompidos: number }> = async (deps, input) => {
  const t = await travarTrabalhoComTurnos(deps, input.trabalhoId);
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  const turnos = t.turnos;
  let interrompidos = 0;
  for (const p of turnos.filter((x) => x.estado === "pendente")) {
    if (!(await deps.repos.turnos.interromper(p.id, "parado_pela_pessoa"))) continue;
    interrompidos += 1;
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: p.conversaId, turnoId: p.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente", trabalho_id: t.id } }));
  }
  const vivos = turnos.filter((x) => x.estado === "despachando").map((x) => x.id);
  interrompidos += await deps.repos.turnos.pedirInterrupcao(vivos, agora);
  for (const id of vivos) await deps.services.interruptor.interromper(id).catch(() => false);
  const { turnos: _turnos, ...trabalho } = t;
  events.push(...(await marcarParado(deps, trabalho)));
  const atual = (await deps.repos.trabalhos.buscar(t.id)) ?? trabalho;
  const [dto] = await trabalhosParaDto(deps, [atual]);
  return { data: { trabalho: dto!, interrompidos }, events };
};

