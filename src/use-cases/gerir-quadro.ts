import type { CasoNod } from "../contracts/servicos.ts";
import type { QuadroDto, ResultadoGerirQuadro } from "../contracts/quadro.ts";
import type { LinkDeTarefa } from "../contracts/quadro-pela-conversa.ts";
import { lerOps, MAX_COMECOS_POR_LOTE } from "../domain/quadro.ts";
import { proporColunas } from "./colunas-do-quadro.ts";
import { comentarTarefa } from "./comentar-tarefa.ts";
import { proporExclusaoDoQuadro } from "./quadro-exclusao.ts";
import { aplicarLoteQuadro, type PedidoLote, resumoParaBot } from "./quadro.ts";
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
  conflito: "Nada mudou: outra mudança chegou antes; leia o quadro e chame de novo.",
};

const recusa = (erro: keyof typeof INSTRUCAO, detalhe: string) => ({ data: { ok: false, erro, instrucao: `${detalhe}. ${INSTRUCAO[erro]}` } as ResultadoGerirQuadro });

/** NOD-430: `nod-tarefa:<anfitrião>:<tarefa>` (web/lib/texto-formatado.ts o vira o botão que abre a tarefa no quadro). */
export const linkDaTarefa = (anfitriaoId: string, tarefaId: string) => `nod-tarefa:${anfitriaoId}:${tarefaId}`;

/**
 * O código que a pessoa vê no canto do card (`TarefaDto.codigo`, NOD-416: `ZE-12`; sem número, o do Linear ou `#` e 4 do
 * id). Nunca o título: ele pode ter vindo de fora e o código entra na instrução, fora de cerca (ADR-047/062; revisão 1
 * do PR #627). O título vai só nos dados (`tarefas[].titulo`).
 */
export function linksDasTarefas(q: QuadroDto, ids: ReadonlySet<string>): LinkDeTarefa[] {
  return q.tarefas.filter((t) => ids.has(t.id)).slice(0, 20).map((t) => ({ tarefa_id: t.id, codigo: t.codigo, titulo: t.titulo, link: linkDaTarefa(q.agenteId, t.id) }));
}

/**
 * A pessoa falou com este bot neste turno: conversa ou ligação, de primeira mão e sem procuração (como o
 * ajustar_barra_lateral; revisão 1 do PR #627). Sob procuração, quem pediu foi outro, não a pessoa na conversa.
 */
const naConversa = (t: Pick<Turno, "origem" | "profundidade" | "sobProcuracaoDe">): boolean =>
  (t.origem === "conversa" || t.origem === "ligacao") && t.profundidade === 0 && t.sobProcuracaoDe == null;

export const gerirQuadro: CasoNod<Deps, "gerir_quadro"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) return recusa("nao_encontrado", "turno de outro bot");
  // ADR-063 entre donos (revisão do PR #612): o quadro é da pessoa do escopo. Um bot de outro dono só mexe nele de
  // primeira mão; numa corrente (profundidade > 0) ou sob a procuração de outra pessoa, a corrente é de um salto.
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) return recusa("nao_encontrado", "bot não encontrado");
  const deOutroDono = agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId);
  // Na profundidade 0, o bot de outro dono (sala de equipe, procuração) ainda passa por aqui com o limite que o turno der;
  // o corte dele (o que pode no quadro de outra pessoa) é tratado na NOD-443, não nesta (revisão 3 do PR #627).
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
  // As colunas são da pessoa (ADR-140): o bot só mexe nelas a pedido dela, na conversa — não no turno de uma tarefa,
  // rotina ou pedido de colega (revisão do PR #615, o mesmo corte do Desfazer de lote alheio).
  const COLUNA = new Set(["criar_coluna", "renomear_coluna", "mover_coluna", "remover_coluna", "substituir_colunas", "definir_passagem"]);
  if (ops.some((o) => COLUNA.has(o.tipo)) && !naConversa(turno)) {
    return recusa("entrada_invalida", "as colunas só mudam a pedido da pessoa, num turno em que ela falou com você (não numa tarefa, rotina ou pedido de colega). Diga a ela o que sugere e deixe que ela peça");
  }
  // NOD-448 (ADR-140, decisão 3 do Gil): trocar o conjunto inteiro de colunas não sai sozinho — vira o card compacto na
  // conversa e só se aplica quando a pessoa confirma. Os outros passos de coluna saem na hora, com Desfazer.
  const troca = ops[0]?.tipo === "substituir_colunas" ? ops[0] : null;
  if (troca) {
    const pr = await proporColunas(deps, {
      autor: { tipo: "agente", agenteId: input.agenteId },
      ...(input.quadro !== undefined ? { quadro: input.quadro } : {}),
      ops, op: troca, executor: turno.executor, agenteId: input.agenteId, conversaId: input.conversaId, turnoId: turno.id,
      profundidade: turno.profundidade, origemConfiavel: limpo, autorNaConversa: naConversa(turno), limite: naConversa(turno) && limpo ? "total" : "normal",
    });
    if (!pr.data.ok) return { data: { ok: false, erro: pr.data.erro, instrucao: `${pr.data.detalhe}. ${INSTRUCAO[pr.data.erro]}` }, events: pr.events };
    const n = pr.data.payload.movidas.reduce((s, m) => s + m.tarefas, 0);
    return {
      data: {
        ok: true, quadro: null, lote_id: null, comecaram: [], proposta_id: pr.data.propostaId,
        instrucao: `Nada mudou ainda: a troca (${pr.data.payload.depois.map((c) => c.nome).join(" → ")}${n ? `; ${n} ${n === 1 ? "tarefa muda" : "tarefas mudam"} de coluna` : ""}) espera a pessoa no card desta conversa. Diga isso em uma frase e encerre.`,
      },
      events: pr.events,
    };
  }
  // NOD-430: remover o quadro (o do próprio bot ou o de outro bot da pessoa) vira o card 'quadro_exclusao', como o
  // excluir_rotina; no automático/total o modo confirma na hora e volta `aplicada: true`.
  const remover = ops[0]?.tipo === "remover_quadro" ? ops[0] : null;
  if (remover) {
    const ex = await proporExclusaoDoQuadro(deps, {
      agenteId: input.agenteId, conversaId: input.conversaId, turnoId: turno.id, plano: input.plano ?? null, executor: turno.executor,
      ...(input.quadro !== undefined ? { quadro: input.quadro } : {}), ...(remover.bot ? { bot: remover.bot } : {}), naConversa: naConversa(turno), limpo,
    });
    if (!ex.data.ok) return { data: { ok: false, erro: ex.data.erro, instrucao: `${ex.data.detalhe}. ${INSTRUCAO[ex.data.erro]}` }, events: ex.events };
    const nome = ex.data.payload.anfitriaoNome;
    const instrucao = ex.data.aplicada
      ? `Excluí o quadro do ${nome}: ${nome} voltou a ser um agente comum (a conversa e a memória ficaram). Não tem Desfazer. Diga em uma frase: "Excluí o quadro do ${nome}."`
      : ex.data.obsoleta
        ? `Nada mudou: o quadro do ${nome} mudou enquanto o pedido saía. Diga isso e pergunte se ela ainda quer.`
        : ex.data.jaAberto
          ? `Nada mudou ainda: excluir o quadro do ${nome} já espera a pessoa num card aberto (Excluir / Agora não; está também na Sua vez). Não abri outro. Diga isso em uma frase e encerre.`
          : `Nada mudou ainda: excluir o quadro do ${nome} espera a pessoa no card desta conversa (Excluir / Agora não). Diga isso em uma frase e encerre.`;
    return { data: { ok: true, quadro: null, lote_id: null, comecaram: [], proposta_id: ex.data.propostaId, instrucao, ...(ex.data.aplicada ? { aplicada: true } : {}) }, events: ex.events };
  }
  const pedido: PedidoLote = {
    autor: { tipo: "agente", agenteId: input.agenteId },
    ...(input.quadro !== undefined ? { quadro: input.quadro } : {}),
    ops,
    executor: turno.executor,
    turnoId: turno.id,
    profundidade: turno.profundidade,
    conversaId: input.conversaId,
    origemConfiavel: limpo,
    autorNaConversa: naConversa(turno),
    // NOD-430: controle total só a pedido da pessoa, na conversa e num turno limpo; senão o limite normal.
    limite: naConversa(turno) && limpo ? "total" : "normal",
  };
  // NOD-417: comentar vai sozinho (lerOps) e não é lote — grava o comentário e aciona o responsável e os @mencionados (nunca o autor).
  const r = ops[0]?.tipo === "comentar" ? await comentarTarefa(deps, pedido, ops[0]) : await aplicarLoteQuadro(deps, pedido);
  if (!r.data.ok) return { data: { ok: false, erro: r.data.erro, instrucao: `${r.data.detalhe}. ${INSTRUCAO[r.data.erro]}` }, events: r.events };
  const { quadro, lote, comecaram, desfeito } = r.data;
  // O resultado mostra ao bot o título e a pergunta de cada tarefa: se alguma foi escrita por um turno não confiável
  // (deFora), o turno de quem leu fica contaminado, como no buscar_conversas (ADR-062 §6; revisão rodada 5).
  if (limpo && quadro?.tarefas.some((t) => t.deFora)) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  const partes = [r.data.removido ? "Quadro removido: o bot voltou a ser um agente comum (a conversa e a memória ficaram). Não tem Desfazer; para outro quadro, criar_quadro." : desfeito ? "Desfeito." : r.data.comentario ? "Comentário gravado na tarefa." : "Feito."];
  // NOD-416: mudar de quadro não tem lote (nem Desfazer) e não aciona ninguém; o código antigo continua abrindo.
  if (r.data.movida) partes.push(`A tarefa agora é ${r.data.movida.codigo}, no quadro de ${quadro?.agenteNome ?? "destino"} (${r.data.movida.codigoAntigo} continua abrindo). Ninguém começou nada; sem Desfazer: para voltar, mover_quadro de novo.`);
  // Revisão do PR #623: o bot que pôs um responsável sem status pode achar que ele começou (antes da NOD-416 começava).
  // Revisão 3 do PR #623: a criada vem pelo id que o lote devolve (na ordem dos criar_tarefa), não pelo título.
  let k = 0;
  for (const o of ops) {
    if (o.tipo !== "criar_tarefa") continue;
    const id = r.data.criadas?.[k++] ?? null;
    if (!o.agente || o.status) continue;
    const t = id ? quadro?.tarefas.find((x) => x.id === id) : undefined;
    const col = t ? quadro?.colunas.find((c) => c.id === t.status)?.nome : undefined;
    if (t && !t.turnoId) partes.push(`"${t.titulo}" ficou no ${col ?? "Backlog"}; para começar, status afazer (mudar_tarefa).`);
  }
  if (r.data.comentario) {
    const juntados = r.data.juntados ?? 0;
    if (!r.data.seguradas) partes.push(comecaram.length ? `Acionou: ${comecaram.map((c) => c.agenteNome).join(", ")}${juntados ? ` (${juntados === 1 ? "um já estava" : `${juntados} já estavam`} na fila para esta tarefa e o comentário se juntou ao trabalho dele)` : ""}.` : "Ninguém foi acionado: o comentário aciona o responsável da tarefa e os @nomes de outros bots do quadro, nunca quem escreveu.");
  } else if (comecaram.length) partes.push(`Começaram: ${comecaram.map((c) => c.agenteNome).join(", ")} (cada um recebeu a tarefa como pedido).`);
  const parado = r.data.responsavelForaDoAndamento;
  if (parado) partes.push(`A tarefa está em ${parado.coluna}, fora do andamento: o comentário ficou nela e ${parado.agenteNome} (o responsável) não foi acionado.`);
  if (r.data.seguradas && r.data.comentario) partes.push("A corrente de bots chegou ao limite: o comentário ficou gravado e ninguém foi acionado.");
  else if (r.data.seguradas) partes.push(`${r.data.seguradas === 1 ? "Uma tarefa ficou" : `${r.data.seguradas} tarefas ficaram`} na espera sem começar: a corrente de bots chegou ao limite ou o lote passou de ${MAX_COMECOS_POR_LOTE} começos. Diga à pessoa: ela começa a tarefa pela conversa com você (mudar_tarefa com status afazer, num turno dela).`);
  if (r.data.ajustada) partes.push("Um passo de coluna foi para a posição válida mais próxima: as colunas só mudam de lugar dentro do próprio grupo.");
  if (quadro?.cumpridoEm) partes.push(`Meta cumprida: ${quadro.resumo ?? ""}`.trim());
  if (lote && !desfeito) partes.push(`A pessoa vê um Desfazer; para desfazer você mesmo: {tipo: "desfazer", lote: "${lote.id}"}.`);
  // NOD-430: o link de cada tarefa tocada (abre o quadro do anfitrião com ela aberta), para a resposta à pessoa. A movida
  // (NOD-416) não tem lote: o link é o dela no quadro de destino.
  const tocadas = new Set(lote?.tarefaIds ?? (r.data.comentario ? [r.data.comentario.tarefaId] : r.data.movida ? [r.data.movida.tarefaId] : []));
  const tarefas = quadro && !desfeito ? linksDasTarefas(quadro, tocadas) : [];
  if (tarefas.length) partes.push(`Na resposta, cite cada tarefa pelo link (o título de cada uma está em tarefas): ${tarefas.map((t) => `[${t.codigo}](${t.link})`).join(", ")}${quadro && quadro.agenteId !== input.agenteId ? ` (no quadro do ${quadro.agenteNome})` : ""}.`);
  return {
    data: {
      ok: true,
      quadro: quadro ? resumoParaBot(quadro) : null,
      lote_id: lote?.id ?? null,
      comecaram: comecaram.map((c) => ({ tarefa_id: c.tarefaId, agente: c.agenteNome })),
      instrucao: partes.join(" "),
      ...(tarefas.length ? { tarefas } : {}),
      ...(r.data.ajustada ? { ajustada: true } : {}),
      // O código novo estruturado, como a rota devolve em `movida` (paridade, QA do PR #623).
      ...(r.data.movida ? { movida: { tarefa_id: r.data.movida.tarefaId, codigo: r.data.movida.codigo, codigo_antigo: r.data.movida.codigoAntigo } } : {}),
    },
    events: r.events,
  };
};
