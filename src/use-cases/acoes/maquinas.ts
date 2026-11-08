import type { IdAcao } from "../../domain/acoes/index.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { CasoDeUso, Deps } from "../tipos.ts";

/**
 * Os executores únicos das máquinas (definido em 2026-11-07, ADA-243, ADR-135): a rota da tela (PUT /maquinas/padrao,
 * usada pelo seletor "Máquina padrão" e pela tela "Onde os bots trabalham") e o gerir_maquinas de QUALQUER bot chamam a
 * MESMA função, e o teste de contrato (tests/integration/paridade-maquinas.test.ts) leva os dois ao mesmo padraoId.
 */

/**
 * A chave viva da pessoa que pode ser padrão: não revogada e não só-computador (NOD-94). Fora disso, nao_encontrado
 * (a chave revogada some da lista; o só-computador nunca roda bot).
 */
export async function exigirChaveViva(d: Pick<Deps, "repos">, id: unknown): Promise<string> {
  if (typeof id !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "máquina" });
  const viva = (await d.repos.maquinaTokens.listar()).find((c) => c.id === id && c.revogadaEm === null && c.papel !== "computador");
  if (!viva) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
  return viva.id;
}

/** `maquinaId: null` = qualquer uma (tira a padrão). Vale a última gravação (on conflict do update). */
export const definirMaquinaPadrao: CasoDeUso<{ maquinaId: unknown }, { padraoId: string | null }> = async (deps, input) => {
  const id = input.maquinaId === null ? null : await exigirChaveViva(deps, input.maquinaId);
  const r = await deps.repos.preferencias.definirMaquinaPadrao(id);
  return { data: { padraoId: r.maquinaPadraoId ?? null } };
};

export const EXECUTORES_MAQUINAS = {
  "maquinas.definir_padrao": definirMaquinaPadrao,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
