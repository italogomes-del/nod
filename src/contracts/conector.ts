export type SensibilidadeDeclarada = "toca" | "nao-toca" | "nao-declarou";

export type ClassificacaoOrigem = {
  conectorId: string;
  fonte: string;
  concessaoId: string;
  declaracao: SensibilidadeDeclarada;
  tocaDadoPessoal: boolean;
  versaoRegra: 1;
};

export type CapacidadeConector = {
  id: string;
  rotulo: string;
};

export type ConectorCatalogo = {
  id: string;
  nome: string;
  resumo: string;
  capacidades: readonly CapacidadeConector[];
  /** Sugestão de tela, nunca substitui a pergunta no ato da concessão (ADR-002). */
  sugestaoToca: boolean;
};

export type ConcessaoEstado = "proposta" | "conectada" | "revogada";

export type Concessao = {
  tenantId: string;
  id: string;
  agenteId: string;
  conectorId: string;
  estado: ConcessaoEstado;
  declaracao: SensibilidadeDeclarada;
  capacidadesLigadas: string[];
  criadoEm: number;
};
