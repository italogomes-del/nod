/**
 * Declaração TypeScript do que a 0002 cria para rotinas (ADR-011), com nomes IDÊNTICOS aos do
 * banco (ADR-004 refinado). Duas UNIQUE: reivindicação de janela e idempotência do varredor.
 */
export const ROTINAS = {
  tabela: "rotinas",
  check: {
    nome: "rotinas_fuso_iana",
    /** Rejeita '+03:00', 'UTC-3', 'GMT+3': só nome IANA com barra. Igual ao CHECK da 0002. */
    fragmento: "'^[A-Za-z_]+/[A-Za-z_/+-]+$'",
  },
  /** DEFAULT true na coluna: o gate nasce ligado por schema, nunca por texto (E7.3). */
  exigeAprovacaoDefault: true,
  janelas: { tabela: "rotina_janelas", unique: "rotina_janelas_unica" },
  execucoes: { tabela: "rotina_execucoes", check: "rotina_execucoes_motivo_sem_texto_livre" },
  varredor: { tabela: "decisao_eventos_varridos", unique: "decisao_eventos_varridos_unico" },
} as const;
