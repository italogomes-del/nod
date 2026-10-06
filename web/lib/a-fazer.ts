/**
 * definido em 2026-10-06 (pedido do Marlon): o "A fazer" está desligado — a pílula embaixo da conversa e a seção da
 * gaveta poluíam a tela sem ajudar. O servidor desliga junto (NOD_PENDENCIAS, src/domain/pendencia.ts). A web não lê
 * env do servidor (ADR-018), então religar é virar esta constante E pôr NOD_PENDENCIAS=1.
 */
export const A_FAZER_LIGADO: boolean = false;
