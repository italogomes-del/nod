import type { RotinaDto } from "../contracts/api.ts";
import type { ExecucaoRotina } from "../contracts/rotina.ts";
import { EXECUCOES_GUARDADAS } from "../shared/constantes.ts";
import { exigir } from "./apoio-l7.ts";
import type { CasoDeUso } from "./tipos.ts";

/** GET rotinas: o que a policy deixa ver, com a próxima execução calculada pelo servidor (ADR-011). */
export const listarRotinas: CasoDeUso<Record<string, never>, { rotinas: RotinaDto[] }> = async (deps) => {
  const rotinas = await deps.repos.rotinas.listar();
  return { data: { rotinas: rotinas.map((rotina) => ({ rotina, proximaExecucao: rotina.proximaExecucao })) } };
};

/** GET rotinas/:id/execucoes: as 20 mais recentes (Grok Bot), mais recente primeiro. */
export const listarExecucoes: CasoDeUso<{ rotinaId: string }, { execucoes: ExecucaoRotina[] }> = async (deps, input) => {
  exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  return { data: { execucoes: await deps.repos.rotinaExecucoes.listar(input.rotinaId, EXECUCOES_GUARDADAS) } };
};
