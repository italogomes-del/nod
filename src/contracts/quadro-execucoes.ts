/**
 * Os trabalhos de uma tarefa do quadro (definido em 2026-11-02, NOD-418): cada vez que a tarefa aciona o bot responsável
 * é um trabalho, com a cadeia de turnos dele (as retomadas). A tela mostra o trabalho atual na tarefa aberta (o log ao
 * vivo, a última frase do agente) e os anteriores recolhidos, e deixa repetir, cancelar e mandar recado. Só tipos.
 */

/** Por que o trabalho existe. */
export const ORIGENS_EXECUCAO = ["inicio", "resposta", "comentario", "repetir", "automatica", "recado"] as const;
export type OrigemExecucao = (typeof ORIGENS_EXECUCAO)[number];

export const ESTADOS_EXECUCAO = ["fila", "rodando", "concluido", "falhou", "cancelado"] as const;
export type EstadoExecucao = (typeof ESTADOS_EXECUCAO)[number];

/** O desfecho gravado quando o fim do trabalho é tratado: vale depois da poda dos turnos e diante do cancelamento por fora. */
export type DesfechoExecucao = "concluido" | "falhou" | "cancelado";

/** Como a falha é tratada: transitória repete sozinha; do agente bloqueia a tarefa; cancelada é da pessoa. */
export type ClasseFalha = "transitoria" | "do_agente" | "cancelada";

export type ExecucaoQuadro = {
  id: string;
  tarefaId: string;
  /** 1, 2, 3… na tarefa. */
  numero: number;
  origem: OrigemExecucao;
  /** O turno raiz da cadeia. */
  turnoId: string;
  /** O motivo da falha, em palavras, gravado quando o fim é tratado (sobrevive à poda dos turnos). */
  motivo: string | null;
  /** O desfecho gravado no tratamento (null = ainda não tratado, ou reaberto por uma retomada). */
  desfecho: DesfechoExecucao | null;
  canceladaEm: number | null;
  tratadaEm: number | null;
  /** A nova tentativa sozinha agendada (tratadaEm + INTERVALO_NOVA_TENTATIVA_MS): o varredor a abre quando passar. */
  novaTentativaEm: number | null;
  criadoEm: number;
};

/** O recado da pessoa pela tela da tarefa (ADR-083, emenda NOD-418). */
export type RecadoQuadro = {
  id: string;
  tarefaId: string;
  texto: string;
  /** Entrou na sessão viva do trabalho. */
  entregueEm: number | null;
  /** Virou (ou entrou no começo de) um trabalho novo. */
  execucaoId: string | null;
  /** O bot que repassou o pedido da pessoa feito na conversa (null = ela, pela tela). */
  repassadoPor: string | null;
  canceladoEm: number | null;
  criadoEm: number;
};

export type ExecucaoDto = Pick<ExecucaoQuadro, "id" | "numero" | "origem" | "turnoId" | "motivo" | "criadoEm"> & {
  estado: EstadoExecucao;
  /** O turno da cadeia que roda agora (a retomada): os frames ao vivo vêm dele. */
  turnoAtual: string;
  /** Quando a máquina pegou o trabalho (a duração ao vivo). null = ainda na fila. */
  comecouEm: number | null;
  /** A última frase do agente (o resumo, no concluído). Texto de fora: a tela escapa. */
  ultimaFrase: string | null;
  /** Nova tentativa automática: a posição dela (1 ou 2). */
  tentativa: number | null;
  /** A cadeia espera a pessoa ou um comando de fundo (decisão, aprovação, CI): não acabou, mas nada roda agora. */
  esperando: boolean;
  /** Revisão 5 do PR #625: a nova tentativa sozinha agendada depois da queda (null = nenhuma). */
  novaTentativaEm: number | null;
};

export type RecadoDto = Pick<RecadoQuadro, "id" | "texto" | "criadoEm"> & { entregue: boolean };

/** O que a tela lê na tarefa aberta (a mesma vista volta de Repetir, Cancelar e recado). */
export type ExecucoesDaTarefa = {
  /** Do mais recente ao primeiro. */
  execucoes: ExecucaoDto[];
  /** Os recados ainda não lidos pelo agente e o último lido (a nota "Leu seu recado"). */
  recados: RecadoDto[];
  /** A conversa onde o trabalho roda ("Ver na conversa"). */
  conversaId: string | null;
  /** Sem bot responsável: Repetir e recado desligados. */
  semAgente: boolean;
};

/** O recado tem o teto do comentário e da resposta da tarefa. */
export const RECADO_MAX = 4000;
/** Novas tentativas sozinhas seguidas, depois do trabalho que falhou (NOD-418: até 2). */
export const TENTATIVAS_AUTOMATICAS_MAX = 2;
/**
 * O intervalo mínimo entre o tratamento de uma queda e a nova tentativa sozinha. Definido em 2026-11-02 (revisão 4 do PR
 * #625): sem ele a nova tentativa saía na passada seguinte do varredor (30 s) e as duas tentativas queimavam numa queda
 * curta da máquina; 60 s cobre o reanúncio da máquina depois de um reinício do servidor (a espera de 10 s do app).
 */
export const INTERVALO_NOVA_TENTATIVA_MS = 60_000;

/**
 * O trabalho atual da tarefa como o bot o lê (revisão 4 do PR #625): o número, o estado, se a cadeia espera (a pessoa, o
 * CI) e, na falha, o motivo — cercado (ADR-047): é frase do servidor hoje, mas vai ao modelo como dado, não instrução.
 */
export type TrabalhoParaBot = {
  numero: number; estado: EstadoExecucao; esperando: boolean; motivo: string | null;
  /** Revisão 5 do PR #625: quando a nova tentativa sozinha abre (ISO; null = nenhuma agendada). */
  novaTentativaEm: string | null;
};
