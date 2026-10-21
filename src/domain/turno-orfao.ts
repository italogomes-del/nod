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
 * definido em 2026-10-15 (NOD-257, H5): por que o pedido a colega espera na fila, em palavras curtas para o card do
 * pedido. `null` quando ele só está na vez dele (ainda não passou do prazo da fila e nada o impede).
 */
export type MotivoFila = BloqueioFila | CausaOrfao;

export function motivoDaFila(d: DecisaoTurnoOrfao): MotivoFila | null {
  return d.tipo === "encerrar" ? d.causa : d.tipo === "observar" ? d.bloqueio : null;
}

export function textoDoMotivoDaFila(m: MotivoFila): string {
  switch (m) {
    case "depois_de": return "espera a task anterior terminar";
    case "faixa_ocupada": return "espera o bot terminar o que está fazendo";
    case "condicao_da_maquina": return "espera o computador do bot (cota da IA, Mac fora ou sem recursos)";
    default: return textoDaCausa(m);
  }
}

/**
 * definido em 2026-10-13 (NOD-219, D3): a observação do mesmo turno velho sai no máximo uma vez por hora — o varredor
 * passa a cada minuto, e o log não pode virar ruído.
 */
export const INTERVALO_OBSERVACAO_TURNO_VELHO_MS = 3_600_000;

export function deveObservar(ultimaObservacao: number | undefined, agora: number): boolean {
  return ultimaObservacao === undefined || agora - ultimaObservacao >= INTERVALO_OBSERVACAO_TURNO_VELHO_MS;
}

/**
 * definido em 2026-10-20 (NOD-309, PR 4, emenda da ADR-045): o trabalho de FUNDO pendente que a condição da máquina
 * segura antes do despacho (o Mac fora, sem a faixa ocupada nem a task anterior aberta) não fica no escuro:
 *  - passados 10 min na fila, UM aviso por cadeia — "fica na fila e retoma quando o Mac voltar" (abaixo dos 30 min do
 *    pedido parado, para quem pediu não esperar calado). A cota da IA tem a nota dela ("Seguir com…") e não entra aqui;
 *  - o pedido de colega, a frente e o retorno do lote parados há mais de 24 h desde o começo da cadeia (NOD-229,
 *    `PRAZO_DO_FUNDO_MS`) desistem: o turno sai da fila e quem pediu recebe a falha. A task e a rotina só recebem o
 *    aviso (a task é da pessoa; a rotina tem a janela seguinte, que a encerra como 'não rodou').
 */
export type FundoPreso = "rotina" | "colega" | "frente" | "lote" | "task";

export const AVISO_FUNDO_PRESO_MS = 10 * 60_000;

export interface FatosFundoPreso {
  fundo: FundoPreso | null;
  criadoEm: number;
  acordarEm: number | null;
  /** O primeiro turno da cadeia (a raiz): o prazo de 24 h conta dele. */
  inicioDaCadeia: number;
  /** A cadeia já ganhou a linha "fica na fila" (assunto `fundo.espera`, desta passada ou da queda no meio do turno). */
  avisado: boolean;
  /** Uma conta de IA da pessoa está no limite: a cota tem a nota dela. */
  cotaNoLimite: boolean;
  depoisDeAberto: boolean;
  faixaOcupada: boolean;
}

export type DecisaoFundoPreso = { tipo: "nada" } | { tipo: "avisar" } | { tipo: "desistir" };

export function decidirFundoPreso(f: FatosFundoPreso, agora: number, prazoDoFundoMs: number): DecisaoFundoPreso {
  if (f.fundo === null || f.depoisDeAberto || f.faixaOcupada) return { tipo: "nada" };
  if (f.acordarEm !== null && f.acordarEm > agora) return { tipo: "nada" };
  const desiste = f.fundo === "colega" || f.fundo === "frente" || f.fundo === "lote";
  if (desiste && agora - f.inicioDaCadeia >= prazoDoFundoMs) return { tipo: "desistir" };
  if (!f.avisado && !f.cotaNoLimite && agora - f.criadoEm >= AVISO_FUNDO_PRESO_MS) return { tipo: "avisar" };
  return { tipo: "nada" };
}

