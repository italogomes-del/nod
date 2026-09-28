import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * "Pode fazer e o resto desta tarefa" (definido em 2026-09-28, emenda da ADR-037). No caso da Ada, cada
 * passo no computador do bot pedia um clique: 9 aprovações para montar e abrir um HTML. O clique aprova a
 * ação do card E libera as próximas da MESMA tarefa — o turno raiz e as retomadas dele —, nunca de outra.
 * Não libera nada em turno não confiável (ADR-026) nem vence o gate de rotina (a checagem da ação faz isso:
 * fundo/computadores.ts); a liberação fica escrita na conversa.
 */
export const liberarComputadorNaTarefa: CasoDeUso<{ decisao: Decisao }, { liberado: boolean }> = async (deps, { decisao }) => {
  const nada = { data: { liberado: false } };
  if (decisao.tipo !== "aprovacao" || !decisao.turnoId) return nada;
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  if (!itens.some((i) => i.selecionado && i.destino.conector === "computador")) return nada;
  const turno = await deps.repos.turnos.buscar(decisao.turnoId);
  if (!turno || turno.entradaConfianca !== "confiavel") return nada;
  const raiz = await deps.repos.turnos.raizDaCadeia(turno.id);
  if (!raiz || !(await deps.repos.turnos.liberarComputador(raiz.id, deps.agora()))) return nada;
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const linha = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    autoria,
    kind: "sistema",
    texto: `${pessoa?.nome ?? "A pessoa"} liberou o computador do bot até o fim desta tarefa.`,
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = linha ? [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { mensagem_id: linha.id, kind: "sistema", decisao_id: decisao.id } })] : [];
  return { data: { liberado: true }, events };
};

/** A ação no computador deste turno já foi liberada para a tarefa inteira? */
export async function computadorLiberadoNaTarefa(deps: Pick<Deps, "repos">, turnoId: string): Promise<boolean> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  return raiz ? deps.repos.turnos.computadorLiberado(raiz.id) : false;
}
