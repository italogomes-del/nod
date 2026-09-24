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

/**
 * ABERTAS que a pessoa tira da tela sem responder (× / "Dispensar"; vencida de qualquer tipo sempre
 * sai). Os três de pedir_a_pessoa (#46: dispensar não é responder, EMENDA 16 intacta) e, definido em
 * 2026-09-24 (ADR-045), o "Retomar" de uma conversa que o Mac interrompeu. Usada pelo caso de uso e
 * pelo repositório; a web espelha num Record sobre este tipo (web/telas/sua-vez.ts).
 */
export const TIPOS_DISPENSAVEIS_ABERTOS = ["pergunta", "falta_de_dado", "permissao", "retomar_turno"] as const satisfies readonly TipoDecisao[];

export type DesfechoDecisao =
  | { tipo: "decidida"; por: string; em: IsoUtc }
  /**
   * ADR-042: resolvida por regra nomeada, sem pessoa. `por` NÃO existe aqui de propósito — quem
   * decidiu é a regra, e gravar um nome de pessoa seria inferir autoria de outro campo (ADR-023).
   * A coluna decidida_por (uuid) fica NULA; a regra e a versão vivem na autoria do evento.
   */
  | { tipo: "decidida_por_regra"; regra: `regra:${string}`; regraVersao: number; em: IsoUtc }
  | { tipo: "expirou_sem_ninguem_ver"; em: IsoUtc }
  | { tipo: "expirou_com_alguem_ciente"; em: IsoUtc }
  /**
   * definido em 2026-09-24: a pessoa tirou a decisão da tela com o ×, sem responder. `antes` guarda
   * de onde saiu (vencida ou ainda aberta) — ADR-007 continua valendo: o sistema nunca some com
   * nada sozinho; quem dispensa é a pessoa, e o registro fica.
   */
  | { tipo: "dispensada"; por: string; em: IsoUtc; antes: EstadoDecisao };

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
  /**
   * definido em 2026-09-24: ids dos pedidos ABERTOS iguais a este (mesma decisora, agente, conversa,
   * tipo e frase; só acesso e retomar_turno) que a fila dobrou nele — o mais antigo. A web mostra
   * "×N" e decidir este fecha as gêmeas por regra:gemea_resolvida. Vazio no caso comum.
   */
  gemeas: string[];
};
