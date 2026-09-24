import type { PreferenciaHarness } from "./harness.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca } from "./mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoSemNovidade } from "./motivos.ts";

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

export type OrigemTurno = "conversa" | "sala" | "rotina" | "retomada" | "peer";

/** Profundidade estrutural de peer: 0 = normal; 1 = respondendo a perguntar_a_bot, sem porta lateral (E12.4). */
export type Profundidade = 0 | 1;

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
  /** ADR-045: ids dos anexos que entraram neste turno (vazio na maioria). */
  entradaAnexos: readonly string[];
  entradaConfianca: Confianca;
  custoUsd: number | null;
  modelo: string;
  harness?: PreferenciaHarness;
  criadoEm: EpochMs;
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
};

/**
 * Evento já interpretado de uma linha do `--output-format stream-json` (mapa-cli 2026-09-16).
 * Tipos/subtipos desconhecidos viram 'ignorado' em vez de falhar o parser.
 */
export type EventoStream =
  /** `sessaoCli` é null só no catcher (0005): ele não abre sessão real, e o classificador não pode promover um marcador a --resume. */
  | { tipo: "init"; sessaoCli: string | null; ferramentas: string[]; modelo: string; versaoCli: string; apiKeySource: string }
  | { tipo: "delta"; texto: string }
  | { tipo: "tool_use"; id: string; nome: string; input: unknown }
  | { tipo: "tool_result"; toolUseId: string; isError: boolean; texto: string }
  | {
      tipo: "result";
      sucesso: boolean;
      subtype: string;
      sessaoCli: string | null;
      texto: string;
      custoUsd: number | null;
      tokens: TokensTurno;
      numTurnos: number;
      negacoesPermissao: string[];
      /** Texto cru do CLI quando `sucesso` é false (subtype/result/error): vai ao log, nunca à pessoa (ADR-002). */
      erroCru: string | null;
    }
  | { tipo: "rate_limit"; status: string; utilizacaoCincoHoras: number | null; utilizacaoSeteDias: number | null }
  | { tipo: "ignorado"; razao: "linha_vazia" | "json_invalido" | "tipo_desconhecido"; tipoBruto: string | null }
  /** Passo do driver catcher (Leapy §11): `subtipo` snake_case (CHECK catcher_registros_tipo); o servidor persiste em catcher_registros. */
  | { tipo: "catcher"; subtipo: string; dados: Record<string, unknown> };

/** Resultado de Parar (E5.4), sempre renderizado — inclusive quando nada rodava. */
export type FaixaParada = {
  interrompidas: number;
  naoInterrompidas: { turnoId: string; motivo: string }[];
  jaEntregues: { id: string; em: EpochMs }[];
  nadaRodando: boolean;
};
