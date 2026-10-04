import type { IdHarness } from "./harness.ts";
import type { RuntimeEvent } from "./evento.ts";
import type { Inventario } from "./inventario.ts";
import type { MotivoPasse } from "./motivos.ts";
import type { PlanoTurno } from "./plano-turno.ts";
import type { ResultadoTurno, SinaisTurno, TarefaDoBot } from "./turno.ts";

/** A máquina se anuncia (ADR-021 conectar). */
export type AnuncioMaquina = {
  machineId: string;
  nome: string;
  inventario: Inventario;
  versaoContrato: number;
  harnesses?: Partial<Record<IdHarness, Inventario>>;
  /**
   * definido em 2026-09-24 (ADR-048): `gh auth status` NESTA máquina. O servidor só usa o gh para a
   * pessoa dona da chave desta máquina — o login do gh serve a quem o fez, nunca a um colega.
   */
  github?: { gh: boolean };
  /**
   * definido em 2026-10-04 (ADR-072): este app roda o laço de voz (abre o canal do cérebro da ligação). Ausente = app
   * antigo: o turno da ligação nunca vai para ele.
   */
  ligacao?: boolean;
};

/** Passe é CAMPO tipado, nunca regex sobre o texto do modelo (GRUPO.passe-tipado). */
export type FalaEntrega = { tipo: "texto"; texto: string } | { tipo: "passe"; motivo: MotivoPasse };

export type Entrega = {
  turnoId: string;
  machineId: string;
  /** Idempotência: UNIQUE (tenant_id, turno_id, seq_local) na 0002. */
  seqLocal: number;
  fala: FalaEntrega;
  resultado: ResultadoTurno;
};

/**
 * Uma volta do modelo numa sessão viva que não encerrou o turno (definido em 2026-10-01, ADR-067). `seq` sobe de 1 em
 * 1 por turno: o servidor grava cada uma uma vez só, mesmo que a renovação seja repetida.
 */
export type FalaIntermediaria = { seq: number; texto: string };
export type PedidoRenovar = {
  turnoId: string;
  machineId: string;
  sinais: SinaisTurno;
  eventos: RuntimeEvent[];
  /** ADR-067: falas da sessão viva ainda não confirmadas pelo servidor. */
  falas?: FalaIntermediaria[];
  /**
   * ADR-067: a sessão viva está com a entrada aberta. Só então o servidor absorve as mensagens novas da pessoa nesta
   * conversa e as devolve; sem isto elas esperam na fila, como antes.
   */
  aceitaMensagens?: boolean;
};
/** O que a renovação devolve. `mensagens`: as falas da pessoa que entraram neste turno vivo, na ordem (ADR-067). */
export type RespostaRenovar = { ativo: boolean; versaoMinimaApp: string; mensagens?: string[]; ligacaoEncerrada?: boolean };

/**
 * O que o app desktop viu do turno vivo desde a última renovação, NA ORDEM: texto do modelo e nomes
 * de ferramenta (nunca input/resultado). O servidor republica como turno.delta / turno.atividade.
 */
export type TrechoVivo = { texto: string } | { ferramenta: string } | { tarefas: TarefaDoBot[] };

/**
 * Os cinco verbos da ponte (ADR-021), faladas in-process nesta rodada. A ponte HTTP entra depois
 * sem trocar o driver. {ativo:false} em renovar manda o executor abortar.
 */
export interface PonteInterna {
  conectar(m: AnuncioMaquina): Promise<void>;
  puxar(pessoaId: string): Promise<PlanoTurno | null>;
  renovar(p: PedidoRenovar): Promise<RespostaRenovar>;
  entregar(e: Entrega): Promise<void>;
  desconectar(machineId: string): Promise<void>;
}
