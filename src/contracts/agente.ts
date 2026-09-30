import type { PreferenciaHarness } from "./harness.ts";
import type { EpochMs, TenantId } from "./ids.ts";

export const FORMAS_AGENTE = ["shape-square", "shape-hex", "shape-circle", "shape-pebble", "shape-capsule", "shape-triangle", "shape-cloud", "shape-drop"] as const;
export const CORES_AGENTE = ["c-red", "c-pink", "c-purple", "c-blue", "c-teal", "c-green", "c-orange", "c-black", "c-brown", "c-amber", "c-gray", "c-cream"] as const;

export type FormaAgente = (typeof FORMAS_AGENTE)[number];
export type CorAgente = (typeof CORES_AGENTE)[number];

/** Imutável após a criação (trigger nod_agente_dono_imutavel na 0002; erro `dono_imutavel`). */
export type DonoAgente = "pessoa" | "empresa";

export type Visibilidade = "privado" | "equipe";

/** Níveis do `--effort` do Claude Code, na ordem (medido no `--help` da 2.1.284). */
export const ESFORCOS_AGENTE = ["low", "medium", "high", "xhigh", "max"] as const;
export type EsforcoAgente = (typeof ESFORCOS_AGENTE)[number];

/**
 * Como o bot aprova as próprias ações (ADR-059, 0040): 'manual' pede a pessoa para o que muda algo; 'automatico'
 * aprova sozinho e para no arriscado, na credencial e no que vem depois de conteúdo de fora; 'total' aprova tudo,
 * menos o que toca credencial. Só a dona muda.
 */
export const MODOS_APROVACAO = ["manual", "automatico", "total"] as const;
export type ModoAprovacao = (typeof MODOS_APROVACAO)[number];

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
  harness?: PreferenciaHarness;
  /** O `--effort` do Claude Code (0037). Ausente ou null = o padrão do modelo. */
  esforco?: EsforcoAgente | null;
  /** ADR-059 (0040). Ausente = 'manual' (planos e fixtures anteriores ao modo). */
  modoAprovacao?: ModoAprovacao;
  /** Duplicate copia perfil, nunca memória nem histórico. */
  duplicadoDe: string | null;
  secao?: string;
  naoLido?: boolean;
  excluidoEm?: EpochMs | null;
  criadoEm: EpochMs;
};
