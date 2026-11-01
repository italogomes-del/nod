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
import { NOME_DO_STATUS, type Status } from "../lib/quadro.ts";
import { comColunas, iconeDaColuna, inicioDoFimPreso, LIMITE_COLUNAS, type EdicaoDeColuna } from "../lib/colunas.ts";
import { aposDoCabecalho, botaoDeNova, campoDeRenomear, colunaNova, folhaDasColunas, naFolha } from "./colunas-quadro.ts";
import { atalhosDePrazo, codigoDaTarefa, faltaParaOPrazo, fraseDoPrazo, tarefasPorStatus, type Faixa } from "../lib/quadro-dados.ts";
import { anel, avatar, barra, card, confiar, ICONE, ICONE_DO_STATUS, linha, lista, quadro, seloEmTeste, type Card, type Coluna, type ExtraDaGrade, type Filtro, type Html, type QuemRoda } from "./quadro.ts";

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

const LIMITE_META = 200;

/**
 * NOD-415 (ADR-141): o menu de prazo (um select nativo: teclado e leitor de tela de graça). O valor atual, os atalhos,
 * "Outra data…" (abre o campo de data ao lado) e "Sem prazo". Quem ouve a troca é web/lib/quadro-na-tela.ts.
 */
export function menuDePrazo(prazo: string | null, agora: number, id = "qd-prazo"): string {
  const atalhos = atalhosDePrazo(agora);
  // O prazo atual sempre se lê "até 6 nov" no menu fechado, mesmo quando é um dos atalhos.
  const atual = prazo ? `<option value="${esc(prazo)}" selected>${esc(fraseDoPrazo(prazo))}</option>` : "";
  const opcoes = atalhos.map((a) => `<option value="${esc(a.valor)}">${esc(`${a.rotulo} (${fraseDoPrazo(a.valor).replace(/^até /, "")})`)}</option>`).join("");
  return `<span class="qd-prazo"><label class="qd-sr" for="${esc(id)}">Prazo</label><select id="${esc(id)}" class="qd-prazo-sel" data-campo="prazo">` +
    `${atual}<option value=""${prazo ? "" : " selected"}>Sem prazo</option>${opcoes}<option value="outra">Outra data…</option></select>` +
    `<label class="qd-sr" for="${esc(id)}-data">Outra data</label><input type="date" id="${esc(id)}-data" class="qd-prazo-data" data-campo="prazo-data" hidden></span>`;
}

/**
 * O topo do quadro (NOD-415, ADR-141). Fluxo contínuo é o padrão: sem meta, só "+ Meta" e o prazo, nenhum número. Com
 * meta: a meta (clicável), o prazo, a barra e "N de M feitas", e quanto falta (ou "cumprida"). `editandoMeta` troca a
 * meta pelo campo (Enter salva, Esc desiste, vazio tira a meta).
 */
export function topoDoQuadro(q: QuadroDto, o: { agora: number; editandoMeta?: boolean }): Html {
  const partes: string[] = [];
  if (o.editandoMeta) {
    partes.push(`<form class="qd-meta-form" data-form="editar-meta"><label class="qd-sr" for="qd-meta-in">Meta do quadro (vazio tira)</label>` +
      `<input id="qd-meta-in" class="qd-meta-in" name="meta" maxlength="${LIMITE_META}" value="${esc(q.meta ?? "")}" placeholder="Qual é a meta? (opcional)" autocomplete="off"></form>`);
  } else if (q.meta) {
    partes.push(`<button type="button" class="qd-meta-obj qd-editavel" data-act="editar-meta" title="Mudar a meta">${esc(q.meta)}</button>`);
  } else {
    partes.push(`<button type="button" class="qd-link qd-meta-mais" data-act="editar-meta">+ Meta</button>`);
  }
  partes.push(menuDePrazo(q.prazo, o.agora));
  if (q.meta) {
    const total = Math.max(0, q.total);
    const feitas = Math.min(Math.max(0, q.feitas), total);
    const pct = total ? Math.round((100 * feitas) / total) : 0;
    partes.push(`<span class="qd-barra" role="progressbar" aria-label="Progresso da meta" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${feitas}"><i style="width:${pct}%"></i></span>`);
    partes.push(total === 0 ? `<span class="qd-meta-falta">nenhuma tarefa ainda</span>` : `<span class="qd-meta-n">${feitas} de ${total} feitas</span>`);
  }
  const falta = q.meta && q.cumpridoEm ? "cumprida" : faltaParaOPrazo(q.prazo, o.agora);
  if (falta) partes.push(`<span class="qd-meta-falta">${esc(falta)}</span>`);
  partes.push(`<button type="button" class="qd-link qd-remover" data-act="remover-quadro" title="O bot volta a ser um agente comum; a conversa e a memória ficam">Remover quadro</button>`);
  return confiar(`<div class="qd-meta${q.meta ? "" : " qd-meta-fluxo"}">${partes.join("")}${seloEmTeste()}</div>`);
}

const rotuloDoQuadro = (q: QuadroDto, nome: string): string => (q.meta ? `Quadro ${q.meta} de ${nome}` : `Quadro de ${nome}`);

/**
 * O quadro com as tarefas. `alternadas`: as colunas que a pessoa abriu ou recolheu ao contrário do padrão; coluna com
 * tarefa abre sozinha (o Backlog que acende com as 8 do passo 3). `acesas`: os cards que mudaram na última releitura.
 *
 * NOD-448: as colunas são as do quadro (`q.colunas`), com o cabeçalho que edita, o "+" e as tiras de Feito e Fechado
 * presas à direita (NOD-429). `edicao` é o pedaço aberto (menu, renomear, remover, coluna nova, a folha do celular).
 */
export function quadroDaMeta(o: { q: QuadroDto; nome: string; agente: AgenteDoQuadro; filtro: Filtro; alternadas: ReadonlySet<string>; acesas: ReadonlySet<string>; edicao?: EdicaoDeColuna | null; agora?: number; editandoMeta?: boolean }): Html {
  const por = tarefasPorStatus(o.q);
  const ed = o.edicao ?? null;
  const cs = comColunas(o.q).colunas;
  const rotulo = rotuloDoQuadro(o.q, o.nome);
  const contagem: Record<string, number> = Object.fromEntries(cs.map((c) => [c.id, (por[c.id] ?? []).length]));
  const cols = cs.map((c) => {
    const tarefas = (por[c.id] ?? []).filter((t) => passaNoFiltro(t, o.filtro));
    const padrao = c.recolhida && (contagem[c.id] ?? 0) === 0;
    // Renomear ou remover (o popover) abre a coluna, para o campo ter onde ficar.
    const editando = !naFolha(ed) && (ed?.tipo === "renomear" || ed?.tipo === "remover") && ed.coluna === c.id;
    return { c, tarefas, recolhida: !editando && padrao !== o.alternadas.has(c.id) };
  });
  const cartoes = (ts: TarefaDto[]): Card[] => ts.map((t) => cardDaTarefa(t, o.agente, o.acesas.has(t.id)));
  const vazio = (id: string): string => (id === "backlog" && o.q.total === 0 ? VAZIO_DO_BACKLOG : "Nada aqui");
  const preso = inicioDoFimPreso(cols.map((x) => ({ grupo: x.c.grupo, recolhida: x.recolhida })));
  const larguraPresa = (depois: number) => `calc(${depois} * (var(--qd-tira) + 8px) + var(--qd-tira) + 8px)`;
  const colunas: Coluna[] = cols.map(({ c, tarefas, recolhida }, i) => ({
    status: c.id, nome: c.nome, grupo: c.grupo, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhida, recolhivel: true,
    editavel: { fixa: c.fixa }, n: tarefas.length, cards: cartoes(tarefas).map(card), vazio: vazio(c.id),
    ...(!recolhida ? { apos: aposDoCabecalho(cs, c, ed, contagem[c.id] ?? 0, o.nome) } : {}),
    ...(ed?.tipo === "renomear" && ed.coluna === c.id && !naFolha(ed) ? { cab: campoDeRenomear(c, ed.erro) } : {}),
    ...(i >= preso ? { presa: larguraPresa(cols.length - 1 - i) } : {}),
  }));
  const cheio = cs.length >= LIMITE_COLUNAS;
  const extras: ExtraDaGrade[] = [{ html: botaoDeNova(cheio), trilha: "var(--qd-tira)" }];
  if (ed?.tipo === "nova" && !naFolha(ed)) {
    const depois = ed.depoisDe ? cs.findIndex((c) => c.id === ed.depoisDe) : -1;
    extras.unshift({ html: confiar(`<section class="qd-col qd-col-nova" aria-label="Nova coluna">${colunaNova(ed)}</section>`), trilha: "minmax(var(--qd-col-min), 1fr)", em: depois >= 0 && depois < preso ? depois + 1 : preso });
  }
  const ordem = `<button type="button" class="qd-link qd-lg-ordem" data-act="col-folha">Ordem das colunas</button>`;
  return confiar([
    topoDoQuadro(o.q, { agora: o.agora ?? Date.now(), ...(o.editandoMeta ? { editandoMeta: true } : {}) }),
    barra({ filtro: o.filtro, trabalhando: trabalhando(o.q, o.agente) }),
    quadro({ rotulo, classe: "qd-so-largo", colunas, extras }),
    `<div class="qd-so-estreito">${lista({ rotulo, antes: confiar(ordem), grupos: cols.map(({ c, tarefas, recolhida }) => ({ status: c.id, nome: c.nome, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhido: recolhida, linhas: cartoes(tarefas).map(linha), vazio: vazio(c.id) })) })}` +
      `${naFolha(ed) ? folhaDasColunas(cs, ed, contagem, o.nome) : ""}</div>`,
  ].join(""));
}

/**
 * Ainda sem quadro (NOD-415, ADR-141): o quadro nasce aqui ou pela conversa. A meta e o prazo são opcionais e o
 * "Criar quadro" fica sempre habilitado: sem meta, o quadro nasce no fluxo contínuo.
 */
export function semQuadro(nome: string, agora: number = Date.now()): Html {
  return confiar(`<div class="qd-sem-quadro" role="status"><p class="qd-sem-tit">${esc(`${nome} ainda não tem quadro`)}</p>` +
    `<form class="qd-criar" data-form="criar-quadro"><label class="qd-sr" for="qd-criar-meta">Meta (opcional)</label>` +
    `<input id="qd-criar-meta" class="qd-meta-in" name="meta" maxlength="${LIMITE_META}" placeholder="Qual é a meta? (opcional)" autocomplete="off">` +
    `${menuDePrazo(null, agora, "qd-criar-prazo")}<button type="submit" class="qd-bt qd-bt-pri">Criar quadro</button></form>` +
    `<p class="qd-sem-txt">Ou peça na conversa, por exemplo <i>quero um quadro para a esteira de engenharia</i>. Sem meta, o quadro é um fluxo contínuo.</p>${seloEmTeste()}</div>`);
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
  // NOD-448: o nome e o ícone da coluna do quadro (renomeada ou criada pela pessoa); o padrão só para um dado velho.
  const col = comColunas(o.q).colunas.find((c) => c.id === t.status);
  const nomeSt = col?.nome ?? NOME_DO_STATUS[t.status as Status] ?? t.status;
  const icSt = ICONE_DO_STATUS[col ? iconeDaColuna(col) : (t.status as Status)] ?? ICONE_DO_STATUS.afazer;
  const chipSt = `<span class="qd-chip">${icSt}<span>${esc(nomeSt)}</span></span>`;
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
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="voltar-ao-quadro">${ICONE.voltar}<span>${esc(o.q.meta ?? "Quadro")}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigo)}</span></div>` +
    `<div class="qd-t-corpo"><div class="qd-t-principal"><h1 class="qd-t-tit" id="qd-t-tit" tabindex="-1">${esc(t.titulo)}</h1><div class="qd-chips">${chipSt}${chipResp}${chipPr}</div>${desc}${pergunta}${resposta}</div>` +
    `<aside class="qd-lado" aria-label="Detalhes da tarefa"><section class="qd-lado-sec"><h2 class="qd-rotulo">Propriedades</h2><dl class="qd-props">` +
    `<dt>Status</dt><dd>${esc(nomeSt)}</dd><dt>Responsável</dt><dd>${esc(resp?.nome ?? "ninguém")}</dd><dt>Quadro</dt><dd>${esc(o.q.meta ?? "sem meta")}</dd></dl></section>` +
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
