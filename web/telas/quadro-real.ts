/**
 * NOD-442 (definido em 2026-10-31): o quadro de verdade, montado com os componentes da NOD-429 (web/telas/quadro.ts).
 * Três pedaços, desenhados em separado por web/lib/quadro-na-tela.ts (o campo da pílula nunca é regravado enquanto a
 * pessoa digita):
 * - `conteudoDoQuadro`: a meta, a barra, a grade (computador) e a lista por estado (celular), ou a tarefa aberta;
 * - `faixaDoQuadro`: a resposta do bot numa linha de vidro por cima da pílula (carregando, a resposta com Desfazer, o erro);
 * - `pilulaDoQuadro`: a conversa no próprio quadro (passo 9 do protótipo), que fala com o bot anfitrião.
 * Todo texto (título, descrição, pergunta, resposta, meta) é dado e passa por `esc`.
 */
import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import { colunasPadrao, NOME_DO_STATUS, type Status } from "../lib/quadro.ts";
import { codigoDaTarefa, fraseDoPrazo, tarefasPorStatus, type Faixa } from "../lib/quadro-dados.ts";
import { anel, avatar, barra, card, confiar, ICONE, ICONE_DO_STATUS, linha, lista, meta, quadro, seloEmTeste, type Card, type Filtro, type Html, type QuemRoda } from "./quadro.ts";

/** Quem é o agente de um id (o avatar com o mascote dele e o nome); null = não é um bot da pessoa. */
export type AgenteDoQuadro = (agenteId: string) => { avatar: Html; nome: string } | null;

const VOCE = { avatar: anel("V", "Você", true), nome: "Você" };
const VAZIO_DO_BACKLOG = "Diga o que entra, ou peça para trazer do Linear.";
const LIMITE_RESPOSTA = 4000;
const LIMITE_PEDIDO = 4000;

const numeroDoPr = (url: string): string => {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
};
/** Só http(s) vira link (a rota já valida; aqui é a segunda trava, para um dado velho). */
const linkSeguro = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** A tarefa como card: o responsável (bot ou você), a execução, o motivo do bloqueio e a pergunta para você. */
export function cardDaTarefa(t: TarefaDto, agente: AgenteDoQuadro, acesa = false): Card {
  const resp = t.status === "voce" ? VOCE : t.agenteId ? agente(t.agenteId) : null;
  const tags = [t.prUrl ? numeroDoPr(t.prUrl) : "", t.linearId ? "Linear" : ""].filter(Boolean);
  return {
    id: t.id,
    codigo: codigoDaTarefa(t),
    titulo: t.titulo,
    ...(resp ? { responsavel: resp } : {}),
    ...(t.execucao ? { estado: t.execucao } : {}),
    ...(t.status === "bloqueado" ? { motivo: t.pergunta ?? "bloqueada" } : {}),
    ...(t.status === "voce" ? { voce: t.pergunta ?? "Precisa de você" } : {}),
    ...(tags.length ? { tags } : {}),
    ...(acesa ? { brilho: true } : {}),
  };
}

const passaNoFiltro = (t: TarefaDto, f: Filtro): boolean => (f === "todos" ? true : f === "pessoas" ? t.status === "voce" || !t.agenteId : !!t.agenteId && t.status !== "voce");

/** Quem roda agora (o anel na barra), sem repetir o mesmo bot. */
function trabalhando(q: QuadroDto, agente: AgenteDoQuadro): QuemRoda[] {
  const vistos = new Set<string>();
  const r: QuemRoda[] = [];
  for (const t of q.tarefas) {
    if (t.execucao !== "rodando" || !t.agenteId || vistos.has(t.agenteId)) continue;
    vistos.add(t.agenteId);
    const a = agente(t.agenteId);
    if (a) r.push(a);
  }
  return r;
}

/** A linha da meta: "Lançar as seções · até 6 nov · 2 de 8 feitas", "cumprida" quando fecha, "nenhuma tarefa ainda" no começo. */
function metaDoQuadro(q: QuadroDto): Html {
  const falta = q.cumpridoEm ? "cumprida" : q.total === 0 ? "nenhuma tarefa ainda" : "";
  return meta({ objetivo: q.meta, prazo: fraseDoPrazo(q.prazo), feitas: q.feitas, total: q.total, ...(falta ? { falta } : {}), selo: seloEmTeste() });
}

/**
 * O quadro com as tarefas. `alternadas`: as colunas que a pessoa abriu ou recolheu ao contrário do padrão; coluna com
 * tarefa abre sozinha (o Backlog que acende com as 8 do passo 3). `acesas`: os cards que mudaram na última releitura.
 */
export function quadroDaMeta(o: { q: QuadroDto; nome: string; agente: AgenteDoQuadro; filtro: Filtro; alternadas: ReadonlySet<Status>; acesas: ReadonlySet<string> }): Html {
  const por = tarefasPorStatus(o.q);
  const rotulo = `Quadro ${o.q.meta} de ${o.nome}`;
  const cols = colunasPadrao().map((c) => {
    const tarefas = por[c.status].filter((t) => passaNoFiltro(t, o.filtro));
    const padrao = c.recolhida && por[c.status].length === 0;
    return { ...c, tarefas, recolhida: padrao !== o.alternadas.has(c.status) };
  });
  const cartoes = (ts: TarefaDto[]): Card[] => ts.map((t) => cardDaTarefa(t, o.agente, o.acesas.has(t.id)));
  const vazio = (s: Status): string => (s === "backlog" && o.q.total === 0 ? VAZIO_DO_BACKLOG : "Nada aqui");
  return confiar([
    metaDoQuadro(o.q),
    barra({ filtro: o.filtro, trabalhando: trabalhando(o.q, o.agente) }),
    quadro({
      rotulo, classe: "qd-so-largo",
      colunas: cols.map((c) => ({ status: c.status, nome: c.nome, recolhida: c.recolhida, recolhivel: true, n: c.tarefas.length, cards: cartoes(c.tarefas).map(card), vazio: vazio(c.status) })),
    }),
    `<div class="qd-so-estreito">${lista({ rotulo, grupos: cols.map((c) => ({ status: c.status, nome: c.nome, recolhido: c.recolhida, linhas: cartoes(c.tarefas).map(linha), vazio: vazio(c.status) })) })}</div>`,
  ].join(""));
}

/** Ainda sem quadro: o que dizer e a quem pedir (o quadro nasce de um pedido no chat de qualquer bot). */
export function semQuadro(nome: string): Html {
  return confiar(`<div class="qd-sem-quadro" role="status"><p class="qd-sem-tit">${esc(`${nome} ainda não tem quadro`)}</p>` +
    `<p class="qd-sem-txt">Diga a meta e o prazo aqui embaixo ou na conversa, por exemplo <i>quero lançar as seções novas até sexta</i>.</p>${seloEmTeste()}</div>`);
}

export function quadroCarregando(): Html {
  return confiar(`<div class="qd-sem-quadro" role="status" aria-busy="true"><p class="qd-sem-txt">Abrindo o quadro…</p></div>`);
}

export function quadroComErro(): Html {
  return confiar(`<div class="qd-sem-quadro" role="alert"><p class="qd-sem-tit">Não consegui abrir o quadro</p>` +
    `<button type="button" class="qd-link" data-act="qd-reler">Tentar de novo</button></div>`);
}

/* ---------- A tarefa aberta ---------- */

function formResposta(t: TarefaDto): string {
  const id = `qd-resp-${esc(t.id)}`;
  return `<form class="qd-resp-form" data-form="responder-tarefa" data-id="${esc(t.id)}"><label class="qd-sr" for="${id}">Sua resposta</label>` +
    `<textarea id="${id}" class="qd-resp-in" name="resposta" rows="2" maxlength="${LIMITE_RESPOSTA}" required placeholder="Sua resposta"></textarea>` +
    `<button type="submit" class="qd-bt qd-bt-pri">Responder</button></form>`;
}

/**
 * O detalhe de uma tarefa (o clique no card): à esquerda o título, os chips, a descrição e, se trava em você, a pergunta
 * com o campo da resposta; à direita o painel (Propriedades, Entregáveis, No Linear). Abaixo de 700px o painel desce.
 */
export function tarefaAberta(o: { t: TarefaDto; q: QuadroDto; agente: AgenteDoQuadro }): Html {
  const { t } = o;
  const codigo = codigoDaTarefa(t);
  const resp = t.status === "voce" ? VOCE : t.agenteId ? o.agente(t.agenteId) : null;
  const st = t.status as Status;
  const chipSt = `<span class="qd-chip">${ICONE_DO_STATUS[st]}<span>${esc(NOME_DO_STATUS[st])}</span></span>`;
  const chipResp = resp ? `<span class="qd-chip">${avatar({ avatar: resp.avatar, nome: resp.nome, estado: t.execucao })}<span>${esc(resp.nome)}</span></span>` : `<span class="qd-chip qd-chip-vazio">Sem responsável</span>`;
  const pr = linkSeguro(t.prUrl);
  const lin = linkSeguro(t.linearUrl);
  const chipPr = pr ? `<a class="qd-chip" href="${esc(pr)}" target="_blank" rel="noopener noreferrer">${esc(numeroDoPr(pr))}</a>` : "";
  const desc = t.descricao.trim() ? `<div class="qd-t-desc">${esc(t.descricao)}</div>` : `<div class="qd-t-desc qd-t-desc-vazia">Sem descrição.</div>`;
  const pergunta = t.pergunta && (t.status === "voce" || t.status === "bloqueado")
    ? `<h2 class="qd-t-sec">${t.status === "voce" ? "Precisa de você" : "Bloqueada"}</h2><p class="qd-voce-frase">${esc(t.pergunta)}</p>${t.status === "voce" ? formResposta(t) : ""}` : "";
  const resposta = t.resposta ? `<h2 class="qd-t-sec">Sua resposta</h2><p class="qd-t-resposta">${esc(t.resposta)}</p>` : "";
  const entregaveis = `<section class="qd-lado-sec"><h2 class="qd-rotulo">Entregáveis <span class="qd-n">${pr ? 1 : 0}</span></h2>` +
    (pr ? `<ul><li>${ICONE.ok}<a class="qd-link" href="${esc(pr)}" target="_blank" rel="noopener noreferrer">${esc(numeroDoPr(pr))}</a></li></ul>` : `<p class="qd-lado-vazio">Nada ainda</p>`) + `</section>`;
  const noLinear = t.linearId ? `<section class="qd-lado-sec"><h2 class="qd-rotulo">No Linear</h2><ul><li>${lin ? `<a class="qd-link" href="${esc(lin)}" target="_blank" rel="noopener noreferrer">${esc(t.linearId)}</a>` : `<span>${esc(t.linearId)}</span>`}</li></ul></section>` : "";
  return confiar(`<article class="qd-tarefa qd-com-lado" aria-labelledby="qd-t-tit" data-tarefa="${esc(t.id)}">` +
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="voltar-ao-quadro">${ICONE.voltar}<span>${esc(o.q.meta)}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigo)}</span></div>` +
    `<div class="qd-t-corpo"><div class="qd-t-principal"><h1 class="qd-t-tit" id="qd-t-tit" tabindex="-1">${esc(t.titulo)}</h1><div class="qd-chips">${chipSt}${chipResp}${chipPr}</div>${desc}${pergunta}${resposta}</div>` +
    `<aside class="qd-lado" aria-label="Detalhes da tarefa"><section class="qd-lado-sec"><h2 class="qd-rotulo">Propriedades</h2><dl class="qd-props">` +
    `<dt>Status</dt><dd>${esc(NOME_DO_STATUS[st])}</dd><dt>Responsável</dt><dd>${esc(resp?.nome ?? "ninguém")}</dd><dt>Quadro</dt><dd>${esc(o.q.meta)}</dd></dl></section>` +
    `${entregaveis}${noLinear}</aside></div></article>`);
}

/* ---------- A conversa no quadro: a faixa e a pílula ---------- */

const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
const ENVIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';

export type TrocaDaFaixa = { id: string; de: "eu" | "bot"; texto: string; em: number };

/**
 * A faixa por cima da pílula: uma linha só (a última resposta). A seta abre as últimas trocas (até 40% da altura) e o
 * Abrir na Conversa leva à aba Conversa, que é a mesma conversa. O Desfazer volta o lote inteiro do pedido.
 */
export function faixaDoQuadro(o: { faixa: Faixa; avatarBot: Html | null; historico: readonly TrocaDaFaixa[]; aberto: boolean; hora: (em: number) => string }): Html {
  const f = o.faixa;
  if (f.tipo === "nada" && !o.aberto) return confiar("");
  const histBt = o.historico.length ? `<button type="button" class="qc-hist-bt" data-act="qc-historico" aria-expanded="${o.aberto}" aria-controls="qc-hist" aria-label="${o.aberto ? "Fechar o histórico" : "Ver as últimas trocas"}">${SETA}</button>` : "";
  const hist = o.aberto && o.historico.length
    ? `<div class="qc-hist" id="qc-hist"><ol class="qc-hist-lista">${o.historico.map((m) => `<li class="${m.de === "eu" ? "qc-h-eu" : "qc-h-bot"}"><p>${esc(m.texto)}</p><time>${esc(o.hora(m.em))}</time></li>`).join("")}</ol>` +
      `<button type="button" class="qd-link qc-hist-abrir" data-act="qc-abrir-conversa">Abrir na Conversa</button></div>` : "";
  let linha1 = "";
  let classe = "qc-ok";
  if (f.tipo === "aguardando") {
    classe = "qc-aguarda";
    linha1 = `<span class="qc-giro" aria-hidden="true"></span><span class="qc-resp-txt">Mexendo no quadro…</span>`;
  } else if (f.tipo === "resposta") {
    linha1 = `${o.avatarBot ?? ""}<span class="qc-resp-txt" title="${esc(f.texto)}">${esc(f.texto)}</span>` +
      (f.loteId ? `<button type="button" class="qd-link qc-link qc-desfazer" data-act="qc-desfazer" data-id="${esc(f.loteId)}">Desfazer</button>` : "");
  } else if (f.tipo === "erro") {
    classe = "qc-erro";
    linha1 = `<i class="qc-erro-ic" aria-hidden="true">!</i><span class="qc-resp-txt">${esc(f.texto)}</span>`;
  } else {
    linha1 = `<span class="qc-resp-txt">Últimas trocas</span>`;
  }
  return confiar(`<div class="qc-resp ${classe}">${hist}<div class="qc-linha">${linha1}${histBt}</div></div>`);
}

/** A pílula: "Nova tarefa ou mensagem" e Enviar. Com uma tarefa aberta, o pedido vai sobre ela (o placeholder diz qual). */
export function pilulaDoQuadro(o: { meta: string | null; nome: string }): Html {
  const rot = o.meta ? `Conversar com o quadro ${o.meta}` : `Conversar com ${o.nome} sobre o quadro`;
  return confiar(`<div class="qc-caixa"><div class="qc-faixa" id="qc-faixa" role="status" aria-live="polite"></div>` +
    `<form class="qc-pil" role="group" aria-label="${esc(rot)}" data-form="conversa-no-quadro"><label class="qd-sr" for="qc-txt">${esc(rot)}</label>` +
    `<textarea id="qc-txt" class="qc-txt" rows="1" maxlength="${LIMITE_PEDIDO}" placeholder="Nova tarefa ou mensagem"></textarea>` +
    `<button type="submit" class="qc-bt qc-enviar" aria-label="Enviar ao quadro">${ENVIAR}</button></form></div>`);
}
