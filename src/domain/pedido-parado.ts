import type { EstadoTrabalho } from "../contracts/trabalho.ts";

/**
 * Pedido a colega que parou sem voltar (definido em 2026-10-08, diagnóstico do Nod diário): em 08/10, 18 pedidos entre
 * bots ficaram sem resposta porque a task do colega acabou por um caminho que não avisa quem pediu (recusa no despacho,
 * Parar, cancelamento, card dispensado, queda da máquina) — e a task de quem pediu ficou "rodando" por horas, sem turno
 * vivo. O varredor de expiração passa por eles e decide aqui o que fazer com cada um.
 */

/** Motivos de infraestrutura: o bot não errou, a máquina ou a IA saiu do ar no meio do pedido. */
export const MOTIVOS_DE_QUEDA = ["maquina_sem_contato", "executor_indisponivel", "reinicio_servidor"] as const;

/** definido em 2026-10-08: até 3 quedas por pedido (2 retomadas automáticas); a terceira avisa quem pediu. */
export const MAX_QUEDAS_POR_PEDIDO = 3;

/**
 * definido em 2026-10-08: sem nenhum sinal de que as máquinas voltaram (um turno concluído ou com lease vivo depois da
 * queda) em 30 min, desiste da retomada e avisa quem pediu — melhor ele saber do que esperar em silêncio.
 */
export const DESISTIR_SEM_SINAL_MS = 30 * 60_000;

/**
 * definido em 2026-10-08: só retoma sozinho a queda das últimas 2 h. Um pedido que caiu de manhã e voltaria à tarde já
 * perdeu o contexto de quem pediu; avisar é mais barato e deixa o bot que pediu decidir se pede de novo.
 */
export const RETOMAR_ATE_MS = 2 * 3_600_000;

/** O que o repositório lê de um pedido parado (trabalhos.repo.ts, pedidosAColegaParados). */
export type PedidoParado = {
  /** O turno de delegação que o handoff aponta (payload.tarefaId): a raiz do pedido. */
  tarefaId: string;
  trabalhoColegaId: string;
  estadoColega: EstadoTrabalho;
  /** O último turno assentado do trabalho do colega (concluído ou interrompido; o absorvido não conta). */
  ultimoTurnoId: string | null;
  ultimoMotivo: string | null;
  /** Quando o último turno caiu: o lease dele (último sinal) ou, recusado no despacho, a criação. */
  quedaEm: number | null;
  /** Quantos turnos do trabalho do colega caíram por infraestrutura. */
  quedas: number;
  /** O card "Retomar" do último turno, se houver. */
  cardRetomar: { id: string; aberto: boolean } | null;
  /** Algum turno da pessoa concluiu, ou roda com lease vivo, depois da queda: as máquinas voltaram. */
  sinalDepoisDaQueda: boolean;
  /** A última fala do colega na task (o resultado que não chegou a quem pediu). */
  textoFinal: string | null;
  /** O turno da fala final, para a entrega achar a raiz pela cadeia. */
  turnoDoTextoFinal: string | null;
};

export type AcaoPedidoParado =
  | { tipo: "esperar" }
  | { tipo: "retomar"; turnoId: string; tentativa: number }
  | { tipo: "entregar_resultado"; turnoId: string; texto: string }
  /**
   * `semEsperar` (definido em 2026-10-09, #218): o aviso sai mesmo com algo da cadeia do colega "em aberto" — a task foi
   * parada (nada nela continua) ou a regra desistiu de uma queda com o "Retomar" ainda aberto. Sem isto o aviso
   * esperava pela pessoa ou pelo colega (entregar-resposta-peer.ts, aindaNaoEntrega), não gravava nada, e o pedido
   * voltava a cada passada do varredor: a tarefa cf7f39aa do Nod diário passou pelo aviso 1.013 vezes em 8,5 h.
   */
  | { tipo: "avisar_falha"; motivo: string; semEsperar?: true };

export function ehQueda(motivo: string | null): boolean {
  return motivo !== null && (MOTIVOS_DE_QUEDA as readonly string[]).includes(motivo);
}

/**
 * A decisão, sem efeito: o use case (pedidos-parados.ts) aplica. `motivoLegivel` traduz o enum (motivoEmPortugues).
 * - Terminou com fala que não voltou: entrega o resultado. Sem fala: avisa que terminou sem resposta.
 * - Parado: avisa (alguém parou a task do colega).
 * - Caiu por infraestrutura, com o card "Retomar" ainda aberto ou sem card: retoma sozinho quando as máquinas voltam,
 *   até MAX_QUEDAS_POR_PEDIDO e só nas últimas RETOMAR_ATE_MS; esgotado, mais velho, ou sem sinal de volta em
 *   DESISTIR_SEM_SINAL_MS, avisa.
 * - "Precisa de você" por outra razão (uma decisão da pessoa): espera — o vencimento de 24 h já avisa.
 * - Falhou por qualquer outro motivo: avisa com o motivo.
 */
export function decidirPedidoParado(p: PedidoParado, agora: number, motivoLegivel: (motivo: string) => string): AcaoPedidoParado {
  if (p.estadoColega === "terminado") {
    if (p.textoFinal && p.turnoDoTextoFinal) return { tipo: "entregar_resultado", turnoId: p.turnoDoTextoFinal, texto: p.textoFinal };
    return { tipo: "avisar_falha", motivo: "terminou sem resposta" };
  }
  if (p.estadoColega === "parado") return { tipo: "avisar_falha", motivo: "a task foi parada antes de terminar", semEsperar: true };
  const caiu = ehQueda(p.ultimoMotivo) && p.ultimoTurnoId !== null;
  // Card do "Retomar" já resolvido (a pessoa retomou, dispensou ou ele venceu): a decisão é dela, não da regra.
  const cardDecidido = p.cardRetomar !== null && !p.cardRetomar.aberto;
  if (p.estadoColega === "precisa_de_voce" && (!caiu || cardDecidido)) return { tipo: "esperar" };
  if (p.estadoColega !== "falhou" && p.estadoColega !== "precisa_de_voce") return { tipo: "esperar" };
  const motivo = motivoLegivel(p.ultimoMotivo ?? "trabalho_incompleto");
  if (!caiu || cardDecidido) return { tipo: "avisar_falha", motivo };
  // Daqui para baixo a regra desiste de uma queda: o "Retomar" aberto fica para a pessoa, mas não segura o aviso.
  if (p.quedas >= MAX_QUEDAS_POR_PEDIDO) return { tipo: "avisar_falha", motivo: `${motivo} (caiu ${p.quedas} vezes)`, semEsperar: true };
  if (p.quedaEm !== null && agora - p.quedaEm > RETOMAR_ATE_MS) return { tipo: "avisar_falha", motivo: `${motivo}, e já faz mais de 2 h`, semEsperar: true };
  if (p.ultimoTurnoId && p.sinalDepoisDaQueda) return { tipo: "retomar", turnoId: p.ultimoTurnoId, tentativa: p.quedas + 1 };
  if (p.quedaEm !== null && agora - p.quedaEm > DESISTIR_SEM_SINAL_MS) return { tipo: "avisar_falha", motivo: `${motivo}, e as máquinas não voltaram em 30 min`, semEsperar: true };
  return { tipo: "esperar" };
}
