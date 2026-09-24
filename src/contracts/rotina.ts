import type { EpochMs, TenantId } from "./ids.ts";
import type { DesfechoRotina, MotivoBloqueioRotina } from "./motivos.ts";
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
  /**
   * Exclusão recuperável (ADR-034, migração 0016): não-nulo some das listagens, do teto de 50 e do
   * tick do scheduler, sem apagar linha — a trilha e as execuções passadas continuam.
   */
  excluidoEm: EpochMs | null;
};

/**
 * Trava UNIQUE (tenant_id, rotina_id, instante_agendado) e registra QUAL executor ganhou (ADR-011).
 * turnoId é null entre a reivindicação e o nascimento do turno na MESMA tx (rotinaJanelasRepo
 * .vincularTurno preenche): a janela existe ANTES do turno, por desenho — definido em 2026-09-16.
 */
export type JanelaRotina = {
  tenantId: TenantId;
  rotinaId: string;
  instanteAgendado: EpochMs;
  executor: Executor;
  machineId: string;
  turnoId: string | null;
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

/**
 * definido em 2026-09-24 (emenda da ADR-044, "rotina se trava sozinha"): a rotina que o pré-voo parou,
 * como o card de acesso a mostra. `desde` é a primeira janela que não rodou (sem nenhuma, quando o card
 * nasceu); `naoRodaram` são as execuções 'bloqueada' seguidas até agora, mais recentes primeiro — nenhuma
 * gastou turno de modelo. O fuso é o da rotina, para a web escrever "ontem 13:00".
 */
export type ParadaDaRotina = { desde: EpochMs; naoRodaram: EpochMs[]; fusoIana: string };

/**
 * A mesma parada na lista de rotinas: qual app falta e o botão de um clique. `decisaoId` é a decisão de
 * acesso aberta (mesmo id da proposta); null = o card é o de conexão, que ainda não tem decisão. O card é
 * UM por (agente, app): `rodaNaHora` diz se ele é DESTA rotina (permitir a dispara na hora) ou de outra
 * rotina do mesmo agente (esta roda na próxima janela dela).
 */
export type BloqueioRotina = ParadaDaRotina & { motivo: Exclude<MotivoBloqueioRotina, "aguardando_resposta">; app: string; slug: string; decisaoId: string | null; rodaNaHora: boolean };
