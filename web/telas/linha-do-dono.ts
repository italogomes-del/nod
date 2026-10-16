import type { DonoDto } from "../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { linhaAtual, resumoEtapa } from "../lib/atividade.ts";
import { conversaViva, donoDoBot, esperaNaTela, fraseDoDono, frentesDoBot, grupoDaLinha, linhaDoDono, quemPediu, temDonos, type GrupoDoBot, type LinhaDoDono } from "../lib/dono.ts";
import { ICONE } from "../lib/icones.ts";
import { duracaoCurta } from "../lib/relogio.ts";
import { esc, hora, iconeAgente } from "../lib/render.ts";
import { aberto, etiquetaOrigem, maquinasDe, meiaNoiteDe, memoriaDosBots, pilulaDaCota, pilulaDasMaquinas, pilulaMac, pilulaMemoria, leituraDoMac, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe, tituloCurto, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { agente, chipTrabalhosDoBot, custoDoTopo, renderFaixaTrabalhos } from "./trabalhos.ts";

/**
 * O dono de cada bot na tela (definido em 2026-10-12, ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/,
 * quadros 02–08): a linha acima do campo da conversa (uma só, nunca pilha; aberta, as frentes, as esperas e a fila), o
 * sinal do bot na barra lateral e a tela Trabalhos com uma linha por bot. As frases saem de web/lib/dono.ts; aqui, o HTML.
 * Servidor sem o dono (anterior ao I10): as telas de antes (a faixa de tasks, o chip com o número, a lista por task).
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Os pontos da linha: um azul (você), um vivo por frente até 3 (acima disso, um e o número), um vazado, ou o número da fila. */
function pontos(l: Pick<LinhaDoDono, "sinal" | "quantos">, cor: string | undefined): string {
  if (l.sinal === "voce") return '<span class="ld-pontos" aria-hidden="true"><span class="ponto-trabalho precisa"></span></span>';
  if (l.sinal === "espera") return '<span class="ld-pontos" aria-hidden="true"><span class="ponto-trabalho fora-do-mac"></span></span>';
  if (l.sinal === "fila") return `<span class="ld-pontos ld-num" aria-hidden="true">${l.quantos}</span>`;
  const vivo = `<span class="ponto-trabalho ${esc(cor ?? "")} pulso-trab"></span>`;
  return `<span class="ld-pontos" aria-hidden="true">${l.quantos > 3 ? `${vivo}<span class="ld-n">${l.quantos}</span>` : vivo.repeat(l.quantos)}</span>`;
}

/** As decisões abertas do bot (a mais nova primeiro): o "Esperando você" leva até a mensagem dela na conversa. */
function decisoesDoBot(estado: Estado, agenteId: string): { id: string; frase: string; desde: number }[] {
  const itens = (estado.suaVez?.itens ?? []).filter((i) => i.decisao.agenteId === agenteId && i.estadoColuna !== "vencido");
  return itens.map((i) => ({ id: i.decisao.id, frase: i.decisao.frase, desde: Date.parse(i.decisao.criadoEm) })).sort((a, b) => b.desde - a.desde);
}

/** Quantas decisões abertas desta conversa a fila da pessoa traz (as que a faixa do campo já mostra). */
function decisoesNaConversa(estado: Estado, conversaId: string): number {
  return (estado.suaVez?.itens ?? []).filter((i) => i.decisao.conversaId === conversaId && i.estadoColuna !== "vencido").length;
}

// ---- a linha acima do campo (quadros 02, 03, 06, 07 e 08) ------------------------------------------------------------

/**
 * A linha acima do campo da conversa do bot. Fechada: o estado de maior prioridade em negrito e o resto em contagem
 * ("Esperando a CI do #845 · 38 min · 2 pedidos na fila"), e "detalhes" à direita; some quando o bot está livre. Aberta
 * (`faixaTrabalhosAberta`), embaixo da mesma linha: Esperando você, Frentes, Esperando e Na fila. "Esperando você" leva à
 * mensagem do bot com a pergunta — a decisão fica na conversa, nunca aqui.
 */
export function renderLinhaDoDono(estado: Estado, agenteId: string): string {
  const bot = agente(estado, agenteId);
  const dono = donoDoBot(estado, agenteId, bot?.conversaId);
  if (!dono) return renderFaixaTrabalhos(estado, agenteId);
  // O que espera a pessoa nesta conversa já tem a faixa no alto do campo ("Ze 2 está esperando sua resposta", ADR-045, com
  // Responder/Outro assunto; "1 coisa espera você" para os pedidos): a linha não repete — fica com o resto (as frentes, a
  // espera, a fila). "Esperando você" sobra só para o que a faixa não mostra (a frente parada à espera, sem decisão).
  const naFaixa = bot?.conversaId ? decisoesNaConversa(estado, bot.conversaId) : 0;
  const visto = naFaixa > 0 ? { ...dono, estado: { ...dono.estado, esperandoVoce: Math.max(0, dono.estado.esperandoVoce - naFaixa) } } : dono;
  const l = linhaDoDono(visto, estado.agora);
  if (!l) return "";
  const nome = bot?.nome ?? "bot";
  const aberta = estado.faixaTrabalhosAberta === agenteId;
  const resumo = `${l.texto}${l.extras.length ? ` · ${l.extras.join(" · ")}` : ""}`;
  const extras = l.extras.length ? `<span class="ld-extras"> · ${esc(l.extras.join(" · "))}</span>` : "";
  const decisao = decisoesDoBot(estado, agenteId)[0];
  // "Esperando você": o texto leva à pergunta; o resto da linha abre o detalhe.
  const principal = l.sinal === "voce"
    ? `<button type="button" class="ld-principal" data-act="ir-a-pergunta"${decisao ? ` data-id="${esc(decisao.id)}"` : ""} title="Ver a pergunta na conversa">${pontos(l, bot?.cor)}<span class="ld-texto"><b>${esc(l.texto)}</b>${extras}</span></button>`
    : `<button type="button" class="ld-principal" data-act="faixa-trabalhos" data-recolher="${aberta ? 1 : 0}" aria-expanded="${aberta}">${pontos(l, bot?.cor)}<span class="ld-texto"><b>${esc(l.texto)}</b>${extras}</span></button>`;
  const detalhes = `<button type="button" class="ld-detalhes" data-act="faixa-trabalhos" data-recolher="${aberta ? 1 : 0}" aria-expanded="${aberta}" aria-label="${aberta ? "Fechar" : "Ver"} os detalhes de ${esc(nome)}"><span class="ld-detalhes-txt">${aberta ? "fechar" : "detalhes"}</span>${aberta ? ICONE.recolher : ICONE.abrir}</button>`;
  // No celular o detalhe é uma folha por cima da conversa; o fundo escurecido a fecha ao toque (mobile.css).
  const corpo = aberta ? `<button type="button" class="ld-fundo" data-act="faixa-trabalhos" data-recolher="1" tabindex="-1" aria-hidden="true"></button>${detalheDoDono(estado, visto, agenteId, bot)}` : "";
  return `<section class="linha-dono${aberta ? " aberta" : ""}" data-sinal="${l.sinal}" aria-label="${esc(`${nome}: ${resumo}`)}"><div class="ld-barra">${principal}${detalhes}</div>${corpo}</section>`;
}

/** A linha aberta: as seções que têm algo, na ordem do quadro 03 (no celular, uma folha que cobre a tela). */
function detalheDoDono(estado: Estado, dono: DonoDto, agenteId: string, bot: Agente | undefined): string {
  const todos = trabalhosConhecidos(estado, bot?.conversaId);
  const { abertas, terminadas } = frentesDoBot(todos, agenteId, meiaNoiteDe(estado.agora));
  const secoes: string[] = [];
  const decisoes = decisoesDoBot(estado, agenteId);
  if (dono.estado.esperandoVoce > 0) {
    const linhas = decisoes.length
      ? decisoes.slice(0, 3).map((d) => `<button type="button" class="ld-item" data-act="ir-a-pergunta" data-id="${esc(d.id)}"><span class="ponto-trabalho precisa" aria-hidden="true"></span><span class="ld-item-titulo">${esc(d.frase)}</span><span class="ld-item-fim">ver na conversa ›</span></button>`).join("")
      : `<button type="button" class="ld-item" data-act="ir-a-pergunta"><span class="ponto-trabalho precisa" aria-hidden="true"></span><span class="ld-item-titulo">A pergunta está na conversa</span><span class="ld-item-fim">ver ›</span></button>`;
    secoes.push(secao("Esperando você", linhas));
  }
  if (abertas.length || terminadas.length) {
    const trabalhando = dono.estado.frentes;
    const titulo = abertas.length ? `Frentes${trabalhando ? ` · ${trabalhando} trabalhando` : ""}` : "Frentes de hoje";
    secoes.push(secao(titulo, [...abertas.map((t) => linhaDaFrente(estado, t, todos, bot)), ...terminadas.slice(-5).map((t) => linhaTerminada(t))].join("")));
  }
  if (dono.esperas.length) {
    const titulo = (id: string | null) => (id ? todos.find((t) => t.id === id)?.titulo ?? null : null);
    const linhas = dono.esperas.map((e) => {
      const v = esperaNaTela(e, estado.agora, titulo(e.trabalhoId));
      const cab = `<span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span>${v.comando ? `<code class="ld-comando">${esc(v.titulo)}</code>` : `<span class="ld-item-titulo">${esc(v.titulo)}</span>`}<span class="ld-item-fim">${esc(v.tempo)}</span>`;
      return `<div class="ld-espera"><div class="ld-item estatico">${cab}</div>${v.linhas.map((x, i) => `<p class="ld-sub${i === 0 && x.startsWith("última linha") ? " mono" : ""}">${esc(x)}</p>`).join("")}</div>`;
    }).join("");
    secoes.push(secao("Esperando", linhas));
  }
  if (dono.fila.length) {
    const linhas = dono.fila.map((p, i) => `<div class="ld-item estatico"><span class="ld-ordem" aria-hidden="true">${i + 1}</span><span class="ld-item-titulo">${esc(capital(quemPediu(p)))}</span><span class="ld-item-fim">${esc(hora(p.desde))}</span></div>`).join("");
    secoes.push(secao("Na fila", linhas));
  }
  const fechar = `<button type="button" class="ld-folha-fechar" data-act="faixa-trabalhos" data-recolher="1" aria-label="Fechar os detalhes">${ICONE.abrir}</button>`;
  return `<div class="ld-detalhe" role="group" aria-label="Detalhes de ${esc(bot?.nome ?? "bot")}"><div class="ld-folha-cab"><b>${esc(bot?.nome ?? "bot")}</b>${fechar}</div>${secoes.join("") || '<p class="ld-vazio">Nada em andamento.</p>'}</div>`;
}

const secao = (titulo: string, corpo: string): string => `<div class="ld-secao"><h3>${esc(titulo)}</h3>${corpo}</div>`;

/**
 * Uma frente aberta: o ponto, o título, o último passo e o tempo; o clique abre os passos dela (os feitos com ✓ e o de
 * agora com o ponto vivo, como a tela da task) e o atalho para a tela da task.
 */
function linhaDaFrente(estado: Estado, t: TrabalhoDto, todos: readonly TrabalhoDto[], bot: Agente | undefined): string {
  const a = t.turnoVivoId ? estado.atividades[t.conversaId]?.[t.turnoVivoId] : undefined;
  const passo = a && t.estado === "rodando" ? linhaAtual(a) : situacaoDe(t, todos, estado.trabalhos?.segurando === true, estado.agora);
  const tempo = t.estado === "na_fila" ? "" : tempoDe(t, estado.agora);
  const curto = tituloCurto(t.titulo);
  const aberta = estado.frenteAberta === t.id;
  const linha = `<button type="button" class="ld-item ld-frente" data-act="frente-aberta" data-id="${esc(t.id)}" aria-expanded="${aberta}"${curto === t.titulo ? "" : ` title="${esc(t.titulo)}"`}>${pontoTrabalho(t, bot?.cor)}<b class="ld-item-titulo">${esc(curto)}</b><span class="ld-passo">${esc(passo)}</span><span class="ld-item-fim">${esc(tempo)}</span>${aberta ? ICONE.recolher : ICONE.abrir}</button>`;
  if (!aberta) return linha;
  const feitos = (a?.etapas ?? []).map((e) => `<li><span class="passo-ok" aria-hidden="true">✓</span><span>${esc(resumoEtapa(e.texto))}</span></li>`).join("");
  const agora = t.estado === "rodando" && t.turnoVivoId ? `<li class="ld-agora"><span class="ponto-trabalho ${esc(bot?.cor ?? "")} pulso-trab" aria-hidden="true"></span><span>${esc(a ? linhaAtual(a) : t.ultimoPasso ?? "trabalhando…")}</span></li>` : "";
  const quem = `${etiquetaOrigem(t)}${aberto(t) && t.estado !== "na_fila" ? ` · aberta há ${tempoDe(t, estado.agora)}` : ""}`;
  return `${linha}<div class="ld-passos"><ul>${feitos}${agora || (feitos ? "" : `<li class="ld-sem-passos">${esc(passo)}</li>`)}</ul><p class="ld-sub">${esc(quem)}<button type="button" class="tk-pop-link" data-act="abrir-trabalho" data-id="${esc(t.id)}">Abrir a frente</button></p></div>`;
}

/** Uma frente que terminou hoje: ✓ (■ parou, ! falhou), o título e a hora; o clique abre a tela da task. */
function linhaTerminada(t: TrabalhoDto): string {
  return `<button type="button" class="ld-item" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, undefined)}<span class="ld-item-titulo">${esc(tituloCurto(t.titulo))}</span><span class="ld-item-fim">${esc(hora(t.terminadoEm ?? t.criadoEm))}</span></button>`;
}

// ---- a barra lateral (quadro 01 × o desenho) ----------------------------------------------------------------------------

/**
 * O sinal do bot ao lado do nome: um só — ponto vivo trabalhando (com o número de frentes, se mais de uma), vazado só
 * esperando (ou só com fila), azul quando precisa de você; o `title` diz a frase inteira ("1 trabalhando · 10
 * esperando"). Só lê `GET trabalhos` (a barra é lembrada pelo que lê, web/lib/lembrar.ts); por isso o turno da própria
 * conversa não conta aqui — o mascote já anima. Sem o dono no servidor, o chip de antes.
 */
export function sinalDoBot(estado: Estado, a: Pick<Agente, "id" | "cor" | "conversaId">): string {
  if (!temDonos(estado)) return chipTrabalhosDoBot(estado, a);
  const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === a.id);
  const l = dono ? linhaDoDono(dono, 0) : null;
  if (!dono || !l) return "";
  const frase = fraseDoDono({ ...dono, estado: { ...dono.estado, conversaTrabalhando: false, conversaPropriaTrabalhando: false } });
  const ponto = l.sinal === "voce" ? "precisa" : l.sinal === "vivo" ? `${esc(a.cor)} pulso-trab` : "fora-do-mac";
  const n = l.sinal === "vivo" && dono.estado.frentes > 1 ? `<span class="sinal-n">${dono.estado.frentes}</span>` : "";
  return `<span class="chip-trab sinal-dono" data-sinal="${l.sinal}" title="${esc(frase)}" aria-label="${esc(frase)}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span>${n}</span>`;
}

// ---- Trabalhos com uma linha por bot (quadro 05) ----------------------------------------------------------------------

const GRUPOS: { chave: GrupoDoBot; titulo: string }[] = [
  { chave: "precisa", titulo: "Precisa de você" },
  { chave: "trabalhando", titulo: "Trabalhando" },
  { chave: "esperando", titulo: "Esperando" },
];

type LinhaDoBot = { bot: Agente; dono: DonoDto; linha: LinhaDoDono; grupo: GrupoDoBot };

/** A frase e o detalhe curto do bot em Trabalhos: a pergunta (ou "Esperando você"), a frente que trabalha, a espera. */
function fraseDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): { frase: string; detalhe: string; tempo: string } {
  const e = x.dono.estado;
  const desde = e.desde ?? estado.agora;
  if (x.grupo === "precisa") {
    const d = decisoesDoBot(estado, x.bot.id)[0];
    // A frase da fila da pergunta é "parei para perguntar a Marlon: <a pergunta>"; aqui só a pergunta.
    const frase = d?.frase.replace(/^parei para perguntar a [^:]{1,60}:\s*/, "") || "Esperando você";
    return { frase, detalhe: x.linha.extras.join(" · "), tempo: `há ${duracaoCurta(estado.agora - desde)}` };
  }
  if (x.grupo === "trabalhando") {
    // Uma frente só trabalhando: o título dela é a frase (quadro 05); mais de uma, "Trabalhando em N frentes".
    const vivas = todos.filter((t) => t.agenteId === x.bot.id && t.estado === "rodando" && t.turnoVivoId);
    const frase = vivas.length === 1 && vivas[0] ? tituloCurto(vivas[0].titulo) : x.linha.texto;
    return { frase, detalhe: x.linha.extras.join(" · "), tempo: `desde ${hora(desde)}` };
  }
  // Esperando: o tempo já vai à direita ("desde 17:58"); a duração sai do detalhe.
  return { frase: x.linha.texto, detalhe: x.linha.extras.filter((s) => !/^(\d+ min|menos de 1 min|\d+h|\d+ d)$/.test(s)).join(" · "), tempo: `desde ${hora(desde)}` };
}

/** "2 bots trabalhando · 1 esperando · 1 precisa de você" e, quando há leitura, a memória dos bots em cada máquina. */
function resumoPorBot(linhas: readonly LinhaDoBot[], memoria: string): string {
  const n = (g: GrupoDoBot) => linhas.filter((l) => l.grupo === g).length;
  const t = n("trabalhando");
  const partes = [
    `${t} ${t === 1 ? "bot trabalhando" : "bots trabalhando"}`,
    n("esperando") ? `${n("esperando")} esperando` : "",
    n("precisa") ? `${n("precisa")} ${n("precisa") === 1 ? "precisa" : "precisam"} de você` : "",
    memoria,
  ];
  return partes.filter(Boolean).join(" · ");
}

/**
 * Trabalhos com uma linha por bot (ADR-099 item 10): Precisa de você, Trabalhando e Esperando (pelo sinal da linha do
 * dono), e "Livres: …" numa linha no fim. Cada linha: ponto, mascote, nome, a frase e o detalhe curto, o tempo; o clique
 * abre as frentes do bot embaixo dela (quadro 05). O custo de hoje e as pílulas da cota e das máquinas ficam no topo.
 */
export function renderTrabalhosPorBot(estado: Estado): string {
  if (!estado.trabalhos) return '<section class="tela-trabalhos"><p class="mudo">carregando…</p></section>';
  const todos = estado.trabalhos.trabalhos;
  const linhas: LinhaDoBot[] = [];
  const livres: Agente[] = [];
  for (const dono of estado.trabalhos.donos ?? []) {
    const bot = agente(estado, dono.estado.agenteId);
    if (!bot) continue;
    const vivaAgora = conversaViva(estado, bot.conversaId);
    const viva = { ...dono, estado: { ...dono.estado, conversaTrabalhando: vivaAgora, conversaPropriaTrabalhando: vivaAgora } };
    const linha = linhaDoDono(viva, estado.agora, { comConversa: true });
    const grupo = grupoDaLinha(linha);
    if (linha && grupo) linhas.push({ bot, dono: viva, linha, grupo });
    else livres.push(bot);
  }
  const secoes = GRUPOS.map((g) => {
    const doGrupo = linhas.filter((l) => l.grupo === g.chave).sort((a, b) => (a.dono.estado.desde ?? 0) - (b.dono.estado.desde ?? 0));
    if (!doGrupo.length) return "";
    return `<section class="tt-grupo tb-grupo" data-grupo="${g.chave}"><h2>${g.titulo} · ${doGrupo.length}</h2><div class="tt-lista">${doGrupo.map((x) => linhaDoBot(estado, x, todos)).join("")}</div></section>`;
  }).join("");
  const nomesLivres = livres.map((b) => b.nome);
  const livresHtml = nomesLivres.length ? `<p class="tb-livres">Livres: ${esc(nomesLivres.join(", "))}</p>` : "";
  const vazio = linhas.length ? "" : `<p class="tt-vazio">Nenhum bot está trabalhando agora. Quando um bot começar uma frente, esperar algo ou precisar de você, aparece aqui.</p>`;
  return `<section class="tela-trabalhos" aria-label="Trabalhos">
    <header class="tt-cab"><div><h1>Trabalhos</h1><p>${esc(resumoPorBot(linhas, memoriaDosBots(estado.trabalhos)))}</p>${custoDoTopo(estado)}</div></header>
    ${pilulaDaCota(estado.trabalhos.cota, todos, estado.agora)}${pilulaDoTopo(estado)}
    ${secoes}${vazio}${livresHtml}
  </section>`;
}

/** A pílula das máquinas ou da memória no topo (a mesma regra de "Todos os trabalhos": o disco primeiro, uma pílula só). */
function pilulaDoTopo(estado: Estado): string {
  const dto = estado.trabalhos;
  if (!dto) return "";
  const todos = dto.trabalhos;
  const abertos = todos.filter(aberto).length;
  const segurando = dto.segurando === true;
  const maquinas = maquinasDe(dto);
  if (maquinas) return pilulaDasMaquinas(maquinas.filter((m) => m.motivoEspera === "disco"), todos) || pilulaMemoria(leituraDoMac(dto).pressao, abertos, false) || pilulaDasMaquinas(maquinas, todos);
  const motivo = dto.motivoEspera ?? null;
  const esperam = todos.filter((t) => seguradoPeloMac(t, segurando)).length;
  return (motivo === "disco" ? pilulaMac(segurando, esperam, true, motivo) : "") || pilulaMemoria(estado.pressao, abertos, false) || pilulaMac(segurando, esperam, true, motivo);
}

function linhaDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { frase, detalhe, tempo } = fraseDoBot(estado, x, todos);
  const aberta = estado.botAbertoEmTrabalhos === x.bot.id;
  const ponto = x.linha.sinal === "voce" ? "precisa" : x.linha.sinal === "vivo" ? `${esc(x.bot.cor)} pulso-trab` : "fora-do-mac";
  const linha = `<button type="button" class="tt-linha tb-linha" data-act="bot-trabalhos" data-agente="${esc(x.bot.id)}" aria-expanded="${aberta}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span><span class="tt-bot">${iconeAgente(x.bot, "sm")}<b>${esc(x.bot.nome)}</b></span><span class="tt-meio"><span class="tt-titulo">${esc(frase)}</span>${detalhe ? `<span class="tt-passo">${esc(detalhe)}</span>` : ""}</span><span class="tt-fim">${esc(tempo)}</span>${aberta ? ICONE.recolher : ICONE.seta}</button>`;
  return aberta ? linha + frentesAbertasDoBot(estado, x, todos) : linha;
}

/** As frentes do bot aberto em Trabalhos (quadro 05): abertas, terminadas hoje, as esperas da conversa e a fila. */
function frentesAbertasDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { abertas, terminadas } = frentesDoBot(todos, x.bot.id, meiaNoiteDe(estado.agora));
  const frente = (t: TrabalhoDto): string => {
    const fim = aberto(t) ? (t.estado === "na_fila" ? "na fila" : `frente · ${tempoDe(t, estado.agora)}`) : hora(t.terminadoEm ?? t.criadoEm);
    return `<button type="button" class="tb-frente" data-act="abrir-trabalho" data-id="${esc(t.id)}">${pontoTrabalho(t, x.bot.cor)}<span class="tb-frente-titulo">${esc(tituloCurto(t.titulo))}</span><span class="tb-frente-passo">${esc(aberto(t) ? situacaoDe(t, todos, false, estado.agora) : "")}</span><span class="tb-frente-fim">${esc(fim)}</span></button>`;
  };
  const daConversa = x.dono.esperas.filter((e) => e.trabalhoId === null).map((e) => {
    const v = esperaNaTela(e, estado.agora);
    return `<div class="tb-frente estatica"><span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span><span class="tb-frente-titulo">${esc(v.titulo)}</span><span class="tb-frente-passo">${esc(v.linhas.at(-1) ?? "")}</span><span class="tb-frente-fim">${esc(v.tempo)}</span></div>`;
  }).join("");
  const fila = x.dono.fila.map((p, i) => `<div class="tb-frente estatica"><span class="ld-ordem" aria-hidden="true">${i + 1}</span><span class="tb-frente-titulo">Na fila: ${esc(quemPediu(p))}</span><span class="tb-frente-passo"></span><span class="tb-frente-fim">${esc(hora(p.desde))}</span></div>`).join("");
  const corpo = [...abertas.map(frente), daConversa, ...terminadas.map(frente), fila].join("");
  const conversa = `<button type="button" class="tb-abrir-conversa" data-act="abrir-conversa" data-conversa="${esc(x.bot.conversaId)}" data-agente="${esc(x.bot.id)}">Abrir a conversa com ${esc(x.bot.nome)} ›</button>`;
  return `<div class="tb-frentes" role="group" aria-label="Frentes de ${esc(x.bot.nome)}">${corpo || '<p class="tb-sub">Nenhuma frente hoje.</p>'}${conversa}</div>`;
}
