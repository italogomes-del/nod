import type { AcessoPedido } from "./acesso.ts";
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
  /**
   * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso", migração 0027): os apps que a
   * rotina DECLARA ler ou alterar, já normalizados pelo domínio. null = rotina anterior, sem declaração: o
   * pré-voo lê a fonte. Presente, mesmo vazia, ganha da fonte.
   */
  acessos: AcessoPedido[] | null;
  /**
   * definido em 2026-10-01 (item 7 da ADR-066, migração 0045): a rotina só acorda quando o agente tem pendência
   * visível (ADR-064). Sem nenhuma, a janela agendada passa sem turno de modelo — execução 'sem_novidade' com
   * motivo 'sem_pendencia', custo zero. "Executar agora" da pessoa roda sempre. DEFAULT false na coluna.
   */
  soComPendencia: boolean;
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

/**
 * definido em 2026-10-15 (pacote A3): no `RotinaDto`, quantos horários do cron passaram desde a janela da execução que
 * ainda está aberta — cada um pulado pelo agendador (ADR-045, disparar-rotina.ts). Só vem na rotina ativa e a partir de
 * AVISO_JANELAS_PULADAS (src/domain/janelas-puladas.ts); ausente = nada a avisar. Não se grava: é contado a cada leitura.
 */
export type JanelasPuladasDaRotina = { janelasPuladas?: number };

/**
 * definido em 2026-10-15 (NOD-270): a última janela parou porque uma pergunta (ou aprovação) de uma execução anterior
 * espera a pessoa — a lista mostra "parada: pergunta sem resposta desde X" e o atalho ao balão. Ausente no DTO = não está
 * parada por isso (ou a rotina não é da pessoa).
 */
export type PerguntaPendenteDaRotina = { decisaoId: string; desde: EpochMs; tipo: TipoPendenciaDaRotina };

/**
 * definido em 2026-10-16 (review de design do #342): o que segura a janela — "aprovacao" para os tipos de gate
 * (TIPOS_GATE_ROTINA: gate_rotina e aprovacao), "pergunta" para o resto. A lista diz "aprovação sem resposta" e
 * "Ver aprovação" no primeiro caso, para o rótulo não contradizer o card que o atalho abre.
 */
export type TipoPendenciaDaRotina = "pergunta" | "aprovacao";
