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

export type PedidoRenovar = {
  turnoId: string;
  machineId: string;
  sinais: SinaisTurno;
  eventos: RuntimeEvent[];
};

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
  renovar(p: PedidoRenovar): Promise<{ ativo: boolean; versaoMinimaApp: string }>;
  entregar(e: Entrega): Promise<void>;
  desconectar(machineId: string): Promise<void>;
}
