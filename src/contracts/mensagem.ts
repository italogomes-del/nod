import type { AnexoMeta } from "./anexo.ts";
import type { Autoria } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { DesfechoItem, DesfechoRotina, MotivoFalhaComputador, MotivoNegacao, MotivoPasse } from "./motivos.ts";

/** Marca de confiança é propriedade do CONTEÚDO, nunca do nome da ferramenta (ADR-026). */
export type Confianca = "confiavel" | "nao_confiavel";

export type KindMensagem =
  | "texto"
  | "sistema"
  | "handoff"
  | "passe"
  | "consentimento"
  | "rotina_execucao"
  | "resultado_aprovacao"
  | "negacao"
  | "parada"
  | "peer_ask";

/** Payload tipado por kind: estado de controle nunca se lê do texto (Regra 9, GRUPO.passe-tipado). */
export type PayloadMensagem =
  | { kind: "boas_vindas" }
  | { kind: "handoff"; de: string; para: string; motivo: string; tarefaId?: string }
  | { kind: "peer_pedido"; conversaOrigemId: string; turnoOrigemId: string }
  | { kind: "passe"; motivo: MotivoPasse }
  /** definido em 2026-09-24 (ADR-044): um consentimento por LOTE de capacidades do mesmo app. */
  | { kind: "consentimento"; conectorId: string; slug: string; capacidades: string[]; naoInclui: string[] }
  /** Forma das mensagens gravadas antes de 2026-09-24: uma capacidade por consentimento. */
  | { kind: "consentimento"; conectorId: string; slug: string; capacidade: string; naoInclui: string[] }
  | { kind: "rotina_execucao"; rotinaId: string; instanteAgendado: EpochMs; desfecho: DesfechoRotina }
  | { kind: "resultado_aprovacao"; decisaoId: string; itens: { idx: number; desfecho: DesfechoItem }[] }
  | { kind: "negacao"; classe: "ferramenta_negada" | "conector_indisponivel" | "plano_ausente"; nome: string; motivo: MotivoNegacao; terminal: boolean }
  | { kind: "parada"; interrompidas: number; nadaRodando: boolean }
  | { kind: "peer_ask"; agenteId: string; nome: string; naoSupervisionado: true; tarefaId: string; turnoOrigemId?: string }
  /** definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO de que o computador do bot saiu do ar. */
  | { kind: "computador_fora_do_ar"; agenteId: string; desde: EpochMs; motivo: MotivoFalhaComputador };

export type Mensagem = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  turnoId: string | null;
  autoria: Autoria;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  /** Turno interrompido no meio do streaming deixa a fala parcial marcada (ADR-010). */
  parcial: boolean;
  criadoEm: EpochMs;
  /** ADR-045: arquivos que a pessoa mandou com esta mensagem (só metadados; bytes por rota própria). */
  anexos?: AnexoMeta[];
};
