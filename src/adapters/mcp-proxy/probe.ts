import type { CapacidadeConector, TransporteConector } from "../../contracts/conector.ts";
import type { JsonSchema } from "../../contracts/ferramentas-nod.ts";
import type { ResultadoSonda } from "../../contracts/servicos.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { log } from "../../obs/log.ts";
import { PROBE_MS } from "../../shared/constantes.ts";
import { criarClienteMcp, ErroTransporteMcp, type FerramentaDescoberta } from "./cliente-mcp.ts";

/**
 * Sonda de conector (ADR-013): descobre o catálogo por tools/list e captura readOnlyHint AQUI, na
 * DESCOBERTA — nunca em tempo de chamada. Roda no servidor com ambiente de REGIME SERVIDOR
 * (allowlist, ADR-015 B) mais o env decifrado do conector; stderr só vai ao log (cliente-mcp).
 * Teto PROBE_MS (definido em 2026-09-16, src/shared/constantes.ts).
 */
export type ConfigSonda = {
  nome: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  /** Env DECIFRADO do conector; mesclado sobre a allowlist do regime servidor. */
  env?: Record<string, string>;
};

export type OpcoesSonda = {
  timeoutMs?: number;
  /** Fonte do ambiente base (default process.env); injetável no teste. */
  ambiente?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
};

const TIPOS: readonly JsonSchema["type"][] = ["object", "string", "number", "integer", "boolean", "array"];

/** Reduz o inputSchema do conector ao subconjunto JsonSchema do nod (o que o proxy expõe e valida). */
export function paraJsonSchema(entrada: unknown): JsonSchema {
  const e = (typeof entrada === "object" && entrada !== null ? entrada : {}) as Record<string, unknown>;
  const tipo = TIPOS.find((t) => t === e.type) ?? "object";
  const saida: JsonSchema = { type: tipo };
  if (typeof e.description === "string") saida.description = e.description;
  if (typeof e.properties === "object" && e.properties !== null) {
    const props: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(e.properties as Record<string, unknown>)) props[k] = paraJsonSchema(v);
    saida.properties = props;
  }
  if (Array.isArray(e.required)) saida.required = e.required.filter((r): r is string => typeof r === "string");
  if (typeof e.additionalProperties === "boolean") saida.additionalProperties = e.additionalProperties;
  if (Array.isArray(e.enum)) saida.enum = e.enum.filter((x): x is string => typeof x === "string");
  if (typeof e.items === "object" && e.items !== null) saida.items = paraJsonSchema(e.items);
  if (typeof e.minLength === "number") saida.minLength = e.minLength;
  if (typeof e.minItems === "number") saida.minItems = e.minItems;
  return saida;
}

export function paraCapacidade(t: FerramentaDescoberta): CapacidadeConector {
  return {
    nome: t.name,
    descricao: typeof t.description === "string" ? t.description : "",
    schema: paraJsonSchema(t.inputSchema),
    // Ausente = NÃO é readOnly (default fechado): só a anotação explícita libera a ferramenta em turno não confiável (ADR-026).
    readOnlyHint: t.annotations?.readOnlyHint === true,
  };
}

export async function sondarConector(cfg: ConfigSonda, opcoes: OpcoesSonda = {}): Promise<ResultadoSonda> {
  const env = { ...montarAmbiente("servidor", opcoes.ambiente ?? process.env), ...(cfg.env ?? {}) };
  const cliente = criarClienteMcp({
    nome: cfg.nome,
    transporte: cfg.transporte,
    comando: cfg.comando ?? null,
    args: cfg.args ?? [],
    url: cfg.url ?? null,
    env,
    timeoutMs: opcoes.timeoutMs ?? PROBE_MS,
    fetchImpl: opcoes.fetchImpl,
  });
  try {
    const ferramentas = await cliente.listar();
    return { ok: true, ferramentas: ferramentas.map(paraCapacidade) };
  } catch (e) {
    const motivo = e instanceof ErroTransporteMcp ? e.motivo : "falha_tecnica";
    log("aviso", "sonda_conector_falhou", { conector: cfg.nome, motivo, erro: e instanceof Error ? e.name : "desconhecido" });
    return { ok: false, motivo };
  } finally {
    await cliente.fechar().catch(() => undefined);
  }
}
