import type { EpochMs, TenantId } from "./ids.ts";

export type FormaAgente = "shape-square" | "shape-hex" | "shape-circle";
export type CorAgente = "c-purple" | "c-black" | "c-pink" | "c-teal" | "c-blue" | "c-orange" | "c-green" | "c-red";

/** Imutável após a criação (trigger nod_agente_dono_imutavel na 0002; erro `dono_imutavel`). */
export type DonoAgente = "pessoa" | "empresa";

export type Visibilidade = "privado" | "equipe";

/**
 * Agente (bot). Nasce 'Novo agente' (EMENDA 17) e o modelo propõe o perfil por `atualizar_perfil`.
 * Sem `cwd` (EMENDA 11, ADR-014 literal): o driver cria um mkdtemp por turno e apaga no finally.
 */
export type Agente = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  nome: string;
  titulo: string;
  /** O que ele faz — prosa da pessoa ou proposta confirmada; vai no --append-system-prompt. */
  descricao: string;
  dono: DonoAgente;
  forma: FormaAgente;
  cor: CorAgente;
  /** Pin (Grok Bot). */
  fixado: boolean;
  /** Hide (Grok Bot). */
  oculto: boolean;
  /** Perfil confirmado pela pessoa (nada aplicado antes disso). */
  confirmado: boolean;
  modelo: string;
  /** Duplicate copia perfil, nunca memória nem histórico. */
  duplicadoDe: string | null;
  criadoEm: EpochMs;
};
