/**
 * Declaração TypeScript do que a 0003 cria para decisões e itens de aprovação, com nomes
 * IDÊNTICOS aos do banco (ADR-004 refinado): a policy PERMISSIVE adicional FOR UPDATE que deixa a
 * DECISORA designada (perna extra da EMENDA 1) marcar 'decidida' e marcar itens, e os triggers que
 * mantêm as pernas (owner_id/decisor_id; owner_id/decisao_id) imutáveis sob esse UPDATE.
 * tests/conformidade/gate-rls.ts aceita a policy por este nome; qualquer outra é acusada.
 */
export const DECISOES = {
  tabela: "decisoes",
  policyDecisora: "nod_decisora",
  trigger: "nod_decisao_pernas_imutaveis",
  funcao: "nod_decisao_pernas_imutaveis",
  itens: {
    tabela: "itens_aprovacao",
    policyDecisora: "nod_decisora",
    trigger: "nod_item_aprovacao_pernas_imutaveis",
    funcao: "nod_item_aprovacao_pernas_imutaveis",
  },
} as const;
