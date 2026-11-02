/**
 * NOD-442 (definido em 2026-10-31): o quadro de verdade, montado com os componentes da NOD-429 (web/telas/quadro.ts).
 * Três pedaços, desenhados em separado por web/lib/quadro-na-tela.ts (o campo da pílula nunca é regravado enquanto a
 * pessoa digita):
 * - `conteudoDoQuadro`: a meta, a barra, a grade (computador) e a lista por estado (celular), ou a tarefa aberta;
 * - `faixaDoQuadro`: a resposta do bot numa linha de vidro por cima da pílula (carregando, a resposta com Desfazer, o erro);
 * - `pilulaDoQuadro`: a conversa no próprio quadro (passo 9 do protótipo), que fala com o bot anfitrião.
 * Todo texto (título, descrição, pergunta, resposta, meta) é dado e passa por `esc`.
 */
import type { ColunaDto, EntradaHistoricoDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import { NOME_DO_STATUS, type Status } from "../lib/quadro.ts";
import { comColunas, iconeDaColuna, paradaHa, podeTerPrazo, prazoLegivelMin, inicioDoFimPreso, LIMITE_COLUNAS, type EdicaoDeColuna } from "../lib/colunas.ts";
import { aposDoCabecalho, botaoDeNova, campoDeRenomear, colunaNova, confirmacaoDeSoltar, folhaDasColunas, menuDeMover, naFolha, type AgenteDaPassagem } from "./colunas-quadro.ts";
import { RESP_VOCE, atalhosDePrazo, codigoDaTarefa, faltaParaOPrazo, fraseDoPrazo, linhaDoHistorico, opcoesDeStatus, tarefasPorStatus, type Faixa } from "../lib/quadro-dados.ts";
import { ecoDoAgente, fraseDaTrava, fraseDoMovimento, porqueNaoDesfaz } from "../lib/freios.ts";
import { anel, avatar, barra, card, confiar, ICONE, ICONE_DO_STATUS, linha, lista, quadro, seloEmTeste, type Aviso, type Card, type Coluna, type ExtraDaGrade, type Filtro, type Html, type QuemRoda } from "./quadro.ts";

/** Quem é o agente de um id (o avatar com o mascote dele e o nome); null = não é um bot da pessoa. */
export type AgenteDoQuadro = (agenteId: string) => { avatar: Html; nome: string } | null;

const VOCE = { avatar: anel("V", "Você", true), nome: "Você" };
const VAZIO_DO_BACKLOG = "Diga o que entra, ou peça para trazer do Linear.";
const LIMITE_RESPOSTA = 4000;
const LIMITE_PEDIDO = 4000;
const LIMITE_TITULO = 200;

/** NOD-416: "Nova tarefa…" na barra. Cai no Backlog e ninguém começa (para começar, mude o status). */
export function formNovaTarefa(): Html {
  return confiar(`<form class="qd-nova-tarefa" data-form="nova-tarefa"><label class="qd-sr" for="qd-nova-tit">Nova tarefa</label>` +
    `<input id="qd-nova-tit" class="qd-nova-in" name="titulo" maxlength="${LIMITE_TITULO}" required autocomplete="off" placeholder="Nova tarefa…">` +
    `<button type="submit" class="qd-bt">Criar</button></form>`);
}

const numeroDoPr = (url: string): string => {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
};
/** Só http(s) vira link (a rota já valida; aqui é a segunda trava, para um dado velho). */
const linkSeguro = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** NOD-421: o PR em texto, sem cor nem alerta ("CI ok · aberto", "conflito" como palavra). */
const estadoDoPr = (p: NonNullable<TarefaDto["prs"]>[number]): string =>
  [p.estado === "aberto" && p.ci ? `CI ${p.ci}` : "", p.estado === "aberto" && p.conflito ? "conflito" : "", p.estado === "fechado" ? "fechado sem merge" : p.estado].filter(Boolean).join(" · ");
type PrDto = NonNullable<TarefaDto["prs"]>[number];
type TomDoPr = NonNullable<Card["pr"]>["tom"];
/** O tom do ponto: falhou (vermelho), conflito (âmbar), pendente/sem CI (cinza), ok (verde), mergeado (violeta), fechado (cinza). */
export const tomDoPr = (p: PrDto): TomDoPr =>
  p.estado === "mergeado" ? "mergeado" : p.estado === "fechado" ? "fechado" : p.ci === "falhou" ? "falhou" : p.conflito ? "conflito" : p.ci === "ok" ? "ok" : "pendente";
/** 3ª revisão do PR #621: o ícone do PR em Entregáveis. CI falhando = falhou; fechado sem merge; aberto (pendente, ok ou em conflito) = em espera; mergeado. */
const iconeDoPr = (p: PrDto): Html =>
  p.estado === "mergeado" ? ICONE.mergeado : p.estado === "fechado" ? ICONE.fechado : p.ci === "falhou" ? ICONE.falhou : ICONE.fila;
const GRAVIDADE: Record<TomDoPr, number> = { falhou: 0, conflito: 1, pendente: 2, ok: 3, mergeado: 4, fechado: 5 };
/** O PR que o card mostra: o mais problemático (empate = o de número maior, o mais novo). */
export const prMaisProblematico = (prs: readonly PrDto[]): PrDto =>
  [...prs].sort((a, b) => GRAVIDADE[tomDoPr(a)] - GRAVIDADE[tomDoPr(b)] || b.numero - a.numero)[0]!;
const horaDaLinha = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * A tarefa como card: o responsável (bot ou você), a execução, o motivo do bloqueio e a pergunta para você. NOD-419: `eco`
 * (com as colunas e a hora) põe na linha 1 o "Ada terminou · Desfazer" do último movimento de um agente; `aviso` (a
 * recusa da trava, vinda da tela) passa na frente. NOD-420: `responder`, `agora` e `prazoMin` (o "parada há" e o atraso).
 */
export function cardDaTarefa(t: TarefaDto, agente: AgenteDoQuadro, acesa = false, o: { eco?: { colunas: readonly { id: string }[]; agora: number }; aviso?: Aviso; agora?: number; prazoMin?: number; responder?: boolean } = {}): Card {
  const resp = t.status === "voce" ? VOCE : t.agenteId ? agente(t.agenteId) : null;
  const eco = o.eco ? ecoDoAgente(t, o.eco.colunas, o.eco.agora) : null;
  const av: Aviso | null = o.aviso ?? (eco ? { texto: eco.texto, act: "tarefa-desfazer-movimento", id: eco.movimento } : null);
  // NOD-421 (🧭 da Ada): o PR mais problemático com o ponto do estado, mais "+N"; sem PR ligado, o pr_url do agente, como antes.
  const pior = t.prs?.length ? prMaisProblematico(t.prs) : null;
  const pr = pior ? { texto: `PR #${pior.numero}${t.prs!.length > 1 ? ` +${t.prs!.length - 1}` : ""}`, tom: tomDoPr(pior), titulo: estadoDoPr(pior) } : null;
  const tags = [!pr && t.prUrl ? numeroDoPr(t.prUrl) : "", t.linearId ? "Linear" : ""].filter(Boolean);
  return {
    id: t.id,
    codigo: codigoDaTarefa(t),
    titulo: t.titulo,
    ...(resp ? { responsavel: resp } : {}),
    ...(t.execucao ? { estado: t.execucao } : {}),
    ...(t.status === "bloqueado" ? { motivo: t.pergunta ?? "bloqueada" } : {}),
    ...(t.status === "voce" ? { voce: t.pergunta ?? "Precisa de você" } : {}),
    ...(pr ? { pr } : {}),
    ...(tags.length ? { tags } : {}),
    ...(acesa ? { brilho: true } : {}),
    ...(av ? { aviso: av } : {}),
    // NOD-420: responder sem abrir a tarefa, e há quanto tempo ela espera (na espera da pessoa ou numa coluna com prazo).
    ...(o.responder && (t.status === "voce" || t.status === "bloqueado") ? { responder: LIMITE_RESPOSTA } : {}),
    ...(o.agora && t.naColunaDesde && (o.prazoMin || t.status === "voce" || t.status === "bloqueado")
      ? { quando: paradaHa(t.naColunaDesde, o.agora), ...(o.prazoMin && o.agora - t.naColunaDesde >= o.prazoMin * 60_000 ? { atrasada: true } : {}) } : {}),
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

/**
 * NOD-421 (revisão do PR #621): o aviso do GitHub no topo do quadro, uma linha de texto que parece mensagem e não alerta
 * ("GitHub não conectado no servidor: os PRs não sincronizam", "GitHub · sem acesso a dono/repo"). Sem aviso, nada.
 */
export function avisoDoGithub(q: Pick<QuadroDto, "avisoGithub">): Html {
  return confiar(q.avisoGithub ? `<p class="qd-aviso-gh">${esc(q.avisoGithub)}</p>` : "");
}

const rotuloDoQuadro = (q: QuadroDto, nome: string): string => (q.meta ? `Quadro ${q.meta} de ${nome}` : `Quadro de ${nome}`);

/**
 * O quadro com as tarefas. `alternadas`: as colunas que a pessoa abriu ou recolheu ao contrário do padrão; coluna com
 * tarefa abre sozinha (o Backlog que acende com as 8 do passo 3). `acesas`: os cards que mudaram na última releitura.
 *
 * NOD-448: as colunas são as do quadro (`q.colunas`), com o cabeçalho que edita, o "+" e as tiras de Feito e Fechado
 * presas à direita (NOD-429). `edicao` é o pedaço aberto (menu, renomear, remover, coluna nova, a folha do celular).
 */
export function quadroDaMeta(o: { q: QuadroDto; nome: string; agente: AgenteDoQuadro; filtro: Filtro; alternadas: ReadonlySet<string>; acesas: ReadonlySet<string>; edicao?: EdicaoDeColuna | null; agora?: number; editandoMeta?: boolean; agentes?: readonly AgenteDaPassagem[]; /** NOD-419: a recusa da trava no card que a pessoa soltou. */ avisos?: ReadonlyMap<string, Aviso> }): Html {
  const por = tarefasPorStatus(o.q);
  const ed = o.edicao ?? null;
  const cs = comColunas(o.q).colunas;
  const rotulo = rotuloDoQuadro(o.q, o.nome);
  const contagem: Record<string, number> = Object.fromEntries(cs.map((c) => [c.id, (por[c.id] ?? []).length]));
  const cols = cs.map((c) => {
    const tarefas = (por[c.id] ?? []).filter((t) => passaNoFiltro(t, o.filtro));
    const padrao = c.recolhida && (contagem[c.id] ?? 0) === 0;
    // Renomear ou remover (o popover) abre a coluna, para o campo ter onde ficar.
    const editando = !naFolha(ed) && (ed?.tipo === "renomear" || ed?.tipo === "remover" || ed?.tipo === "passagem" || ed?.tipo === "trava" || ed?.tipo === "soltar" || ed?.tipo === "prazo") && ed.coluna === c.id;
    return { c, tarefas, recolhida: !editando && padrao !== o.alternadas.has(c.id) };
  });
  // O prazo dormente (coluna que passou a "só a pessoa tira daqui") não marca atraso (revisão 4 do PR #624).
  const prazoDe = new Map(cs.flatMap((c) => (c.prazoMin && podeTerPrazo(c) ? [[c.id, c.prazoMin] as const] : [])));
  // ADR-142: o "Mover para…" abre o menu só no card (e na vista) de onde veio; o card solto vira uma linha no topo da
  // lista de destino, com o card de origem apagado até a pessoa confirmar ou desistir.
  const cartoes = (ts: TarefaDto[], estreito: boolean): Card[] => ts.map((t) => {
    const menu = o.agentes && ed?.tipo === "mover" && ed.tarefa === t.id && !!ed.estreito === estreito ? { menu: menuDeMover(cs, t, o.nome) } : {};
    const saindo = ed?.tipo === "soltar" && ed.tarefa === t.id ? { classe: "qd-saindo" } : {};
    const av = o.avisos?.get(t.id);
    return { ...cardDaTarefa(t, o.agente, o.acesas.has(t.id), { eco: { colunas: cs, agora: o.agora ?? Date.now() }, ...(av ? { aviso: av } : {}), ...(o.agora ? { agora: o.agora } : {}), ...(prazoDe.has(t.status) ? { prazoMin: prazoDe.get(t.status)! } : {}), responder: true }), ...(o.agentes ? { arrastavel: true } : {}), ...menu, ...saindo };
  });
  const solta = (c: (typeof cs)[number]): Html[] => {
    if (ed?.tipo !== "soltar" || ed.coluna !== c.id) return [];
    return [confirmacaoDeSoltar(c, ed.tarefa, o.q.tarefas.find((t) => t.id === ed.tarefa)?.titulo)];
  };
  const vazio = (id: string): string => (id === "backlog" && o.q.total === 0 ? VAZIO_DO_BACKLOG : "Nada aqui");
  const preso = inicioDoFimPreso(cols.map((x) => ({ grupo: x.c.grupo, recolhida: x.recolhida })));
  const larguraPresa = (depois: number) => `calc(${depois} * (var(--qd-tira) + 8px) + var(--qd-tira) + 8px)`;
  const colunas: Coluna[] = cols.map(({ c, tarefas, recolhida }, i) => ({
    status: c.id, nome: c.nome, grupo: c.grupo, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhida, recolhivel: true,
    editavel: { fixa: c.fixa }, ...(c.prazoMin && podeTerPrazo(c) ? { prazo: prazoLegivelMin(c.prazoMin) } : {}), n: tarefas.length, cards: [...solta(c), ...cartoes(tarefas, false).map(card)], vazio: vazio(c.id),
    ...(!recolhida ? { apos: aposDoCabecalho(cs, c, ed, contagem[c.id] ?? 0, o.nome, o.agentes) } : {}),
    ...(ed?.tipo === "renomear" && ed.coluna === c.id && !naFolha(ed) ? { cab: campoDeRenomear(c, ed.erro) } : {}),
    ...(i >= preso ? { presa: larguraPresa(cols.length - 1 - i) } : {}),
    ...(c.trava && fraseDaTrava(cs, c.trava) ? { trava: `Travada: ${fraseDaTrava(cs, c.trava)}` } : {}),
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
    avisoDoGithub(o.q),
    barra({ filtro: o.filtro, trabalhando: trabalhando(o.q, o.agente), extra: formNovaTarefa() }),
    quadro({ rotulo, classe: "qd-so-largo", colunas, extras }),
    `<div class="qd-so-estreito">${lista({ rotulo, antes: confiar(ordem), grupos: cols.map(({ c, tarefas, recolhida }) => ({ status: c.id, nome: c.nome, icone: iconeDaColuna(c), pessoa: c.daPessoa, recolhido: recolhida, linhas: [...solta(c), ...cartoes(tarefas, true).map(linha)], vazio: vazio(c.id) })) })}` +
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
export type ExtrasDaTarefa = {
  /** Os bots que podem ser responsáveis (a frota da pessoa). Sem a lista, o Responsável fica só leitura. */
  responsaveis?: readonly { id: string; nome: string }[];
  /** Os outros quadros da pessoa ("Mover para…"); vazio ou sem a lista, o campo não aparece. */
  destinos?: readonly { id: string; nome: string }[];
  /** O destino já escolhido no "Mover para…" (sobrevive a um redesenho; o botão Mover fica ligado). */
  moverPara?: string | null;
  /** O histórico da tarefa; null = ainda carregando. */
  historico?: readonly EntradaHistoricoDto[] | null;
  /** NOD-417: a seção dos comentários (comentarios-tarefa.ts). */
  comentarios?: string;
  /** NOD-418: o trabalho da tarefa (trabalhos-da-tarefa.ts). */
  trabalhos?: string;
  /**
   * Revisão 7 do PR #623: o Status escolhido é uma coluna com responsável que aciona (ADR-142). A mesma linha do card
   * solto ("Confirmar · Não iniciar ainda") aparece logo abaixo do Status, antes de mandar a mudança.
   */
  soltar?: string;
  /** NOD-419: a hora curta do histórico de movimentos. */
  hora?: (em: number) => string;
};

const opcao = (valor: string, rotulo: string, marcada: boolean, titulo?: string): string => `<option value="${esc(valor)}"${marcada ? " selected" : ""}${titulo ? ` title="${esc(titulo)}"` : ""}>${esc(rotulo)}</option>`;

function secaoDoHistorico(h: ExtrasDaTarefa["historico"]): string {
  const corpo = h === undefined ? "" : h === null ? `<p class="qd-lado-vazio">Carregando…</p>`
    : !h.length ? `<p class="qd-lado-vazio">Sem histórico antes desta versão</p>`
    : `<ol class="qd-hist">${[...h].reverse().map((e) => { const l = linhaDoHistorico(e); return `<li><span class="qd-hist-quem">${esc(l.quem)}</span> <span class="qd-hist-oque">${esc(l.oque)}</span> <time class="qd-hist-quando" datetime="${esc(new Date(e.criadoEm).toISOString())}">${esc(l.quando)}</time></li>`; }).join("")}</ol>`;
  return corpo ? `<h2 class="qd-t-sec">Histórico</h2>${corpo}` : "";
}

export function tarefaAberta(o: { t: TarefaDto; q: QuadroDto; agente: AgenteDoQuadro } & ExtrasDaTarefa): Html {
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
  // Revisão 3 do PR #629: Bloqueado com pergunta (o motivo do agente, do laço ou do freio) também pede resposta, como o
  // servidor aceita o `responder` ali (paridade, ADR-135).
  const pergunta = t.pergunta && (t.status === "voce" || t.status === "bloqueado")
    ? `<h2 class="qd-t-sec">${t.status === "voce" ? "Precisa de você" : "Bloqueada"}</h2><p class="qd-voce-frase">${esc(t.pergunta)}</p>${formResposta(t)}` : "";
  const resposta = t.resposta ? `<h2 class="qd-t-sec">Sua resposta</h2><p class="qd-t-resposta">${esc(t.resposta)}</p>` : "";
  // NOD-421: os PRs que o laço ligou (repo #N · estado); sem nenhum, o pr_url que o agente gravou, como antes.
  const prs = (t.prs ?? []).flatMap((p) => { const u = linkSeguro(p.url); return u ? [{ ...p, url: u }] : []; });
  const itensPr = prs.length
    ? prs.map((p) => `<li>${iconeDoPr(p)}<a class="qd-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(`${p.repo} #${p.numero}`)}</a><span class="qd-pr-estado"> · ${esc(estadoDoPr(p))}</span></li>`)
    : pr ? [`<li>${ICONE.ok}<a class="qd-link" href="${esc(pr)}" target="_blank" rel="noopener noreferrer">${esc(numeroDoPr(pr))}</a></li>`] : [];
  const entregaveis = `<section class="qd-lado-sec"><h2 class="qd-rotulo">Entregáveis <span class="qd-n">${itensPr.length}</span></h2>` +
    (itensPr.length ? `<ul>${itensPr.join("")}</ul>` : `<p class="qd-lado-vazio">Nada ainda</p>`) + `</section>`;
  // NOD-421: as linhas de sistema (CI, conflito, merge), discretas. Merge da main no PR #623: ficam logo abaixo do
  // Histórico da NOD-416, cada uma com o seu título ("Histórico" e "Atividade", sem repetir). Podem contar o mesmo fato
  // por dois lados (o merge do PR na Atividade e a ida a Feito no Histórico); juntar as duas numa lista só (o histórico
  // lendo quadro_tarefa_linhas, como a 0142 prevê) fica para depois.
  const linhas = t.linhas?.length
    ? `<h2 class="qd-t-sec">Atividade</h2><ul class="qd-t-linhas">${t.linhas.map((l) => `<li>${esc(l.texto)} · <time datetime="${new Date(l.criadoEm).toISOString()}">${esc(horaDaLinha(l.criadoEm))}</time></li>`).join("")}</ul>` : "";
  const noLinear = t.linearId ? `<section class="qd-lado-sec"><h2 class="qd-rotulo">No Linear</h2><ul><li>${lin ? `<a class="qd-link" href="${esc(lin)}" target="_blank" rel="noopener noreferrer">${esc(t.linearId)}</a>` : `<span>${esc(t.linearId)}</span>`}</li></ul></section>` : "";
  // NOD-416: Status e Responsável mudam aqui mesmo (cada mudança é um lote com Desfazer, como no card).
  const campoStatus = `<select id="qd-t-status" class="qd-sel" data-campo="status" data-id="${esc(t.id)}">` +
    opcoesDeStatus(comColunas(o.q).colunas).map((g) => `<optgroup label="${esc(g.grupo)}">${g.colunas.filter((c) => c.id !== "voce" || c.id === t.status).map((c) => opcao(c.id, c.nome, c.id === t.status)).join("")}</optgroup>`).join("") +
    (col ? "" : opcao(t.status, nomeSt, true)) + `</select>`;
  const lista = o.responsaveis ?? null;
  // Revisão 2 do PR #623: em Precisa de você o select mostra Você (o responsável efetivo, como o chip); o bot segue na lista.
  const comVoce = t.status === "voce";
  const campoResp = !lista ? `<span id="qd-t-resp">${esc(resp?.nome ?? "ninguém")}</span>`
    : `<select id="qd-t-resp" class="qd-sel" data-campo="agente" data-id="${esc(t.id)}">` +
      `${comVoce ? `<option value="${RESP_VOCE}" selected disabled>Você</option>` : ""}${opcao("", "Ninguém", !comVoce && !t.agenteId)}` +
      `${lista.map((a) => opcao(a.id, a.nome, !comVoce && a.id === t.agenteId)).join("")}${t.agenteId && !lista.some((a) => a.id === t.agenteId) ? opcao(t.agenteId, t.agenteNome ?? "Outro bot", !comVoce) : ""}</select>`;
  // O label só aponta para o select; sem a lista, o Responsável é texto e o rótulo é um dt simples.
  const rotuloResp = lista ? `<label for="qd-t-resp">Responsável</label>` : "Responsável";
  const soltar = o.soltar ? comColunas(o.q).colunas.find((c) => c.id === o.soltar) : undefined;
  const escolhido = o.destinos?.find((d) => d.id === o.moverPara);
  const campoMover = o.destinos?.length
    // Revisão do PR #623 (WCAG 3.2.2): escolher o quadro não move; o botão Mover confirma (e fica desligado sem escolha).
    ? `<dt><label for="qd-t-mover">Mover para</label></dt><dd class="qd-mover"><select id="qd-t-mover" class="qd-sel" data-campo="mover" data-id="${esc(t.id)}" title="${esc(escolhido?.nome ?? "Outro quadro…")}">${opcao("", "Outro quadro…", !escolhido)}${o.destinos.map((d) => opcao(d.id, d.nome, d.id === escolhido?.id, d.nome)).join("")}</select>` +
      `<button type="button" class="qd-bt" data-act="mover-quadro" data-id="${esc(t.id)}"${escolhido ? "" : " disabled"}>Mover</button></dd>` : "";
  return confiar(`<article class="qd-tarefa qd-com-lado" aria-labelledby="qd-t-tit" data-tarefa="${esc(t.id)}">` +
    `<div class="qd-t-cab"><button type="button" class="qd-voltar" data-act="voltar-ao-quadro">${ICONE.voltar}<span>${esc(o.q.meta ?? "Quadro")}</span></button><span class="qd-t-sep" aria-hidden="true">/</span><span class="qd-id">${esc(codigo)}</span></div>` +
    `<div class="qd-t-corpo"><div class="qd-t-principal"><h1 class="qd-t-tit" id="qd-t-tit" tabindex="-1">${esc(t.titulo)}</h1><div class="qd-chips">${chipSt}${chipResp}${chipPr}</div>${desc}${pergunta}${resposta}${o.trabalhos ?? ""}${secaoDoHistorico(o.historico)}${linhas}${historicoDaTarefa(t, comColunas(o.q).colunas, o.hora)}${o.comentarios ?? ""}</div>` +
    `<aside class="qd-lado" aria-label="Detalhes da tarefa"><section class="qd-lado-sec"><h2 class="qd-rotulo">Propriedades</h2><dl class="qd-props">` +
    `<dt><label for="qd-t-status">Status</label></dt><dd>${campoStatus}${soltar ? `<ul class="qd-t-soltar">${confirmacaoDeSoltar(soltar, t.id, t.titulo)}</ul>` : ""}</dd><dt>${rotuloResp}</dt><dd>${campoResp}</dd>` +
    `<dt>Quadro</dt><dd>${esc(o.q.agenteNome)}${o.q.meta ? ` · ${esc(o.q.meta)}` : ""}</dd>${campoMover}` +
    `${t.branch ? `<dt>Branch</dt><dd><code class="qd-branch">${esc(t.branch)}</code></dd>` : ""}</dl></section>` +
    `${entregaveis}${noLinear}</aside></div></article>`);
}

/**
 * NOD-419: o histórico discreto da tarefa (recolhido: "› N movimentos"). Uma linha por movimento (quem · de → para ·
 * hora); o Desfazer só no último, e só se a tarefa ainda está onde ele a deixou (senão, o porquê no title).
 */
export function historicoDaTarefa(t: TarefaDto, cs: readonly ColunaDto[], hora: (em: number) => string = (em) => new Date(em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })): string {
  const ms = t.movimentos ?? [];
  if (!ms.length) return "";
  const linhas = ms.map((m) => {
    const porque = porqueNaoDesfaz(t, m, cs);
    const desfeito = m.desfeitoEm !== null;
    // Revisão 4 do PR #629: o porquê vai também num texto para o leitor de tela (o title só aparece no hover).
    const bt = !porque ? `<button type="button" class="qd-link qd-hist-desfazer" data-act="tarefa-desfazer-movimento" data-id="${esc(m.id)}">Desfazer</button>` : "";
    return `<li class="qd-hist-l${desfeito ? " qd-hist-desfeito" : ""}"${porque && !desfeito ? ` title="${esc(porque)}"` : ""}><span>${esc(fraseDoMovimento(m, cs))}</span>` +
      `<time class="qd-hist-hora" datetime="${esc(new Date(m.criadoEm).toISOString())}">${esc(hora(m.criadoEm))}</time>${desfeito ? `<span class="qd-sr"> (desfeito)</span>` : ""}${porque && !desfeito ? `<span class="qd-sr"> (${esc(porque)})</span>` : ""}${bt}</li>`;
  }).join("");
  const n = ms.length === 1 ? "1 movimento" : `${ms.length} movimentos`;
  return `<details class="qd-hist"><summary class="qd-hist-sum">${esc(n)}</summary><ol class="qd-hist-lista">${linhas}</ol></details>`;
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
