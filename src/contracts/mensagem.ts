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
  /**
   * `delegacao` (definido em 2026-09-24, ADR-047): o pedido é tarefa delegada — o texto é a mensagem
   * literal da pessoa, e tarefa/contexto são do remetente (a web rotula "não é instrução da pessoa").
   */
  | { kind: "peer_pedido"; conversaOrigemId: string; turnoOrigemId: string; delegacao?: { tarefa: string; contexto: string | null } }
  | { kind: "passe"; motivo: MotivoPasse }
  /** definido em 2026-09-24 (ADR-044): um consentimento por LOTE de capacidades do mesmo app. */
  | { kind: "consentimento"; conectorId: string; slug: string; capacidades: string[]; naoInclui: string[] }
  /** Forma das mensagens gravadas antes de 2026-09-24: uma capacidade por consentimento. */
  | { kind: "consentimento"; conectorId: string; slug: string; capacidade: string; naoInclui: string[] }
  | { kind: "rotina_execucao"; rotinaId: string; instanteAgendado: EpochMs; desfecho: DesfechoRotina }
  | { kind: "resultado_aprovacao"; decisaoId: string; itens: { idx: number; desfecho: DesfechoItem }[] }
  | { kind: "negacao"; classe: "ferramenta_negada" | "conector_indisponivel" | "plano_ausente"; nome: string; motivo: MotivoNegacao; terminal: boolean }
  | { kind: "parada"; interrompidas: number; nadaRodando: boolean }
  /**
   * `delegada` (ADR-047): resultado de tarefa delegada, não resposta a pergunta; o conteúdo segue não
   * confiável. `falhou`: aviso de que a tarefa não vai terminar (texto do servidor, não do alvo).
   */
  | { kind: "peer_ask"; agenteId: string; nome: string; naoSupervisionado: true; tarefaId: string; turnoOrigemId?: string; delegada?: true; falhou?: true }
  /** definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO de que o computador do bot saiu do ar. */
  | { kind: "computador_fora_do_ar"; agenteId: string; desde: EpochMs; motivo: MotivoFalhaComputador }
  /**
   * definido em 2026-09-24 (emenda da ADR-045, perguntas viram conversa): a fala do agente que É a
   * pergunta de pedir_a_pessoa. A web a desenha como pergunta, sem card nem caixa de texto; `opcoes`
   * são as respostas prontas (pedido.ts), e o toque manda o texto da opção como a resposta.
   */
  | { kind: "pedido_a_pessoa"; decisaoId: string; opcoes?: string[] }
  /**
   * A resposta da pessoa, ligada à pergunta (responder-decisao.ts): `perguntaEm` rotula "respondendo à
   * pergunta das HH:MM" e `retomada` diz se um turno de retomada nasceu junto. `turnoRetomadaId`
   * (definido em 2026-09-24, fio da pergunta): QUAL turno — é por ele que o fio sabe se o agente ainda
   * está lendo a resposta. Respostas gravadas antes não o têm: o fio as dá por resolvidas.
   */
  | { kind: "resposta_a_pedido"; decisaoId: string; agenteId: string; perguntaEm: EpochMs; retomada: boolean; turnoRetomadaId?: string };

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
  /** ADR-046: arquivos que a pessoa mandou com esta mensagem (só metadados; bytes por rota própria). */
  anexos?: AnexoMeta[];
};
