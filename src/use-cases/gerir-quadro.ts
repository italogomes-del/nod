import type { CasoNod } from "../contracts/servicos.ts";
import type { ResultadoGerirQuadro } from "../contracts/quadro.ts";
import { lerOps, MAX_COMECOS_POR_LOTE } from "../domain/quadro.ts";
import { aplicarLoteQuadro, resumoParaBot } from "./quadro.ts";
import type { Deps } from "./tipos.ts";
import type { Turno } from "../contracts/turno.ts";

/**
 * gerir_quadro (definido em 2026-10-31, NOD-442, ADR-135): a via do chat das ações `quadro.*`, para QUALQUER bot. É o
 * mesmo aplicarLoteQuadro da tela, com o bot como autor e as ações do lote validadas pelo mesmo lerOp. Os turnos que o
 * lote começa rodam no executor do turno de quem chamou.
 */

const INSTRUCAO: Record<Extract<ResultadoGerirQuadro, { ok: false }>["erro"], string> = {
  experimento_desligado: "O quadro está desligado para esta pessoa (Experimentos → Quadro). Nada mudou; diga isso a ela.",
  sem_quadro: "Nada mudou.",
  entrada_invalida: "Nada mudou: corrija a ação e chame de novo.",
  nao_encontrado: "Nada mudou: confira o id ou o nome e chame de novo.",
};

const recusa = (erro: keyof typeof INSTRUCAO, detalhe: string) => ({ data: { ok: false, erro, instrucao: `${detalhe}. ${INSTRUCAO[erro]}` } as ResultadoGerirQuadro });

const naConversa = (t: Pick<Turno, "origem" | "profundidade">): boolean => (t.origem === "conversa" || t.origem === "ligacao") && t.profundidade === 0;

export const gerirQuadro: CasoNod<Deps, "gerir_quadro"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) return recusa("nao_encontrado", "turno de outro bot");
  // ADR-063 entre donos (revisão do PR #612): o quadro é da pessoa do escopo. Um bot de outro dono só mexe nele de
  // primeira mão; numa corrente (profundidade > 0) ou sob a procuração de outra pessoa, a corrente é de um salto.
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) return recusa("nao_encontrado", "bot não encontrado");
  const deOutroDono = agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId);
  if (deOutroDono && turno.profundidade > 0) return recusa("entrada_invalida", "entre donos diferentes, a corrente é de um salto: este turno já veio de outro bot");
  // O turno que mandaram parar (troca de responsável, Desfazer, cancelamento) não escreve mais no quadro (revisão rodada 3).
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return recusa("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  // Limpo = confiável e nada de fora entrou durante o turno (a página lida, o e-mail): o mesmo corte do avisar_pessoa.
  const limpo = turno.entradaConfianca === "confiavel" && !(await deps.repos.turnos.contaminado(turno.id));
  const ops = lerOps(input.acoes);
  if ("erro" in ops) return recusa("entrada_invalida", ops.indice >= 0 ? `ação ${ops.indice + 1}: ${ops.erro}` : ops.erro);
  // Quem responde ao bloqueio é a pessoa (revisão do PR #612). O bot só repassa o que ela disse a ele agora, na
  // conversa: turno dela (conversa ou ligação), de primeira mão e confiável — nunca uma tarefa, rotina ou colega.
  if (ops.some((o) => o.tipo === "responder") && !(naConversa(turno) && limpo)) {
    return recusa("entrada_invalida", "responder é a resposta da pessoa: só num turno em que ela falou com você e nada de fora entrou (não numa tarefa, rotina, pedido de colega ou depois de ler uma página). Peça a ela no card (status voce com a pergunta)");
  }
  const r = await aplicarLoteQuadro(deps, {
    autor: { tipo: "agente", agenteId: input.agenteId },
    ...(input.quadro !== undefined ? { quadro: input.quadro } : {}),
    ops,
    executor: turno.executor,
    turnoId: turno.id,
    profundidade: turno.profundidade,
    conversaId: input.conversaId,
    origemConfiavel: limpo,
    autorNaConversa: naConversa(turno),
  });
  if (!r.data.ok) return { data: { ok: false, erro: r.data.erro, instrucao: `${r.data.detalhe}. ${INSTRUCAO[r.data.erro]}` }, events: r.events };
  const { quadro, lote, comecaram, desfeito } = r.data;
  // O resultado mostra ao bot o título e a pergunta de cada tarefa: se alguma foi escrita por um turno não confiável
  // (deFora), o turno de quem leu fica contaminado, como no buscar_conversas (ADR-062 §6; revisão rodada 5).
  if (limpo && quadro?.tarefas.some((t) => t.deFora)) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  const partes = [desfeito ? "Desfeito." : "Feito."];
  if (comecaram.length) partes.push(`Começaram: ${comecaram.map((c) => c.agenteNome).join(", ")} (cada um recebeu a tarefa como pedido).`);
  if (r.data.seguradas) partes.push(`${r.data.seguradas === 1 ? "Uma tarefa ficou" : `${r.data.seguradas} tarefas ficaram`} em A fazer sem começar: a corrente de bots chegou ao limite ou o lote passou de ${MAX_COMECOS_POR_LOTE} começos. Diga à pessoa: ela começa a tarefa pela conversa com você (mudar_tarefa com status afazer, num turno dela).`);
  if (quadro?.cumpridoEm) partes.push(`Meta cumprida: ${quadro.resumo ?? ""}`.trim());
  if (lote && !desfeito) partes.push(`A pessoa vê um Desfazer; para desfazer você mesmo: {tipo: "desfazer", lote: "${lote.id}"}.`);
  return {
    data: {
      ok: true,
      quadro: quadro ? resumoParaBot(quadro) : null,
      lote_id: lote?.id ?? null,
      comecaram: comecaram.map((c) => ({ tarefa_id: c.tarefaId, agente: c.agenteNome })),
      instrucao: partes.join(" "),
    },
    events: r.events,
  };
};
