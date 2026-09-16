import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca } from "./mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "./motivos.ts";

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
  /** Retomar = turno NOVO apontando para o interrompido (ADR-009/010: nunca requeue). */
  retomaTurnoId: string | null;
  profundidade: Profundidade;
  reenvios: number;
  pararSolicitadoEm: EpochMs | null;
  entradaTexto: string;
  entradaConfianca: Confianca;
  custoUsd: number | null;
  modelo: string;
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
};

/**
 * Evento já interpretado de uma linha do `--output-format stream-json` (mapa-cli 2026-09-16).
 * Tipos/subtipos desconhecidos viram 'ignorado' em vez de falhar o parser.
 */
export type EventoStream =
  | { tipo: "init"; sessaoCli: string; ferramentas: string[]; modelo: string; versaoCli: string; apiKeySource: string }
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
    }
  | { tipo: "rate_limit"; status: string; utilizacaoCincoHoras: number | null; utilizacaoSeteDias: number | null }
  | { tipo: "ignorado"; razao: "linha_vazia" | "json_invalido" | "tipo_desconhecido"; tipoBruto: string | null };

/** Resultado de Parar (E5.4), sempre renderizado — inclusive quando nada rodava. */
export type FaixaParada = {
  interrompidas: number;
  naoInterrompidas: { turnoId: string; motivo: string }[];
  jaEntregues: { id: string; em: EpochMs }[];
  nadaRodando: boolean;
};
