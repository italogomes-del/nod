import type { IdHarness } from "./harness.ts";
import type { EpochMs } from "./ids.ts";

/**
 * A cota da IA como portão do trabalho de fundo (definido em 2026-10-12, ADR-099 §7, parte 7 do plano "um dono por bot").
 *
 * - `reserva`: a IA passou de 99% numa janela (5 horas ou semana) que ainda não renovou. Trabalho NOVO de fundo para de
 *   nascer; o 1% que sobra fica para a conversa com a pessoa.
 * - `limite`: a IA está no limite (o turno voltou com o sinal do fornecedor, ou a janela chegou a 100%). Todo trabalho de
 *   fundo espera até renovar, em vez de falhar.
 *
 * A conversa com a pessoa (turno de conversa, de sala, retomada que ela pediu, e a ligação) nunca é segurada pela cota.
 */
export type SituacaoDaCota = "livre" | "reserva" | "limite";

/** Uma IA segurando trabalho de fundo; `voltaEm` = quando a janela que segura renova (sem horário do CLI: 1 h desde a leitura). */
export type CotaDaIa = { ia: IdHarness; situacao: Exclude<SituacaoDaCota, "livre">; voltaEm: EpochMs };

/**
 * O que `GET trabalhos` manda para a pílula (só quando alguma IA segura): a pior situação, as IAs e quando o trabalho de
 * fundo volta (a última renovação entre as IAs que seguram; null = o CLI não disse).
 */
export type CotaDto = { situacao: Exclude<SituacaoDaCota, "livre">; ias: IdHarness[]; voltaEm: EpochMs | null };

/**
 * Em cada `TrabalhoDto` (definido em 2026-10-12, ADR-099 §7): a cota da IA do bot segura esta task agora (o fundo novo na
 * reserva de 1%, ou todo o fundo com a IA no limite). A linha diz "esperando a cota da IA". Ausente: não espera pela cota.
 */
export type CotaNoTrabalho = { esperaDaCota?: boolean };

/**
 * No `TrabalhosDto`: a cota da IA segurando trabalho de fundo (null = nada segura; ausente = servidor anterior). A pílula
 * diz "a cota da IA está no fim; trabalho de fundo volta às HH:MM".
 */
export type CotaNosTrabalhos = { cota?: CotaDto | null };

/** O custo de um bot hoje e o ritmo dele (definido em 2026-10-12, ADR-099 §7). */
export type CustoDoBotHoje = {
  agenteId: string;
  /** Soma de `turnos.custo_usd` dos turnos criados hoje até agora, no fuso da pessoa. */
  hojeUsd: number;
  /** Média dos 7 dias anteriores, cada um somado da meia-noite até o mesmo horário de agora. */
  mediaUsd: number;
  /** hoje ÷ média; null sem média. */
  vezes: number | null;
  /** O gasto de hoje passou do dobro da média, acima do piso (domain/custo-do-dia.ts). */
  foraDoRitmo: boolean;
};

/** `GET custo-hoje?fuso=`: os bots com gasto hoje (ou fora do ritmo), do que mais gastou ao que menos. */
export type CustoDoDiaDto = { fuso: string; desde: EpochMs; ate: EpochMs; totalUsd: number; bots: CustoDoBotHoje[]; foraDoRitmo: boolean };
