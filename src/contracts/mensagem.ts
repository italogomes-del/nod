import type { ContasNoLimite, IaComConta } from "./contas-ia.ts";
import type { AnexoMeta, TipoAnexo } from "./anexo.ts";
import type { PayloadLinhaLigacao } from "./ligacao.ts";
import type { Autoria } from "./evento.ts";
import type { IdHarness } from "./harness.ts";
import type { CAUSA_LIMITE, CausaSemIa } from "./inventario.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { CausaNativa } from "./negacao.ts";
import type { EstadoTrabalho, OrigemTrabalho } from "./trabalho.ts";
import type { ContaNoLimite, OrigemTurno } from "./turno.ts";
import type { PayloadTrocaDeIa } from "./troca-de-ia.ts";
import type { DesfechoItem, DesfechoRotina, MotivoFalhaComputador, MotivoNegacao, MotivoPasse } from "./motivos.ts";

/** Marca de confiança é propriedade do CONTEÚDO, nunca do nome da ferramenta (ADR-026). */
/**
 * definido em 2026-10-15 (NOD-257, H5): o pedido a colega parado na fila e o porquê. Não é gravado: `lerConversa` o põe
 * no payload do handoff na leitura (use-cases/fila-do-pedido.ts). `motivo` nulo = só na vez dele.
 */
export type FilaDoPedido = {
  desde: number;
  motivo: "depois_de" | "faixa_ocupada" | "condicao_da_maquina" | "agente_excluido" | "geracao_antiga" | null;
};

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
  /** `trabalhoId` (definido em 2026-10-07, ADR-083): o trabalho de quem RECEBEU o pedido; a linha "Enviou mensagem para…" abre a tela dele. */
  | { kind: "handoff"; de: string; para: string; motivo: string; tarefaId?: string; trabalhoId?: string; fila?: FilaDoPedido }
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
   * `causaNativa` e `vezes` (definido em 2026-10-11): por que o hook do nod barrou a nativa e quantas vezes no turno.
   * `ia` (NOD-220): o harness do turno que a IA recusou (plano_ausente). Só existe quando a recusa foi de uma IA; a do
   * executor (motor ausente, `nome` = motorDe: "claude-cli" no local, "catcher") não o grava. `nome` mistura os dois;
   * `ia` não. A web decide "já voltou" e nomeia a IA por `ia`; valor fora do catálogo da web não vale (nada se infere).
   * As negações gravadas antes não o têm: a web nunca conclui "já voltou" por inferência de outra IA.
   */
  | { kind: "negacao"; classe: "ferramenta_negada" | "conector_indisponivel" | "plano_ausente"; nome: string; motivo: MotivoNegacao; terminal: boolean; causa?: CausaSemIa; modelo?: string; causaNativa?: CausaNativa; vezes?: number; ia?: IdHarness; anexo?: TipoAnexo }
  /**
   * definido em 2026-10-05: o bot em "automático" passou a responder por outra IA porque a conta da primeira não
   * serviu. Linha de sistema, dita uma vez por troca; o turno que falhou foi repetido na outra IA.
   * revisto em 2026-10-10 (emenda da ADR-036): `causa: "limite"` = a primeira chegou ao limite da assinatura; `renovaEm`
   * diz quando ela volta a valer na ordem (a tela mostra a linha discreta "O Claude chegou ao limite · respondendo pelo
   * ChatGPT"). Nas outras causas, `renovaEm` não vem.
   */
  | { kind: "ia_trocada"; de: IdHarness; para: IdHarness; causa: CausaSemIa | typeof CAUSA_LIMITE; renovaEm?: EpochMs }
  /**
   * NOD-171: o turno parou porque o plano da IA atingiu o limite de uso (motivo `limite_do_plano` do protocolo do Claude
   * Code, ou a classe `limite_de_uso` do texto do Codex). Vai no aviso "Turno interrompido" para a tela desenhar o card
   * com a hora LOCAL de `voltaEm` (o texto gravado traz a de São Paulo). `voltaEm` null: o fornecedor não disse quando.
   */
  | { kind: "limite_do_plano"; harness: IdHarness | null; voltaEm: EpochMs | null; conta?: ContaNoLimite; contas?: ContasNoLimite }
  /**
   * definido em 2026-10-13 (ADR-102): a conta da lista bateu no limite e o turno seguiu noutra (a mesma IA, com "Trocar
   * sozinho", ou outra IA). A conta pelo apelido (o servidor guarda a lista).
   */
  | { kind: "conta_seguiu"; de: { id: string; apelido: string; ia: IaComConta }; para: { id: string; apelido: string; ia: IaComConta }; voltaEm: EpochMs | null }
  /**
   * definido em 2026-10-16 (ADR-108 R4/R6): a IA das tasks do bot chegou ao limite e elas esperam — o aviso com a
   * recomendação ("esperar" ou "levar") e, no bot fixo, os dois caminhos. Um por bot; aberto, é atualizado.
   */
  | PayloadTrocaDeIa
  /** ADR-102: a pessoa escolheu "Seguir com <conta>" e o turno foi refeito nela. */
  | { kind: "conta_escolhida"; contaId: string; apelido: string; ia: IaComConta }
  /**
   * NOD-302 (continuação da NOD-253): na conversa de onde saiu um pedido a colega, a linha de que ele espera na fila pela
   * cota da IA do colega, com a hora em que ela renova. Uma por turno do pedido (`turnoId`, o do colega).
   */
  | { kind: "pedido_na_fila_da_cota"; turnoId: string; agenteId: string; ia: IdHarness; voltaEm: EpochMs | null }
  /**
   * definido em 2026-10-12 (ADR-101 item 6): a conta em uso bateu no limite, "Trocar sozinho" estava ligado e o turno foi
   * refeito na conta `para`. Só posições; `foraDaTroca` são as contas livres que a troca pulou (corporativas não marcadas).
   */
  | { kind: "conta_trocada"; harness: IdHarness; de: number; para: number; voltaEm: EpochMs | null; foraDaTroca: number[] }
  | { kind: "parada"; interrompidas: number; nadaRodando: boolean }
  /**
   * `delegada` (ADR-047): resultado de tarefa delegada, não resposta a pergunta; o conteúdo segue não
   * confiável. `falhou`: aviso de que a tarefa não vai terminar (texto do servidor, não do alvo).
   */
  | { kind: "peer_ask"; agenteId: string; nome: string; naoSupervisionado: true; tarefaId: string; turnoOrigemId?: string; delegada?: true; falhou?: true; trabalhoId?: string }
  /** definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO de que o computador do bot saiu do ar. */
  | { kind: "computador_fora_do_ar"; agenteId: string; desde: EpochMs; motivo: MotivoFalhaComputador }
  /**
   * definido em 2026-09-24 (emenda da ADR-045): a fala do agente que É a pergunta de pedir_a_pessoa; `opcoes` são as
   * respostas prontas (pedido.ts), e o toque manda o texto da opção como a resposta. revisto em 2026-10-18 (plano "pergunta
   * com botões"): a web desenha um cartão com as opções A a D; `recomendada` é o índice da que o bot recomenda (0: a
   * normalização a põe em primeiro; payload antigo não tem); `ajudaDoComputador`: o pedido de ajuda do computador do bot,
   * que se responde com "Assumir controle", nunca com a mensagem digitada.
   */
  | { kind: "pedido_a_pessoa"; decisaoId: string; opcoes?: string[]; recomendada?: number; ajudaDoComputador?: true }
  /**
   * A resposta da pessoa, ligada à pergunta (responder-decisao.ts): `perguntaEm` rotula "respondendo à pergunta das HH:MM"
   * e `retomada` diz se um turno de retomada nasceu junto; `turnoRetomadaId` (2026-09-24, fio da pergunta) diz QUAL. `via`
   * (2026-10-18): "opcao" quando o texto É uma das opções (espaços e caixa não contam), com o índice em `opcao`; senão
   * "texto". Calculado no servidor, nunca vindo do corpo; sem balão da pergunta (sala esfriada) ou antes de 18/10, sem `via`.
   */
  | { kind: "resposta_a_pedido"; decisaoId: string; agenteId: string; perguntaEm: EpochMs; retomada: boolean; turnoRetomadaId?: string; via?: "opcao" | "texto"; opcao?: number }
  /**
   * definido em 2026-09-25 (card de pasta simplificado): o registro de que a pessoa abriu uma pasta
   * para o agente. O card da proposta some ao permitir; esta linha fica na conversa ("acme aberta
   * para o Dev 1 · Trocar"). `onde` é a pasta-mãe relativa à pasta pessoal, quando a busca a deu.
   */
  | { kind: "pasta_aberta"; propostaId: string; agenteId: string; pasta: string; nome: string; onde?: string }
  /** definido em 2026-09-28 (ADR-051): só ids — o HTML (até 500 000 caracteres) não viaja com a conversa. */
  | { kind: "artefato"; artefatoId: string; versao: number; titulo: string }
  /** definido em 2026-10-04 (ADR-075): a linha "Chat de voz · mm:ss"; a transcrição vem por GET ligacoes/:id/falas. */
  | PayloadLinhaLigacao
  /**
   * definido em 2026-10-07 (ADR-083): a linha centralizada "Abriu a task <titulo>" na conversa do bot. Mensagem
   * `sistema`; a web abre a tela do trabalho ao clicar.
   */
  | { kind: "trabalho_aberto"; trabalhoId: string; titulo: string; origem: OrigemTrabalho }
  /**
   * definido em 2026-10-12 (ADR-099, I2): a linha única "Começou N frentes: …" do lote que o dono abriu (abrir_frentes),
   * no lugar de uma "Abriu a task" por frente. Até a Parte 5 a web abre cada frente como task.
   */
  | { kind: "frentes_abertas"; loteId: string; origem: OrigemTrabalho; frentes: { trabalhoId: string; titulo: string }[] }
  /** definido em 2026-10-12 (ADR-099, I2): a cópia, na conversa do dono, do recado que ele repassou a uma frente. */
  | { kind: "recado_a_frente"; trabalhoId: string; titulo: string }
  /**
   * definido em 2026-10-12 (ADR-099, I3): a linha "3 frentes terminaram" (ou "A frente X terminou", com
   * `avisar_a_cada_uma`) na conversa do dono, quando o lote volta a ele.
   */
  | { kind: "frentes_terminadas"; loteId: string; frentes: { trabalhoId: string; titulo: string; estado: EstadoTrabalho }[] }
  /**
   * definido em 2026-10-12 (ADR-099, I3, decisão 7): o lote de um pedido de colega voltou direto a quem pediu — na
   * conversa do dono fica só a linha "Respondi ao pedido de X" (não confiável: o nome vem de outro bot).
   */
  | { kind: "pedido_respondido"; loteId: string; agenteId: string; nome: string };

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
   * definido em 2026-10-07 (ADR-083, épico #188): de onde veio o turno que gravou a mensagem, para a web agrupar sem
   * adivinhar. `origemTurno`: a origem do turno (null = sem turno, como a fala da pessoa); `trabalhoId`: o trabalho do
   * turno (null = turno da conversa); `fimDoTurno`: é a última fala de um turno já encerrado — as outras falas desse
   * turno foram do meio (ADR-067). Ausentes = servidor anterior ao épico.
   */
  origemTurno?: OrigemTurno | null;
  /**
   * definido em 2026-10-12 (ADR-099, I7 revista): o turno de uma retomada leva a raiz da cadeia dele (o turno que ela
   * continua, até 10 saltos). A execução de rotina e o pedido de colega não viram mais trabalho: sem a raiz, a resposta
   * da pessoa, a volta marcada e o retorno das frentes saíam da linha agrupada "da rotina" / "Pedido do …".
   */
  raiz?: { turnoId: string; origem: OrigemTurno };
  trabalhoId?: string | null;
  fimDoTurno?: boolean;
};
