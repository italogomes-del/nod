import type { IsoUtc, TenantId } from "./ids.ts";

/** pergunta ≠ permissão (EMENDA 16): args malformados de pedir_a_pessoa viram 'pergunta', nunca 'permissao'. */
export type TipoDecisao =
  | "aprovacao"
  | "acesso"
  | "retomar_turno"
  | "gate_rotina"
  | "perfil"
  | "rotina"
  | "rotina_atualizacao"
  | "rotina_exclusao"
  | "pergunta"
  | "falta_de_dado"
  | "permissao";

export type EstadoDecisao = "pendente" | "decidida" | "vencida" | "reaberta";

export type DesfechoDecisao =
  | { tipo: "decidida"; por: string; em: IsoUtc }
  | { tipo: "expirou_sem_ninguem_ver"; em: IsoUtc }
  | { tipo: "expirou_com_alguem_ciente"; em: IsoUtc };

/**
 * Pendência em "Sua vez" (ADR-007). Instantes em ISO UTC: o servidor manda absoluto, o cliente
 * interpola. decisorId é a perna extra da RLS (EMENDA 1): o decisor designado vê sem ser dono.
 */
export type Decisao = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  decisorId: string;
  agenteId: string;
  conversaId: string;
  turnoId: string | null;
  tipo: TipoDecisao;
  estado: EstadoDecisao;
  /** Relógio de DECISÃO (parede). */
  prazoDecisaoEm: IsoUtc;
  /** Relógio de EXECUÇÃO (conta trabalho), separado por nome (ADR-007). */
  prazoExecucaoEm: IsoUtc | null;
  frase: string;
  desfecho: DesfechoDecisao | null;
  vistaEm: IsoUtc | null;
  criadoEm: IsoUtc;
};

export type EstadoColunaFila = "pendente" | "vencido" | "reaberto";

/** Item renderizável de "Sua vez": vencido em cinza, nunca suprimido. */
export type ItemFila = {
  decisao: Decisao;
  estadoColuna: EstadoColunaFila;
  agenteNome: string;
  aguardandoHaMs: number;
  recusaAutomaticaEmMs: number;
};
