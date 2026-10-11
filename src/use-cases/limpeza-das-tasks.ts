import type { PastaParaLimpar, RelatoLimpeza } from "../contracts/ponte.ts";
import { JANELA_DA_LIMPEZA_MS, pastaDeTask, quandoLimpar } from "../domain/limpeza-das-tasks.ts";
import type { Deps } from "./tipos.ts";

/**
 * As pastas de task que o Mac da pessoa pode limpar (definido em 2026-10-09, ADR-088). O servidor decide pelo banco
 * (src/domain/limpeza-das-tasks.ts); o Mac confere o disco e apaga só o que o git deixa apagar sem --force.
 */
export async function pastasParaLimpar(deps: Deps, o: { apertado?: boolean } = {}): Promise<PastaParaLimpar[]> {
  const agora = deps.agora();
  const candidatos = await deps.repos.trabalhos.candidatosALimpeza(agora - JANELA_DA_LIMPEZA_MS);
  return candidatos.flatMap((c) => {
    const quando = quandoLimpar(c, agora, { apertado: o.apertado === true });
    const pasta = pastaDeTask(c.pasta);
    return quando && pasta ? [{ trabalhoId: c.id, pasta, quando }] : [];
  });
}

const MOTIVOS: readonly (keyof RelatoLimpeza["puladas"])[] = ["suja", "travada", "montagem", "pr_nao_mergeado", "clone", "fora_da_pasta", "aninhado", "ignorado_valioso", "head_solto", "em_uso", "nao_reconfirmada", "erro"];
const inteiro = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : 0);

/**
 * O relato que veio do Mac, só com números conhecidos (a rota HTTP o recebe de fora). Campo estranho some; número
 * inválido vira 0. Nunca lança: o relato é só para o log.
 */
export function relatoValido(v: unknown): RelatoLimpeza {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const p = typeof o.puladas === "object" && o.puladas !== null ? (o.puladas as Record<string, unknown>) : {};
  const puladas: RelatoLimpeza["puladas"] = {};
  for (const m of MOTIVOS) if (inteiro(p[m]) > 0) puladas[m] = inteiro(p[m]);
  return {
    pastas: inteiro(o.pastas),
    removidas: inteiro(o.removidas),
    pastasApagadas: inteiro(o.pastasApagadas),
    liberadoBytes: inteiro(o.liberadoBytes),
    puladas,
    orfas: inteiro(o.orfas),
    orfasParadas: inteiro(o.orfasParadas),
    duracaoMs: inteiro(o.duracaoMs),
    ...(o.simulada === true ? { simulada: true, estimadoBytes: inteiro(o.estimadoBytes) } : {}),
    ...(o.adiada === true ? { adiada: true } : {}),
    ...(o.apertada === true ? { apertada: true, cachesBytes: inteiro(o.cachesBytes) } : {}),
  };
}

/** Os campos do log `limpeza_feita` (o log só aceita valor plano): um `pulada_<motivo>` por motivo que apareceu. */
export function camposDoRelato(r: RelatoLimpeza): Record<string, number> {
  const campos: Record<string, number> = {
    pastas: r.pastas,
    removidas: r.removidas,
    pastas_apagadas: r.pastasApagadas,
    liberado_mb: Math.round(r.liberadoBytes / 1_048_576),
    orfas: r.orfas,
    orfas_paradas: r.orfasParadas,
    duracao_ms: r.duracaoMs,
  };
  if (r.simulada) campos.estimado_mb = Math.round((r.estimadoBytes ?? 0) / 1_048_576);
  if (r.apertada) { campos.apertada = 1; campos.caches_mb = Math.round((r.cachesBytes ?? 0) / 1_048_576); }
  for (const [m, n] of Object.entries(r.puladas)) if (n) campos[`pulada_${m}`] = n;
  return campos;
}
