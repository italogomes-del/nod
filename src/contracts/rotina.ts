import type { EpochMs, TenantId } from "./ids.ts";
import type { DesfechoRotina } from "./motivos.ts";
import type { Executor } from "./evento.ts";

export type EstadoRotina = "ativa" | "pausada";

export type Rotina = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  conversaId: string;
  ownerId: string;
  /** cron de 5 campos; quem avalia é o servidor (ADR-011). */
  cron: string;
  /** Fuso IANA nomeado; offset numérico recusado no domínio e no CHECK. */
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  /** DEFAULT true na coluna: o gate nasce ligado por schema, nunca por texto (E7.3). */
  exigeAprovacao: boolean;
  estado: EstadoRotina;
  proximaExecucao: EpochMs;
  criadoEm: EpochMs;
};

/** Trava UNIQUE (tenant_id, rotina_id, instante_agendado) e registra QUAL executor ganhou (ADR-011). */
export type JanelaRotina = {
  tenantId: TenantId;
  rotinaId: string;
  instanteAgendado: EpochMs;
  executor: Executor;
  machineId: string;
  turnoId: string;
};

export type ExecucaoRotina = {
  tenantId: TenantId;
  id: string;
  rotinaId: string;
  instanteAgendado: EpochMs;
  turnoId: string | null;
  desfecho: DesfechoRotina;
  motivo: string | null;
  em: EpochMs;
};
