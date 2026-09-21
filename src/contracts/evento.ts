import type { EpochMs, TenantId } from "./ids.ts";
import type { MotivoLocalidade } from "./motivos.ts";

/** Quem executou o turno: o CLI da pessoa ou o catcher in-process (ADR-012, EMENDA 25). */
export type Executor = "local" | "catcher";

/**
 * Autoria composta (ADR-023/025): quem escreveu, sob procuração de quem, de quem é a cota,
 * e por qual regra a localidade foi decidida (ADR-022). Toda regra que pergunta "foi uma pessoa?"
 * lê `autor_tipo`, nunca infere de outro campo. Nomes em snake_case porque são as colunas de
 * `events` e `mensagens` (0001/0002) — o repositório grava sem traduzir.
 */
export type Autoria = {
  autor_tipo: "pessoa" | "agente";
  autor_id: string;
  /** Quem PEDIU o trabalho quando não foi o autor (null num turno normal). */
  sob_procuracao_de: string | null;
  /** De quem é a assinatura e a cota que o turno queima (ADR-025). */
  conta_de_execucao: string;
  executor: Executor;
  locality: "local";
  locality_reason: MotivoLocalidade;
  machine_id: string | null;
  decidido_por: `regra:${string}` | "pessoa";
  regra_versao: number;
};

/** União FECHADA de kinds da tabela `events` (ADR-005: fluxo append-only). */
export type KindEvento =
  | "mensagem_criada"
  | "turno_criado"
  | "turno_despachado"
  | "turno_encerrado"
  | "turno_interrompido"
  | "decisao_criada"
  | "decisao_decidida"
  | "decisao_vencida"
  | "proposta_criada"
  | "rotina_criada"
  | "rotina_executou"
  | "sala_handoff"
  | "negacao"
  | "concessao_criada"
  | "agente_atualizado"
  | "parada"
  | "relato_criado";

/** Dados do evento: só escalares (o CHECK da trilha e o outbox não aceitam prosa aninhada). */
export type DadosEvento = Record<string, string | number | boolean | null>;

export type RuntimeEvent = {
  tenantId: TenantId;
  id: string;
  createdAt: EpochMs;
  kind: KindEvento;
  autoria: Autoria;
  /** Dona do frame: só ela recebe o evento pelo outbox/SSE (ADR-016, buffer por PESSOA). */
  pessoaDestinoId: string;
  conversaId?: string | null;
  turnoId?: string | null;
  dados: DadosEvento;
};
