/**
 * Declaração TypeScript do que a 0002 cria em agentes e nos enums de estado, com nomes IDÊNTICOS
 * aos do banco (ADR-004 refinado): tests/integration/repos/agentes-dono-imutavel.test.ts e
 * tests/conformidade/motivos-enum.test.ts leem daqui o que conferem no catálogo.
 */
export const AGENTES = {
  tabela: "agentes",
  trigger: "nod_agente_dono_imutavel",
  funcao: "nod_agente_dono_imutavel",
  /** Coluna STORED sem índice (ADR-008 revisado): só a configuração e a coluna são caras em base populada. */
  busca: { configuracao: "nod_pt", coluna: "search_tsv" },
} as const;

/** Enums de ESTADO (não de motivo) que a 0002 cria; os de motivo vivem em src/contracts/motivos.ts. */
export const ENUMS_DE_ESTADO = {
  estado_turno: ["pendente", "despachando", "concluido", "interrompido"],
  origem_turno: ["conversa", "sala", "rotina", "retomada", "peer", "delegacao"],
  confianca: ["confiavel", "nao_confiavel"],
  dono_agente: ["pessoa", "empresa"],
  politica_resposta: ["so_mencoes", "lead", "todos"],
  tipo_decisao: ["aprovacao", "acesso", "retomar_turno", "gate_rotina", "perfil", "rotina", "pergunta", "falta_de_dado", "permissao", "rotina_atualizacao", "rotina_exclusao"],
  estado_decisao: ["pendente", "decidida", "vencida", "reaberta"],
  kind_mensagem: ["texto", "sistema", "handoff", "passe", "consentimento", "rotina_execucao", "resultado_aprovacao", "negacao", "parada", "peer_ask"],
  memoria_tipo: ["preferencia", "fato", "resumo"],
  transporte_conector: ["stdio", "http"],
  declaracao_sensibilidade: ["toca", "nao-toca", "nao-declarou"],
  tipo_conversa: ["propria", "sala"],
  kind_proposta: ["perfil", "rotina", "acesso", "pasta", "rotina_atualizacao", "rotina_exclusao"],
  estado_proposta: ["pendente", "confirmada", "recusada"],
  estado_rotina: ["ativa", "pausada"],
  estado_inventario: ["ausente", "nao_autenticado", "pronto"],
} as const satisfies Record<string, readonly string[]>;
