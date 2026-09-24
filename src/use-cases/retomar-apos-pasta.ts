import type { Proposta } from "../contracts/conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * definido em 2026-09-18: autorizar a pasta retoma a tarefa sozinha. Antes a pessoa clicava e ainda
 * precisava remandar a mensagem — o próprio agente dizia "depois me mande qualquer mensagem".
 * O turno de retomada é NOVO, então o plano nasce com o projeto já vinculado e o catálogo completo.
 */
export const retomarAposPasta: CasoDeUso<{ proposta: Proposta; pasta: string }, { turnoId: string | null }> = async (deps, { proposta, pasta }) => {
  const p = proposta.payload;
  if (p.kind !== "pasta") throw new ErroDeDominio("estado_invalido");
  const confirmada = await deps.repos.propostas.decidir(proposta.id, "confirmada");
  if (!confirmada) throw new ErroDeDominio("estado_invalido");
  const turnoId = p.turnoId;
  if (!turnoId) return { data: { turnoId: null } };
  const original = await deps.repos.turnos.buscar(turnoId);
  if (!original || original.agenteId !== proposta.agenteId || original.conversaId !== proposta.conversaId) throw new ErroDeDominio("estado_invalido");
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null } };
  const agora = deps.agora();
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: original.conversaId,
    agenteId: original.agenteId,
    origem: "retomada",
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: original.profundidade,
    entradaTexto: [
      `A pessoa autorizou a pasta ${pasta} nesta conversa.`,
      "Retome a tarefa que motivou o pedido, usando o contexto da conversa e a entrada original abaixo.",
      "A autorização não executou nada. Inspecione a pasta antes de concluir e não repita trabalho já feito.",
      "Entrada do turno original:",
      original.entradaTexto,
    ].join("\n"),
    entradaConfianca: original.entradaConfianca,
    harness: original.harness,
    modelo: original.modelo,
    retomaTurnoId: original.id,
    sobProcuracaoDe: original.sobProcuracaoDe ?? null,
    reenvios: original.reenvios + 1,
  });
  return {
    data: { turnoId: turno?.id ?? null },
    events: turno ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, proposta_id: proposta.id } })] : [],
  };
};
