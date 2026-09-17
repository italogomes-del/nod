import type { Agente } from "../contracts/agente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export const gerirAgente: CasoDeUso<{ agenteId: string; acao: "organizar" | "excluir" | "restaurar"; secao?: string; naoLido?: boolean }, { agente: Agente }> = async (deps, input) => {
  const atual = await deps.repos.agentes.buscar(input.agenteId, true);
  if (!atual) throw new ErroDeDominio("nao_encontrado");
  if (atual.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  if (input.secao !== undefined && (typeof input.secao !== "string" || input.secao.trim().length > 60)) throw new ErroDeDominio("entrada_invalida");
  if (input.naoLido !== undefined && typeof input.naoLido !== "boolean") throw new ErroDeDominio("entrada_invalida");
  if (input.acao === "organizar" && input.secao === undefined && input.naoLido === undefined) throw new ErroDeDominio("entrada_invalida");
  const agora = deps.agora();
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(atual.id);
  const pendentes = input.acao === "excluir" ? (await deps.repos.turnos.pendentesDaPessoa()).filter((t) => t.agenteId === atual.id) : [];
  const agente = input.acao === "excluir" ? await deps.repos.agentes.excluir(atual.id, agora)
    : input.acao === "restaurar" ? await deps.repos.agentes.restaurar(atual.id)
    : await deps.repos.agentes.organizar(atual.id, { secao: input.secao?.trim(), naoLido: input.naoLido });
  if (!agente) throw new ErroDeDominio("estado_invalido");
  return { data: { agente }, events: [...pendentes.map((t) => evento(deps.escopo, { kind: "turno_interrompido", autoria: autoriaPessoa(deps.escopo), agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa" } })), evento(deps.escopo, { kind: "agente_atualizado", conversaId: conversa?.id ?? null, autoria: autoriaPessoa(deps.escopo), agora, dados: { agente_id: agente.id, acao: input.acao } })] };
};
