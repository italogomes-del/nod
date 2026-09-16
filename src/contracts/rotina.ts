export type RotinaEstado = "proposta" | "ativa" | "pausada";

export type Rotina = {
  tenantId: string;
  id: string;
  agenteId: string;
  /** Expressão cron de 5 campos. Tudo é cron, inclusive "todo dia às 8h" (ADR-011). */
  cron: string;
  /** Fuso IANA nomeado. Persistência recusa offset numérico. */
  fusoIana: string;
  instrucao: string;
  /** Gate nasce ligado por coluna/default, não por interpretação do texto (E7.3). */
  exigeAprovacao: boolean;
  estado: RotinaEstado;
  proximoDisparo: number | null;
  criadoEm: number;
};

export type JanelaRotina = {
  tenantId: string;
  rotinaId: string;
  instanteAgendado: number;
  estado: "reivindicada" | "executada" | "passou-em-branco" | "falhou";
};
