import type { OrigemTurno } from "../contracts/turno.ts";
import { prazoVenceu } from "./relogio.ts";

/**
 * NOD-219: o turno `pendente` que nunca vai sair da fila. Definido em 2026-10-13 (plano de engenharia da Ada, D1–D3).
 *
 * Só o pendente é órfão: o `despachando` já cai pelo lease (varredor de lease, `maquina_sem_contato`) e não é tocado aqui.
 * O `reivindicar` (turnos.repo.ts) exige um agente vivo com a mesma `geracao_execucao` do turno; sem isso o pendente
 * fica "na fila · há 6h" para sempre. Duas causas o tornam impossível de rodar, e só elas encerram:
 *  - `agente_excluido`: o agente foi excluído (`agentes.excluir` interrompe os pendentes, mas um turno criado na corrida
 *    com a exclusão, ou que voltou de uma restauração, escapa);
 *  - `geracao_antiga`: o agente vive, mas a geração subiu (excluir e restaurar não a reduz).
 *
 * O pendente que só está preso — a faixa ocupada, o `depois_de` ainda aberto, a cota da IA, o Mac fora, sem memória ou
 * sem disco — pode sair a qualquer momento: NÃO se encerra. Passado o prazo da fila (`prazo_em`), vira observação (log e
 * métrica `turno_velho_na_fila`), para medir antes de decidir outra regra.
 *
 * A ligação nunca entra (tem o próprio ciclo, a pessoa está na linha), nem a volta marcada para mais tarde (ADR-086):
 * ela ainda não pode sair.
 */
export type CausaOrfao = "agente_excluido" | "geracao_antiga";

/**
 * O que segura o pendente velho. `condicao_da_maquina` junta o que o servidor não distingue sem a máquina: a cota da
 * IA, o Mac fora, a memória ou o disco apertados, a IA não pronta.
 */
export type BloqueioFila = "depois_de" | "faixa_ocupada" | "condicao_da_maquina";

export interface FatosTurnoOrfao {
  origem: OrigemTurno;
  criadoEm: number;
  /** O prazo da fila (`turnos.prazo_em`). */
  prazoEm: number;
  acordarEm: number | null;
  agenteExcluido: boolean;
  /** O agente vive, mas com outra `geracao_execucao`. */
  geracaoAntiga: boolean;
  /** O trabalho de que este depende ("Fazer depois da …") ainda não terminou. */
  depoisDeAberto: boolean;
  /** Outro turno da mesma faixa (a conversa sem trabalho, ou o mesmo trabalho) está despachando. */
  faixaOcupada: boolean;
}

export type DecisaoTurnoOrfao =
  | { tipo: "manter" }
  | { tipo: "encerrar"; causa: CausaOrfao }
  | { tipo: "observar"; bloqueio: BloqueioFila };

export function decidirTurnoOrfao(f: FatosTurnoOrfao, agora: number): DecisaoTurnoOrfao {
  if (f.origem === "ligacao") return { tipo: "manter" };
  if (f.acordarEm !== null && f.acordarEm > agora) return { tipo: "manter" };
  if (f.agenteExcluido) return { tipo: "encerrar", causa: "agente_excluido" };
  if (f.geracaoAntiga) return { tipo: "encerrar", causa: "geracao_antiga" };
  const velho = prazoVenceu({ natureza: "expiracao-fila", iniciaEm: f.criadoEm, prazoMs: Math.max(0, f.prazoEm - f.criadoEm), pausadoMs: 0, agora });
  if (!velho) return { tipo: "manter" };
  return { tipo: "observar", bloqueio: f.depoisDeAberto ? "depois_de" : f.faixaOcupada ? "faixa_ocupada" : "condicao_da_maquina" };
}

/** A causa em palavras, para a conversa, o pedido a colega e o evento. */
export function textoDaCausa(causa: CausaOrfao): string {
  return causa === "agente_excluido" ? "o bot foi excluído" : "o bot foi reiniciado depois que o pedido entrou na fila";
}

/**
 * definido em 2026-10-13 (NOD-219, D3): a observação do mesmo turno velho sai no máximo uma vez por hora — o varredor
 * passa a cada minuto, e o log não pode virar ruído.
 */
export const INTERVALO_OBSERVACAO_TURNO_VELHO_MS = 3_600_000;

export function deveObservar(ultimaObservacao: number | undefined, agora: number): boolean {
  return ultimaObservacao === undefined || agora - ultimaObservacao >= INTERVALO_OBSERVACAO_TURNO_VELHO_MS;
}
