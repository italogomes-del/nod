import type { CasoNod } from "../contracts/servicos.ts";
import type { QuadroDto, ResultadoGerirQuadro } from "../contracts/quadro.ts";
import { LIMITE_ACIONAMENTOS_HORA } from "../domain/freios-quadro.ts";
import type { LinkDeTarefa } from "../contracts/quadro-pela-conversa.ts";
import { ehOpDeTrabalho, lerOps, MAX_COMECOS_POR_LOTE } from "../domain/quadro.ts";
import { proporColunas } from "./colunas-do-quadro.ts";
import { proporExclusaoDoQuadro } from "./quadro-exclusao.ts";
import { acharQuadro, agentesDaPessoa, aplicarLoteQuadro, experimentoLigado, falhaDoAchado, montarQuadro, type PedidoLote, resumoParaBot } from "./quadro.ts";
import { trabalhoDaTarefa, trabalhosParaBot } from "./quadro-execucoes.ts";
import type { Deps } from "./tipos.ts";
import type { TrabalhoFeito } from "./quadro.ts";
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
  nao_permitido: "Nada mudou: não é você (nem a pessoa desta conversa) quem decide. Não tente de novo; diga isso a ela.",
  estado_invalido: "Nada mudou: conte à pessoa o motivo; só chame de novo depois que ela resolver.",
  conflito: "Nada mudou: outra mudança chegou antes; leia o quadro e chame de novo.",
};

const recusa = (erro: keyof typeof INSTRUCAO, detalhe: string) => ({ data: { ok: false, erro, instrucao: `${detalhe}. ${INSTRUCAO[erro]}` } as ResultadoGerirQuadro });

/** O que o bot conta à pessoa depois de Repetir, Cancelar ou recado (o número e o estado do trabalho). */
function fraseDoTrabalho(tipo: "repetir_trabalho" | "cancelar_trabalho" | "recado", t: TrabalhoFeito): string {
  if (tipo === "repetir_trabalho") return `Trabalho #${t.numero} aberto na tarefa (${t.estado === "rodando" ? "rodando" : "na fila"}).`;
  if (tipo === "cancelar_trabalho") {
    const recados = t.cancelados ? ` e ${t.cancelados === 1 ? "o recado que aguardava" : `${t.cancelados} recados que aguardavam`}` : "";
    return t.numero !== null ? `Trabalho #${t.numero} cancelado${recados}. A tarefa ficou na mesma coluna.` : `Nenhum trabalho em andamento: nada a cancelar${recados ? `; cancelei${recados.slice(2)}` : ""}.`;
  }
  if (t.entregue === "novo") return `Sem trabalho em andamento: o recado virou o trabalho #${t.numero}.`;
  return t.entregue === "quando_comecar" ? `Recado entregue ao trabalho #${t.numero}: entra quando ele começar.` : `Recado entregue ao trabalho #${t.numero}: entra no próximo passo dele.`;
}

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

/**
 * NOD-443 (revisão 1, achado 1): o turno da tarefa que quem participa pediu nasce sob a procuração dela. O bot da dona,
 * nesse turno, ainda mexe no quadro da dona (o card da própria tarefa): o quadro do turno é dela e quem pediu participa.
 */
async function tarefaDeQuemParticipa(deps: Deps, dono: string, turno: Pick<Turno, "id" | "sobProcuracaoDe">): Promise<boolean> {
  if (dono !== deps.escopo.pessoaId || !turno.sobProcuracaoDe) return false;
  const q = await deps.repos.quadros.doTurno(turno.id);
  return !!q && (await deps.repos.quadros.ehMembro(q.id, turno.sobProcuracaoDe));
}

/** NOD-443 (revisão 2, achado 3): o quadro devolvido traz conteúdo que não é de quem lê (ADR-047). */
function conteudoDeFora(q: QuadroDto, leitor: string): boolean {
  if (q.voce?.papel === "membro" || (q.dona && q.dona.pessoaId !== leitor)) return true;
  if (q.tarefas.some((t) => t.deFora || (t.pedidoPor != null && t.pedidoPor !== leitor))) return true;
  return (q.comentarios ?? []).some((c) => c.deFora);
}

/** Só leitura (acoes vazio): o resumo do quadro e os trabalhos; contamina o turno como a escrita (conteudoDeFora). */
async function consultar(deps: Deps, agenteId: string, quadro: string | undefined, turno: Pick<Turno, "id" | "executor">, limpo: boolean): Promise<{ data: ResultadoGerirQuadro }> {
  if (!(await experimentoLigado(deps))) return recusa("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, { autor: { tipo: "agente", agenteId }, ops: [], executor: turno.executor, ...(quadro !== undefined ? { quadro } : {}) }, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return recusa(f.erro, f.detalhe); }
  if (!achado) return recusa("sem_quadro", "não há quadro: crie com criar_quadro");
  const dto = await montarQuadro(deps, achado);
  if (limpo && conteudoDeFora(dto, deps.escopo.pessoaId)) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  return {
    data: { ok: true, quadro: resumoParaBot(dto, await trabalhosParaBot(deps, dto.tarefas.map((t) => t.id))), lote_id: null, comecaram: [], instrucao: "Só leitura: nada mudou." },
  };
}

export const gerirQuadro: CasoNod<Deps, "gerir_quadro"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) return recusa("nao_encontrado", "turno de outro bot");
  // ADR-063 entre donos (revisão do PR #612): o quadro é da pessoa do escopo. Um bot de outro dono só mexe nele de
  // primeira mão; numa corrente (profundidade > 0) ou sob a procuração de outra pessoa, a corrente é de um salto.
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) return recusa("nao_encontrado", "bot não encontrado");
  const deOutroDono = agente.ownerId !== deps.escopo.pessoaId || (turno.sobProcuracaoDe != null && turno.sobProcuracaoDe !== deps.escopo.pessoaId);
  if (deOutroDono && turno.profundidade > 0 && !(await tarefaDeQuemParticipa(deps, agente.ownerId, turno))) return recusa("entrada_invalida", "entre donos diferentes, a corrente é de um salto: este turno já veio de outro bot");
  // O turno que mandaram parar (troca de responsável, Desfazer, cancelamento) não escreve mais no quadro (revisão rodada 3).
  if (turno.pararSolicitadoEm != null || turno.estado === "interrompido") return recusa("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  // Limpo = confiável e nada de fora entrou durante o turno (a página lida, o e-mail): o mesmo corte do avisar_pessoa.
  const limpo = turno.entradaConfianca === "confiavel" && !(await deps.repos.turnos.contaminado(turno.id));
  // Revisão 5 do PR #625: `acoes: []` só consulta: o resumo do quadro com o trabalho atual de cada tarefa (a mesma vista
  // da tela, verTrabalhos), sem lote nem Desfazer. Vem antes do lerOps (que recusa a lista vazia).
  if (Array.isArray(input.acoes) && input.acoes.length === 0) return consultar(deps, input.agenteId, input.quadro, turno, limpo);
  const ops = lerOps(input.acoes);
  if ("erro" in ops) return recusa("entrada_invalida", ops.indice >= 0 ? `ação ${ops.indice + 1}: ${ops.erro}` : ops.erro);
  // Quem responde ao bloqueio é a pessoa (revisão do PR #612). O bot só repassa o que ela disse a ele agora, na
  // conversa: turno dela (conversa ou ligação), de primeira mão e confiável — nunca uma tarefa, rotina ou colega.
  if (ops.some((o) => o.tipo === "responder") && !(naConversa(turno) && limpo)) {
    return recusa("entrada_invalida", "responder é a resposta da pessoa: só num turno em que ela falou com você e nada de fora entrou (não numa tarefa, rotina, pedido de colega ou depois de ler uma página). Peça a ela no card (status voce com a pergunta)");
  }
  // As colunas são da pessoa (ADR-140): o bot só mexe nelas a pedido dela, na conversa — não no turno de uma tarefa,
  // rotina ou pedido de colega (revisão do PR #615, o mesmo corte do Desfazer de lote alheio).
  const COLUNA = new Set(["criar_coluna", "renomear_coluna", "mover_coluna", "remover_coluna", "substituir_colunas", "definir_passagem", "travar_coluna"]);
  if (ops.some((o) => COLUNA.has(o.tipo)) && !naConversa(turno)) {
    return recusa("entrada_invalida", "as colunas só mudam a pedido da pessoa, num turno em que ela falou com você (não numa tarefa, rotina ou pedido de colega). Diga a ela o que sugere e deixe que ela peça");
  }
  // NOD-418: Repetir, Cancelar e recado são da pessoa: o bot só repassa o pedido dela, na conversa, como o responder —
  // turno dela, de primeira mão e limpo. Uma página lida no turno podia mandar repetir (gastar) ou cancelar o trabalho;
  // o recado entra no trabalho como a fala dela.
  const trabalhoOp = ops[0] && ehOpDeTrabalho(ops[0]) ? ops[0] : null;
  if (trabalhoOp && !(naConversa(turno) && limpo)) {
    return recusa("entrada_invalida", `${trabalhoOp.tipo} é pedido da pessoa: só num turno em que ela falou com você e nada de fora entrou (não numa tarefa, rotina, pedido de colega ou depois de ler uma página ou um e-mail)`);
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
  // NOD-443 (revisão 2 do PR #628, achado 2): no turno que o pedido de quem participa abriu no bot da dona, o bot age sob
  // a procuração dela (as regras são as de quem pediu) e só na tarefa do turno. Sem isso, o lote sairia como da dona.
  const procuracao = turno.sobProcuracaoDe && turno.sobProcuracaoDe !== deps.escopo.pessoaId && (await tarefaDeQuemParticipa(deps, agente.ownerId, turno)) ? turno.sobProcuracaoDe : null;
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
    ...(procuracao ? { pedidoPor: procuracao, porProcuracao: true } : {}),
    // NOD-430: controle total só a pedido da pessoa, na conversa e num turno limpo; senão o limite normal.
    limite: naConversa(turno) && limpo ? "total" : "normal",
  };
  // NOD-417: comentar numa tarefa do próprio quadro não é lote — grava o comentário e aciona o responsável e os @mencionados
  // (nunca o autor). A escolha entre ele e o comentário de quem participa (NOD-443, D7) é do aplicarLoteQuadro.
  // NOD-418: Repetir, Cancelar e recado não são lote: o trabalho da tarefa.
  const r = trabalhoOp ? await trabalhoDaTarefa(deps, pedido, trabalhoOp) : await aplicarLoteQuadro(deps, pedido);
  if (!r.data.ok) return { data: { ok: false, erro: r.data.erro, instrucao: `${r.data.detalhe}. ${INSTRUCAO[r.data.erro]}` }, events: r.events };
  const { quadro, lote, comecaram, desfeito } = r.data;
  // O resultado mostra ao bot o título e a pergunta de cada tarefa: se alguma foi escrita por um turno não confiável
  // (deFora), o turno de quem leu fica contaminado, como no buscar_conversas (ADR-062 §6; revisão rodada 5). NOD-443
  // (revisão 2, achado 3; ADR-047): também o quadro de outra pessoa e o que outra pessoa pediu ou comentou.
  if (limpo && quadro && conteudoDeFora(quadro, deps.escopo.pessoaId)) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  const feito = r.data.trabalho;
  const partes = [feito ? fraseDoTrabalho(trabalhoOp!.tipo, feito) : r.data.removido ? "Quadro removido: o bot voltou a ser um agente comum (a conversa e a memória ficaram). Não tem Desfazer; para outro quadro, criar_quadro." : desfeito ? "Desfeito." : r.data.comentario ? "Comentário gravado na tarefa." : "Feito."];
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
    if (r.data.freados) partes.push(`Ninguém foi acionado: esta tarefa passou de ${LIMITE_ACIONAMENTOS_HORA} acionamentos na última hora (freio). O comentário ficou gravado; diga à pessoa e espere a resposta dela.`);
    else if (!r.data.seguradas) partes.push(comecaram.length ? `Acionou: ${comecaram.map((c) => c.agenteNome).join(", ")}${juntados ? ` (${juntados === 1 ? "um já estava" : `${juntados} já estavam`} na fila para esta tarefa e o comentário se juntou ao trabalho dele)` : ""}.` : "Ninguém foi acionado: o comentário aciona o responsável da tarefa e os @nomes de outros bots do quadro, nunca quem escreveu.");
  } else if (comecaram.length && !feito) partes.push(`Começaram: ${comecaram.map((c) => c.agenteNome).join(", ")} (cada um recebeu a tarefa como pedido).`);
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
      quadro: quadro ? resumoParaBot(quadro, await trabalhosParaBot(deps, quadro.tarefas.map((t) => t.id))) : null,
      lote_id: lote?.id ?? null,
      comecaram: comecaram.map((c) => ({ tarefa_id: c.tarefaId, agente: c.agenteNome })),
      instrucao: partes.join(" "),
      ...(tarefas.length ? { tarefas } : {}),
      ...(r.data.ajustada ? { ajustada: true } : {}),
      ...(feito ? { trabalho: { numero: feito.numero, estado: feito.estado } } : {}),
      // O código novo estruturado, como a rota devolve em `movida` (paridade, QA do PR #623).
      ...(r.data.movida ? { movida: { tarefa_id: r.data.movida.tarefaId, codigo: r.data.movida.codigo, codigo_antigo: r.data.movida.codigoAntigo } } : {}),
    },
    events: r.events,
  };
};
