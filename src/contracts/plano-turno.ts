import type { AnexoMeta } from "./anexo.ts";
import type { EsforcoAgente, ModoAprovacao } from "./agente.ts";
import type { IdHarness } from "./harness.ts";
import type { Autoria, Executor } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca } from "./mensagem.ts";
import type { Profundidade } from "./turno.ts";
import type { JsonSchema } from "./ferramentas-nod.ts";
import type { TransporteConector } from "./conector.ts";

/** Modo do turno decide quais ferramentas nod entram no catálogo (src/domain/plano-turno.ts). */
export type ModoTurno = "criacao" | "conversa" | "sala" | "rotina" | "peer" | "delegacao";

export type FerramentaPlano = {
  /** 'lembrar' | 'exemplo__enviar_email' (conector = `${slug}__${tool}`). */
  nome: string;
  /** Nome que o CLI enxerga: mcp__nod__<nome> (--allowedTools exato, mapa-cli). */
  nomeMcp: `mcp__nod__${string}`;
  /** "proxy" (2026-09-28): atendida pelo próprio proxy do turno, sem ida ao servidor — hoje só `ler_mais`. */
  origem: "nod" | "conector" | "computador" | "workspace" | "proxy";
  conectorId: string | null;
  /** Capturado na DESCOBERTA (sonda), nunca em tempo de chamada (ADR-013). */
  readOnlyHint: boolean;
  tocaAprendiz: boolean;
  schema: JsonSchema;
  /**
   * definido em 2026-09-24 (ADR-048): "maquina" = a ferramenta roda NA MÁQUINA do turno (o gh logado
   * no Mac da dona do conector). O servidor decide tudo (parada, concessão, schema, trilha) e devolve
   * `executarLocal`; o proxy executa. Ausente = o servidor executa, como sempre.
   */
  execucao?: "maquina";
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
  /**
   * definido em 2026-09-28: ferramentas nativas do harness liberadas neste turno (`nativasDoTurno`). O prompt
   * e o driver leem daqui — antes o prompt sempre dizia "Não há Read…" mesmo com elas ligadas. Ausente
   * (plano de servidor antigo) = o driver cai na regra anterior (nativas de arquivo quando há pasta).
   */
  nativas?: readonly string[];
  /**
   * definido em 2026-09-28 (ADR-052): o nome da pasta do bot no Mac da pessoa, `~/nod/<pastaDoBot>`. Presente
   * só quando o turno tem o kit do terminal; o driver a cria e a usa como diretório do turno.
   */
  pastaDoBot?: string;
  superficie: "maquina_da_pessoa";
  decididoPor: `regra:${string}`;
  autoria: Autoria;
  confiancaEntrada: Confianca;
  profundidade: Profundidade;
  catalogo: { ferramentas: FerramentaPlano[]; servidores: ServidorPlano[] };
  promptSistema: string;
  /**
   * `anexos` (ADR-046): metadados dos arquivos da mensagem deste turno; o driver baixa os bytes em
   * GET interno/anexos/:id com o token do turno. Ausente = nenhum (planos antigos e a maioria dos turnos).
   */
  entrada: { texto: string; sessaoCli: string | null; modelo: string; anexos?: AnexoMeta[]; esforco?: EsforcoAgente };
  /**
   * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram o gate da rotina
   * (`efeitoExternoSoPorAprovacao`, EMENDA 15) e a trava herdada (ADR-058/059). Quem decide quando o bot para e
   * pergunta é só o modo de aprovação, igual em toda origem de turno.
   */
  politicaExecucao: {
    prazoMs: number;
    orcamentoResultadoChars: number;
  };
  /**
   * ADR-059: o modo de aprovação do agente NA EMISSÃO, para o prompt e o Raio-X. Quem decide cada pedido lê o modo
   * ATUAL do agente (trocar vale na próxima ação); este campo só diz ao modelo como o turno começou. Ausente = 'manual'.
   */
  modoAprovacao?: ModoAprovacao;
  /**
   * definido em 2026-09-30 (ADR-059, emenda): o modo do TURNO. Conversa e criação = a pessoa está falando com o bot;
   * no automático, apagar num app e merge que ela pediu ali saem sem card. Ausente (plano antigo) = não é conversa.
   */
  modoTurno?: ModoTurno;
  /**
   * definido em 2026-09-21 (ADR-042): ferramentas que a PESSOA marcou como "sempre permitir",
   * resolvidas no PUXAR e embarcadas aqui — a avaliação é LOCAL, nunca consulta por chamada
   * (ADR-013). Nomes no mesmo namespace de `FerramentaPlano.nome` (`${slug}__${tool}`), e sempre
   * um SUBCONJUNTO do catálogo deste plano: a regra evita a pergunta, nunca amplia alcance.
   * VAZIA em turno com entrada não confiável (ADR-026 + ADR-042 claim 6).
   */
  semprePermitir: readonly string[];
  tokenDeTurno: string;
  expiraEm: EpochMs;
};
