import type { Memoria, TipoMemoria } from "../contracts/memoria.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

const TIPOS: readonly TipoMemoria[] = ["preferencia", "fato", "resumo"];

/** Memória editável pela pessoa (Grok Bot): listar, editar texto/tipo, apagar. Sempre pela dona (repositório filtra owner_id). */
export const listarMemorias: CasoDeUso<{ agenteId: string }, { memorias: Memoria[] }> = async (deps, input) => {
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  return { data: { memorias: await deps.repos.memorias.listarDoAgente(agente.id) } };
};

export const editarMemoria: CasoDeUso<{ memoriaId: string; texto?: string; tipo?: TipoMemoria }, { memoria: Memoria }> = async (deps, input) => {
  const campos: { texto?: string; tipo?: TipoMemoria } = {};
  if (input.texto !== undefined) {
    if (typeof input.texto !== "string" || input.texto.trim() === "") throw new ErroDeDominio("texto_vazio");
    campos.texto = input.texto.trim();
  }
  if (input.tipo !== undefined) {
    if (!TIPOS.includes(input.tipo)) throw new ErroDeDominio("entrada_invalida", { cause: "tipo" });
    campos.tipo = input.tipo;
  }
  if (campos.texto === undefined && campos.tipo === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "nada a editar" });
  const existente = await deps.repos.memorias.buscar(input.memoriaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const memoria = await deps.repos.memorias.atualizar(input.memoriaId, campos);
  if (!memoria) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  return {
    data: { memoria },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: memoria.agenteId, acao: "memoria_editada", memoria_id: memoria.id } })],
  };
};

export const apagarMemoria: CasoDeUso<{ memoriaId: string }, { apagada: true; agenteId: string }> = async (deps, input) => {
  const existente = await deps.repos.memorias.buscar(input.memoriaId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  const ok = await deps.repos.memorias.apagar(input.memoriaId);
  if (!ok) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  return {
    data: { apagada: true, agenteId: existente.agenteId },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: existente.agenteId, acao: "memoria_apagada", memoria_id: existente.id } })],
  };
};
