import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Trabalho, TrabalhoDetalheDto, TrabalhoDto, TrabalhosDto } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { pastaDoBot } from "../domain/nativas.ts";
import { estadoDoTrabalho, pastaDoTrabalho, textoTrabalhoAberto, tituloDoTrabalho, trabalhoFinal } from "../domain/trabalho.ts";
import type { NovoTrabalho } from "../repositories/trabalhos.repo.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Trabalhos (definido em 2026-10-07, ADR-081, épico #188): criar, manter o estado e montar o que a tela recebe. O
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
 * Cria o trabalho. A pasta é `~/nod/<bot>/<slug>` (ADR-065), salvo quando quem chama já decidiu outra (a rotina usa
 * uma por rotina; a rede de 2 min, nenhuma: o processo já roda na pasta do bot). `pasta: null` = a pasta do bot.
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

/** O turno pertence a um trabalho? Sincroniza o dele. */
export function sincronizarDoTurno(deps: DepsTrabalho, turno: Pick<Turno, "trabalhoId"> | null | undefined): Promise<RuntimeEvent[]> {
  return sincronizarTrabalho(deps, turno?.trabalhoId ?? null);
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
    const { tenantId: _tenant, sessaoCli: _sessao, sessaoHarness: _harness, ...publico } = t;
    const e = extras.get(t.id);
    const vivo = e?.turnoVivoId ?? null;
    return {
      ...publico,
      pedidoPorNome: e?.pedidoPorNome ?? null,
      rotinaNome: e?.rotinaNome ? tituloDoTrabalho(e.rotinaNome) : null,
      // O nome da última ferramenta do turno vivo (o processo sabe) ganha da última fala, que pode ser de minutos atrás.
      ultimoPasso: (vivo ? deps.services.trabalhosVivos?.ultimaFerramenta(vivo) : null) ?? (e?.ultimaFala ? tituloDoTrabalho(e.ultimaFala) : null),
      turnoVivoId: vivo,
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
  return { data: { trabalhos: await trabalhosParaDto(deps, trabalhos), pressao: memoria?.nivel ?? null, memoriaTotalMb: memoria?.totalMb ?? null } };
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

/** Os abertos de um trabalho que o Parar mexe: o trabalho é parado mesmo que o turno ainda esteja acabando. */
export async function marcarParado(deps: DepsTrabalho, t: Trabalho): Promise<RuntimeEvent[]> {
  if (trabalhoFinal(t.estado)) return [];
  const parado = await deps.repos.trabalhos.mudarEstado(t.id, "parado", deps.agora());
  return parado ? [eventoTrabalhoMudou(deps, parado)] : [];
}

/**
 * Parar uma task só (POST trabalhos/:id/parar): interrompe os pendentes dela, pede a interrupção do que roda (a
 * próxima renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor. Não abre parada: a conversa e as outras
 * tasks seguem.
 */
export const pararTrabalho: CasoDeUso<{ trabalhoId: string }, { trabalho: TrabalhoDto; interrompidos: number }> = async (deps, input) => {
  const t = await deps.repos.trabalhos.buscarTravado(input.trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  const turnos = await deps.repos.turnos.doTrabalho(t.id);
  let interrompidos = 0;
  for (const p of turnos.filter((x) => x.estado === "pendente")) {
    if (!(await deps.repos.turnos.interromper(p.id, "parado_pela_pessoa"))) continue;
    interrompidos += 1;
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: p.conversaId, turnoId: p.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente", trabalho_id: t.id } }));
  }
  const vivos = turnos.filter((x) => x.estado === "despachando").map((x) => x.id);
  interrompidos += await deps.repos.turnos.pedirInterrupcao(vivos, agora);
  for (const id of vivos) await deps.services.interruptor.interromper(id).catch(() => false);
  events.push(...(await marcarParado(deps, t)));
  const atual = (await deps.repos.trabalhos.buscar(t.id)) ?? t;
  const [dto] = await trabalhosParaDto(deps, [atual]);
  return { data: { trabalho: dto!, interrompidos }, events };
};

