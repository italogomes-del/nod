import type { RuntimeEvent } from "../contracts/evento.ts";
import { decidirPedidoParado, MAX_QUEDAS_POR_PEDIDO, type AcaoPedidoParado, type PedidoParado } from "../domain/pedido-parado.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";

/** A regra que fecha o "Retomar" do colega quando o servidor retoma sozinho. */
export const REGRA_RETOMADA_AUTOMATICA = "regra:retomada_automatica" as const;

/** Só olha pedidos deste prazo para cá: o mesmo de uma decisão (24 h). Mais velho que isso, ninguém espera mais. */
export const JANELA_PEDIDOS_PARADOS_MS = PRAZO_DECISAO_PADRAO_MS;

export type SaidaPedidosParados = { retomados: string[]; avisados: string[]; entregues: string[] };

/**
 * Retoma o último turno caído do colega (definido em 2026-10-08): o "Retomar" aberto fecha por regra, a retomada entra
 * na fila no mesmo trabalho (a mesma sessão, pelo --resume) e a conversa do colega ganha a linha de sistema. Quem pediu
 * segue esperando: a resposta, ou a próxima falha, volta pelo caminho de sempre.
 */
async function retomar(deps: Deps, p: PedidoParado, acao: Extract<AcaoPedidoParado, { tipo: "retomar" }>): Promise<RuntimeEvent[]> {
  const original = await deps.repos.turnos.buscar(acao.turnoId);
  if (!original || original.estado !== "interrompido") return [];
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: original.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: REGRA_RETOMADA_AUTOMATICA });
  const events: RuntimeEvent[] = [];
  if (p.cardRetomar?.aberto) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(p.cardRetomar.id, { regra: REGRA_RETOMADA_AUTOMATICA, regraVersao: 1, agora });
    if (fechada) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_RETOMADA_AUTOMATICA } }));
  }
  const motivo = motivoEmPortugues(original.motivoInterrupcao ?? "trabalho_incompleto");
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    entradaTexto: `Este pedido foi interrompido no meio (${motivo}). Continue de onde parou, sem refazer o que já foi feito, e termine com a resposta para quem pediu.`,
    reenvios: original.reenvios + 1,
  });
  if (!turno) return events;
  if (nova) events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, reenvios: turno.reenvios, regra: REGRA_RETOMADA_AUTOMATICA } }));
  const aviso = await deps.repos.mensagens.criar({
    conversaId: original.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: redigir("retomada-automatica", agora, { motivo, tentativa: String(acao.tentativa), maximo: String(MAX_QUEDAS_POR_PEDIDO) }),
    confianca: "confiavel",
  });
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: original.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  events.push(...(await sincronizarDoTurno(deps, turno)));
  return events;
}

/**
 * definido em 2026-10-08 (diagnóstico do Nod diário: 15 tasks "rodando" sem turno vivo): o varredor de expiração chama
 * isto a cada passada. Cada pedido parado vira, pela regra de src/domain/pedido-parado.ts, uma retomada automática, a
 * entrega do resultado que ficou para trás ou o aviso de falha a quem pediu — que é quem relê o trabalho dele
 * (entregar-resposta-peer.ts) e o tira do "rodando". Roda numa transação própria (varredor-expiracao.ts).
 */
export async function cuidarDosPedidosParados(deps: Deps): Promise<{ data: SaidaPedidosParados; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const saida: SaidaPedidosParados = { retomados: [], avisados: [], entregues: [] };
  const events: RuntimeEvent[] = [];
  for (const p of await deps.repos.trabalhos.pedidosAColegaParados(agora - JANELA_PEDIDOS_PARADOS_MS, agora)) {
    const acao = decidirPedidoParado(p, agora, motivoEmPortugues);
    if (acao.tipo === "esperar") continue;
    if (acao.tipo === "retomar") {
      const r = await retomar(deps, p, acao);
      if (r.length > 0) saida.retomados.push(p.tarefaId);
      events.push(...r);
    } else if (acao.tipo === "entregar_resultado") {
      const r = await entregarRespostaPeer(deps, { tarefaId: acao.turnoId, texto: acao.texto });
      if ("mensagem" in r.data) saida.entregues.push(p.tarefaId);
      events.push(...(r.events ?? []));
    } else {
      const r = await avisarFalhaDelegacao(deps, { turnoId: p.tarefaId, motivo: acao.motivo });
      if ("mensagem" in r.data) saida.avisados.push(p.tarefaId);
      events.push(...(r.events ?? []));
    }
    log("info", "pedido_parado_tratado", { tarefa_id: p.tarefaId, trabalho_id: p.trabalhoColegaId, acao: acao.tipo, estado_colega: p.estadoColega, quedas: p.quedas });
  }
  return { data: saida, events };
}
