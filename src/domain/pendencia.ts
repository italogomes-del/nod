import type { Pendencia } from "../contracts/pendencia.ts";

/**
 * Pendências do bot (definido em 2026-09-30, ADR-064): regras puras. Os números são escolhas, não medições:
 * 20 abertas por bot já é mais do que uma pessoa lê numa lista; 10 no prompt cabem em ~3 mil caracteres com o
 * texto cortado em 300; 30 s bastam para o duplo clique no "Fazer agora" e não prendem um segundo pedido de
 * verdade.
 */
export const PENDENCIAS_ABERTAS_MAX = 20;
export const PENDENCIAS_NO_PROMPT = 10;
/** CHECK pendencia_texto da 0044 e maxLength do schema de anotar_pendencia. */
export const TEXTO_PENDENCIA_MAX = 500;
export const TEXTO_PENDENCIA_NO_PROMPT = 300;
export const REPEDIR_APOS_MS = 30_000;
/** a_partir_de mais longe que isto é erro de conta do modelo, não um lembrete. */
export const A_PARTIR_DE_MAX_MS = 366 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id que o modelo mandou tem a forma de um id de linha: fora dela, nem chega ao Postgres (22P02 viraria 500). */
export function idDePendenciaValido(id: string): boolean {
  return UUID.test(id);
}

/** "Na próxima rotina ou conversa": o que a ferramenta devolve quando a pendência não tem hora. */
export const APARECE_SEM_HORA = "na próxima rotina ou conversa";

/** Espaços colapsados e pontas limpas; é o texto que vai ao banco e à comparação. */
export function normalizarTexto(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/** A mesma pendência escrita de novo: igual depois de normalizar, sem diferença de maiúscula. */
export function mesmoTexto(a: string, b: string): boolean {
  return normalizarTexto(a).toLocaleLowerCase("pt-BR") === normalizarTexto(b).toLocaleLowerCase("pt-BR");
}

// Data e hora com fuso explícito (Z ou ±HH:MM): sem fuso, "16:20" do modelo seria 16:20 UTC para o servidor.
const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * O `a_partir_de` que o bot mandou. Vazio = sem hora; no passado = já vale (null); mais de um ano à frente ou sem
 * fuso = inválido, e a ferramenta devolve a instrução em vez de gravar uma hora errada.
 */
export function lerAPartirDe(valor: string | undefined, agora: number): { ok: true; em: number | null } | { ok: false } {
  if (valor === undefined || valor.trim() === "") return { ok: true, em: null };
  const texto = valor.trim();
  if (!ISO_COM_FUSO.test(texto)) return { ok: false };
  const em = Date.parse(texto);
  if (Number.isNaN(em)) return { ok: false };
  if (em <= agora) return { ok: true, em: null };
  if (em - agora > A_PARTIR_DE_MAX_MS) return { ok: false };
  return { ok: true, em };
}

/** Aberta e com a hora (se houver) já passada: é o que o bot vê no próximo turno. */
export function visivelAoBot(p: Pick<Pendencia, "estado" | "aPartirDe">, agora: number): boolean {
  return p.estado === "aberta" && (p.aPartirDe === null || p.aPartirDe <= agora);
}

/** As que entram no prompt: visíveis, da mais nova para a mais antiga, no máximo PENDENCIAS_NO_PROMPT. */
export function pendenciasDoPrompt(pendencias: readonly Pendencia[], agora: number): Pendencia[] {
  return pendencias
    .filter((p) => visivelAoBot(p, agora))
    .sort((a, b) => b.criadoEm - a.criadoEm || b.id.localeCompare(a.id))
    .slice(0, PENDENCIAS_NO_PROMPT);
}

/** A linha JSON de cada pendência no prompt: id, texto cortado, quando foi anotada e, se for o caso, o cuidado. */
export function pendenciaNoPrompt(p: Pendencia): { id: string; texto: string; anotada_em: string; cuidado?: true } {
  const texto = p.texto.length > TEXTO_PENDENCIA_NO_PROMPT ? `${p.texto.slice(0, TEXTO_PENDENCIA_NO_PROMPT - 1)}…` : p.texto;
  return { id: p.id, texto, anotada_em: new Date(p.criadoEm).toISOString(), ...(p.cuidado ? { cuidado: true as const } : {}) };
}
