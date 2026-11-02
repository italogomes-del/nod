import type { RuntimeEvent } from "../contracts/evento.ts";
import type { OpQuadro } from "../contracts/quadro.ts";
import { entradaDoComentario, mencionados, quemAcionar } from "../domain/comentarios-quadro.ts";
import { colunasDe, papelDe } from "../domain/colunas.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import { andando, resolverTarefa } from "../domain/quadro.ts";
import { abrirTurno, acharQuadro, agentesDaPessoa, type Comecou, eventoQuadro, experimentoLigado, montarQuadro, paraAgenteDoQuadro, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import type { ComentarioDto } from "../contracts/quadro.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Comentar uma tarefa do quadro (definido em 2026-11-02, NOD-417): o gatilho além da atribuição. O comentário da pessoa
 * aciona o bot responsável, venha da pessoa ou de outro bot; a @menção aciona o mencionado, sem trocar o responsável; o
 * comentário de um bot nunca aciona ele mesmo. Cada acionado recebe UM trabalho: se já há um turno dele na fila para esta tarefa,
 * o comentário se junta a esse turno (juntarEntrada, o mesmo do enfileirarRetomada) em vez de abrir outro.
 *
 * Texto de bot é dado de fora (ADR-047/062): o comentário fica `deFora` e o turno que ele abre nasce contaminado. A tarefa
 * só fica `deFora` (pegajoso) quando o bot comentou de um turno não confiável, como o mudar_tarefa: o comentário limpo de
 * um bot não contamina para sempre os turnos do responsável. Não é lote: não entra no Desfazer.
 */

type Comentar = Extract<OpQuadro, { tipo: "comentar" }>;
const falha = (erro: Extract<ResultadoLote, { ok: false }>["erro"], detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });

/**
 * O pedir_a_bot com a tarefa (NOD-417): `alvoId` é acionado além do responsável e das menções; `complemento` vai no fim da
 * entrada dele (a mensagem da pessoa e para onde volta o resultado); `podeJuntar` diz se o turno dele na fila serve (um
 * turno que já atende o pedido de OUTRO bot não serve: a entrega do resultado é pelo turno, e iria ao bot errado).
 */
export type PedidoNaTarefa = { alvoId: string; complemento: string; podeJuntar: (turnoId: string) => Promise<boolean> };

export async function comentarTarefa(deps: Deps, p: PedidoLote, op: Comentar, extra: { pedido?: PedidoNaTarefa } = {}): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && "ambiguo" in achado) return falha("sem_quadro", `a pessoa tem ${achado.ambiguo.length} quadros: diga qual em quadro (o nome do bot anfitrião ou o id): ${achado.ambiguo.map((x) => x.id).join(", ")}`);
  if (!achado) return falha("sem_quadro", "não há quadro: crie com criar_quadro (meta e prazo são opcionais)");
  const repo = deps.repos.quadros;
  // A mesma trava do lote: o comentário e uma troca de responsável não se cruzam.
  const q = await repo.buscarTravado(achado.id);
  if (!q) return falha("sem_quadro", "o quadro sumiu");
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  const tarefas = await repo.tarefas(q.id);
  const achada = resolverTarefa(tarefas.map((t) => ({ ...t, nova: false })), op.tarefa);
  if ("erro" in achada) return falha(achada.erro.includes("não está no quadro") ? "nao_encontrado" : "entrada_invalida", achada.erro);
  let tarefa = tarefas.find((t) => t.id === achada.id)!;

  const deBot = p.autor.tipo === "agente";
  const comentario = await deps.repos.quadroComentarios.inserir({ quadroId: q.id, tarefaId: tarefa.id, autor: p.autor, texto: op.texto, deFora: deBot });
  if (deBot && p.origemConfiavel === false && !tarefa.deFora) tarefa = (await repo.salvarTarefa(tarefa.id, { ...tarefa, deFora: true })) ?? tarefa;

  const porId = new Map(agentes.map((a) => [a.id, a]));
  // Revisão 3 do PR #622: o bot que atende um pedido do responsável nesta tarefa comenta nela: o responsável não é acionado
  // de novo, porque a resposta já volta a ele pelo peer quando o turno acaba. Revisão 4: o pedido aberto é achado pela
  // tarefa e pelo par responsável → autor, não pelo turno de quem comenta (a retomada do turno do colega é outro turno).
  const autorBot = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  const responsavelPediu = autorBot && tarefa.agenteId && tarefa.agenteId !== autorBot
    ? await deps.repos.quadroComentarios.pedidoAbertoNaTarefa(tarefa.id, tarefa.agenteId, autorBot)
    : false;
  // Revisão 4 do PR #622 (decisão da ADR-142): o comentário só aciona o responsável com a tarefa em andamento (a coluna
  // anda: grupo iniciado, fora Precisa de você e Bloqueado). Em Não iniciado e Encerrado ele fica na tarefa, sem acionar.
  const colunas = colunasDe(q);
  const responsavelAnda = andando(colunas, tarefa.status);
  // Revisão 4 do PR #622: no pedir_a_bot com a tarefa, a @menção no texto do pedido não aciona ninguém além do alvo.
  const mencoes = mencionados(op.texto, agentes.map(paraAgenteDoQuadro)).map((a) => a.id).filter((id) => !extra.pedido || id === extra.pedido.alvoId);
  const alvos = quemAcionar({ autor: p.autor, responsavelId: responsavelPediu || !responsavelAnda ? null : tarefa.agenteId, mencionados: mencoes, ...(extra.pedido ? { alvos: [extra.pedido.alvoId] } : {}), nods: new Set(agentes.filter(ehNod).map((a) => a.id)) });
  const autorNome = p.autor.tipo === "agente" ? porId.get(p.autor.agenteId)?.nome ?? "Um bot" : (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "A pessoa";
  const contaminar = deBot || tarefa.deFora || p.origemConfiavel === false;
  // No limite da corrente (ADR-063) o comentário fica gravado e ninguém é acionado: dois bots não se mencionam sem fim.
  const podeAcionar = podeRepassar(p.profundidade ?? 0);
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  const turnos: string[] = [];
  let juntados = 0;
  for (const id of podeAcionar ? alvos : []) {
    const agente = porId.get(id);
    if (!agente) continue;
    const responsavel = id === tarefa.agenteId;
    const doPedido = extra.pedido?.alvoId === id ? extra.pedido : null;
    const base = entradaDoComentario({ quadroId: q.id, tarefa, autorNome, texto: op.texto, responsavel });
    const entrada = doPedido?.complemento ? `${base}\n\n${doPedido.complemento}` : base;
    let naFila = await deps.repos.quadroComentarios.turnoNaFila(tarefa.id, id, tarefa.turnoId);
    if (naFila && doPedido && !(await doPedido.podeJuntar(naFila.id))) naFila = null;
    const juntada = naFila ? await deps.repos.turnos.juntarEntrada(naFila.id, entrada, [], { profundidade: proximaProfundidade(p.profundidade ?? 0) }) : null;
    if (juntada) {
      if (contaminar) await deps.repos.turnos.contaminar(juntada.id, deps.agora());
      turnos.push(juntada.id);
      juntados++;
      comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: juntada.id });
      continue;
    }
    const aberto = await abrirTurno(deps, p, agente, entrada, contaminar);
    if (!aberto) continue;
    turnos.push(aberto.turnoId);
    events.push(...aberto.events);
    comecaram.push({ tarefaId: tarefa.id, agenteId: id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    // O responsável no andamento sem turno vivo: o card passa a mostrar este (Na fila, Rodando) e o gerir_quadro dele
    // acha o quadro pelo turno. Fora do andamento, ou com outro turno vivo, a tarefa fica com o turno que tinha.
    if (responsavel && papelDe(colunas, tarefa.status) === "fazendo") {
      const vivo = tarefa.turnoId ? ["pendente", "despachando"].includes((await repo.estadosDosTurnos([tarefa.turnoId])).get(tarefa.turnoId) ?? "") : false;
      if (!vivo) tarefa = (await repo.salvarTarefa(tarefa.id, { ...tarefa, turnoId: aberto.turnoId })) ?? tarefa;
    }
  }
  await deps.repos.quadroComentarios.registrarTurnos(comentario.id, turnos);
  events.unshift(eventoQuadro(deps, p, q, null, [tarefa.id]));
  const seguradas = podeAcionar ? 0 : alvos.length;
  const parado = tarefa.agenteId && !responsavelAnda && tarefa.agenteId !== autorBot && !alvos.includes(tarefa.agenteId)
    ? { agenteNome: porId.get(tarefa.agenteId)?.nome ?? "o responsável", coluna: colunas.find((c) => c.id === tarefa.status)?.nome ?? tarefa.status }
    : null;
  return {
    data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram, desfeito: false, comentario, ...(juntados ? { juntados } : {}), ...(seguradas ? { seguradas } : {}), ...(parado ? { responsavelForaDoAndamento: parado } : {}) },
    events,
  };
}

/** Os comentários de uma tarefa do quadro do bot da tela (NOD-417), do mais antigo ao mais novo. Só lê. */
export const verComentarios: CasoDeUso<{ agenteId: string; tarefaId: string }, { comentarios: ComentarioDto[] }> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const q = await deps.repos.quadros.doAgente(input.agenteId);
  if (!q || !(await deps.repos.quadros.tarefas(q.id)).some((t) => t.id === input.tarefaId)) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  return { data: { comentarios: await deps.repos.quadroComentarios.daTarefa(input.tarefaId) } };
};
