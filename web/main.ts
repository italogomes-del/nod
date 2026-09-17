import type { ModoSessaoDto } from "../src/contracts/api.ts";
import type { Escopo } from "../src/shared/types.ts";
import { agenteDaTela, conversaDaTela, estadoInicial, invalidacoesDaTela, reduzir, type Acao, type Estado, type Invalidacao, type Tela } from "./estado/reducer.ts";
import { criarApi, ErroApi, sessao as sessaoApi, type Api } from "./lib/api.ts";
import { criarLiveEvents, type LiveEvents } from "./lib/live-events.ts";
import { botao, esc, esquecerRegiao, iconeAgente, regiao } from "./lib/render.ts";
import { renderChaves } from "./telas/chaves.ts";
import { renderConectores } from "./telas/conectores.ts";
import { htmlComposer, renderCabecalhoConversa, renderTimeline } from "./telas/conversa.ts";
import { inventarioEmUso, renderFrota, textoInventario } from "./telas/frota.ts";
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
  if (q === "frota") return { tipo: "hidratar-frota", frota: await api.frota() };
  if (q === "inventario") return { tipo: "hidratar-inventario", inventario: await api.inventario() };
  if (q === "executor") return { tipo: "hidratar-executor", executor: await api.executor() };
  if (q === "sua-vez") return { tipo: "hidratar-sua-vez", suaVez: await api.suaVez() };
  if (q === "rotinas") return { tipo: "hidratar-rotinas", rotinas: (await api.rotinas()).rotinas };
  if (q === "conectores") return { tipo: "hidratar-conectores", conectores: (await api.conectores()).conectores };
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
    const tratadas: Invalidacao[] = [];
    for (const q of relevantes) {
      try {
        const acao = await buscar(q);
        tratadas.push(q);
        if (acao) estado = reduzir(estado, acao);
      } catch (e) {
        if (e instanceof ErroApi && e.status === 404) tratadas.push(q);
        else estado = reduzir(estado, { tipo: "erro", erro: erroDe(e) });
      }
    }
    estado = reduzir(estado, { tipo: "invalidacoes-tratadas", quais: tratadas });
    render();
  } finally {
    reidratando = false;
  }
  if (estado.invalidacoes.some((q) => relevante(q))) void reidratar();
}

function relevante(q: Invalidacao): boolean {
  const t = estado.tela;
  if (q === "frota" || q === "inventario" || q === "executor" || q === "sua-vez" || q === "salas") return true;
  if (q === "rotinas") return t.tipo === "rotinas" || t.tipo === "conversa";
  if (q === "conectores") return t.tipo === "conectores" || t.tipo === "perfil";
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
  return `${item("frota", "▦", "Frota")}${item("sua-vez", "◷", "Sua vez", abertos)}${item("rotinas", "◑", "Rotinas")}${item("conectores", "⚲", "Conectores")}${item("chaves", "⚿", "Chaves")}
    <div class="rail-rodape"><span class="conexao conexao-${esc(estado.conexao.estado)}" title="eventos ao vivo: ${esc(estado.conexao.estado)}">●</span></div>`;
}

function renderSidebar(): string {
  const agentes = estado.frota?.agentes ?? [];
  const t = estado.tela;
  const atual = (conversaId: string) => ((t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId ? ' aria-current="true"' : "");
  const fixados = agentes.filter((a) => a.fixado);
  const favoritos = fixados.length
    ? fixados
        .map(
          (a) =>
            `<button class="fav" data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" aria-label="Abrir ${esc(a.nome)}">${iconeAgente(a)}<b>${esc(a.nome)}</b><span>${esc(a.titulo || "bot")}</span></button>`,
        )
        .join("")
    : `<div class="favorites-note">Fixe um bot para vê-lo aqui no topo.</div>`;

  const linha = (a: (typeof agentes)[number]) => {
    const vivo = Object.values(estado.turnosVivos).find((v) => v.conversaId === a.conversaId);
    const dot = vivo ? `<span class="dot" title="${vivo.estado === "rodando" ? "trabalhando" : "na fila"}"></span>` : "";
    const pin = a.fixado ? '<span class="pin" title="fixado">★</span>' : "";
    return `<button class="row"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" aria-label="Abrir conversa com ${esc(a.nome)}">${iconeAgente(a)}<span class="txt"><b>${esc(a.nome)}</b><span>${esc(a.titulo || a.descricaoEstado || "acabamos de nos conhecer")}</span></span><span class="meta">${pin}${dot}</span></button>`;
  };
  const bots = agentes.map(linha).join("") || '<p class="mudo">nenhum bot ainda</p>';
  const salas = estado.salas
    .map(
      (s) =>
        `<button class="row"${atual(s.sala.conversaId)} data-act="abrir-sala" data-sala="${esc(s.sala.id)}" data-conversa="${esc(s.sala.conversaId)}"><span class="g">#</span><span class="txt"><b>${esc(s.sala.nome)}</b></span><span class="meta"></span></button>`,
    )
    .join("");

  return `<div class="search-wrap">
      <div class="sh"><b>Meus agentes</b></div>
      <div class="search-row">
        <label class="search" aria-label="Buscar"><span>⌕</span><input value="Buscar" readonly></label>
        <button class="create-trigger" data-act="navegar" data-tela="frota" aria-label="Criar bot">+</button>
      </div>
      <div class="favorites">
        <div class="favorites-head"><span>Favoritos</span><b>${fixados.length} fixados</b></div>
        <div class="fav-grid">${favoritos}</div>
      </div>
    </div>
    <div class="list">
      <section class="section"><h3>Bots · ${agentes.length}</h3>${bots}${botao("navegar", "+ criar bot", { classe: "sm", dados: { tela: "frota" } })}</section>
      <section class="section"><h3>Salas · ${estado.salas.length}</h3>${salas}${botao("navegar", "+ nova sala", { classe: "sm", dados: { tela: "nova-sala" } })}</section>
    </div>
    <div class="me"><span class="av-me">eu</span> ${esc(textoInventario(inventarioEmUso(estado), estado.agora))}</div>`;
}

function renderPrincipal(): void {
  const t = estado.tela;
  const erro = estado.erro ? `<div class="erro" role="alert">${esc(estado.erro.codigo)} — ${esc(estado.erro.mensagem)} ${botao("fechar-erro", "×", { classe: "sm" })}</div>` : "";
  let cabecalho = "";
  let corpo = "";
  let composer: { chave: string; html: string } | null = null;
  switch (t.tipo) {
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
      composer = { chave: `conversa:${t.conversaId}`, html: htmlComposer("Mensagem para o bot") };
      break;
    case "sala":
      cabecalho = renderCabecalhoSala(estado, t.salaId);
      corpo = renderTimeline(conversaDaTela(estado), estado);
      composer = { chave: `sala:${t.salaId}`, html: htmlComposer("Mensagem para a sala — @Nome dirige a pergunta", nomesDosMembros(estado, t.salaId)) };
      break;
  }
  regiao("cabecalho", cabecalho);
  regiao("erro", erro);
  const timeline = document.getElementById("timeline");
  const noFim = timeline ? timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight - 40 : true;
  regiao("timeline", corpo);
  if (timeline && (t.tipo === "conversa" || t.tipo === "sala") && noFim) timeline.scrollTop = timeline.scrollHeight;
  // O composer só é regravado quando a conversa muda: o textarea preserva texto, foco e cursor.
  if (composer?.chave !== composerDe) {
    composerDe = composer?.chave ?? null;
    esquecerRegiao("composer");
    regiao("composer", composer?.html ?? "");
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    ta?.focus();
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
    regiao("rail", "");
    regiao("sidebar", "");
    regiao("cabecalho", "");
    regiao("timeline", renderEntrada());
    regiao("composer", "");
    return;
  }
  regiao("rail", renderRail());
  regiao("sidebar", renderSidebar());
  renderPrincipal();
}

// ---------------------------------------------------------------------------------------------
// Sessão, SSE e relógio.

async function iniciarSessao(escopo: Escopo): Promise<void> {
  api = criarApi(escopo);
  dispatch({ tipo: "sessao", escopo });
  live?.disconnect();
  live = criarLiveEvents(api.urlEventos, {
    aoReidratar: () => dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "inventario", "executor", "salas", ...(conversaDaTela(estado) ? [`conversa:${conversaDaTela(estado)?.conversa.id}` as Invalidacao] : [])] }),
  });
  live.subscribe((ev) => {
    if (ev.tipo === "frame") dispatch({ tipo: "frame", frame: ev.frame, agora: Date.now() });
    else if (ev.tipo === "conexao") dispatch({ tipo: "conexao", estado: ev.estado, tentativa: ev.tentativa, proximaEmMs: ev.proximaEmMs });
  });
  live.connect();
  dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "salas", "executor"] });
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

const ACOES: Record<string, (el: HTMLElement) => Promise<void> | void> = {
  entrar: (el) => agir(async () => iniciarSessao(await sessaoApi.entrar(el.dataset.pessoa ?? ""))),
  navegar: (el) => {
    const tela = el.dataset.tela as Tela["tipo"] | undefined;
    if (tela === "frota" || tela === "sua-vez" || tela === "rotinas" || tela === "conectores" || tela === "nova-sala" || tela === "chaves") navegar({ tipo: tela });
  },
  "abrir-conversa": (el) => navegar({ tipo: "conversa", conversaId: el.dataset.conversa ?? "", agenteId: el.dataset.agente ?? "" }),
  "abrir-sala": (el) => navegar({ tipo: "sala", salaId: el.dataset.sala ?? "", conversaId: el.dataset.conversa ?? "" }),
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
  ocultar: (el) => agir(async () => void (await api!.ocultar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota"] }))),
  duplicar: (el) =>
    agir(async () => {
      const r = await api!.duplicar(el.dataset.id ?? "");
      dispatch({ tipo: "invalidar", quais: ["frota"] });
      navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
    }),
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
  "decidir-proposta": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", {}), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota"] }))),
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
      const r = await api!.criarAgente(nome);
      form.reset();
      dispatch({ tipo: "invalidar", quais: ["frota"] });
      navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
    }),
  "editar-perfil": (form) =>
    agir(async () => {
      const d = new FormData(form);
      await api!.editarPerfil(form.dataset.id ?? "", { nome: String(d.get("nome") ?? ""), titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? ""), modelo: String(d.get("modelo") ?? "") });
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
  if (!cb.matches("input[data-item]")) return;
  const raiz = cb.closest("[data-decisao]");
  const contador = raiz?.querySelector("[data-contador]");
  if (contador && raiz) contador.textContent = String(raiz.querySelectorAll("input[data-item]:checked").length);
});

document.addEventListener("keydown", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.id !== "composer-texto") return;
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void enviarComposer();
  }
});

document.addEventListener("input", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
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
