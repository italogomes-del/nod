import type { IdHarness } from "./harness.ts";
import type { Autoria, Executor } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca } from "./mensagem.ts";
import type { Profundidade } from "./turno.ts";
import type { JsonSchema } from "./ferramentas-nod.ts";
import type { TransporteConector } from "./conector.ts";

/** Modo do turno decide quais ferramentas nod entram no catálogo (src/domain/plano-turno.ts). */
export type ModoTurno = "criacao" | "conversa" | "sala" | "rotina" | "peer";

export type FerramentaPlano = {
  /** 'lembrar' | 'exemplo__enviar_email' (conector = `${slug}__${tool}`). */
  nome: string;
  /** Nome que o CLI enxerga: mcp__nod__<nome> (--allowedTools exato, mapa-cli). */
  nomeMcp: `mcp__nod__${string}`;
  origem: "nod" | "conector" | "computador" | "workspace";
  conectorId: string | null;
  /** Capturado na DESCOBERTA (sonda), nunca em tempo de chamada (ADR-013). */
  readOnlyHint: boolean;
  tocaAprendiz: boolean;
  schema: JsonSchema;
};

export type ServidorPlano = {
  conectorId: string;
  nome: string;
  trust: "full" | "untrusted";
  transporte: TransporteConector;
};

/**
 * Plano de turno (ADR-024): emitido pelo servidor no PUXAR, único insumo do proxy MCP.
 * Sem cwd (EMENDA 11): o driver cria mkdtemp por turno. superficie tem UM valor (ADR-028).
 */
export type PlanoTurno = {
  tenantId: TenantId;
  turnoId: string;
  conversaId: string;
  agenteId: string;
  localidade: "local";
  machineId: string;
  executor: Executor;
  harness?: IdHarness;
  workspaceId?: string | null;
  /**
   * definido em 2026-09-18: onde o harness abre (pasta preparada do projeto ativo) e o que ele
   * alcança (todos os projetos aprovados nesta conversa). Ausente = nenhum projeto autorizado,
   * e o driver mantém o diretório temporário vazio com as ferramentas nativas desligadas.
   */
  workspacePastas?: { ativa: string; aprovadas: string[] } | null;
  superficie: "maquina_da_pessoa";
  decididoPor: `regra:${string}`;
  autoria: Autoria;
  confiancaEntrada: Confianca;
  profundidade: Profundidade;
  catalogo: { ferramentas: FerramentaPlano[]; servidores: ServidorPlano[] };
  promptSistema: string;
  entrada: { texto: string; sessaoCli: string | null; modelo: string };
  politicaExecucao: {
    prazoMs: number;
    orcamentoResultadoChars: number;
    /** EMENDA 15: rotina com exige_aprovacao só produz efeito externo via item aprovado. */
    efeitoExternoSoPorAprovacao: boolean;
  };
  tokenDeTurno: string;
  expiraEm: EpochMs;
};
