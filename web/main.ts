import { abrirMenu, pedirGestao, renderGestao, type BotGerido, type AcaoGestao } from "./telas/gestao-agentes.ts";
import type { FormaAgente, CorAgente } from "../src/contracts/agente.ts";
import type { ModoSessaoDto } from "../src/contracts/api.ts";
import type { Escopo } from "../src/shared/types.ts";
import { agenteDaTela, conversaDaTela, estadoInicial, invalidacoesDaTela, reduzir, type Acao, type Estado, type Invalidacao, type Tela } from "./estado/reducer.ts";
import { criarApi, ErroApi, sessao as sessaoApi, type Api } from "./lib/api.ts";
import { criarLiveEvents, type LiveEvents } from "./lib/live-events.ts";
import { botao, esc, iconeAgente } from "./lib/render.ts";
import { esquecerRegiao, regiao } from "./lib/regioes.ts";
import { renderNovoBot } from "./telas/novo-bot.ts";
import { renderNovaRotina } from "./telas/nova-rotina.ts";
import { renderDetalhes } from "./telas/detalhes.ts";
import { renderChaves } from "./telas/chaves.ts";
import { renderConectores } from "./telas/conectores.ts";
import { htmlComposer, renderCabecalhoConversa, renderTimeline } from "./telas/conversa.ts";
import { renderFrota } from "./telas/frota.ts";
import { renderMemoria } from "./telas/memoria.ts";
import { renderPerfil } from "./telas/perfil.ts";
import { renderRotinas } from "./telas/rotinas.ts";
import { nomesDosMembros, renderCabecalhoSala, renderNovaSala } from "./telas/sala.ts";
import { renderSuaVez } from "./telas/sua-vez.ts";

/**
 * main.ts: sessão → hidratar → SSE (ADR-016) → laço "dispatch → reidratar o que o reducer invalidou →
 * render por regiões". A web DECIDE e pede por REST; nunca executa (ADR-020). Nenhuma decisão do produto
 * exige o app aberto: sem executor a tela continua respondendo (web-sem-app).
 */
let estado: Estado = estadoInicial;
let api: Api | null = null;
let live: LiveEvents | null = null;
let composerDe: string | null = null;
let reidratando = false;
/** Tela de entrada (ADR-030): o modo vem do servidor; `recusado` vem do redirect do callback do Google. */
let entrada: { modo: ModoSessaoDto | null; recusado: boolean } = { modo: null, recusado: false };

function dispatch(acao: Acao): void {
  estado = reduzir(estado, acao);
  render();
  void reidratar();
}

function erroDe(e: unknown): { codigo: string; mensagem: string } {
  if (e instanceof ErroApi) return { codigo: e.codigo, mensagem: e.message };
  return { codigo: "falha_interna", mensagem: "falha ao falar com o servidor" };
}

/** Roda uma mutação: marca ocupado, traduz o erro em código fechado (nunca err.message cru). */
async function agir(fn: () => Promise<void>): Promise<void> {
  dispatch({ tipo: "erro", erro: null });
  dispatch({ tipo: "ocupado", valor: true });
  try {
    await fn();
    dispatch({ tipo: "ocupado", valor: false });
  } catch (e) {
    dispatch({ tipo: "erro", erro: erroDe(e) });
  }
}

// ---------------------------------------------------------------------------------------------
// Reidratação: o reducer diz O QUE mudou; aqui busca-se por REST e despacha o hidratar.

async function buscar(q: Invalidacao): Promise<Acao | null> {
  if (!api) return null;
  const agora = Date.now();
  if (q === "gestao") return { tipo: "hidratar-gestao", gestao: await api.gestaoAgentes() };
  if (q === "frota") return { tipo: "hidratar-frota", frota: await api.frota() };
  if (q === "inventario") return { tipo: "hidratar-inventario", inventario: await api.inventario() };
  if (q === "executor") return { tipo: "hidratar-executor", executor: await api.executor() };
  if (q === "sua-vez") return { tipo: "hidratar-sua-vez", suaVez: await api.suaVez() };
  if (q === "rotinas") return { tipo: "hidratar-rotinas", rotinas: (await api.rotinas()).rotinas };
  if (q === "conectores") return { tipo: "hidratar-conectores", ...(await api.conectores()) };
  if (q === "salas") return { tipo: "hidratar-salas", salas: (await api.salas()).salas };
  if (q === "chaves") return { tipo: "hidratar-chaves", chaves: (await api.chaves()).chaves };
  if (q.startsWith("conversa:")) return { tipo: "hidratar-conversa", conversa: await api.conversa(q.slice(9)), agora };
  if (q.startsWith("memoria:")) return { tipo: "hidratar-memorias", agenteId: q.slice(8), memorias: (await api.memorias(q.slice(8))).memorias };
  if (q.startsWith("concessoes:")) return { tipo: "hidratar-concessoes", agenteId: q.slice(11), concessoes: (await api.concessoes(q.slice(11))).concessoes };
  if (q.startsWith("execucoes:")) return { tipo: "hidratar-execucoes", rotinaId: q.slice(10), execucoes: (await api.execucoes(q.slice(10))).execucoes };
  return null;
}

async function reidratar(): Promise<void> {
  if (!api || reidratando) return;
  const pendentes = [...new Set([...estado.invalidacoes, ...invalidacoesDaTela(estado)])];
  if (pendentes.length === 0) return;
  reidratando = true;
  try {
    // Só o que a tela atual olha entra agora; o resto fica marcado para quando a tela abrir.
    const relevantes = pendentes.filter((q) => relevante(q));
    // definido em 2026-09-17: consumir antes do GET preserva frames recebidos durante a busca.
    estado = reduzir(estado, { tipo: "invalidacoes-tratadas", quais: relevantes });
    for (const q of relevantes) {
      try {
        const acao = await buscar(q);
        if (acao) estado = reduzir(estado, acao);
      } catch (e) {
        if (!(e instanceof ErroApi && e.status === 404)) estado = reduzir(estado, { tipo: "erro", erro: erroDe(e) });
      }
    }
    render();
  } finally {
    reidratando = false;
  }
  if (estado.invalidacoes.some((q) => relevante(q))) void reidratar();
}

function relevante(q: Invalidacao): boolean {
  const t = estado.tela;
  if (q === "frota" || q === "inventario" || q === "executor" || q === "sua-vez" || q === "salas") return true;
  if (q === "gestao") return t.tipo === "gestao" || t.tipo === "perfil";
  if (q === "rotinas") return t.tipo === "rotinas" || t.tipo === "conversa";
  if (q === "conectores") return t.tipo === "conectores" || t.tipo === "perfil" || t.tipo === "conversa" || t.tipo === "sala";
  if (q === "chaves") return t.tipo === "chaves";
  if (q.startsWith("conversa:")) return (t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === q.slice(9);
  if (q.startsWith("memoria:")) return t.tipo === "memoria" && t.agenteId === q.slice(8);
  if (q.startsWith("concessoes:")) return (t.tipo === "perfil" || t.tipo === "conversa") && t.agenteId === q.slice(11) ? true : t.tipo === "conectores";
  if (q.startsWith("execucoes:")) return t.tipo === "rotinas";
  return true;
}

// ---------------------------------------------------------------------------------------------
// Render por regiões: rail | sidebar | cabeçalho | timeline/tela | composer | rodapé.

function renderRail(): string {
  const t = estado.tela.tipo;
  const abertos = estado.suaVez?.itens.filter((i) => i.estadoColuna !== "vencido").length ?? 0;
  const item = (tipo: Tela["tipo"], icone: string, rotulo: string, badge = 0) =>
    `<button class="nv" data-act="navegar" data-tela="${tipo}" aria-current="${t === tipo ? "true" : "false"}"><span class="ic">${icone}</span><span class="tl">${rotulo}</span>${badge ? `<span class="b">${badge}</span>` : ""}</button>`;
  return `<button class="marca" data-act="navegar" data-tela="frota" aria-label="nod início">n<span>·</span></button>${item("frota", "▦", "Frota")}${item("sua-vez", "◷", "Sua vez", abertos)}${item("rotinas", "◑", "Rotinas")}${item("conectores", "⚲", "Marketplace")}${item("chaves", "⚿", "Chaves")}
    <div class="rail-rodape"><span class="conexao conexao-${esc(estado.conexao.estado)}" title="eventos ao vivo: ${esc(estado.conexao.estado)}">●</span></div>`;
}

function renderSidebar(): string {
  const agentes = estado.frota?.agentes ?? [];
  const t = estado.tela;
  const atual = (conversaId: string) => ((t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId ? ' aria-current="true"' : "");
  const linha = (a: (typeof agentes)[number]) => {
    const vivo = Object.values(estado.turnosVivos).find((v) => v.conversaId === a.conversaId);
    const dot = vivo ? `<span class="dot" title="${vivo.estado === "rodando" ? "trabalhando" : "na fila"}"></span>` : "";
    const pin = a.fixado ? '<span class="pin" title="fixado">★</span>' : "";
    return `<div class="bot-row" data-bot-contexto="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="row"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}" aria-label="Abrir conversa com ${esc(a.nome)}">${iconeAgente(a)}<span class="txt"><b>${esc(a.nome)}</b><span>${esc(a.titulo || a.descricaoEstado || "acabamos de nos conhecer")}</span></span><span class="meta">${pin}${dot}${a.naoLido ? '<span class="unread-dot" aria-label="Não lido"></span>' : ""}</span></button><button class="bot-overflow" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}">•••</button></div>`;
  };
  const meus = agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId);
  const grupo = (nome: string, lista: typeof agentes) => lista.length ? `<section class="section"><h3>${esc(nome)} <span>${lista.length}</span></h3>${lista.map(linha).join("")}</section>` : "";
  const secoes = [...new Set(meus.filter((a) => !a.fixado && a.secao).map((a) => a.secao!))].sort((a, b) => a.localeCompare(b));
  const bots = grupo("Fixados", meus.filter((a) => a.fixado)) + grupo("Meus agentes", meus.filter((a) => !a.fixado && !a.secao)) + secoes.map((s) => grupo(s, meus.filter((a) => !a.fixado && a.secao === s))).join("");
  const equipe = agentes.filter((a) => a.ownerId !== estado.sessao?.pessoaId).map(linha).join("");
  const salas = estado.salas
    .map(
      (s) =>
        `<button class="row"${atual(s.sala.conversaId)} data-act="abrir-sala" data-sala="${esc(s.sala.id)}" data-conversa="${esc(s.sala.conversaId)}"><span class="g">#</span><span class="txt"><b>${esc(s.sala.nome)}</b></span><span class="meta"></span></button>`,
    )
    .join("");

  return `<div class="search-wrap">
      <div class="sh"><b>Meus agentes</b><span class="create-actions"><button class="create-trigger" data-act="criar-rapido" aria-label="Criar bot">+</button><button class="create-trigger" data-act="navegar" data-tela="novo-bot" aria-label="Nova conversa">⌄</button></span></div>
      <label class="search"><span>⌕</span><input id="busca-bots" placeholder="Buscar agentes…" aria-label="Buscar agentes" autocomplete="off" /><kbd>⌘ K</kbd></label>
    </div>
    <div class="list">
      ${bots || '<p class="mudo">Nenhum agente visível.</p>'}
      ${equipe ? `<section class="section"><h3>Agentes da equipe</h3>${equipe}</section>` : ""}
      <section class="section"><h3>Salas <button class="create-trigger" data-act="navegar" data-tela="nova-sala" aria-label="Nova sala">+</button></h3>${salas || '<p class="mudo">Reúna bots para trabalhar juntos.</p>'}</section>
    </div>
    <button class="manage-link" data-act="navegar" data-tela="gestao">Gerenciar agentes <span>Ocultos e excluídos</span></button>
    <button class="marketplace-link" data-act="navegar" data-tela="conectores"><span>▦</span> Marketplace</button>
    <div class="me"><span class="av-me">eu</span><div><b>Seu espaço</b><small>${estado.executor?.atual === "claude-cli" ? "Claude Code conectado" : "Modo de simulação"}</small></div></div>`;
}

function renderPrincipal(): void {
  const t = estado.tela;
  const erro = estado.erro ? `<div class="erro" role="alert">${esc(estado.erro.codigo)} — ${esc(estado.erro.mensagem)} ${botao("fechar-erro", "×", { classe: "sm" })}</div>` : "";
  let cabecalho = "";
  let corpo = "";
  let composer: { chave: string; html: string } | null = null;
  switch (t.tipo) {
    case "novo-bot":
      corpo = renderNovoBot(estado);
      break;
    case "nova-rotina":
      corpo = renderNovaRotina(estado, t.agenteId);
      break;
    case "frota":
      corpo = renderFrota(estado);
      break;
    case "sua-vez":
      corpo = renderSuaVez(estado);
      break;
    case "rotinas":
      corpo = renderRotinas(estado);
      break;
    case "conectores":
      corpo = renderConectores(estado);
      break;
    case "gestao":
      corpo = renderGestao(estado.gestao ?? null, estado.sessao?.pessoaId);
      break;
    case "perfil":
      corpo = renderPerfil(estado, t.agenteId);
      break;
    case "memoria":
      corpo = renderMemoria(estado, t.agenteId);
      break;
    case "nova-sala":
      corpo = renderNovaSala(estado);
      break;
    case "chaves":
      corpo = renderChaves(estado);
      break;
    case "conversa":
      cabecalho = renderCabecalhoConversa(estado, t.agenteId);
      corpo = renderTimeline(conversaDaTela(estado), estado);
      composer = { chave: `conversa:${t.conversaId}`, html: htmlComposer(`Escreva uma mensagem para ${botGerido(t.agenteId)?.nome ?? "o bot"}…`, (estado.frota?.agentes ?? []).filter((a) => a.id !== t.agenteId && a.ownerId === estado.sessao?.pessoaId && a.confirmado).map((a) => a.nome)) };
      break;
    case "sala":
      cabecalho = renderCabecalhoSala(estado, t.salaId);
      corpo = renderTimeline(conversaDaTela(estado), estado);
      composer = { chave: `sala:${t.salaId}`, html: htmlComposer("Mensagem para a sala — @Nome dirige a pergunta", nomesDosMembros(estado, t.salaId)) };
      break;
  }
  regiao("detalhes", renderDetalhes(estado));
  document.querySelector(".app")?.classList.toggle("com-detalhes", t.tipo === "conversa");
  regiao("cabecalho", cabecalho);
  regiao("erro", erro);
  const timeline = document.getElementById("timeline");
  const noFim = timeline ? timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40 : true;
  const abertos = [...document.querySelectorAll<HTMLDetailsElement>("details[data-disclosure][open]")].map((el) => el.dataset.disclosure);
  const buscas = ["busca-destinatario", "busca-marketplace"].map((id) => ({ id, valor: (document.getElementById(id) as HTMLInputElement | null)?.value ?? "" }));
  const respostas = [...document.querySelectorAll<HTMLInputElement>("[data-decisao] input")].map((el) => ({
    decisao: el.closest<HTMLElement>("[data-decisao]")?.dataset.decisao ?? "",
    atributo: el.hasAttribute("data-resposta") ? "data-resposta" : el.hasAttribute("data-item-texto") ? "data-item-texto" : "data-item",
    chave: el.dataset.resposta ?? el.dataset.itemTexto ?? el.dataset.item ?? "",
    valor: el.value, marcado: el.checked, inicial: el.defaultValue, marcadoInicial: el.defaultChecked,
    foco: document.activeElement === el, inicio: el.selectionStart, fim: el.selectionEnd,
  }));
  regiao("timeline", corpo);
  for (const resposta of respostas) {
    const el = document.querySelector<HTMLInputElement>(`[data-decisao="${CSS.escape(resposta.decisao)}"] input[${resposta.atributo}="${CSS.escape(resposta.chave)}"]`);
    if (!el || el.disabled || el.defaultValue !== resposta.inicial || el.defaultChecked !== resposta.marcadoInicial) continue;
    el.value = resposta.valor;
    el.checked = resposta.marcado;
    if (resposta.foco) {
      el.focus({ preventScroll: true });
      if (resposta.inicio !== null && resposta.fim !== null) el.setSelectionRange(resposta.inicio, resposta.fim);
    }
    const raiz = el.closest<HTMLElement>("[data-decisao]");
    const contador = raiz?.querySelector("[data-contador]");
    if (contador) contador.textContent = String(raiz?.querySelectorAll("input[data-item]:checked").length ?? 0);
  }
  for (const busca of buscas) {
    const campo = document.getElementById(busca.id) as HTMLInputElement | null;
    if (campo) campo.value = busca.valor;
  }
  filtrarBots((document.getElementById("busca-destinatario") as HTMLInputElement | null)?.value ?? "", ".contact-picker");
  filtrarApps((document.getElementById("busca-marketplace") as HTMLInputElement | null)?.value ?? "");
  for (const el of document.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]")) if (abertos.includes(el.dataset.disclosure)) el.open = true;
  if (timeline && (t.tipo === "conversa" || t.tipo === "sala") && noFim) timeline.scrollTop = timeline.querySelector(".welcome-options") ? 0 : timeline.scrollHeight;
  // O composer só é regravado quando a conversa muda: o textarea preserva texto, foco e cursor.
  if (composer?.chave !== composerDe) {
    composerDe = composer?.chave ?? null;
    esquecerRegiao("composer");
    regiao("composer", composer?.html ?? "");
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    ta?.focus();
  }
  // definido em 2026-09-17: hidratação do nome atualiza só o placeholder; nunca recria o textarea nem perde rascunho.
  const campoMensagem = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (campoMensagem && t.tipo === "conversa") {
    const nome = botGerido(t.agenteId)?.nome ?? "o bot";
    campoMensagem.placeholder = `Escreva uma mensagem para ${nome}…`;
  }
  document.body.classList.toggle("ocupado", estado.ocupado);
}

/**
 * Entrada (ADR-030). A recusa do Google é UMA mensagem para todos os motivos — o servidor não diz se
 * foi domínio, cadastro ou verificação, e a tela também não, para não contar quem trabalha na Leapy.
 */
function renderEntrada(): string {
  const m = entrada.modo;
  const recusa = entrada.recusado
    ? `<p class="erro" role="alert">Não foi possível entrar com essa conta. Use a sua conta Google da Leapy (@leapy.com.br). Se ela já é da Leapy, peça para ser cadastrada no nod.</p>`
    : "";
  if (!m) return `<section class="tela entrar"><h1>nod</h1><p class="mudo">carregando…</p></section>`;
  if (m.modo === "google") {
    return `<section class="tela entrar"><h1>nod</h1><p>Entre com a sua conta Google da Leapy.</p>${recusa}<a class="bt pri" href="${esc(sessaoApi.urlGoogle)}">Entrar com Google</a></section>`;
  }
  const pessoas = m.pessoas.length
    ? m.pessoas.map((p, i) => botao("entrar", `Entrar como ${esc(p.nome)}`, { classe: i === 0 ? "pri" : undefined, dados: { pessoa: p.id } })).join(" ")
    : '<p class="mudo">Nenhuma pessoa no cadastro. Rode <code>npm run db:seed</code>.</p>';
  return `<section class="tela entrar"><h1>nod</h1><p>Login de desenvolvimento (só nesta máquina): entre como uma pessoa do cadastro.</p>${pessoas}</section>`;
}

function render(): void {
  if (!estado.sessao) {
    document.querySelector(".app")?.classList.add("sem-sessao");
    regiao("detalhes", "");
    regiao("rail", "");
    regiao("sidebar", "");
    regiao("cabecalho", "");
    regiao("timeline", renderEntrada());
    regiao("composer", "");
    return;
  }
  document.querySelector(".app")?.classList.remove("sem-sessao");
  regiao("rail", renderRail());
  const busca = document.getElementById("busca-bots") as HTMLInputElement | null;
  const valorBusca = busca?.value ?? "";
  const focoBusca = document.activeElement === busca;
  regiao("sidebar", renderSidebar());
  const novaBusca = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (novaBusca) { novaBusca.value = valorBusca; if (focoBusca) novaBusca.focus(); }
  filtrarBots(valorBusca);
  renderPrincipal();
}

// ---------------------------------------------------------------------------------------------
// Sessão, SSE e relógio.

async function iniciarSessao(escopo: Escopo): Promise<void> {
  api = criarApi(escopo);
  dispatch({ tipo: "sessao", escopo });
  live?.disconnect();
  live = criarLiveEvents(api.urlEventos, {
    aoReidratar: () => dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "inventario", "executor", "salas", "rotinas", ...(conversaDaTela(estado) ? [`conversa:${conversaDaTela(estado)?.conversa.id}` as Invalidacao] : [])] }),
  });
  live.subscribe((ev) => {
    if (ev.tipo === "frame") dispatch({ tipo: "frame", frame: ev.frame, agora: Date.now() });
    else if (ev.tipo === "conexao") dispatch({ tipo: "conexao", estado: ev.estado, tentativa: ev.tentativa, proximaEmMs: ev.proximaEmMs });
  });
  live.connect();
  dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "salas", "executor", "rotinas"] });
}

async function boot(): Promise<void> {
  dispatch({ tipo: "tick", agora: Date.now() });
  window.setInterval(() => dispatch({ tipo: "tick", agora: Date.now() }), 15_000);
  const url = new URL(window.location.href);
  if (url.searchParams.get("entrar") === "recusado") {
    entrada = { ...entrada, recusado: true };
    url.searchParams.delete("entrar");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  try {
    await iniciarSessao(await sessaoApi.atual());
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) {
      render();
      try {
        entrada = { ...entrada, modo: await sessaoApi.modo() };
        render();
      } catch (e2) {
        dispatch({ tipo: "erro", erro: erroDe(e2) });
      }
    } else dispatch({ tipo: "erro", erro: erroDe(e) });
  }
}

// ---------------------------------------------------------------------------------------------
// Ações (delegação por data-act e data-form). A web só pede; o servidor decide.

function navegar(tela: Tela): void {
  dispatch({ tipo: "navegar", tela });
  if (tela.tipo !== "conversa" && tela.tipo !== "sala") document.getElementById("timeline")?.scrollTo({ top: 0 });
}

async function mudarGestao(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao", "rotinas", "salas", "sua-vez"] });
  } catch (e) { dispatch({ tipo: "erro", erro: erroDe(e) }); throw e; }
}

function acaoDoBot(a: BotGerido, acao: AcaoGestao): void {
  const executar = (fn: () => Promise<unknown>) => void agir(async () => { await mudarGestao(fn); });
  if (acao === "perfil") { navegar({ tipo: "perfil", agenteId: a.id }); return; }
  if (acao === "renomear") {
    pedirGestao("Renomear bot", `<label>Nome<input name="nome" value="${esc(a.nome)}" required maxlength="60" /></label>`, "Salvar", async (d) => mudarGestao(() => api!.editarPerfil(a.id, { nome: String(d.get("nome")) }))); return;
  }
  if (acao === "mover") {
    const secoes = [...new Set((estado.gestao?.agentes ?? estado.frota?.agentes ?? []).filter((b) => b.ownerId === estado.sessao?.pessoaId && !b.excluidoEm).map((b) => b.secao).filter(Boolean))];
    pedirGestao("Mover para", `<p>Escolha uma seção ou escreva um novo nome. Deixe vazio para tirar da seção.</p><label>Seção<input name="secao" value="${esc(a.secao ?? "")}" maxlength="60" list="secoes-bots" placeholder="Sem seção" /></label><datalist id="secoes-bots">${secoes.map((n) => `<option value="${esc(n!)}"></option>`).join("")}</datalist>`, "Mover", async (d) => mudarGestao(() => api!.organizarAgente(a.id, { secao: String(d.get("secao")) }))); return;
  }
  if (acao === "duplicar") {
    pedirGestao(`Duplicar ${a.nome}?`, "<p>A cópia mantém perfil e avatar. Rotinas começam pausadas. Histórico, memória e acessos não são copiados.</p>", "Duplicar", async () => {
      const r = await api!.duplicar(a.id);
      await mudarGestao(async () => r);
      navegar({ tipo: "conversa", agenteId: r.agente.id, conversaId: r.conversa.id });
    }); return;
  }
  if (acao === "excluir") {
    pedirGestao(`Excluir ${a.nome}?`, "<p>O bot vai para Excluídos. Novos trabalhos serão bloqueados, rotinas pausadas e acessos revogados. Trabalhos em andamento receberão um pedido de interrupção; ações externas já realizadas não podem ser desfeitas.</p><p>Você pode recuperar o perfil e o histórico em Gerenciar agentes.</p>", "Excluir agente", async () => {
      await mudarGestao(() => api!.excluirAgente(a.id)); navegar({ tipo: "gestao" });
    }, true); return;
  }
  if (acao === "copiar") {
    void navigator.clipboard.writeText(a.conversaId).then(() => pedirGestao("ID copiado", `<p>ID da conversa copiado para a área de transferência.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})).catch(() => pedirGestao("ID da conversa", `<p>Selecione e copie o ID abaixo.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})); return;
  }
  if (acao === "ocultar" && !a.oculto) {
    pedirGestao("Ocultar da barra lateral?", "<p>O bot e suas rotinas continuam funcionando. Para trazê-lo de volta, abra Gerenciar agentes → Ocultos.</p>", "Ocultar", async () => {
      await mudarGestao(() => api!.ocultar(a.id, true)); navegar({ tipo: "gestao" });
    }); return;
  }
  executar(() => acao === "fixar" ? api!.fixar(a.id, !a.fixado) : acao === "nao-lido" ? api!.organizarAgente(a.id, { naoLido: !a.naoLido }) : acao === "restaurar" ? api!.restaurarAgente(a.id) : api!.ocultar(a.id, false));
}

function botGerido(id: string | undefined): BotGerido | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

function menuDoBot(el: HTMLElement): void {
  const a = botGerido(el.dataset.id);
  if (a) abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, el, (acao) => acaoDoBot(a, acao));
}

function conversaAtual(): { conversaId: string; salaId: string | null } | null {
  const t = estado.tela;
  if (t.tipo === "conversa") return { conversaId: t.conversaId, salaId: null };
  if (t.tipo === "sala") return { conversaId: t.conversaId, salaId: t.salaId };
  return null;
}

async function enviarComposer(): Promise<void> {
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const alvo = conversaAtual();
  if (!ta || !alvo || !api) return;
  const texto = ta.value.trim();
  if (!texto) return;
  const a = api;
  await agir(async () => {
    if (alvo.salaId) await a.postarNaSala(alvo.salaId, texto);
    else await a.enviar(alvo.conversaId, texto);
    ta.value = "";
    ta.style.height = "auto";
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
  });
}

function marcacoesDe(decisaoId: string): { id: string; selecionado: boolean; textoFinal?: string }[] {
  const raiz = document.querySelector(`[data-decisao="${CSS.escape(decisaoId)}"]`);
  if (!raiz) return [];
  return [...raiz.querySelectorAll<HTMLInputElement>("input[data-item]")].map((cb) => {
    const id = cb.getAttribute("data-item") ?? "";
    const texto = raiz.querySelector<HTMLInputElement>(`input[data-item-texto="${CSS.escape(id)}"]`)?.value;
    return { id, selecionado: cb.checked, ...(texto !== undefined ? { textoFinal: texto } : {}) };
  });
}

function filtrarApps(texto: string): void {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-app-busca]")];
  for (const el of cards) el.hidden = !el.dataset.appBusca?.includes(texto.trim().toLowerCase());
  const vazio = document.getElementById("marketplace-vazio");
  if (vazio) vazio.hidden = cards.some((el) => !el.hidden);
}

function filtrarBots(texto: string, raiz = "#sidebar"): void {
  for (const el of document.querySelectorAll<HTMLElement>(`${raiz} [data-busca]`)) el.hidden = !el.dataset.busca?.includes(texto.trim().toLowerCase());
}

const ACOES: Record<string, (el: HTMLElement) => Promise<void> | void> = {
  entrar: (el) => agir(async () => iniciarSessao(await sessaoApi.entrar(el.dataset.pessoa ?? ""))),
  navegar: (el) => {
    const tela = el.dataset.tela as Tela["tipo"] | undefined;
    if (tela === "frota" || tela === "sua-vez" || tela === "rotinas" || tela === "conectores" || tela === "nova-sala" || tela === "chaves" || tela === "novo-bot" || tela === "nova-rotina") navegar({ tipo: tela });
  },
  "conectar-composio": (el) => agir(async () => {
    if (!estado.composioConfigurado) {
      dispatch({ tipo: "aviso-conexao", texto: "Adicione a chave do seu Composio acima para conectar os apps." });
      document.querySelector<HTMLInputElement>('input[name="chave"]')?.focus();
      return;
    }
    const slug = el.dataset.id ?? "";
    const r = await api!.conectarApp(slug);
    dispatch({ tipo: "autorizacao-app", slug, url: r.url });
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "verificar-composio": (el) => agir(async () => {
    const r = await api!.verificarApp(el.dataset.id ?? "");
    dispatch({ tipo: "aviso-conexao", texto: r.conectado ? "Conexão concluída. Escolha as ferramentas que seu bot pode usar abaixo, ou volte à conversa para ele pedir o acesso necessário." : "Login ainda não concluído ou conexão indisponível. Termine a autorização na outra aba e tente novamente." });
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "abrir-conexao": (el) => {
    const t = estado.tela;
    navegar({ tipo: "conectores", app: el.dataset.id, voltar: t.tipo === "conversa" || t.tipo === "sala" ? t : undefined });
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  },
  "voltar-conexao": () => {
    const t = estado.tela;
    if (t.tipo === "conectores" && t.voltar) navegar(t.voltar);
    else navegar({ tipo: "frota" });
  },
  "retomar-conexao": (el) => agir(async () => {
    const alvo = conversaAtual();
    if (!alvo) return;
    await api!.recusarProposta(el.dataset.id ?? "");
    const texto = `Conectei ${el.dataset.slug ?? "o app"}. Continue o pedido anterior usando o catálogo disponível e peça os acessos necessários.`;
    if (alvo.salaId) await api!.postarNaSala(alvo.salaId, texto);
    else await api!.enviar(alvo.conversaId, texto);
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`, "conectores"] });
  }),
  "criar-rapido": () => agir(async () => {
    const r = await api!.criarAgente(undefined, { interativo: true });
    dispatch({ tipo: "invalidar", quais: ["frota"] });
    navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
  }),
  "escolher-missao": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { ta.value = el.dataset.texto ?? ""; return enviarComposer(); }
  },
  "alternar-detalhes": () => { document.querySelector(".app")?.classList.toggle("detalhes-abertos"); },
  "preencher-prompt": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { ta.value = el.dataset.texto ?? ""; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  },
  "nova-rotina": (el) => navegar({ tipo: "nova-rotina", agenteId: el.dataset.id }),
  "executar-rotina": (el) => agir(async () => {
    const r = await api!.executarRotina(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["rotinas", `execucoes:${el.dataset.id ?? ""}`] });
    navegar({ tipo: "conversa", conversaId: r.ids.conversaId ?? "", agenteId: el.dataset.agente ?? "" });
  }),
  "abrir-conversa": (el) => {
    const a = estado.frota?.agentes.find((a) => a.id === el.dataset.agente);
    if (a?.naoLido && a.ownerId === estado.sessao?.pessoaId) void agir(async () => { await mudarGestao(() => api!.organizarAgente(a.id, { naoLido: false })); });
    navegar({ tipo: "conversa", conversaId: el.dataset.conversa ?? "", agenteId: el.dataset.agente ?? "" });
  },
  "abrir-sala": (el) => navegar({ tipo: "sala", salaId: el.dataset.sala ?? "", conversaId: el.dataset.conversa ?? "" }),
  "menu-agente": (el) => menuDoBot(el),
  "atualizar-gestao": () => dispatch({ tipo: "invalidar", quais: ["gestao"] }),
  "restaurar-agente": (el) => agir(async () => { await mudarGestao(() => api!.restaurarAgente(el.dataset.id ?? "")); }),
  "ir-perfil": (el) => navegar({ tipo: "perfil", agenteId: el.dataset.id ?? "" }),
  "ir-memoria": (el) => navegar({ tipo: "memoria", agenteId: el.dataset.id ?? "" }),
  "fechar-erro": () => dispatch({ tipo: "erro", erro: null }),
  "fechar-faixa": () => dispatch({ tipo: "faixa", faixa: null }),
  enviar: () => enviarComposer(),
  "sondar-inventario": () => agir(async () => dispatch({ tipo: "hidratar-inventario", inventario: await api!.inventario(true) })),
  "trocar-executor": (el) =>
    agir(async () => {
      const estadoNovo = await api!.trocarExecutor(el.dataset.id === "claude-cli" ? "claude-cli" : "catcher");
      dispatch({ tipo: "hidratar-executor", executor: estadoNovo });
      dispatch({ tipo: "invalidar", quais: ["inventario", "frota"] });
    }),
  "parar-conversa": () =>
    agir(async () => {
      const alvo = conversaAtual();
      if (!alvo) return;
      dispatch({ tipo: "faixa", faixa: await api!.pararConversa(alvo.conversaId) });
      dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`, "frota"] });
    }),
  "parar-sala": (el) =>
    agir(async () => {
      dispatch({ tipo: "faixa", faixa: await api!.pararSala(el.dataset.id ?? "") });
      const alvo = conversaAtual();
      if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    }),
  "confirmar-proposta": (el) => agir(async () => void (await api!.confirmarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota", "rotinas", "sua-vez", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  "recusar-proposta": (el) => agir(async () => void (await api!.recusarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  fixar: (el) => agir(async () => void (await api!.fixar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota"] }))),
  ocultar: (el) => { const a = botGerido(el.dataset.id); if (a) acaoDoBot(a, "ocultar"); },
  duplicar: (el) => { const a = botGerido(el.dataset.id); if (a) acaoDoBot(a, "duplicar"); },
  revogar: (el) => agir(async () => void (await api!.revogar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [`concessoes:${el.dataset.agente ?? ""}`, "frota"] }))),
  "salvar-memoria": (el) =>
    agir(async () => {
      const li = el.closest("[data-memoria]");
      const texto = li?.querySelector<HTMLInputElement>('[data-campo="texto"]')?.value ?? "";
      const tipo = li?.querySelector<HTMLSelectElement>('[data-campo="tipo"]')?.value as "preferencia" | "fato" | "resumo" | undefined;
      await api!.editarMemoria(el.dataset.agente ?? "", el.dataset.id ?? "", { texto, tipo });
      dispatch({ tipo: "invalidar", quais: [`memoria:${el.dataset.agente ?? ""}`] });
    }),
  "apagar-memoria": (el) => agir(async () => void (await api!.apagarMemoria(el.dataset.agente ?? "", el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [`memoria:${el.dataset.agente ?? ""}`] }))),
  "pausar-rotina": (el) => agir(async () => void (await api!.pausarRotina(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["rotinas"] }))),
  "ativar-rotina": (el) => agir(async () => void (await api!.ativarRotina(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["rotinas"] }))),
  "ver-execucoes": (el) => dispatch({ tipo: "invalidar", quais: [`execucoes:${el.dataset.id ?? ""}`] }),
  "sondar-conector": (el) => agir(async () => void (await api!.sondarConector(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["conectores", "frota"] }))),
  "habilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", true), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "desabilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", false), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "decidir-aprovacao": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "") }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  "decidir-aprovacao-nenhum": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "").map((m) => ({ ...m, selecionado: false })) }), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  "decidir-proposta": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", {}), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  "recusar-decisao": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { recusar: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  responder: (el) =>
    agir(async () => {
      const texto = document.querySelector<HTMLInputElement>(`input[data-resposta="${CSS.escape(el.dataset.id ?? "")}"]`)?.value.trim() ?? "";
      await api!.responder(el.dataset.id ?? "", texto);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] });
    }),
  retomar: (el) =>
    agir(async () => {
      const texto = document.querySelector<HTMLInputElement>(`input[data-resposta="${CSS.escape(el.dataset.id ?? "")}"]`)?.value.trim();
      await api!.retomar(el.dataset.id ?? "", texto || undefined);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] });
    }),
  "revogar-chave": (el) => {
    if (!window.confirm(`Cancelar a chave "${el.dataset.nome ?? ""}"? O computador dela para de conseguir entrar na hora.`)) return;
    return agir(async () => void (await api!.revogarChave(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["chaves"] })));
  },
  "fechar-chave-emitida": () => dispatch({ tipo: "chave-emitida", emitida: null }),
  reabrir: (el) => agir(async () => void (await api!.reabrir(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
};

const FORMS: Record<string, (form: HTMLFormElement) => Promise<void>> = {
  "emitir-chave": (form) =>
    agir(async () => {
      const nome = (form.elements.namedItem("nome") as HTMLInputElement | null)?.value.trim() ?? "";
      const emitida = await api!.emitirChave(nome);
      form.reset();
      dispatch({ tipo: "chave-emitida", emitida });
    }),
  "criar-agente": (form) =>
    agir(async () => {
      const nome = (form.elements.namedItem("nome") as HTMLInputElement | null)?.value.trim() || undefined;
      const d = new FormData(form);
      const r = await api!.criarAgente(nome, { titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? "") });
      form.reset();
      dispatch({ tipo: "invalidar", quais: ["frota"] });
      navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
    }),
  "criar-rotina": (form) => agir(async () => {
    const d = new FormData(form);
    const [hora, minuto] = String(d.get("horario")).split(":").map(Number);
    await api!.criarRotina({ agenteId: String(d.get("agenteId")), cron: String(d.get("frequencia")).startsWith("intervalo:") ? `*/${String(d.get("frequencia")).split(":")[1]} * * * *` : d.get("frequencia") === "hora" ? "0 * * * *" : `${minuto} ${hora} * * ${d.get("frequencia")}`, fusoIana: String(d.get("fusoIana")), instrucao: String(d.get("instrucao")), fonte: String(d.get("fonte")), entregavel: String(d.get("entregavel")), limitesAprovacao: String(d.get("limitesAprovacao")), politicaSemDado: String(d.get("politicaSemDado")) });
    dispatch({ tipo: "invalidar", quais: ["rotinas"] });
    navegar({ tipo: "rotinas" });
  }),
  "editar-perfil": (form) =>
    agir(async () => {
      const d = new FormData(form);
      await api!.editarPerfil(form.dataset.id ?? "", { nome: String(d.get("nome") ?? ""), titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? ""), modelo: String(d.get("modelo") ?? ""), forma: String(d.get("forma")) as FormaAgente, cor: String(d.get("cor")) as CorAgente });
      dispatch({ tipo: "invalidar", quais: ["frota"] });
    }),
  "criar-memoria": (form) =>
    agir(async () => {
      const d = new FormData(form);
      await api!.criarMemoria(form.dataset.id ?? "", String(d.get("tipo") ?? "fato") as "preferencia" | "fato" | "resumo", String(d.get("texto") ?? ""));
      form.reset();
      dispatch({ tipo: "invalidar", quais: [`memoria:${form.dataset.id ?? ""}`] });
    }),
  "criar-sala": (form) =>
    agir(async () => {
      const d = new FormData(form);
      const agenteIds = d.getAll("agenteIds").map(String);
      const r = await api!.criarSala(String(d.get("nome") ?? "sala"), agenteIds);
      dispatch({ tipo: "invalidar", quais: ["salas"] });
      navegar({ tipo: "sala", salaId: r.ids.salaId ?? "", conversaId: r.ids.conversaId ?? "" });
    }),
  "configurar-composio": (form) => agir(async () => {
    const d = new FormData(form);
    await api!.configurarComposio(String(d.get("chave") ?? ""));
    form.reset();
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "credenciais-conector": (form) => agir(async () => {
    const d = new FormData(form);
    let env: Record<string, string>;
    try { env = JSON.parse(String(d.get("env") ?? "{}")) as Record<string, string>; }
    catch { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Informe as credenciais como um objeto JSON válido." } }); return; }
    await api!.atualizarCredenciais(form.dataset.id ?? "", env);
    form.reset();
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "registrar-conector": (form) =>
    agir(async () => {
      const d = new FormData(form);
      const args = String(d.get("args") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      let env: Record<string, string> = {};
      const envTexto = String(d.get("env") ?? "").trim();
      if (envTexto) env = JSON.parse(envTexto) as Record<string, string>;
      await api!.registrarConector({ nome: d.get("nome"), slug: d.get("slug"), transporte: d.get("transporte"), comando: String(d.get("comando") ?? "") || null, args, url: String(d.get("url") ?? "") || null, env, declaracao: d.get("declaracao") });
      form.reset();
      dispatch({ tipo: "invalidar", quais: ["conectores"] });
    }),
  conceder: (form) =>
    agir(async () => {
      const d = new FormData(form);
      const agenteId = String(d.get("agenteId") ?? "");
      await api!.conceder(agenteId, form.dataset.id ?? "", String(d.get("capacidade") ?? ""));
      dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`, "frota"] });
    }),
};

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || el.tagName === "BUTTON" && (el as HTMLButtonElement).type === "submit" && el.closest("form[data-form]")) return;
  const acao = ACOES[el.dataset.act ?? ""];
  if (acao) void acao(el);
});

document.addEventListener("submit", (ev) => {
  const form = (ev.target as HTMLElement).closest<HTMLFormElement>("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const tratar = FORMS[form.dataset.form ?? ""];
  if (tratar) void tratar(form);
});

// Contador ao vivo da aprovação em lista e autocomplete de @menção.
document.addEventListener("change", (ev) => {
  const cb = ev.target as HTMLInputElement;
  if (cb.matches('select[name="frequencia"]')) {
    const horario = cb.closest("form")?.querySelector<HTMLInputElement>('input[name="horario"]');
    const intervalo = cb.value.startsWith("intervalo:") || cb.value === "hora";
    if (horario) { horario.disabled = intervalo; horario.required = !intervalo; horario.closest("label")!.hidden = intervalo; }
    return;
  }
  if (!cb.matches("input[data-item]")) return;
  const raiz = cb.closest("[data-decisao]");
  const contador = raiz?.querySelector("[data-contador]");
  if (contador && raiz) contador.textContent = String(raiz.querySelectorAll("input[data-item]:checked").length);
});

document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); document.getElementById("busca-bots")?.focus(); return; }
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.id !== "composer-texto") return;
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void enviarComposer();
  }
});

document.addEventListener("input", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.id === "busca-marketplace") {
    filtrarApps(ta.value);
    return;
  }
  if (ta.id === "busca-bots" || ta.id === "busca-destinatario") { filtrarBots(ta.value, ta.id === "busca-bots" ? "#sidebar" : ".contact-picker"); return; }
  if (ta.id !== "composer-texto") return;
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 170)}px`;
  const caixa = document.getElementById("autocomplete");
  if (!caixa) return;
  const sugestoes = JSON.parse(ta.dataset.sugestoes ?? "[]") as string[];
  const m = /(^|\s)@([\p{L}\d_-]*)$/u.exec(ta.value.slice(0, ta.selectionStart));
  const lista = m ? sugestoes.filter((n) => n.toLowerCase().startsWith((m[2] ?? "").toLowerCase())) : [];
  caixa.hidden = lista.length === 0;
  caixa.innerHTML = lista.map((n) => `<button type="button" class="sug" data-nome="${esc(n)}">@${esc(n)}</button>`).join("");
});

document.addEventListener("mousedown", (ev) => {
  const sug = (ev.target as HTMLElement).closest<HTMLElement>(".sug");
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!sug || !ta) return;
  ev.preventDefault();
  const antes = ta.value.slice(0, ta.selectionStart).replace(/@[\p{L}\d_-]*$/u, `@${sug.dataset.nome ?? ""} `);
  ta.value = antes + ta.value.slice(ta.selectionStart);
  ta.selectionStart = ta.selectionEnd = antes.length;
  const caixa = document.getElementById("autocomplete");
  if (caixa) caixa.hidden = true;
  ta.focus();
});

void boot();

// Exposto para inspeção manual no console (nunca como API): o estado atual e o agente da tela.
declare global {
  interface Window {
    nod?: { estado(): Estado; agente(): string | null };
  }
}
window.nod = { estado: () => estado, agente: () => agenteDaTela(estado) };

document.addEventListener("contextmenu", (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-bot-contexto]");
  if (!row) return;
  ev.preventDefault();
  const botao = row.querySelector<HTMLElement>("[data-act=menu-agente]");
  if (botao) menuDoBot(botao);
});
