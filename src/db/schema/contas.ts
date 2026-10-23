/**
 * Declaração TypeScript do que a 0109 cria (NOD-345, ADR-124), com nomes IDÊNTICOS aos do banco.
 * tests/conformidade/contas.test.ts compara isto com o catálogo: um GRANT a mais vira teste vermelho.
 */
export const CONTAS = {
  funcao: "nod_criar_espaco_provisorio(text, text)",
  /** Os privilégios EXATOS do nod_app em cada tabela global da 0109 (sem RLS, exceção em gate-rls.ts). */
  privilegios: {
    contas: ["INSERT", "SELECT"],
    conta_pessoas: ["INSERT", "SELECT"],
    bootstrap_instalacoes: ["INSERT", "SELECT"],
    identidades_conta: ["INSERT", "SELECT", "UPDATE"],
    sessoes: ["INSERT", "SELECT", "UPDATE"],
    sessoes_corte: ["INSERT", "SELECT", "UPDATE"],
    codigos_conta: ["INSERT", "SELECT", "UPDATE"],
    entradas_conta: ["INSERT", "SELECT", "UPDATE"],
    pareamentos_conta: ["INSERT", "SELECT", "UPDATE"],
    limites_conta: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  } as Readonly<Record<string, readonly string[]>>,
  /** UPDATE só de coluna (has_table_privilege não o vê): nada além destas. */
  colunasAtualizaveis: { bootstrap_instalacoes: ["aposentada_em"] } as Readonly<Record<string, readonly string[]>>,
  todos: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
  executam: ["nod_app", "nod_dono"],
} as const;
