import type { EpochMs, TenantId } from "./ids.ts";
import type { Profundidade } from "./turno.ts";

/** Uma pendência fica aberta até o bot concluir ou alguém (o bot ou a pessoa) descartar (ADR-064). */
export type EstadoPendencia = "aberta" | "feita" | "descartada";

/**
 * O que o bot deixou para depois (definido em 2026-09-30, ADR-064; 0044). É do bot e mora na conversa própria dele.
 * Sem alarme: `aPartirDe` só decide quando ela passa a aparecer para o bot, no próximo turno que a pessoa ou uma
 * rotina abrir.
 */
export type Pendencia = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  conversaId: string;
  /** O turno que a anotou (null se o turno foi apagado). */
  turnoId: string | null;
  texto: string;
  aPartirDe: EpochMs | null;
  /** Anotada num turno que leu conteúdo de fora ou teve entrada não confiável: o bot confere na fonte antes de agir. */
  cuidado: boolean;
  /** Profundidade do turno que anotou: 3 é o limite da corrente de colegas (ADR-063). */
  profundidade: Profundidade;
  estado: EstadoPendencia;
  resolvidaEm: EpochMs | null;
  resolvidaPor: "bot" | "pessoa" | null;
  /** Como o bot fez, ou por que descartou. */
  motivo: string | null;
  /** O último "Fazer agora" da pessoa: segura o duplo clique. */
  pedidaEm: EpochMs | null;
  criadoEm: EpochMs;
};

/** GET agentes/:id/pendencias: as abertas do bot, da mais nova para a mais antiga. */
export type RespostaPendencias = { pendencias: Pendencia[] };
