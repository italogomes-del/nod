import type { AnexoMeta } from "./anexo.ts";
import type { PayloadLinhaLigacao } from "./ligacao.ts";
import type { Autoria } from "./evento.ts";
import type { IdHarness } from "./harness.ts";
import type { CausaSemIa } from "./inventario.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { OrigemTurno } from "./turno.ts";
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
  | "peer_ask"
  /** definido em 2026-09-28 (ADR-051, 0031): o card do artefato; o HTML vem por GET artefatos/:id. */
  | "artefato";

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
  /**
   * definido em 2026-10-03: `frase` (o pedido) e `texto` por item entram para a web desenhar o recibo compacto da
   * decisão sem reler o texto redigido; as mensagens gravadas antes não os têm.
   */
  | { kind: "resultado_aprovacao"; decisaoId: string; frase?: string; itens: { idx: number; desfecho: DesfechoItem; texto?: string }[] }
  /**
   * `causa` (definido em 2026-10-05): a IA estava logada e a conta não serviu (src/contracts/inventario.ts).
   * `modelo` (NOD-171): o harness está pronto, mas o modelo escolhido no agente não é aceito por ele; a tela pede outro
   * modelo em vez de dizer que a IA "já voltou".
   */
  | { kind: "negacao"; classe: "ferramenta_negada" | "conector_indisponivel" | "plano_ausente"; nome: string; motivo: MotivoNegacao; terminal: boolean; causa?: CausaSemIa; modelo?: string }
  /**
   * definido em 2026-10-05: o bot em "automático" passou a responder por outra IA porque a conta da primeira não
   * serviu. Linha de sistema, dita uma vez por troca; o turno que falhou foi repetido na outra IA.
   */
  | { kind: "ia_trocada"; de: IdHarness; para: IdHarness; causa: CausaSemIa }
  /**
   * NOD-171: o turno parou porque o plano da IA atingiu o limite de uso (motivo `limite_do_plano` do protocolo do Claude
   * Code, ou a classe `limite_de_uso` do texto do Codex). Vai no aviso "Turno interrompido" para a tela desenhar o card
   * com a hora LOCAL de `voltaEm` (o texto gravado traz a de São Paulo). `voltaEm` null: o fornecedor não disse quando.
   */
  | { kind: "limite_do_plano"; harness: IdHarness | null; voltaEm: EpochMs | null }
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
  | { kind: "resposta_a_pedido"; decisaoId: string; agenteId: string; perguntaEm: EpochMs; retomada: boolean; turnoRetomadaId?: string }
  /**
   * definido em 2026-09-25 (card de pasta simplificado): o registro de que a pessoa abriu uma pasta
   * para o agente. O card da proposta some ao permitir; esta linha fica na conversa ("acme aberta
   * para o Dev 1 · Trocar"). `onde` é a pasta-mãe relativa à pasta pessoal, quando a busca a deu.
   */
  | { kind: "pasta_aberta"; propostaId: string; agenteId: string; pasta: string; nome: string; onde?: string }
  /** definido em 2026-09-28 (ADR-051): só ids — o HTML (até 500 000 caracteres) não viaja com a conversa. */
  | { kind: "artefato"; artefatoId: string; versao: number; titulo: string }
  /** definido em 2026-10-04 (ADR-075): a linha "Chat de voz · mm:ss"; a transcrição vem por GET ligacoes/:id/falas. */
  | PayloadLinhaLigacao;

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
  /**
   * definido em 2026-10-07 (ADR-081, épico #188): de onde veio o turno que gravou a mensagem, para a web agrupar sem
   * adivinhar. `origemTurno`: a origem do turno (null = sem turno, como a fala da pessoa); `trabalhoId`: o trabalho do
   * turno (null = turno da conversa); `fimDoTurno`: é a última fala de um turno já encerrado — as outras falas desse
   * turno foram do meio (ADR-067). Ausentes = servidor anterior ao épico.
   */
  origemTurno?: OrigemTurno | null;
  trabalhoId?: string | null;
  fimDoTurno?: boolean;
};
