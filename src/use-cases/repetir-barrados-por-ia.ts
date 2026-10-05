import type { RuntimeEvent } from "../contracts/evento.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * definido em 2026-10-05: a fala que ficou sem resposta porque não havia IA pronta por até meia hora atrás. Mais velho
 * que isso a pessoa já seguiu a vida, e uma resposta atrasada a um "oi" antigo confunde mais do que ajuda.
 */
export const JANELA_REPETIR_BARRADOS_MS = 30 * 60_000;

/**
 * Uma IA do Mac ficou pronta (definido em 2026-10-05): as falas da pessoa que tinham sido barradas por falta de IA
 * (`executor_indisponivel`) são repetidas, para o bot responder sem ela precisar mandar de novo. Medido em produção
 * nesse dia: a pessoa nova mandou "oi", conectou outra IA e ficou esperando; só um segundo "oi" teve resposta.
 *
 * Só a fala mais recente de cada conversa, e só se nada veio depois dela (a própria repetição é um turno mais novo,
 * então uma segunda chamada não repete de novo). Rotina, sala e pedido entre bots ficam de fora: têm vínculos próprios.
 */
export const repetirBarradosPorIa: CasoDeUso<{ executor: "local" | "catcher" }, { repetidos: number }> = async (deps, input) => {
  const agora = deps.agora();
  const barrados = await deps.repos.turnos.barradosPorFaltaDeIa(agora - JANELA_REPETIR_BARRADOS_MS);
  const events: RuntimeEvent[] = [];
  for (const turno of barrados) {
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: turno.conversaId,
      agenteId: turno.agenteId,
      origem: "conversa",
      prazoEm: turno.prazoEm,
      profundidade: turno.profundidade,
      entradaTexto: turno.entradaTexto,
      mensagemOrigemId: turno.mensagemOrigemId,
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      modelo: turno.modelo,
      harness: turno.harness,
      reenvios: turno.reenvios + 1,
      executor: input.executor,
    });
    if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, input.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  }
  return { data: { repetidos: events.length }, events };
};
