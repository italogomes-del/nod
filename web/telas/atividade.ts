import type { ItemDeAtividade } from "../../src/contracts/atividade.ts";
import type { Estado } from "../estado/reducer.ts";
import { chaveDaAtividade, diaLocal, diaSeguinte, FILTROS_DA_ATIVIDADE, itensDoFiltro, rotuloDoDia, type FiltroAtividade } from "../lib/atividade-do-bot.ts";
import { esc, hora } from "../lib/render.ts";
import { memoriaDoMac } from "./linha-do-dono.ts";

type Bot = NonNullable<Estado["frota"]>["agentes"][number];

/**
 * A Atividade do bot, um nível da gaveta (definido em 2026-10-18, chat limpo, PR 2; ADR-114; protótipo "Atividade aberta no
 * drawer"): o que saiu do chat, um dia por página. Os filtros Tudo / Sem aprovação / Frentes / Bloqueios / Máquina e IA (botões com
 * `aria-pressed`; item sem categoria só em "Tudo"), a lista com a hora à esquerda, o título e o detalhe em cinza, e "Dia
 * anterior ›" no fim. O clique leva ao alvo: a frente abre a tela dela; a mensagem abre o texto inteiro ali mesmo, com o
 * "Relatar" (ADR-041). A linha da trilha (app indisponível) não tem mensagem e não leva "Relatar" na v1 (decisão 14).
 *
 * A memória não é fonte da rota (decisão 13): no topo de hoje, enquanto vale, a linha "Agora" do estado que a tela já tem.
 */
export function renderAtividade(estado: Estado, bot: Bot): string {
  const vista = estado.atividadeVista?.agenteId === bot.id ? estado.atividadeVista : null;
  const hoje = diaLocal(estado.agora > 0 ? estado.agora : Date.now());
  const dia = vista?.dia ?? hoje;
  const filtro: FiltroAtividade = vista?.filtro ?? "tudo";
  const chave = chaveDaAtividade(bot.id, dia);
  const filtros = `<div class="atv-filtros" role="group" aria-label="Filtrar a atividade">${FILTROS_DA_ATIVIDADE.map((f) => `<button type="button" class="atv-filtro" data-act="atividade-filtro" data-filtro="${f.filtro}" aria-pressed="${f.filtro === filtro}">${esc(f.rotulo)}</button>`).join("")}</div>`;
  // Um bloco só, com o espaçamento do protótipo (12 px entre filtros, dia e lista): solto, cada parte pegava o vão de 22 px
  // da gaveta e o `.detalhes h3` (QA do PR 2).
  const bloco = (corpo: string): string => `<div class="atv">${corpo}</div>`;
  if (!(chave in estado.atividadeDoBot)) return bloco(`${filtros}<p class="mudo atv-vazio">carregando…</p>`);
  const dto = estado.atividadeDoBot[chave];
  if (!dto) return bloco(`${filtros}<p class="mudo atv-vazio">A atividade deste bot não está disponível agora.</p>`);
  const itens = itensDoFiltro(dto.itens, filtro);
  const agora = dia === hoje && (filtro === "tudo" || filtro === "maquina_ia") ? linhaAgora(estado, bot) : "";
  const vazio = itens.length === 0 && !agora ? `<p class="mudo atv-vazio">${filtro === "tudo" ? "Nada neste dia." : filtro === "sem_aprovacao" ? "Nada rodou sem aprovação neste dia." : "Nada deste tipo neste dia."}</p>` : "";
  const lista = itens.length || agora ? `<ol class="atv-lista" aria-label="${esc(`Atividade · ${rotuloDoDia(dia, hoje)}`)}">${agora}${itens.map((i) => linhaDoItem(i, vista?.aberta ?? null)).join("")}</ol>` : "";
  const truncados = dto.truncados > 0 ? `<p class="mudo atv-mais">e mais ${dto.truncados} ${dto.truncados === 1 ? "item" : "itens"} deste dia, no Raio-X</p>` : "";
  const seguinte = dia < hoje ? `<button type="button" class="atv-dia" data-act="atividade-dia" data-dia="${esc(diaSeguinte(dia))}">‹ Dia seguinte</button>` : "<span></span>";
  const anterior = dto.diaAnterior ? `<button type="button" class="atv-dia" data-act="atividade-dia" data-dia="${esc(dto.diaAnterior)}">Dia anterior ›</button>` : "";
  const navegacao = anterior || dia < hoje ? `<div class="atv-navegacao">${seguinte}${anterior}</div>` : "";
  return bloco(`${filtros}<h3 class="atv-dia-titulo" tabindex="-1">${esc(rotuloDoDia(dia, hoje))}</h3>${lista}${vazio}${truncados}${navegacao}`);
}

/**
 * "Agora · Pouca memória no seu Mac · 2 trabalhos abertos · ver": a linha do estado de agora (não vem da rota). Como o ponto
 * da linha do dono, a memória só entra quando o bot tem trabalho aberto (QA do PR 2: sem ele, a linha dizia "0 trabalhos
 * abertos"); o disco cheio que segura tudo entra sempre, porque nenhuma task nova começa.
 */
function linhaAgora(estado: Estado, bot: Bot): string {
  const m = memoriaDoMac(estado, bot.id, bot.conversaId);
  if (!m || (m.abertos === 0 && !m.disco)) return "";
  const [titulo, ...resto] = m.texto.split(" · ");
  return `<li class="atv-item atv-agora atv-${m.nivel}"><span class="atv-hora">Agora</span><span class="atv-texto"><span class="atv-titulo">${esc(titulo ?? "")}</span><span class="atv-detalhe">${esc(resto.join(" · "))}${resto.length ? " · " : ""}<button type="button" class="atv-link" ${m.alvo}>ver</button></span></span></li>`;
}

/** Uma linha da lista. A mensagem aberta mostra o texto inteiro e o "Relatar"; a frente abre a tela dela. */
function linhaDoItem(i: ItemDeAtividade, aberta: string | null): string {
  const vezes = i.vezes && i.vezes > 1 ? ` <span class="atv-vezes">${i.vezes} vezes</span>` : "";
  // PR 6 dos modos de aprovação (tela Y3): o comando ou o caminho do que rodou sem aprovação vai em fonte de código.
  const corpo = `<span class="atv-hora">${esc(hora(i.em))}</span><span class="atv-texto"><span class="atv-titulo">${esc(i.titulo)}${vezes}</span>${i.detalhe ? `<span class="atv-detalhe${i.codigo ? " atv-codigo" : ""}"${i.codigo ? ` title="${esc(i.detalhe)}"` : ""}>${esc(i.detalhe)}</span>` : ""}</span>`;
  if (i.revisor) return `<li class="atv-item atv-do-revisor"><div class="atv-botao estatico">${corpo}</div>${linhaDoRevisor(i.revisor)}</li>`;
  const alvo = i.alvo;
  if (alvo && "trabalhoId" in alvo) return `<li class="atv-item"><button type="button" class="atv-botao" data-act="abrir-trabalho" data-id="${esc(alvo.trabalhoId)}">${corpo}</button></li>`;
  if (alvo && "mensagemId" in alvo) {
    const aberto = aberta === i.id;
    const texto = i.texto ?? i.detalhe ?? "";
    const inteiro = aberto ? `<div class="atv-inteiro" id="atv-${esc(i.id)}">${texto && texto !== i.detalhe ? `<p>${esc(texto)}</p>` : ""}<button type="button" class="atv-link" data-act="relatar-mensagem" data-id="${esc(alvo.mensagemId)}">Relatar</button></div>` : "";
    return `<li class="atv-item${aberto ? " aberto" : ""}"><button type="button" class="atv-botao" data-act="atividade-abrir" data-id="${esc(i.id)}" aria-expanded="${aberto}"${aberto ? ` aria-controls="atv-${esc(i.id)}"` : ""}>${corpo}</button>${inteiro}</li>`;
  }
  return `<li class="atv-item"><div class="atv-botao estatico">${corpo}</div></li>`;
}

/**
 * PR 4 dos modos de aprovação: embaixo da ação que o revisor liberou, o motivo dele e "Devia ter perguntado". O clique grava
 * a contestação (não desfaz nada) e a linha vira "Você marcou: devia ter perguntado". A hora fica alinhada à de cima.
 */
function linhaDoRevisor(r: NonNullable<ItemDeAtividade["revisor"]>): string {
  const motivo = r.motivo ? `<span class="atv-revisor-motivo"><b>Revisor:</b> ${esc(r.motivo)}</span>` : "";
  const acao = r.contestada
    ? `<span class="atv-contestada" data-acao="${esc(r.acaoId)}" tabindex="-1">Você marcou: devia ter perguntado</span>`
    : `<button type="button" class="atv-link atv-contestar" data-act="contestar-revisor" data-id="${esc(r.acaoId)}">Devia ter perguntado</button>`;
  return `<div class="atv-revisor">${motivo}${acao}</div>`;
}
