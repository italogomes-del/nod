import type { PreferenciaHarness } from "./harness.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { CausaSemIa } from "./inventario.ts";
import type { Confianca } from "./mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoSemNovidade } from "./motivos.ts";
import type { CatalogoDeComandos } from "./comandos.ts";
import type { ExecucaoRaioX } from "./raio-x.ts";
import type { UsoDoPlano } from "./uso-do-plano.ts";

/**
 * Os quatro sinais write-ahead (ADR-009) — definição ÚNICA, usada pelo turno, pelo SPI e pela ponte.
 * promptSubmitted é gravado ANTES de escrever no stdin do CLI; viajam a cada renovação de lease.
 */
export type SinaisTurno = {
  attempted: boolean;
  rejected: boolean;
  promptSubmitted: boolean;
  producedOutput: boolean;
};

/** Quatro estados (ADR-010 revisado); 'interrompido' exige motivo (CHECK na 0002). */
export type EstadoTurno = "pendente" | "despachando" | "concluido" | "interrompido";

/**
 * 'delegacao' (definido em 2026-09-24, ADR-047; revisto em 2026-09-29, ADR-058): o turno de quem cumpre um
 * pedido de colega (pedir_a_bot), com os acessos dele. 'peer' é legado: o turno de quem respondia a
 * perguntar_a_bot, que saiu na ADR-058; nenhum turno novo nasce com ele.
 */
export type OrigemTurno = "conversa" | "sala" | "rotina" | "retomada" | "peer" | "delegacao" | "ligacao";

/**
 * Profundidade estrutural (E12.4; revisto em 2026-09-30, ADR-063): quantos passes seguidos entre bots este fio já
 * teve. 0 = o trabalho começou por uma pessoa ou por uma rotina; cada pedido a colega e cada resposta que volta
 * somam 1. Em PROFUNDIDADE_MAXIMA (src/domain/profundidade.ts) o salto some.
 */
export type Profundidade = 0 | 1 | 2 | 3;

export type Turno = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  agenteId: string;
  ownerId: string;
  origem: OrigemTurno;
  estado: EstadoTurno;
  sinais: SinaisTurno;
  machineId: string | null;
  leaseAte: EpochMs | null;
  /** Prazo de PRODUTO (relógio de decisão), distinto do lease curto. */
  prazoEm: EpochMs;
  motivoInterrupcao: MotivoInterrupcao | null;
  motivoFalha: MotivoFalha | null;
  /**
   * O agente chamou `sem_novidade` neste turno (definido em 2026-09-21): consultou a fonte e nada
   * mudou. null = não pediu silêncio. Quando presente, o assentamento NÃO escreve a fala na
   * conversa e a rotina registra desfecho 'sem_novidade' sem marcador. Motivo TIPADO, nunca
   * inferido do texto (Regra 9).
   */
  semNovidadeMotivo: MotivoSemNovidade | null;
  /** Retomar = turno NOVO apontando para o interrompido (ADR-009/010: nunca requeue). */
  retomaTurnoId: string | null;
  profundidade: Profundidade;
  reenvios: number;
  pararSolicitadoEm: EpochMs | null;
  entradaTexto: string;
  /** ADR-046: ids dos anexos que entraram neste turno (vazio na maioria). */
  entradaAnexos: readonly string[];
  entradaConfianca: Confianca;
  custoUsd: number | null;
  modelo: string;
  harness?: PreferenciaHarness;
  criadoEm: EpochMs;
  /** Fala da pessoa que disparou o turno (0024). Não é `mensagens.turno_id`, que é a fala que o turno produziu. */
  mensagemOrigemId?: string | null;
  /** Turno que respondeu por este, quando ele foi lido junto com outro (motivo 'absorvido'). */
  absorvidoPor?: string | null;
  trabalhoId?: string | null; // ADR-081: o trabalho deste turno; null = turno da conversa
  /**
   * Pessoa que PEDIU o trabalho (0028, ADR-047/ADR-025). Preenchido só no turno de delegação: a autoria do
   * plano sai com `sob_procuracao_de` dela. Ausente/null = a pessoa falou direto, ou ninguém pediu.
   */
  sobProcuracaoDe?: string | null;
  /** definido em 2026-10-04 (ADR-072): a ligação deste turno (o turno-cérebro e o trabalho pedido durante ela). */
  ligacaoId?: string | null;
};

export type TokensTurno = {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheCriacao: number;
};

/** O que o executor devolve ao fim do turno; o servidor assenta (ADR-012/021). */
export type ResultadoTurno = {
  desfecho: "sucesso" | "falha" | "interrompido";
  /** Preenchido pelo domínio só quando o protocolo o determina; parado_pela_pessoa vs sem_progresso é decisão do servidor. */
  motivoInterrupcao?: MotivoInterrupcao;
  motivoFalha?: MotivoFalha;
  texto: string;
  sessaoCli: string | null;
  sinais: SinaisTurno;
  custoUsd: number | null;
  tokens: TokensTurno;
  ferramentasChamadas: string[];
  /** result.permission_denials[].tool_name: negação de permissão NÃO é erro no CLI (s4b). */
  negacoesPermissao: string[];
  /** Motivo cru da falha, só para diagnóstico em log (0005: antes o `erro_execucao` chegava sem causa). */
  erroCru?: string | null;
  /**
   * definido em 2026-10-05: o turno falhou porque a CONTA da IA não serve (logada e sem acesso). O servidor marca essa
   * IA como fora para a pessoa e, no bot em automático, repete o pedido na outra IA pronta (src/contracts/inventario.ts).
   */
  causaSemIa?: CausaSemIa;
  /** Modo dev (0036): cada chamada à API e as compactações do turno. Ausente no Codex e no catcher. */
  execucao?: ExecucaoRaioX;
  /** O "/" do chat (0038): o catálogo do Mac, só quando mudou desde a última entrega deste app. */
  comandos?: CatalogoDeComandos;
  /** NOD-179: o uso do plano que o CLI informou no turno (último `rate_limit`). Ausente quando o CLI não informou. */
  usoDoPlano?: UsoDoPlano;
  /** NOD-171: com `motivoFalha` `limite_do_plano`, quando o plano volta a funcionar (epoch ms); `null` se o CLI não disse. */
  limiteVoltaEm?: number | null;
};

/** Lista de tarefas do bot (TaskCreate/TaskUpdate do Claude Code), no cartão de atividade (domain/tarefas-do-bot.ts). */
export const ESTADOS_DA_TAREFA = ["pendente", "andamento", "feita"] as const;
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number];
export type TarefaDoBot = { id: string; titulo: string; estado: EstadoDaTarefa };

/**
 * Evento já interpretado de uma linha do `--output-format stream-json` (mapa-cli 2026-09-16).
 * Tipos/subtipos desconhecidos viram 'ignorado' em vez de falhar o parser.
 */
export type EventoStream =
  /** `sessaoCli` é null só no catcher (0005): ele não abre sessão real, e o classificador não pode promover um marcador a --resume. */
  | {
      tipo: "init";
      sessaoCli: string | null;
      ferramentas: string[];
      modelo: string;
      versaoCli: string;
      apiKeySource: string;
      /** O "/" do chat (definido em 2026-09-28): o que o CLI carregou. Ausentes no Codex e no catcher. */
      skills?: string[];
      comandos?: string[];
      comandosSoDoTerminal?: string[];
      plugins?: { nome: string; caminho: string }[];
    }
  | { tipo: "delta"; texto: string }
  /**
   * Bloco de texto COMPLETO de uma mensagem do assistente (definido em 2026-09-28). Só compõe a fala no
   * fim do turno (classificarResultado); o texto ao vivo continua saindo dos `delta`, e ninguém publica
   * este evento — republicá-lo duplicaria o texto no cartão de atividade.
   */
  | { tipo: "texto_bloco"; texto: string }
  | { tipo: "tool_use"; id: string; nome: string; input: unknown }
  | { tipo: "tool_result"; toolUseId: string; isError: boolean; texto: string }
  /**
   * Fim de uma chamada à API (`stream_event` message_delta, definido em 2026-09-28 para o modo dev): o usage
   * DAQUELA chamada. O `usage` do `result` soma o turno inteiro e não mostra o contexto de cada chamada.
   */
  | { tipo: "chamada"; entrada: number; cacheLido: number; cacheNovo: number; saida: number; pensamento: number; subagente: boolean }
  /** `system/compact_boundary`: o Claude Code resumiu o histórico no meio do turno. Tokens antes/depois quando vierem. */
  | { tipo: "compactacao"; antes: number | null; depois: number | null; gatilho: string }
  | {
      tipo: "result";
      sucesso: boolean;
      subtype: string;
      sessaoCli: string | null;
      texto: string;
      custoUsd: number | null;
      tokens: TokensTurno;
      numTurnos: number;
      /** Maior `modelUsage[*].contextWindow` (modo dev): o teto contra o qual o contexto de cada chamada é medido. Ausente no Codex e no catcher. */
      janela?: number | null;
      negacoesPermissao: string[];
      /** Texto cru do CLI quando `sucesso` é false (subtype/result/error): vai ao log, nunca à pessoa (ADR-002). */
      erroCru: string | null;
    }
  /** NOD-179: `renova*Em` é o `resetsAt` de cada janela, em epoch ms (`null` se inválido); NOD-171: `voltaEm`, o da janela que barrou. */
  | { tipo: "rate_limit"; status: string; utilizacaoCincoHoras: number | null; utilizacaoSeteDias: number | null; renovaCincoHorasEm: number | null; renovaSeteDiasEm: number | null; voltaEm?: number | null; usandoOverage?: boolean }
  /**
   * Comando em segundo plano do Claude Code (definido em 2026-10-01, ADR-067): `Bash` com run_in_background ou um
   * `Monitor`. Enquanto um estiver "iniciada", a sessão viva não fecha: quando ele termina, o CLI chama o modelo de
   * novo sozinho. Medido no 2.1.286: `system/task_started` (is_backgrounded) abre; `task_updated` com status final
   * ou `task_notification` fecha.
   */
  | { tipo: "tarefa_fundo"; id: string; estado: "iniciada" | "terminada" }
  | { tipo: "ignorado"; razao: "linha_vazia" | "json_invalido" | "tipo_desconhecido" | "sintetico"; tipoBruto: string | null }
  /** Passo do driver catcher (Práticas §11): `subtipo` snake_case (CHECK catcher_registros_tipo); o servidor persiste em catcher_registros. */
  | { tipo: "catcher"; subtipo: string; dados: Record<string, unknown> };

/** Resultado de Parar (E5.4), sempre renderizado — inclusive quando nada rodava. */
export type FaixaParada = {
  interrompidas: number;
  naoInterrompidas: { turnoId: string; motivo: string }[];
  jaEntregues: { id: string; em: EpochMs }[];
  nadaRodando: boolean; trabalhosParados?: { id: string; titulo: string }[]; // ADR-081: as tasks que este Parar parou
};
