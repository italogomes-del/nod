import type { PayloadPropostaPerfil } from "../contracts/conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import type { UseCasesNod } from "./tipos.ts";

function opcional(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "") throw new ErroDeDominio("entrada_invalida", { cause: "campo de perfil" });
  return v.trim();
}

/**
 * Ferramenta nod `atualizar_perfil` (EMENDA 5, E1.1): o modelo PROPÕE nome/título/descrição; nada
 * muda no agente antes de confirmarProposta pela pessoa. Vira Proposta kind 'perfil' + evento
 * proposta_criada (a web renderiza o cartão a partir da Proposta, nunca do texto).
 */
export const atualizarPerfil: UseCasesNod["atualizarPerfil"] = async (deps, input) => {
  const payload: PayloadPropostaPerfil = { kind: "perfil" };
  const nome = opcional(input.nome);
  const titulo = opcional(input.titulo);
  const descricao = opcional(input.descricao);
  if (nome !== undefined) payload.nome = nome;
  if (titulo !== undefined) payload.titulo = titulo;
  if (descricao !== undefined) payload.descricao = descricao;
  if (nome === undefined && titulo === undefined && descricao === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "proposta vazia" });

  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  return {
    data: { proposta_id: proposta.id },
    events: [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "perfil", agente_id: input.agenteId } })],
  };
};
