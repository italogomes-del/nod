import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado, FiltroTrabalhos, Tela } from "../estado/reducer.ts";
import { linhaAtual, resumoEtapa, type AtividadeTurno } from "../lib/atividade.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { duracaoCurta } from "../lib/relogio.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { aberto, abertosDoBot, agrupar, dicaSemContato, emEspera, esperandoColega, etiquetaOrigem, quandoVolta, voltaMarcada, filtrar, leituraDoMac, maquinasDe, memoriaDosBots, memoriaLegivel, pilulaDaCota, pilulaDasMaquinas, pilulaMac, pilulaMemoria, pontoTrabalho, resumoDaPilula, seguradoPeloMac, situacaoDe, tempoDe, temposDaTask, tituloCurto, trabalhoPorId, trabalhosConhecidos, type GruposTrabalhos } from "../lib/trabalhos.ts";
import { renderMensagem, type BlocoDaTimeline } from "./conversa.ts";
import { horariosDaRotina } from "./linhas-do-chat.ts";
import { PARCIAL, usd } from "./modo-dev.ts";

/**
 * As telas dos trabalhos (ADR-083, épico #188; protótipo "Chat limpo", pranchas K1–K9 e M1–M3): a faixa de Trabalhos em
 * cima do campo e a pílula recolhida, a tela da task, o chip da barra lateral, o ícone do topo, o nível "Trabalhos" da
 * gaveta e a tela "Todos os trabalhos". Tudo em string; main.ts põe nas regiões.
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

export function agente(estado: Estado, id: string | null | undefined): Agente | undefined {
  if (!id) return undefined;
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

const etiqueta = (t: TrabalhoDto): string => `<span class="etiqueta-origem">${esc(etiquetaOrigem(t))}</span>`;

/**
 * "lendo a planilha de receita · 15 min": o que faz e há quanto tempo (na fila, só o que espera). `vivo`: a atividade do
 * turno que roda, quando a tela a guarda — o passo anda a cada frame em vez de esperar o próximo `GET trabalhos`.
 */
function progresso(t: TrabalhoDto, todos: readonly TrabalhoDto[], agora: number, vivo?: AtividadeTurno, segurando = false): string {
  const situacao = vivo && t.estado === "rodando" && !t.esperandoComputadorDe && !emEspera(t) ? linhaAtual(vivo) : situacaoDe(t, todos, segurando, agora);
  return t.estado === "na_fila" ? situacao : `${situacao} · ${tempoDe(t, agora)}`;
}

/**
 * O ao vivo do turno do trabalho (definido em 2026-10-08, revisão W9): a faixa lê `atividades`, que só a tela da
 * conversa aberta redesenha a cada frame. A gaveta e "Todos os trabalhos" não leem — a gaveta é lembrada pelo que lê
 * (web/lib/lembrar.ts), e ler `atividades` a redesenharia a cada pedaço de texto de qualquer bot (ADR-061).
 */
function atividadeDe(estado: Estado, t: TrabalhoDto): AtividadeTurno | undefined {
  return t.turnoVivoId ? estado.atividades[t.conversaId]?.[t.turnoVivoId] : undefined;
}

/** O status curto da task, sem tempo: "esperando Eng 2", o passo de agora ou o estado. */
function statusCurto(t: TrabalhoDto, todos: readonly TrabalhoDto[], vivo?: AtividadeTurno, segurando = false, agora = Date.now()): string {
  return vivo && t.estado === "rodando" && !t.esperandoComputadorDe && !emEspera(t) ? linhaAtual(vivo) : situacaoDe(t, todos, segurando, agora);
}

/**
 * O detalhe da linha da faixa, só no hover e no foco (CSS): a origem e "trabalhou 21 min · aberta há 5h" (na fila, só a
 * origem — lá ainda não há tempo a contar). revisto em 2026-10-09 (pedido do Marlon, "quanto menos poluirmos a tela
 * melhor"): a etiqueta "rotina" saiu da linha e entrou aqui.
 */
function detalheNoHover(t: TrabalhoDto, agora: number): string {
  const origem = esc(etiquetaOrigem(t));
  if (t.estado === "na_fila") return `<span class="ft-tempo">${origem}</span>`;
  const { abertaMs, trabalhouMs } = temposDaTask(t, agora);
  return `<span class="ft-tempo">${origem} · trabalhou ${esc(duracaoCurta(trabalhouMs))} · aberta há ${esc(duracaoCurta(abertaMs))}</span>`;
}

/** O título da linha: o curto à vista (sem o id técnico entre parênteses), o inteiro no `title`. */
function tituloDaLinha(t: TrabalhoDto, classe: string): string {
  const curto = tituloCurto(t.titulo);
  return `<span class="${classe}"${curto === t.titulo ? "" : ` title="${esc(t.titulo)}"`}>${esc(curto)}</span>`;
}

// ---- faixa de Trabalhos e pílula (#195, K1/K6) --------------------------------------------------------------------------

/**
 * A faixa colada em cima do campo, com uma linha por trabalho aberto do bot; sem trabalho aberto, nada (a região some).
 * revisto em 2026-10-09 (pedido do Marlon): nasce recolhida na pílula "● N trabalhando" à direita, que abre a faixa; só
 * fica aberta enquanto a pessoa está na conversa (`faixaTrabalhosAberta`, reducer.ts).
 */
export function renderFaixaTrabalhos(estado: Estado, agenteId: string): string {
  const bot = agente(estado, agenteId);
  const lista = abertosDoBot(estado, agenteId, bot?.conversaId);
  if (lista.length === 0) return "";
  const nome = bot?.nome ?? "bot";
  const n = lista.length;
  if (estado.faixaTrabalhosAberta !== agenteId) {
    const r = resumoDaPilula(lista);
    const ponto = r.ponto === "trabalhando" ? `${esc(bot?.cor ?? "")} pulso-trab` : r.ponto;
    const precisa = r.precisa > 0 && r.precisa < n ? `<span class="pt-precisa">· ${r.precisa} ${r.precisa === 1 ? "precisa" : "precisam"} de você</span>` : "";
    return `<div class="faixa-trab-lugar"><button type="button" class="pilula-trab" data-act="faixa-trabalhos" data-recolher="0" aria-expanded="false" aria-label="Abrir os trabalhos de ${esc(nome)}: ${n} ${n === 1 ? "aberto" : "abertos"}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span><span><b>${n}</b> ${r.texto}</span>${precisa}${ICONE.recolher}</button></div>`;
  }
  const todos = trabalhosConhecidos(estado, bot?.conversaId);
  const segurando = estado.trabalhos?.segurando === true;
  // revisto em 2026-10-09 (pedido do Marlon, "dá uma caprichada"): toda linha tem a mesma altura e as mesmas colunas —
  // ponto, título numa linha, status curto em texto discreto, seta; a origem e o tempo só no hover ou no foco do teclado,
  // entre o título e o status (o status e a seta não saem do lugar; o título é que cede).
  const linhas = lista.map((t) => `<button type="button" class="ft-linha" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, bot?.cor)}${tituloDaLinha(t, "ft-titulo")}${detalheNoHover(t, estado.agora)}<span class="ft-passo">${esc(statusCurto(t, todos, atividadeDe(estado, t), segurando, estado.agora))}</span><span class="ft-seta" aria-hidden="true">${ICONE.seta}</span></button>`).join("");
  // "Trabalhos · Cecília": sem "do"/"da" — o nome do bot não diz o gênero (o print do Marlon tinha "Trabalhos do Cecília").
  return `<section class="faixa-trab" aria-label="Trabalhos de ${esc(nome)}"><div class="ft-cab"><span>Trabalhos · ${esc(nome)}</span><span class="ft-n">${n}</span><button type="button" class="ft-recolher" data-act="faixa-trabalhos" data-recolher="1" aria-expanded="true" aria-label="Recolher em pílula" title="Recolher em pílula">${ICONE.abrir}</button></div>${linhas}</section>`;
}

// ---- barra lateral (#196, K8 variante 3) -------------------------------------------------------------------------------

/**
 * O chip ao lado do nome do bot com trabalho aberto: o número e um ponto na cor do bot, piscando de leve enquanto algum
 * trabalha de fato (a animação some com `prefers-reduced-motion`); só esperando, o ponto vazado da espera. Sem trabalho,
 * nada — um sinal por bot, sem empilhar badges.
 */
export function chipTrabalhosDoBot(estado: Estado, a: Pick<Agente, "id" | "cor" | "conversaId">): string {
  // Só a lista de `GET trabalhos`: a barra é lembrada pelo que lê (web/lib/lembrar.ts), e ler `conversas` a redesenharia a
  // cada mensagem de qualquer bot (medido em 2026-09-30, ADR-061: redesenho por frame travava a tela).
  const lista = abertosDoBot({ trabalhos: estado.trabalhos, conversas: {}, trabalhoDetalhe: {} }, a.id);
  if (lista.length === 0) return "";
  // definido em 2026-10-12 (ADR-099, parte 1): só pisca com algo trabalhando de fato; com o bot só esperando (a volta
  // marcada ou um colega), o ponto vazado da espera — o mesmo da linha da task (`pontoTrabalho`).
  const trabalhando = lista.some((t) => t.estado === "rodando" && !emEspera(t));
  const esperando = lista.filter((t) => emEspera(t)).length;
  const soEspera = !trabalhando && esperando > 0 && !lista.some((t) => t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso");
  const n = lista.length;
  const titulo = `${n} ${n === 1 ? "trabalho aberto" : "trabalhos abertos"}${esperando > 0 ? ` · ${esperando} esperando` : ""}`;
  const ponto = soEspera ? "fora-do-mac" : `${esc(a.cor)}${trabalhando ? " pulso-trab" : ""}`;
  return `<span class="chip-trab" title="${titulo}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span>${n}</span>`;
}

const ICONE_TRABALHOS = '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="14" height="11" rx="2.2"/><path d="M7.5 5.5V4.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2v1.3"/><path d="M3 10h14"/></svg>';

/** O ícone "Trabalhos" do topo da barra (ao lado de Não lidos): só com trabalho aberto (ou com a tela aberta), com o número. */
export function renderIconeTrabalhos(estado: Estado): string {
  const n = (estado.trabalhos?.trabalhos ?? []).filter(aberto).length;
  const naTela = estado.tela.tipo === "trabalhos";
  if (n === 0 && !naTela) return "";
  return `<button class="icone-topo trabalhos-bt" data-act="navegar" data-tela="trabalhos" aria-current="${naTela ? "page" : "false"}" aria-label="Trabalhos: ${n} ${n === 1 ? "aberto" : "abertos"}" title="Trabalhos">${ICONE_TRABALHOS}${n ? `<span class="contagem-topo" aria-hidden="true">${n}</span>` : ""}</button>`;
}

// ---- gaveta e "Todos os trabalhos" (#196, K3/K9/M3) ----------------------------------------------------------------------

const GRUPOS: { chave: keyof GruposTrabalhos; titulo: string }[] = [
  { chave: "precisa", titulo: "Precisa de você" },
  { chave: "trabalhando", titulo: "Trabalhando" },
  // definido em 2026-10-12 (ADR-099, parte 1): quem só espera a volta marcada ou um colega, abaixo de quem trabalha.
  { chave: "esperando", titulo: "Esperando" },
  { chave: "fila", titulo: "Na fila" },
  { chave: "terminados", titulo: "Terminados hoje" },
];

function detalheDaLinha(t: TrabalhoDto, todos: readonly TrabalhoDto[], agora: number, segurando = false): string {
  if (!aberto(t)) return `${hora(t.terminadoEm ?? t.criadoEm)} · ${tempoDe(t, agora)}${t.estado === "terminado" ? "" : ` · ${situacaoDe(t)}`}`;
  return progresso(t, todos, agora, undefined, segurando);
}

/** O nível "Trabalhos" da gaveta do bot: os grupos de `GRUPOS`, só os que têm algo. */
export function renderGavetaTrabalhos(estado: Estado, agenteId: string): string {
  const bot = agente(estado, agenteId);
  const todos = trabalhosConhecidos(estado, bot?.conversaId);
  const grupos = agrupar(todos.filter((t) => t.agenteId === agenteId), estado.agora);
  const secoes = GRUPOS.filter((g) => grupos[g.chave].length > 0).map((g) => {
    const linhas = grupos[g.chave].map((t) => `<button type="button" class="gv-linha tr-linha" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, bot?.cor)}<span class="gv-linha-txt"><b>${tituloDaLinha(t, "gv-titulo")} ${etiqueta(t)}</b><small>${esc(detalheDaLinha(t, todos, estado.agora, estado.trabalhos?.segurando === true))}</small></span></button>`).join("");
    return `<section class="gv-secao tr-grupo" data-grupo="${g.chave}"><h3>${g.titulo} · ${grupos[g.chave].length}</h3><div class="gv-cartao">${linhas}</div></section>`;
  });
  if (!estado.trabalhos && secoes.length === 0) return '<p class="mudo">carregando…</p>';
  return secoes.join("") || '<p class="mudo">Nenhuma task hoje. Quando o bot abrir uma, ela aparece aqui — e no chat, numa linha.</p>';
}

/**
 * Contagem do topo de "Todos os trabalhos": "1 trabalhando · 11 esperando · 1 na fila · 2 precisam de você · os bots usam
 * 3,1 GB do seu Mac". Revisto em 2026-10-09 (a tela fala por máquina): a memória por máquina ("0,4 GB do seu Mac e 0,7 GB
 * na nod-motor-teste"). Revisto em 2026-10-12 (ADR-099, parte 1): "trabalhando" no lugar de "rodando", e quem só espera
 * conta à parte.
 */
function resumoDosTrabalhos(g: GruposTrabalhos, memoria: string): string {
  const partes = [
    `${g.trabalhando.length} trabalhando`,
    g.esperando.length ? `${g.esperando.length} esperando` : "",
    g.fila.length ? `${g.fila.length} na fila` : "",
    g.precisa.length ? `${g.precisa.length} ${g.precisa.length === 1 ? "precisa" : "precisam"} de você` : "",
    // definido em 2026-10-08 (QA): sem leitura útil (0 MB, harness sem processo próprio) a frase some em vez de dizer "0 MB".
    memoria,
  ];
  return partes.filter(Boolean).join(" · ");
}

/**
 * O custo de hoje no topo de Trabalhos (definido em 2026-10-12, ADR-099 §7: "custo visível, sem teto"). À vista, só o total
 * e, quando algum bot passou do ritmo, "acima do normal" — o Marlon quer a tela limpa. O clique abre quanto cada bot gastou
 * e quem passou do ritmo (a regra: src/domain/custo-do-dia.ts). Sem leitura (servidor anterior), nada.
 */
const SEM_BASE = "Menos de 3 dias com gasto nos últimos 7: ainda não dá para comparar.";

export function custoDoTopo(estado: Estado): string {
  const c = estado.custoHoje;
  if (!c) return "";
  const aberto = estado.custoAberto;
  const aviso = c.foraDoRitmo ? '<span class="tt-custo-aviso" aria-hidden="true"></span>' : "";
  // NOD-276 (D10): o total que deixou de fora turno sem custo conhecido diz "parcial".
  const rotulo = `${usd(c.totalUsd)} hoje${c.parcial ? " (parcial)" : ""}${c.foraDoRitmo ? " · acima do normal" : ""}`;
  const botao = `<button type="button" class="tt-custo${c.foraDoRitmo ? " fora" : ""}" data-act="custo-hoje" aria-expanded="${aberto}" title="Ver quanto cada bot gastou hoje">${aviso}${esc(rotulo)}${ICONE.abrir}</button>`;
  if (!aberto) return botao;
  const vezes = (v: number | null) => (v === null ? "" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× o normal`);
  const linhas = c.bots.map((b) => {
    const bot = agente(estado, b.agenteId);
    return `<li class="tt-custo-bot${b.foraDoRitmo ? " fora" : ""}">${bot ? iconeAgente(bot, "sm") : ""}<span class="tt-custo-nome">${esc(bot?.nome ?? "bot")}</span>${b.foraDoRitmo ? `<small>${esc(vezes(b.vezes))}</small>` : b.ritmo === "sem base" ? `<small title="${SEM_BASE}">sem base</small>` : ""}<b>${esc(usd(b.hojeUsd))}</b></li>`;
  }).join("");
  return `${botao}<div class="tt-custo-detalhe" role="group" aria-label="Custo de hoje por bot"><ul>${linhas || '<li class="mudo">Nenhum gasto hoje.</li>'}</ul><p>Desde a meia-noite. "Acima do normal" é mais que o dobro da média dos dias com gasto nos últimos 7 (precisa de pelo menos 3) até este horário.${c.parcial ? ` ${PARCIAL}` : ""}</p></div>`;
}

const FILTROS: { id: FiltroTrabalhos; nome: string }[] = [
  { id: "todos", nome: "Todos" },
  { id: "voce", nome: "De você" },
  { id: "rotinas", nome: "Rotinas" },
  { id: "bots", nome: "Entre bots" },
];

/**
 * "Todos os trabalhos" (K9/M3): os grupos da gaveta com os trabalhos de todos os bots, o filtro por origem e a memória
 * de cada um — os que mais usam primeiro. Sob pressão, a pílula de memória fica no topo.
 */
export function renderTodosOsTrabalhos(estado: Estado, filtro: FiltroTrabalhos = "todos"): string {
  if (!estado.trabalhos) return '<section class="tela-trabalhos"><p class="mudo">carregando…</p></section>';
  const todos = estado.trabalhos.trabalhos;
  const grupos = agrupar(filtrar(todos, filtro), estado.agora);
  const filtros = FILTROS.map((f) => `<button type="button" class="tt-filtro${f.id === filtro ? " ativo" : ""}" data-act="filtro-trabalhos" data-id="${f.id}" aria-pressed="${f.id === filtro}">${f.nome}</button>`).join("");
  const abertos = todos.filter(aberto).length;
  // ADR-085: a pílula de memória já diz que o Mac está apertado; sem ela, a do Mac ocupado (pelo uso que a pessoa escolheu).
  const segurando = estado.trabalhos.segurando === true;
  // #219: uma pílula só; o disco quase cheio vai na frente da de memória (é o que pede a mão da pessoa).
  const motivo = estado.trabalhos.motivoEspera ?? null;
  const esperam = todos.filter((t) => seguradoPeloMac(t, segurando)).length;
  // Revisto em 2026-10-09 (a tela fala por máquina): a pílula nomeia quem segura (o Mac ou a VM); a de memória é só do Mac.
  const maquinas = maquinasDe(estado.trabalhos);
  const pilula = maquinas
    ? pilulaDasMaquinas(maquinas.filter((m) => m.motivoEspera === "disco"), todos) || pilulaMemoria(leituraDoMac(estado.trabalhos).pressao, abertos, false) || pilulaDasMaquinas(maquinas, todos)
    : (motivo === "disco" ? pilulaMac(segurando, esperam, true, motivo) : "") || pilulaMemoria(estado.pressao, abertos, false) || pilulaMac(segurando, esperam, true, motivo);
  const linha = (t: TrabalhoDto): string => {
    const bot = agente(estado, t.agenteId);
    const mem = aberto(t) && t.memoriaMb !== null ? ` · ${memoriaLegivel(t.memoriaMb)}` : "";
    const fim = aberto(t) ? (t.estado === "na_fila" ? "" : tempoDe(t, estado.agora)) : hora(t.terminadoEm ?? t.criadoEm);
    const passo = situacaoDe(t, todos, segurando, estado.agora);
    // Revisão do Gil no #336: o passo corta (40%, some no estreito) — o title leva o texto inteiro e o que fazer.
    const dica = passo.includes(" · sem contato") ? dicaSemContato(t, estado.agora) : "";
    return `<button type="button" class="tt-linha" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, bot?.cor)}<span class="tt-bot">${bot ? iconeAgente(bot, "sm") : ""}<b>${esc(bot?.nome ?? "bot")}</b></span><span class="tt-meio">${tituloDaLinha(t, "tt-titulo")}${etiqueta(t)}<span class="tt-passo"${dica ? ` title="${esc(dica)}"` : ""}>${esc(passo)}</span></span><span class="tt-fim">${esc(fim + mem)}</span></button>`;
  };
  const secoes = GRUPOS.filter((g) => grupos[g.chave].length > 0).map((g) => `<section class="tt-grupo" data-grupo="${g.chave}"><h2>${g.titulo} · ${grupos[g.chave].length}${g.chave === "trabalhando" && grupos.trabalhando.some((t) => t.memoriaMb !== null) ? " · os que mais usam memória primeiro" : ""}</h2><div class="tt-lista">${grupos[g.chave].map(linha).join("")}</div></section>`).join("");
  const vazio = filtro === "todos" ? "Nenhum bot está trabalhando agora. Quando um bot abrir uma task, rodar uma rotina ou atender um colega, aparece aqui." : "Nada com este filtro hoje.";
  return `<section class="tela-trabalhos" aria-label="Todos os trabalhos">
    <header class="tt-cab"><div><h1>Trabalhos</h1><p>${esc(resumoDosTrabalhos(agrupar(todos, estado.agora), memoriaDosBots(estado.trabalhos)))}</p>${custoDoTopo(estado)}</div><div class="tt-filtros" role="group" aria-label="Filtrar trabalhos">${filtros}</div></header>
    ${pilulaDaCota(estado.trabalhos.cota, todos, estado.agora)}${pilula}
    ${secoes || `<p class="tt-vazio">${vazio}</p>`}
  </section>`;
}

// ---- a tela da task (#195, K2/K7) ---------------------------------------------------------------------------------------

function pedidaPor(t: TrabalhoDto, estado: Estado): string {
  if (t.origem === "colega") return `pedida pelo ${t.pedidoPorNome ?? agente(estado, t.pedidoPorAgenteId)?.nome ?? "colega"}`;
  if (t.origem === "rotina") return `da rotina ${t.rotinaNome ?? ""}`.trim();
  return "pedida por você";
}

/**
 * O topo da tela da task, no lugar do cabeçalho: o chip (ponto vivo, mascote, título, tempo) e a linha "task do Dev 1,
 * pedida pelo Chico · com os acessos do Dev 1 · pasta …". Quando o computador do bot está com outro trabalho, diz qual.
 */
export function renderTopoTrabalho(estado: Estado, id: string): string {
  const t = trabalhoPorId(estado, id);
  if (!t) return '<div class="tk-topo"><span class="tk-chip">carregando a task…</span></div>';
  const bot = agente(estado, t.agenteId);
  const nome = bot?.nome ?? "bot";
  // definido em 2026-10-08 (QA do épico, K7): no pedido de colega, o chip mostra quem pediu › quem faz.
  const pediu = t.origem === "colega" ? agente(estado, t.pedidoPorAgenteId) : undefined;
  const quemPediu = pediu ? `${iconeAgente(pediu, "sm")}<span class="tk-seta" aria-label="pediu a">${ICONE.seta}</span>` : "";
  // revisto em 2026-10-08 (protótipo "Nod — tempo da task", aprovado): no lugar do tempo total, o status curto ("esperando
  // Eng 2", "trabalhando"); o tempo trabalhado e o de espera ficam no cartão que o status abre.
  // Revisão do Gil no #336: a máquina sem contato também é espera — o topo nunca diz "trabalhando" (NOD-260, critério 3).
  const fora = emEspera(t);
  const status = !aberto(t) ? `${situacaoDe(t)} · ${tempoDe(t, estado.agora)}` : fora ? situacaoDe(t, [], false, estado.agora) : t.estado === "rodando" ? "trabalhando" : situacaoDe(t);
  const abertoCartao = estado.tempoTaskAberto === t.id;
  const botaoStatus = `<button type="button" class="tk-status${fora ? " fora-do-mac" : ""}" data-act="tempo-task" data-id="${esc(t.id)}" aria-expanded="${abertoCartao}" title="Ver o tempo da task">${esc(status)}${ICONE_ABRIR_TEMPO}</button>`;
  const chip = `<span class="tk-chip">${pontoTrabalho(t, bot?.cor)}${quemPediu}${bot ? iconeAgente(bot, "sm", t.estado === "rodando" && !fora ? "trabalhando" : "disponivel") : ""}<span class="tk-titulo">${esc(t.titulo)}</span>${botaoStatus}</span>`;
  const linha = [`task do ${nome}, ${pedidaPor(t, estado)}`, `com os acessos do ${nome}`, t.pasta ? `pasta ${t.pasta}` : "", t.custoUsd !== null ? `${usd(t.custoUsd)} até agora` : ""].filter(Boolean).join(" · ");
  const espera = t.esperandoComputadorDe ? `<p class="tk-espera" role="status">esperando o computador do ${esc(nome)} (em uso por: ${esc(t.esperandoComputadorDe)})</p>` : "";
  return `<div class="tk-topo">${chip}${abertoCartao ? cartaoDoTempo(t, estado.agora) : ""}<p class="tk-linha">${esc(linha)}</p>${espera}</div>`;
}

const ICONE_ABRIR_TEMPO = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"></path></svg>';

/**
 * O cartão do tempo (protótipo "Nod — tempo da task"): aberta há, a barra trabalhando × esperando e, quando espera um
 * colega, desde quando e o atalho para a task dele. A queda (máquina ou IA fora) ainda não é medida à parte: conta como espera.
 */
function cartaoDoTempo(t: TrabalhoDto, agora: number): string {
  const { abertaMs, trabalhouMs, esperouMs } = temposDaTask(t, agora);
  const pct = abertaMs > 0 ? Math.round((trabalhouMs / abertaMs) * 100) : 0;
  const colega = esperandoColega(t);
  const volta = voltaMarcada(t);
  // ADR-086 (combinado com o protótipo "Nod — tempo da task"): a espera não ocupa o Mac, e a pessoa vê que a task volta
  // sozinha — no próprio rodapé, um fecho só e a hora uma vez.
  const rodape = colega
    ? `<div class="tk-pop-rodape"><span>${esc(colega.nome)} recebeu o pedido às ${esc(hora(colega.desde))} · fora do Mac, volta sozinha</span>${colega.trabalhoId ? `<button type="button" class="tk-pop-link" data-act="abrir-trabalho" data-id="${esc(colega.trabalhoId)}">Ver task</button>` : ""}</div>`
    : volta ? `<div class="tk-pop-rodape"><span>fora do Mac · volta ${esc(quandoVolta(volta, agora))}</span></div>` : "";
  return `<div class="tk-pop" role="group" aria-label="Tempo da task">
    <div class="tk-pop-linha tk-pop-total"><span>${aberto(t) ? "Aberta há" : "Durou"}</span><b>${esc(duracaoCurta(abertaMs))}</b></div>
    <div class="tk-pop-barra" role="img" aria-label="Trabalhou ${esc(duracaoCurta(trabalhouMs))}, esperou ${esc(duracaoCurta(esperouMs))}"><span style="width:${pct}%"></span></div>
    <div class="tk-pop-linha"><span class="tk-pop-ponto trabalhou" aria-hidden="true"></span><span>Trabalhando</span><b>${esc(duracaoCurta(trabalhouMs))}</b></div>
    <div class="tk-pop-linha"><span class="tk-pop-ponto esperou" aria-hidden="true"></span><span>Esperando</span><b>${esc(duracaoCurta(esperouMs))}</b></div>
    ${rodape}
  </div>`;
}

function aberturaDaTask(t: TrabalhoDto, estado: Estado): string {
  const quem = t.pedidoPorNome ?? agente(estado, t.pedidoPorAgenteId)?.nome ?? "colega";
  const texto = t.origem === "colega" ? `pedido do ${quem} · a resposta volta para o ${quem}` : t.origem === "rotina" ? `execução da rotina ${t.rotinaNome ?? ""}`.trim() : t.origem === "rede" ? "a conversa virou task" : "aberta por você na conversa";
  return `<div class="time-sep">${esc(hora(t.criadoEm))} · ${esc(texto)}</div>`;
}

/**
 * O corpo da tela da task: a conversa com quem pediu (as mensagens do trabalho, inclusive as falas do meio, que não vão
 * ao chat) e os passos centralizados do turno que está rodando — os já feitos com ✓ e o de agora com o ponto vivo.
 * A junção das duas partes abaixo (os testes das telas leem a string inteira).
 */
export function renderTelaTrabalho(estado: Estado, id: string): string {
  return [...blocosDoHistoricoDaTask(estado, id), ...blocosAoVivoDaTask(estado, id)].map((b) => b.html).join("");
}

/**
 * O HISTÓRICO da tela da task em blocos com chave (definido em 2026-10-08, revisão W1, ADR-061): a abertura e uma
 * mensagem por bloco. Não lê `atividades`: main.ts o lembra (web/lib/lembrar.ts) e só o refaz quando chega mensagem
 * nova; o texto ao vivo não o toca — antes cada `turno.delta` regravava até 300 mensagens, perdia a seleção de texto e
 * re-hidratava os artefatos.
 */
export function blocosDoHistoricoDaTask(estado: Estado, id: string): BlocoDaTimeline[] {
  const d = estado.trabalhoDetalhe[id];
  const t = d?.trabalho ?? trabalhoPorId(estado, id);
  if (!t) return [{ chave: "carregando", html: '<p class="mudo tk-carregando">carregando a task…</p>' }];
  const mensagens = d ? d.mensagens.map((m) => ({ chave: m.id, html: renderMensagem(m, estado) })) : [{ chave: "carregando", html: '<p class="mudo tk-carregando">carregando a conversa da task…</p>' }];
  return [{ chave: "abertura", html: aberturaDaTask(t, estado) }, ...mensagens];
}

/** O AO VIVO da tela da task: os passos feitos, o de agora (ou o texto que o bot escreve) e a linha do fim. */
export function blocosAoVivoDaTask(estado: Estado, id: string): BlocoDaTimeline[] {
  const t = estado.trabalhoDetalhe[id]?.trabalho ?? trabalhoPorId(estado, id);
  if (!t) return [];
  const bot = agente(estado, t.agenteId);
  const a = atividadeDe(estado, t);
  const feitos = (a?.etapas ?? []).map((e) => `<div class="passo"><span class="passo-ok" aria-hidden="true">✓</span><span>${esc(resumoEtapa(e.texto))}</span></div>`).join("");
  const agora = t.estado === "rodando" && a
    ? a.atual.trim() && a.ferramentas === 0
      ? `<article class="message bot streaming ao-vivo">${bot ? iconeAgente(bot, "md", "trabalhando") : ""}<div class="bubble-wrap"><div class="bubble">${textoFormatado(a.atual, { chave: `task:${t.id}`, aoVivo: true })}<span class="cursor">▍</span></div></div></article>`
      : `<div class="passo passo-agora"><span class="ponto-trabalho ${esc(bot?.cor ?? "")} pulso-trab" aria-hidden="true"></span><span>${esc(linhaAtual(a))}</span></div>`
    : t.estado === "rodando"
      ? `<div class="passo passo-agora"><span class="ponto-trabalho ${esc(bot?.cor ?? "")} pulso-trab" aria-hidden="true"></span><span>${esc(t.ultimoPasso ?? "trabalhando…")}</span></div>`
      : "";
  const fim = !aberto(t) ? `<div class="linha-centro-wrap"><span class="linha-centro estatica"><span class="linha-ok" aria-hidden="true">${t.estado === "terminado" ? "✓" : "■"}</span><b>${esc(t.titulo)}</b><span>${esc(situacaoDe(t))} · ${esc(tempoDe(t, estado.agora))}${t.custoUsd !== null ? ` · ${esc(usd(t.custoUsd))}` : ""}</span></span></div>` : "";
  return [{ chave: "passos", html: feitos }, { chave: "agora", html: agora }, { chave: "fim", html: fim }].filter((b) => b.html !== "");
}

/** Os botões embaixo do campo da task: Parar task (só com ela aberta; main.ts esconde ao terminar) e Fechar. */
export function htmlAcoesDaTask(id: string): string {
  return `<div class="tk-acoes">${botao("parar-trabalho", "Parar task", { id, classe: "tk-parar" })}${botao("fechar-trabalho", "Fechar", { classe: "tk-fechar" })}</div>`;
}

// ---- a tela provisória de uma linha (#191) ------------------------------------------------------------------------------

/** As mensagens que uma linha sem trabalho recolheu (execuções antigas de rotina, pedido a colega antigo), com Fechar. */
export function renderTelaLinha(estado: Estado, tela: Extract<Tela, { tipo: "linha" }>): string {
  const c = estado.conversas[tela.conversaId];
  const ids = new Set(tela.mensagens);
  const mensagens = (c?.mensagens ?? []).filter((m) => ids.has(m.id));
  const corpo = !c ? '<p class="mudo">carregando…</p>' : mensagens.length ? mensagens.map((m) => renderMensagem(m, estado)).join("") : '<p class="mudo">Essas mensagens saíram da janela carregada da conversa.</p>';
  if (tela.rotina && c && mensagens.length) return telaDaLinhaDaRotina(tela.titulo, mensagens, estado);
  const quando = mensagens.length ? `<div class="time-sep">${esc(hora(mensagens[0]?.criadoEm ?? 0))}${mensagens.length > 1 ? ` a ${esc(hora(mensagens[mensagens.length - 1]?.criadoEm ?? 0))}` : ""} · ${mensagens.length} ${mensagens.length === 1 ? "mensagem" : "mensagens"}</div>` : "";
  return `<div class="tk-topo"><span class="tk-chip"><span class="tk-titulo">${esc(tela.titulo)}</span></span></div>${quando}${corpo}<div class="tk-acoes">${botao("fechar-trabalho", "Fechar", { classe: "tk-fechar" })}</div>`;
}

/**
 * A linha "… rodou N vezes · nada para você" aberta (definido em 2026-10-08, QA do épico, prancha R2 aprovada): o chip
 * com o relógio da rotina, "N execuções · 09:10 e 09:20" embaixo, e cada execução com a sua separação "09:10 · sem nada
 * para você" e as falas dela. Antes a tela juntava tudo como "5 mensagens", sem dizer onde uma execução acabava.
 */
function telaDaLinhaDaRotina(titulo: string, mensagens: readonly Mensagem[], estado: Estado): string {
  const execucoes = new Map<string, Mensagem[]>();
  for (const m of mensagens) execucoes.set(m.turnoId ?? m.id, [...(execucoes.get(m.turnoId ?? m.id) ?? []), m]);
  const grupos = [...execucoes.values()];
  const inicios = grupos.map((g) => g[0]?.criadoEm ?? 0);
  const n = grupos.length;
  const topo = `<div class="tk-topo"><span class="tk-chip"><span class="linha-ic" aria-hidden="true">${ICONE.relogio}</span><span class="tk-titulo">${esc(titulo)}</span></span><p class="tk-linha">${n} ${n === 1 ? "execução" : "execuções"} · ${esc(horariosDaRotina(inicios))}</p></div>`;
  const corpo = grupos.map((g) => `<div class="time-sep">${esc(hora(g[0]?.criadoEm ?? 0))} · sem nada para você</div>${g.map((m) => renderMensagem(m, estado)).join("")}`).join("");
  return `${topo}${corpo}<div class="tk-acoes">${botao("fechar-trabalho", "Fechar", { classe: "tk-fechar" })}</div>`;
}
