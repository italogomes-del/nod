import type { Executor } from "../contracts/evento.ts";
import type { Turno } from "../contracts/turno.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Sessão viva (definido em 2026-10-01, ADR-067): o turno do Claude Code não acaba na primeira resposta. Enquanto há
 * comando em segundo plano, ou a pessoa manda mensagem, o CLI fica aberto e o modelo volta a trabalhar sozinho — como
 * no terminal. Estes dois casos de uso são o lado do servidor, chamados pela renovação do lease.
 */

/** O turno ainda roda: uma fala da sessão só entra na conversa enquanto ele não foi assentado. */
const vivo = (t: Turno | null): t is Turno => t !== null && t.estado === "despachando";

/**
 * Uma volta do modelo que não encerrou o turno vira fala na conversa na hora, com a autoria e a confiança da fala final
 * (assentarTurno). Fala de sala nunca chega aqui: o driver a junta na entrega, que passa pelos responders.
 */
export const gravarFalasDaSessao: CasoDeUso<{ turnoId: string; machineId: string; executor: Executor; textos: readonly string[] }, { gravadas: number }> = async (deps, e) => {
  const turno = await deps.repos.turnos.buscar(e.turnoId);
  if (!vivo(turno) || turno.origem === "sala" || (turno.machineId !== null && turno.machineId !== e.machineId)) return { data: { gravadas: 0 } };
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: e.executor, machineId: e.machineId });
  const events = [];
  for (const texto of e.textos) {
    if (texto.trim() === "") continue;
    const m = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "texto", texto, payload: null, confianca: turno.entradaConfianca });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: m.id, kind: "texto", parcial: false } }));
  }
  return { data: { gravadas: events.length }, events };
};

/**
 * Quem recebe mensagem no meio do trabalho: o turno vivo da conversa da pessoa com o bot — conversa, criação, rotina ou
 * a retomada de uma delas. Pedido de colega (delegação, peer, e o que corre sob procuração) e sala ficam de fora: a
 * resposta deles vai a outro bot ou passa pelos responders, e uma fala da pessoa no meio a misturaria.
 */
export function aceitaMensagemNaSessao(t: Turno): boolean {
  return t.estado === "despachando" && t.sobProcuracaoDe === null && t.origem !== "delegacao" && t.origem !== "peer" && t.origem !== "sala";
}

/**
 * As falas da pessoa que esperavam na fila desta conversa entram no turno vivo, na ordem; cada uma sai
 * interrompido/'absorvido' (a tela tira o "na fila"). Devolve os textos que o executor escreve na sessão do CLI.
 */
export const absorverNaSessao: CasoDeUso<{ turnoId: string; executor: Executor }, { textos: string[] }> = async (deps, e) => {
  const turno = await deps.repos.turnos.buscar(e.turnoId);
  if (!turno || !aceitaMensagemNaSessao(turno)) return { data: { textos: [] } };
  const absorvidos = await deps.repos.turnos.absorverNaSessao(turno);
  if (absorvidos.length === 0) return { data: { textos: [] } };
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo, e.executor);
  const events = absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: turno.id } }));
  return { data: { textos: absorvidos.map((a) => a.entradaTexto) }, events };
};
