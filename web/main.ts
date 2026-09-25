import "./lib/mascote-elemento.ts";
import { abrirComputador } from "./telas/computador.ts";
import { abrirWorkspace } from "./telas/workspace.ts";
import { abrirReportarBug } from "./telas/reportar-bug.ts";
import { renderInteligencia, escolhaInteligencia } from "./telas/inteligencia.ts";
import { abrirMenu, pedirGestao, renderGestao, type BotGerido, type AcaoGestao } from "./telas/gestao-agentes.ts";
import type { FormaAgente, CorAgente } from "../src/contracts/agente.ts";
import type { AmbienteBancoDto, ModoSessaoDto } from "../src/contracts/api.ts";
import type { AlvoAviso } from "../src/contracts/desktop.ts";
import type { Escopo } from "../src/shared/types.ts";
import { agenteDaTela, conversaDaTela, estadoInicial, invalidacoesDaTela, reduzir, type Acao, type Estado, type Invalidacao, type Tela } from "./estado/reducer.ts";
import { criarApi, ErroApi, sessao as sessaoApi, type Api } from "./lib/api.ts";
import { criarAvisador } from "./lib/avisador.ts";
import { criarCanalAvisos } from "./lib/canal-avisos.ts";
import { criarLiveEvents, type LiveEvents } from "./lib/live-events.ts";
import { atualizarMascote, botao, esc, iconeAgente } from "./lib/render.ts";
import { estadoMascoteNaConversa } from "./lib/mascote.ts";
import { esquecerRegiao, regiao } from "./lib/regioes.ts";
import { renderNovoBot } from "./telas/novo-bot.ts";
import { renderNovaRotina } from "./telas/nova-rotina.ts";
import { renderDetalhes } from "./telas/detalhes.ts";
import { renderChaves } from "./telas/chaves.ts";
import { renderRelatos } from "./telas/relatos.ts";
import { renderEspaco } from "./telas/espaco.ts";
import { renderConectores } from "./telas/conectores.ts";
import { appsQueFaltam } from "./telas/rotina-precisa.ts";
import { criarConexoes } from "./lib/conexao.ts";
import type { Proposta } from "../src/contracts/conversa.ts";
import { htmlComposer, renderCabecalhoConversa, renderTimeline } from "./telas/conversa.ts";
import { inventarioEmUso } from "./telas/frota.ts";
import { renderMemoria } from "./telas/memoria.ts";
import { renderPerfil } from "./telas/perfil.ts";
import { renderRotinas } from "./telas/rotinas.ts";
import { nomesDosMembros, renderCabecalhoSala, renderNovaSala } from "./telas/sala.ts";
import { abertasPorAgente, perguntasPorAgente, renderChamada, renderIncidentes, renderSuaVez, rotinasParadasPorAgente, SUBTITULO_ESPERANDO, SUBTITULO_ROTINA_PARADA } from "./telas/sua-vez.ts";
import { aparenciaDoComposer } from "./telas/pergunta.ts";
import { destinoDoEnvio, enviarPeloComposer, modoDoComposer, MOTIVO_SEM_ANEXO } from "./lib/perguntas.ts";
import { mimeDe, motivoRecusa, POR_MENSAGEM, renderItens as renderItensAnexo, resumo as resumoAnexos, type Aceita, type ItemAnexo } from "./lib/anexos.ts";

/**
 * main.ts: sessão → hidratar → SSE (ADR-016) → laço "dispatch → reidratar o que o reducer invalidou →
 * render por regiões". A web DECIDE e pede por REST; nunca executa (ADR-020). Nenhuma decisão do produto
 * exige o app aberto: sem executor a tela continua respondendo (web-sem-app).
 */
let estado: Estado = estadoInicial;
/** Janela do Desfazer ao cancelar uma mensagem da fila. */
const CANCELAR_DESFAZER_MS = 5_000;
let api: Api | null = null;
let live: LiveEvents | null = null;
let composerDe: string | null = null;
let reidratando = false;
let ambienteBanco: AmbienteBancoDto | null = null;
/** Tela de entrada (ADR-030): o modo vem do servidor; `recusado` vem do redirect do callback do Google. */
let entrada: { modo: ModoSessaoDto | null; recusado: boolean } = { modo: null, recusado: false };

// definido em 2026-09-24 (revisão da interface): a tela principal é o chat; quem esconde o painel do
// bot espera achá-lo escondido na próxima conversa e no próximo carregamento.
const CHAVE_PAINEL_OCULTO = "nod.painelOculto";
// A busca da sidebar fica fechada até ser pedida (ícone ou ⌘K); aberta, fecha no Esc ou ao perder o foco vazia.
let buscaAberta = false;
const termoBusca = (): string => (document.getElementById("busca-bots") as HTMLInputElement | null)?.value ?? "";
function abrirBusca(): void {
  buscaAberta = true;
  render();
  document.getElementById("busca-bots")?.focus();
}
function fecharBusca(): void {
  const campo = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (campo) campo.value = "";
  buscaAberta = false;
  render();
}
const LUPA = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
const LOJA = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 4.5 3h11L17 7.5"/><path d="M3 7.5a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0"/><path d="M4.2 10v7h11.6v-7"/><path d="M8 17v-4h4v4"/></svg>';

function painelOculto(): boolean {
  try { return localStorage.getItem(CHAVE_PAINEL_OCULTO) === "1"; } catch { return false; }
}

/**
 * Avisos (definido em 2026-09-24, "aviso no Mac"): depois de cada leitura de "Sua vez" o avisador decide
 * se chama a pessoa (web/lib/avisador.ts) e o canal mostra — notificação do macOS e Dock no app,
 * Notification API e título da aba no navegador (web/lib/canal-avisos.ts).
 */
const canalAvisos = criarCanalAvisos((alvo) => abrirAlvoDoAviso(alvo), () => { if (estado.sessao) render(); });
const avisador = criarAvisador({
  relogio: { agora: () => Date.now(), esperar: (ms, fn) => { const t = window.setTimeout(fn, ms); return () => window.clearTimeout(t); } },
  temFoco: () => document.hasFocus(),
  ligado: () => canalAvisos.ligado(),
  pessoaId: () => estado.sessao?.pessoaId ?? null,
  mostrar: (aviso) => canalAvisos.mostrar(aviso),
});
/** A última leitura de "Sua vez" foi com a janela atrás (`?ver=0`): ao voltar, relê para carimbar vista_em. */
let suaVezSemVer = false;
/** A decisora designada que não é dona não recebe frames (ADR-016): a cada 4 ticks (60 s) "Sua vez" é relida. */
const TICKS_POR_RELEITURA = 4;

/** A janela está na frente da pessoa: visível E com foco. */
function naFrente(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function dispatch(acao: Acao): void {
  estado = reduzir(estado, acao);
  render();
  void reidratar();
}

function erroDe(e: unknown): { codigo: string; mensagem: string; correlationId?: string | null } {
  // O correlation_id atravessa para o relato poder citá-lo (ADR-041): é o que liga o que a pessoa
  // viu na tela à linha de log do servidor. Continua fora do que se RENDERIZA (ADR-002).
  if (e instanceof ErroApi) return { codigo: e.codigo, mensagem: e.message, correlationId: e.correlationId };
  return { codigo: "falha_interna", mensagem: "falha ao falar com o servidor" };
}

/** Roda uma mutação: marca ocupado, traduz o erro em código fechado (nunca err.message cru). */
async function agir(fn: () => Promise<void>): Promise<void> {
  // O que nasce do próprio clique ela já sabe: nenhum aviso nos próximos 5 s (web/lib/avisador.ts).
  avisador.acaoPropria();
  dispatch({ tipo: "erro", erro: null });
  dispatch({ tipo: "ocupado", valor: true });
  try {
    await fn();
  } catch (e) {
    dispatch({ tipo: "erro", erro: erroDe(e) });
  } finally {
    // definido em 2026-09-21: 'ocupado' saía do catch ligado e travava os botões da tela até a próxima
    // ação bem-sucedida (visto no 409 do card de acesso: "Permitir acesso" ficava inerte depois do erro).
    dispatch({ tipo: "ocupado", valor: false });
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
  if (q === "sua-vez") {
    // definido em 2026-09-24 ("aviso no Mac"): atrás, a leitura serve ao Dock e ao aviso, e não conta como vista.
    const ver = naFrente();
    const suaVez = await api.suaVez(ver);
    suaVezSemVer = !ver;
    return { tipo: "hidratar-sua-vez", suaVez };
  }
  if (q === "rotinas") return { tipo: "hidratar-rotinas", rotinas: (await api.rotinas()).rotinas };
  if (q === "conectores") return { tipo: "hidratar-conectores", ...(await api.conectores()) };
  if (q === "salas") return { tipo: "hidratar-salas", salas: (await api.salas()).salas };
  if (q === "chaves") return { tipo: "hidratar-chaves", chaves: (await api.chaves()).chaves };
  if (q === "relatos") return { tipo: "hidratar-relatos", relatos: (await api.relatos()).relatos };
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
        if (acao?.tipo === "hidratar-sua-vez") canalAvisos.contador(avisador.atualizar(acao.suaVez));
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
  if (q === "chaves") return t.tipo === "chaves" || t.tipo === "espaco";
  if (q === "relatos") return t.tipo === "relatos";
  if (q.startsWith("conversa:")) return (t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === q.slice(9);
  if (q.startsWith("memoria:")) return t.tipo === "memoria" && t.agenteId === q.slice(8);
  if (q.startsWith("concessoes:")) return (t.tipo === "perfil" || t.tipo === "conversa") && t.agenteId === q.slice(11) ? true : t.tipo === "conectores";
  // 2026-09-21: o painel de detalhes (tela conversa) também mostra o histórico — é onde a pessoa
  // confere que uma rotina silenciosa (desfecho sem_novidade, que não escreve no chat) rodou.
  if (q.startsWith("execucoes:")) return t.tipo === "rotinas" || t.tipo === "conversa";
  return true;
}

// ---------------------------------------------------------------------------------------------
// Render por regiões: sidebar | cabeçalho | timeline/tela | composer | rodapé.
//
// O rail (coluna de ícones Frota/Sua vez/Rotinas/Marketplace/Chaves) foi removido em 2026-09-18: era
// uma SEGUNDA navegação sobre a sidebar, contra o modelo de contatos do ADR-032. Nenhuma das cinco
// entradas era um lugar — Frota duplicava a sidebar, Sua vez já decide dentro da conversa, Rotinas e
// Marketplace são do bot (painel Detalhes) e Chaves é da conta ("Seu espaço"). As telas continuam
// existindo e roteáveis; o que saiu foi a entrada fixa.

function renderSidebar(): string {
  const agentes = estado.frota?.agentes ?? [];
  const abertas = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const paradas = rotinasParadasPorAgente(estado);
  const t = estado.tela;
  const atual = (conversaId: string) => ((t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId ? ' aria-current="true"' : "");
  const linha = (a: (typeof agentes)[number]) => {
    // definido em 2026-09-24 (revisão da interface): a linha só tem UM sinal, o ponto do próprio mascote.
    // A cor diz o tipo — âmbar decisão, azul pergunta, cinza mensagem não lida —; o mascote animado já
    // diz quando o bot trabalha. Selos ⚑, estrela de fixado e pontos soltos saíram.
    const perguntando = perguntas.get(a.id) ?? 0;
    // definido em 2026-09-24 (emenda da ADR-044): "rotina parada" (âmbar) quando uma rotina dele espera acesso.
    const aviso = (abertas.get(a.id) ?? 0) > 0 ? "decisao" : perguntando ? "pergunta" : a.naoLido ? "nao-lido" : "";
    const rotuloAviso = aviso === "decisao" ? " (esperando sua decisão)" : aviso === "pergunta" ? " (esperando sua resposta)" : aviso === "nao-lido" ? " (mensagem nova)" : "";
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    const estadoVisual = aviso && mascote === "disponivel" ? "aguardando" : mascote;
    // definido em 2026-09-24 (sidebar no estilo do Grok): o título vira um chip ao lado do nome e a linha de
    // baixo é a última mensagem; os estados que pedem ação (fora do ar, pergunta, rotina parada) ganham dela.
    const subtitulo = a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId ? '<span class="sub-fora-do-ar">computador fora do ar</span>' : perguntando ? SUBTITULO_ESPERANDO : paradas.has(a.id) ? SUBTITULO_ROTINA_PARADA : `<span>${esc(a.ultimaMensagem?.previa || a.descricaoEstado || "acabamos de nos conhecer")}</span>`;
    const chip = a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : "";
    return `<div class="bot-row" data-bot-contexto="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="row"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}" aria-label="Abrir conversa com ${esc(a.nome)}${rotuloAviso}">${iconeAgente(a, "", estadoVisual, aviso ? `data-aviso="${aviso}"` : "")}<span class="txt"><span class="nome-linha"><b>${esc(a.nome)}</b>${chip}</span>${subtitulo}</span></button><button class="bot-overflow" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}">•••</button></div>`;
  };
  const meus = agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId);
  const grupo = (nome: string, lista: typeof agentes) => lista.length ? `<section class="section"><h3>${esc(nome)}</h3>${lista.map(linha).join("")}</section>` : "";
  // definido em 2026-09-24 (sidebar no estilo do Grok): fixados em grade de 4 — avatar grande, nome e o
  // título num chip. Mesmo aviso no mascote e o mesmo menu (clique direito / •••) da linha.
  const bloco = (a: (typeof agentes)[number]) => {
    const perguntando = perguntas.get(a.id) ?? 0;
    const aviso = (abertas.get(a.id) ?? 0) > 0 ? "decisao" : perguntando ? "pergunta" : a.naoLido ? "nao-lido" : "";
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    const rotulo = aviso === "decisao" ? " (esperando sua decisão)" : aviso === "pergunta" ? " (esperando sua resposta)" : aviso === "nao-lido" ? " (mensagem nova)" : "";
    return `<div class="fixado" data-bot-contexto="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="fixado-bt"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" aria-label="Abrir conversa com ${esc(a.nome)}${rotulo}">${iconeAgente(a, "lg", aviso && mascote === "disponivel" ? "aguardando" : mascote, aviso ? `data-aviso="${aviso}"` : "")}<b>${esc(a.nome)}</b>${a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : ""}</button><button class="bot-overflow" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}">•••</button></div>`;
  };
  const secoes = [...new Set(meus.filter((a) => !a.fixado && a.secao).map((a) => a.secao!))].sort((a, b) => a.localeCompare(b));
  const fixados = meus.filter((a) => a.fixado);
  const grade = fixados.length ? `<section class="fixados" aria-label="Fixados">${fixados.map(bloco).join("")}</section>` : "";
  const bots = grupo("Meus agentes", meus.filter((a) => !a.fixado && !a.secao)) + secoes.map((s) => grupo(s, meus.filter((a) => !a.fixado && a.secao === s))).join("");
  const equipe = agentes.filter((a) => a.ownerId !== estado.sessao?.pessoaId).map(linha).join("");
  const salas = estado.salas
    .map(
      (s) =>
        `<button class="row"${atual(s.sala.conversaId)} data-act="abrir-sala" data-sala="${esc(s.sala.id)}" data-conversa="${esc(s.sala.conversaId)}"><span class="g">#</span><span class="txt"><b>${esc(s.sala.nome)}</b></span><span class="meta"></span></button>`,
    )
    .join("");

  const ambiente = ambienteBanco
    ? `<div class="ambiente-banco ambiente-${esc(ambienteBanco.regime)}" role="status" title="Banco usado por esta instância do Nod"><span></span>${ambienteBanco.regime === "persistente" ? "Persistente" : ambienteBanco.regime === "efemero" ? "Efêmero" : "Banco não identificado"}${ambienteBanco.porta ? ` · DB ${ambienteBanco.porta}` : ""}</div>`
    : "";
  // Sem o rail e sem o inventário na tela inicial, o rodapé é o ÚNICO lugar sempre visível que pode
  // avisar que o motor não está pronto (ADR-029: falha vira estado escrito, nunca só um ícone).
  const inv = inventarioEmUso(estado);
  const falhaMotor = !!inv && inv.estado !== "pronto";
  const situacaoMotor = !estado.executor
    ? "Verificando conexão…"
    : falhaMotor
      ? inv.estado === "nao_autenticado"
        ? "Sua IA não está conectada"
        : "Sua IA não foi encontrada"
      : estado.executor.atual === "catcher"
        ? "Modo de simulação"
        : "Sua IA conectada";
  // definido em 2026-09-24 (sidebar no estilo do Grok): sem marca e sem título — o topo tem só busca,
  // sino e +. A busca é um ícone; o campo aparece ao clicar, com ⌘K, ou enquanto tem texto.
  const buscando = buscaAberta || termoBusca() !== "";
  return `<div class="search-wrap">
      <div class="sh"><button class="icone-topo" data-act="abrir-busca" aria-label="Buscar agentes" aria-keyshortcuts="Meta+K Control+K" title="Buscar (⌘K)">${LUPA}</button>${renderChamada(estado)}<span class="create-actions"><button class="create-trigger" data-act="navegar" data-tela="novo-bot" data-segurar="criar-rapido" aria-label="Nova conversa (segure para criar um bot direto)" aria-keyshortcuts="Shift+Enter Shift+Space"><span class="segurar-anel" aria-hidden="true"></span>+</button></span></div>
      <label class="search"${buscando ? "" : " hidden"}><span>⌕</span><input id="busca-bots" placeholder="Buscar agentes…" aria-label="Buscar agentes" autocomplete="off" /><kbd>esc</kbd></label>
    </div>
    ${renderIncidentes(estado)}
    <div class="list">
      ${grade}
      ${bots || (grade ? "" : '<p class="mudo">Nenhum agente visível.</p>')}
      ${equipe ? `<section class="section"><h3>Agentes da equipe</h3>${equipe}</section>` : ""}
      <section class="section"><h3>Salas <button class="create-trigger" data-act="navegar" data-tela="nova-sala" aria-label="Nova sala">+</button></h3>${salas || '<p class="mudo">Reúna bots para trabalhar juntos.</p>'}</section>
    </div>
    ${ambiente}
    ${falhaMotor ? `<p class="me-aviso" role="status">${esc(situacaoMotor)}</p>` : ""}
    <div class="rodape">
      <button class="me${falhaMotor ? " me-falha" : ""}" data-act="navegar" data-tela="espaco" aria-current="${t.tipo === "espaco" ? "true" : "false"}" aria-label="Seu espaço: ${esc(situacaoMotor)}" title="Seu espaço · ${esc(situacaoMotor)}"><span class="av-me">eu</span><span class="me-conexao conexao-${esc(estado.conexao.estado)}" title="eventos ao vivo: ${esc(estado.conexao.estado)}"></span></button>
      <button class="marketplace-bt" data-act="navegar" data-tela="conectores" aria-current="${t.tipo === "conectores" ? "true" : "false"}">${LOJA}Marketplace</button>
    </div>`;
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
    case "inicio":
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
    case "relatos":
      corpo = renderRelatos(estado);
      break;
    case "espaco":
      corpo = renderEspaco(estado, ambienteBanco, canalAvisos.estado());
      break;
    case "conversa":
      cabecalho = renderCabecalhoConversa(estado, t.agenteId);
      corpo = renderTimeline(conversaDaTela(estado), estado);
      composer = { chave: `conversa:${t.conversaId}`, html: htmlComposer(placeholderPadrao(), (estado.frota?.agentes ?? []).filter((a) => a.id !== t.agenteId && a.ownerId === estado.sessao?.pessoaId && a.confirmado).map((a) => a.nome), { anexos: aceitaDo(botGerido(t.agenteId)?.harness) }) };
      break;
    case "sala":
      cabecalho = renderCabecalhoSala(estado, t.salaId);
      corpo = renderTimeline(conversaDaTela(estado), estado);
      composer = { chave: `sala:${t.salaId}`, html: htmlComposer(PLACEHOLDER_SALA, nomesDosMembros(estado, t.salaId)) };
      break;
  }
  regiao("detalhes", renderDetalhes(estado));
  document.querySelector(".app")?.classList.toggle("com-detalhes", t.tipo === "conversa");
  document.querySelector(".app")?.classList.toggle("detalhes-ocultos", painelOculto());
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
    esquecerRegiao("composer-pergunta");
    regiao("composer", composer?.html ?? "");
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    ta?.focus();
    redesenharAnexos();
  }
  atualizarComposer();
  document.body.classList.toggle("ocupado", estado.ocupado);
}

const PLACEHOLDER_SALA = "Mensagem para a sala — @Nome dirige a pergunta";

function placeholderPadrao(): string {
  const t = estado.tela;
  return t.tipo === "conversa" ? `Escreva uma mensagem para ${botGerido(t.agenteId)?.nome ?? "o bot"}…` : PLACEHOLDER_SALA;
}

/**
 * O campo reflete o modo sem ser regravado (web/lib/regioes.ts): a faixa, os modos e a citação entram
 * na região `composer-pergunta`; placeholder, dica, borda e clipe mudam no próprio nó. definido em
 * 2026-09-17: hidratação do nome atualiza só o placeholder; nunca recria o textarea nem perde rascunho.
 * definido em 2026-09-24 (emenda da ADR-045): com pergunta aberta, a próxima mensagem responde.
 */
function atualizarComposer(): void {
  const alvo = conversaAtual();
  const caixa = document.querySelector<HTMLElement>("#composer .composer");
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!alvo || !caixa || !ta) return;
  const nota = document.getElementById("composer-nota");
  const a = aparenciaDoComposer(modoDoComposer(estado, alvo.conversaId), estado, { placeholder: placeholderPadrao(), nota: nota?.dataset.padrao ?? "" }, alvo.conversaId);
  regiao("composer-pergunta", a.topo);
  caixa.classList.toggle("modo-resposta", a.resposta);
  if (ta.placeholder !== a.placeholder) ta.placeholder = a.placeholder;
  if (nota && nota.textContent !== a.nota) nota.textContent = a.nota;
  const clipe = caixa.querySelector<HTMLButtonElement>('[data-act="anexar"]');
  if (clipe) {
    clipe.disabled = a.anexoBloqueado !== null;
    const titulo = a.anexoBloqueado ?? clipe.dataset.titulo ?? "";
    if (titulo) clipe.title = titulo;
    else clipe.removeAttribute("title");
  }
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
    regiao("sidebar", "");
    regiao("cabecalho", "");
    regiao("timeline", renderEntrada());
    regiao("composer", "");
    return;
  }
  document.querySelector(".app")?.classList.remove("sem-sessao");
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
  conexoes.cancelarTodas();
  api = criarApi(escopo);
  // Outra sessão, outra fila: a primeira leitura volta a ser só a linha de base.
  avisador.reiniciar();
  canalAvisos.contador(0);
  ambienteBanco = await api.ambiente();
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
  let ticks = 0;
  window.setInterval(() => {
    ticks += 1;
    // definido em 2026-09-24 ("aviso no Mac"): a decisora designada que não é dona não recebe frame
    // decisao.* (o outbox manda à dona); sem isto o pedido dela só aparecia — e só avisava — quando
    // outra coisa relesse "Sua vez".
    if (ticks % TICKS_POR_RELEITURA === 0 && estado.sessao) estado = reduzir(estado, { tipo: "invalidar", quais: ["sua-vez"] });
    dispatch({ tipo: "tick", agora: Date.now() });
  }, 15_000);
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
// Conexão de apps (definido em 2026-09-25, jornadas de conexão): uma espera por app, e o que fazer quando
// o login termina. Sem um `depois` da própria tentativa, o padrão: no marketplace a gaveta abre em
// "Quem pode usar"; no chat, o card já virou o de permitir no servidor e a conversa só relê.

const conexoes = criarConexoes({
  conectar: (slug) => api!.conectarApp(slug),
  verificar: (slug) => api!.verificarApp(slug),
  mudou: (slug, valor) => dispatch({ tipo: "conexao-app", slug, valor }),
  conectado: (slug) => {
    const conversa = conversaAtual();
    dispatch({ tipo: "invalidar", quais: ["conectores", "sua-vez", "frota", ...(conversa ? [`conversa:${conversa.conversaId}` as Invalidacao] : [])] });
    const t = estado.tela;
    if (t.tipo === "conectores" && !t.avancado) navegar({ ...t, gaveta: { slug, passo: "quem-usa" } });
  },
  abrirJanela: (nome) => {
    try {
      const janela = window.open("", nome, "popup,width=560,height=720");
      // Ainda about:blank, da nossa origem: cortar o opener impede a página do provedor de navegar o Nod.
      if (janela) janela.opener = null;
      return janela;
    } catch { return null; }
  },
  esperar: (ms) => new Promise((r) => window.setTimeout(r, ms)),
  agora: () => Date.now(),
});

/** Chamado DENTRO do clique (a janela de login só abre sem bloqueio no gesto da pessoa). `depois` morre com a tentativa. */
function iniciarConexao(slug: string, depois: (() => Promise<void>) | null = null): void {
  if (!slug) return;
  // O GitHub não depende do Composio (ADR-048): o servidor tenta o gh desta máquina e o token antes.
  if (!estado.composioConfigurado && slug !== "github") {
    navegar({ tipo: "conectores", avancado: true });
    dispatch({ tipo: "aviso-conexao", texto: "Para conectar apps, adicione a chave do Composio do time abaixo." });
    return;
  }
  dispatch({ tipo: "erro", erro: null });
  void conexoes.iniciar(slug, depois).catch((e: unknown) => dispatch({ tipo: "erro", erro: erroDe(e) }));
}

function propostaDoEstado(id: string): Proposta | null {
  for (const c of Object.values(estado.conversas)) {
    const p = c.propostas.find((x) => x.id === id);
    if (p) return p;
  }
  return estado.suaVez?.itens.find((i) => i.proposta?.id === id)?.proposta ?? null;
}

// ---------------------------------------------------------------------------------------------
// Ações (delegação por data-act e data-form). A web só pede; o servidor decide.

function navegar(tela: Tela): void {
  // O menu "Avisos no Mac" muda a preferência sem passar pela página: "Seu espaço" relê ao abrir.
  if (tela.tipo === "espaco") void canalAvisos.reler();
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

/**
 * Clique no aviso: um pedido abre a conversa dele (ou a sala); vários, ou a conversa de outra pessoa
 * (a decisora designada não a lê), abrem "Sua vez".
 */
function abrirAlvoDoAviso(alvo: AlvoAviso): void {
  if (!estado.sessao) return;
  const conversaId = alvo.tipo === "conversa" ? alvo.conversaId : null;
  const agente = estado.frota?.agentes.find((a) => a.conversaId === conversaId && a.ownerId === estado.sessao?.pessoaId);
  const sala = estado.salas.find((s) => s.sala.conversaId === conversaId);
  if (agente) navegar({ tipo: "conversa", conversaId: agente.conversaId, agenteId: agente.id });
  else if (sala) navegar({ tipo: "sala", salaId: sala.sala.id, conversaId: sala.sala.conversaId });
  else navegar({ tipo: "sua-vez" });
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

/** Anexo não vai na resposta à pergunta (a rota só leva texto): o motivo aparece escrito, nada some. */
function recusarAnexoNaResposta(): void {
  dispatch({ tipo: "erro", erro: { codigo: "anexo_na_resposta", mensagem: MOTIVO_SEM_ANEXO } });
}

/** O campo está respondendo a uma pergunta desta conversa (emenda da ADR-045)? */
function emModoResposta(conversaId: string): boolean {
  return modoDoComposer(estado, conversaId).tipo === "resposta";
}

async function enviarComposer(): Promise<void> {
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const alvo = conversaAtual();
  if (!ta || !alvo || !api) return;
  const texto = ta.value.trim();
  const fila = alvo.salaId ? [] : anexosPendentes.get(alvo.conversaId) ?? [];
  // Não sai com arquivo pela metade: o clique espera o upload terminar (o chip mostra a barra).
  if (fila.some((i) => i.estado === "enviando")) return;
  const ids = fila.flatMap((i) => (i.estado === "pronto" && i.meta ? [i.meta.id] : []));
  if (!texto && ids.length === 0) return;
  // definido em 2026-09-24 (emenda da ADR-045): com pergunta aberta, a mensagem RESPONDE por
  // POST decisoes/:id/responder (a retomada nasce lá), salvo "Outro assunto".
  const destino = destinoDoEnvio(modoDoComposer(estado, alvo.conversaId));
  const a = api;
  await agir(async () => {
    const r = await enviarPeloComposer(a, alvo, destino, texto, ids);
    if ("recusado" in r) {
      recusarAnexoNaResposta();
      return;
    }
    ta.value = "";
    ta.style.height = "auto";
    if (r.enviado === "mensagem") limparAnexos(alvo.conversaId);
    // A escolha do campo vale até este envio: a próxima mensagem volta ao padrão.
    dispatch({ tipo: "composer", conversaId: alvo.conversaId, escolha: null });
    dispatch({ tipo: "invalidar", quais: r.enviado === "resposta" ? [`conversa:${alvo.conversaId}`, "sua-vez", "frota"] : [`conversa:${alvo.conversaId}`] });
  });
}

// ---- anexos (ADR-046) ----------------------------------------------------------------------------
// A fila vive fora do reducer: são File e objectURL do navegador, não estado da API. Por conversa,
// para o rascunho de anexos sobreviver a ir e voltar entre conversas como o texto sobrevive.
const anexosPendentes = new Map<string, ItemAnexo[]>();

function aceitaDo(harness: string | undefined): Aceita | undefined {
  if (harness === "codex-cli") return "sem_pdf";
  if (harness === undefined || harness === "auto" || harness === "claude-cli") return "tudo";
  return undefined;
}

function redesenharAnexos(): void {
  const alvo = conversaAtual();
  const fila = document.getElementById("composer-anexos");
  if (!fila || !alvo || alvo.salaId) return;
  const itens = anexosPendentes.get(alvo.conversaId) ?? [];
  fila.innerHTML = renderItensAnexo(itens);
  fila.hidden = itens.length === 0;
  const r = document.getElementById("composer-resumo");
  if (r) r.textContent = resumoAnexos(itens);
}

function limparAnexos(conversaId: string): void {
  for (const i of anexosPendentes.get(conversaId) ?? []) if (i.previa) URL.revokeObjectURL(i.previa);
  anexosPendentes.delete(conversaId);
  redesenharAnexos();
}

function adicionarArquivos(arquivos: readonly File[]): void {
  const alvo = conversaAtual();
  const input = document.getElementById("composer-arquivos") as HTMLInputElement | null;
  if (!alvo || alvo.salaId || !api || !input || arquivos.length === 0) return;
  // Colar ou arrastar com o campo respondendo: o clipe está desligado pelo mesmo motivo.
  if (emModoResposta(alvo.conversaId)) {
    recusarAnexoNaResposta();
    return;
  }
  const aceita = (input.dataset.aceita as Aceita | undefined) ?? "tudo";
  const conversaId = alvo.conversaId;
  const fila = anexosPendentes.get(conversaId) ?? [];
  anexosPendentes.set(conversaId, fila);
  const a = api;
  for (const arquivo of arquivos) {
    const validos = fila.filter((i) => i.estado !== "erro").length;
    const mime = mimeDe(arquivo);
    const recusa = validos >= POR_MENSAGEM ? `Até ${POR_MENSAGEM} arquivos por mensagem.` : motivoRecusa(arquivo, aceita);
    const item: ItemAnexo = { chave: crypto.randomUUID(), nome: arquivo.name, mime, tamanho: arquivo.size, estado: recusa ? "erro" : "enviando", progresso: 0,
      ...(recusa ? { erro: recusa } : {}), ...(!recusa && mime.startsWith("image/") ? { previa: URL.createObjectURL(arquivo) } : {}) };
    fila.push(item);
    if (recusa) continue;
    void a.subirAnexo(conversaId, arquivo, mime, (f) => { item.progresso = f; redesenharAnexos(); })
      .then((meta) => { item.estado = "pronto"; item.meta = meta; })
      .catch(() => { item.estado = "erro"; item.erro = "Não foi possível enviar. Tente de novo."; })
      .finally(redesenharAnexos);
  }
  redesenharAnexos();
}

function removerAnexo(chave: string): void {
  const alvo = conversaAtual();
  if (!alvo) return;
  const fila = anexosPendentes.get(alvo.conversaId) ?? [];
  const item = fila.find((i) => i.chave === chave);
  if (item?.previa) URL.revokeObjectURL(item.previa);
  anexosPendentes.set(alvo.conversaId, fila.filter((i) => i.chave !== chave));
  redesenharAnexos();
}

/** "Responder à pergunta" / "Outro assunto" / "Responder a esta": muda o que a próxima mensagem faz e volta ao campo. */
function escolherNoComposer(outroAssunto: boolean, alvoId?: string): void {
  const alvo = conversaAtual();
  if (!alvo) return;
  dispatch({ tipo: "composer", conversaId: alvo.conversaId, escolha: { outroAssunto, alvoId: alvoId ?? estado.composer[alvo.conversaId]?.alvoId ?? null } });
  document.getElementById("composer-texto")?.focus();
}

/** "Ver pergunta": leva ao balão e o realça um instante (sem animação para quem pediu menos movimento). */
function verPergunta(decisaoId: string): void {
  const balao = document.querySelector<HTMLElement>(`[data-pergunta="${CSS.escape(decisaoId)}"]`);
  if (!balao) return;
  balao.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  balao.classList.add("realce");
  window.setTimeout(() => balao.classList.remove("realce"), 1600);
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
  "relatar-mensagem": (el) => {
    const id = el.dataset.id;
    // definido em 2026-09-21: o correlation_id NÃO vai junto. `estado.erro` é o slot do último erro
    // do app inteiro — pode ser de outra chamada, de vinte minutos atrás, e some quando qualquer
    // agir() dá certo. Carimbar isso no relato mandaria quem investiga para a linha de log errada;
    // o turno e a mensagem já ligam o relato ao que aconteceu.
    if (id && api) abrirReportarBug(api, id, __NOD_VERSAO__, null);
  },
  entrar: (el) => agir(async () => iniciarSessao(await sessaoApi.entrar(el.dataset.pessoa ?? ""))),
  navegar: (el) => {
    const tela = el.dataset.tela as Tela["tipo"] | undefined;
    if (tela === "sua-vez" || tela === "rotinas" || tela === "conectores" || tela === "nova-sala" || tela === "chaves" || tela === "relatos" || tela === "novo-bot" || tela === "nova-rotina" || tela === "espaco" || tela === "gestao") navegar({ tipo: tela });
  },
  // definido em 2026-09-25 (jornadas de conexão): "Conectar" abre o login NA HORA — no card do chat, no
  // cartão do marketplace, na gaveta, no painel do bot e no card da rotina — e a web espera sozinha
  // (web/lib/conexao.ts). Sem "Verificar conexão" e sem ir ao marketplace no meio de uma conversa.
  "conectar-app": (el) => iniciarConexao(el.dataset.id ?? ""),
  "abrir-conexao": (el) => iniciarConexao(el.dataset.id ?? ""),
  "cancelar-conexao": (el) => conexoes.cancelar(el.dataset.id ?? ""),
  "abrir-app": (el) => {
    const t = estado.tela;
    if (t.tipo === "conectores") navegar({ ...t, gaveta: { slug: el.dataset.id ?? "", passo: "detalhes" } });
  },
  "fechar-gaveta": () => {
    const t = estado.tela;
    if (t.tipo === "conectores") { const { gaveta: _g, ...resto } = t; navegar(resto); }
  },
  "filtro-marketplace": (el) => {
    const t = estado.tela;
    const f = el.dataset.id;
    if (t.tipo === "conectores" && (f === "todos" || f === "conectados" || f === "atencao")) navegar({ ...t, filtro: f });
  },
  "abrir-avancado": () => navegar({ tipo: "conectores", avancado: true }),
  "navegar-marketplace": () => navegar({ tipo: "conectores" }),
  "nivel-bot": (el) => agir(async () => {
    const agenteId = el.dataset.id ?? "";
    const nivel = el.dataset.nivel;
    if (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita") return;
    await api!.definirNivel(agenteId, el.dataset.conector ?? "", nivel);
    dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`, "frota"] });
  }),
  "desconectar-app": (el) => agir(async () => {
    await api!.habilitarConector(el.dataset.id ?? "", false);
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  // definido em 2026-09-25: Permitir leva só os grupos marcados no card (card-acesso.ts); sem grupos, tudo o que foi pedido.
  "permitir-acesso": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    const card = el.closest<HTMLElement>("[data-decisao]");
    const grupos = [...(card?.querySelectorAll<HTMLInputElement>("input[data-caps]") ?? [])];
    const capacidades = grupos.filter((g) => g.checked).flatMap((g) => (g.dataset.caps ?? "").split(",").filter(Boolean));
    if (grupos.length > 0 && capacidades.length === 0) { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Marque pelo menos um grupo para permitir." } }); return; }
    await api!.decidir(id, grupos.length > 0 ? { capacidades } : {});
    dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", "conectores", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "dar-acesso": (el) => dispatch({ tipo: "dar-acesso", agenteId: estado.dandoAcesso === el.dataset.id ? null : el.dataset.id ?? null }),
  // definido em 2026-09-25: a rotina que lê um app ainda desconectado — um botão conecta e, quando o login
  // termina, cria a rotina (o confirmar concede o que ela declarou, conceder-acessos-da-rotina.ts).
  "conectar-e-confirmar": (el) => {
    const slug = el.dataset.id ?? "";
    const propostaId = el.dataset.proposta ?? "";
    const ato = el.dataset.ato;
    iniciarConexao(slug, async () => {
      const r = await api!.conectores();
      dispatch({ tipo: "hidratar-conectores", conectores: r.conectores, marketplace: r.marketplace, composioConfigurado: r.composioConfigurado });
      // A proposta ainda tem de estar à vista e pendente: sumiu (decidida, recusada, de outra sessão), nada é confirmado.
      const proposta = propostaDoEstado(propostaId);
      if (!proposta || proposta.estado !== "pendente" || appsQueFaltam(proposta, estado).length > 0) return;
      await agir(async () => {
        if (ato === "decidir-proposta") await api!.decidir(propostaId, {});
        else await api!.confirmarProposta(propostaId);
        dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
      });
    });
  },
  "voltar-conexao": () => {
    const t = estado.tela;
    if (t.tipo === "conectores" && t.voltar) navegar(t.voltar);
    else navegar({ tipo: "inicio" });
  },
  "criar-rapido": () => agir(async () => {
    const r = await api!.criarAgente(undefined, { interativo: true });
    dispatch({ tipo: "invalidar", quais: ["frota"] });
    navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
  }),
  "escolher-missao": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { ta.value = el.dataset.texto ?? ""; return enviarComposer(); }
  },
  "abrir-computador": (el) => { const a = botGerido(el.dataset.id); if (a && api && a.ownerId === estado.sessao?.pessoaId) abrirComputador(api, a); },
  // definido em 2026-09-24 (emenda da ADR-037): "Tentar de novo" é o mesmo ligar do computador; falhou, a
  // frota relê e o cartão continua dizendo o motivo.
  "religar-computador": (el) => agir(async () => {
    try {
      await api!.configurarComputador(el.dataset.id ?? "", "iniciar");
    } finally {
      dispatch({ tipo: "invalidar", quais: ["frota"] });
    }
  }),
  "abrir-workspace": (el) => { const a = botGerido(el.dataset.id); const c = conversaAtual(); if (a && api && a.ownerId === estado.sessao?.pessoaId && c && !c.salaId) abrirWorkspace(api, c.conversaId); },
  // Um clique: autoriza a pasta proposta e a tarefa retoma sozinha, sem a pessoa remandar a mensagem.
  "permitir-pasta": (el) => agir(async () => {
    const alvo = conversaAtual();
    if (!alvo || alvo.salaId || !el.dataset.pasta) return;
    await api!.permitirPasta(el.dataset.id ?? "", el.dataset.pasta);
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
  }),
  anexar: () => document.getElementById("composer-arquivos")?.click(),
  "remover-anexo": (el) => removerAnexo(el.dataset.id ?? ""),
  "abrir-busca": () => abrirBusca(),
  "alternar-detalhes": () => {
    const app = document.querySelector(".app");
    if (!app) return;
    // Estreita, o painel é sobreposto e abre/fecha a cada vez; larga, esconder é preferência que fica.
    if (window.matchMedia("(max-width: 1250px)").matches) { app.classList.toggle("detalhes-abertos"); return; }
    const oculto = !app.classList.contains("detalhes-ocultos");
    app.classList.toggle("detalhes-ocultos", oculto);
    try { localStorage.setItem(CHAVE_PAINEL_OCULTO, oculto ? "1" : "0"); } catch { /* sem storage, vale só nesta aba */ }
  },
  "preencher-prompt": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { ta.value = el.dataset.texto ?? ""; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  },
  "nova-rotina": (el) => navegar({ tipo: "nova-rotina", agenteId: el.dataset.id }),
  // definido em 2026-09-24 (emenda da ADR-044): parada pelo pré-voo (`ids.bloqueada`), o teste não roda —
  // a conversa abre com o card de acesso "rotina parada" e o botão que a destrava; "Sua vez" relê.
  "executar-rotina": (el) => agir(async () => {
    const r = await api!.executarRotina(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["rotinas", `execucoes:${el.dataset.id ?? ""}`, ...(r.ids.bloqueada ? (["sua-vez", `conversa:${r.ids.conversaId ?? ""}`] as const) : [])] });
    navegar({ tipo: "conversa", conversaId: r.ids.conversaId ?? "", agenteId: el.dataset.agente ?? "" });
  }),
  "abrir-conversa": (el) => {
    const a = estado.frota?.agentes.find((a) => a.id === el.dataset.agente);
    if (a?.naoLido && a.ownerId === estado.sessao?.pessoaId) void agir(async () => { await mudarGestao(() => api!.organizarAgente(a.id, { naoLido: false })); });
    navegar({ tipo: "conversa", conversaId: el.dataset.conversa ?? "", agenteId: el.dataset.agente ?? "" });
  },
  "abrir-sala": (el) => navegar({ tipo: "sala", salaId: el.dataset.sala ?? "", conversaId: el.dataset.conversa ?? "" }),
  "menu-agente": (el) => menuDoBot(el),
  "inteligencia": (el) => {
    const a = botGerido(el.dataset.id);
    if (!a || a.ownerId !== estado.sessao?.pessoaId) return;
    pedirGestao(`Inteligência de ${a.nome}`, renderInteligencia(a, estado.executor?.harnesses, true), "Salvar escolha", async (d) => mudarGestao(() => api!.editarPerfil(a.id, escolhaInteligencia(d))));
  },
  "atualizar-gestao": () => dispatch({ tipo: "invalidar", quais: ["gestao"] }),
  "restaurar-agente": (el) => agir(async () => { await mudarGestao(() => api!.restaurarAgente(el.dataset.id ?? "")); }),
  "ir-perfil": (el) => navegar({ tipo: "perfil", agenteId: el.dataset.id ?? "" }),
  "ir-memoria": (el) => navegar({ tipo: "memoria", agenteId: el.dataset.id ?? "" }),
  "fechar-erro": () => dispatch({ tipo: "erro", erro: null }),
  // Sem agir(): no navegador, o pedido de permissão precisa sair direto do clique.
  "alternar-avisos": () => canalAvisos.alternar(),
  "fechar-faixa": () => dispatch({ tipo: "faixa", faixa: null }),
  enviar: () => enviarComposer(),
  "sondar-inventario": () => agir(async () => dispatch({ tipo: "hidratar-inventario", inventario: await api!.inventario(true) })),
  "trocar-executor": (el) =>
    agir(async () => {
      const estadoNovo = await api!.trocarExecutor(el.dataset.id === "codex-cli" ? "codex-cli" : el.dataset.id === "claude-cli" ? "claude-cli" : "catcher");
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
  // definido em 2026-09-24 (ADR-045): "Entendi" no aviso de queda do Mac.
  // definido em 2026-09-24: Cancelar de UMA mensagem da fila. Fica 5 s em "Cancelando… Desfazer" só na
  // web; depois disso vai ao servidor. Desfazer antes do prazo não toca o servidor (nada a reenfileirar).
  "cancelar-turno": (el) => {
    const turnoId = el.dataset.id ?? "";
    if (!turnoId) return;
    dispatch({ tipo: "cancelando-turno", turnoId, agora: Date.now() });
    window.setTimeout(() => {
      if (!(turnoId in estado.cancelando)) return;
      void agir(async () => {
        try {
          await api!.cancelarTurno(turnoId);
        } finally {
          dispatch({ tipo: "desfazer-cancelamento", turnoId });
          const alvo = conversaAtual();
          if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
        }
      });
    }, CANCELAR_DESFAZER_MS);
  },
  "desfazer-cancelamento": (el) => dispatch({ tipo: "desfazer-cancelamento", turnoId: el.dataset.id ?? "" }),
  "dispensar-incidente": (el) => agir(async () => void (await api!.dispensarIncidente(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // definido em 2026-09-24 (ADR-044): o grupo (app · nível) do painel sai inteiro, com um registro só.
  "revogar-acessos": (el) => agir(async () => void (await api!.revogarAcessos(el.dataset.agente ?? "", (el.dataset.ids ?? "").split(",").filter(Boolean)), dispatch({ tipo: "invalidar", quais: [`concessoes:${el.dataset.agente ?? ""}`, "frota"] }))),
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
  "ver-execucoes": (el) => {
    const id = el.dataset.id ?? "";
    const abrindo = !estado.historicoAberto[id];
    dispatch({ tipo: "alternar-historico", rotinaId: id });
    if (abrindo) dispatch({ tipo: "invalidar", quais: [`execucoes:${id}`] });
  },
  "sondar-conector": (el) => agir(async () => void (await api!.sondarConector(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["conectores", "frota"] }))),
  "habilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", true), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "desabilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", false), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "decidir-aprovacao": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "") }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  // ADR-042: aprova AGORA e grava a regra para as próximas vezes, no mesmo clique.
  "decidir-aprovacao-sempre": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? ""), sempre: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  "decidir-aprovacao-nenhum": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "").map((m) => ({ ...m, selecionado: false })) }), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  "decidir-proposta": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", {}), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  "recusar-decisao": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { recusar: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta se responde pelo campo da conversa — sem card
  // nem caixa própria. Estes são os gestos em volta dele: o modo, o balão, o toque e a vinda de "Sua vez".
  "composer-responder": (el) => escolherNoComposer(false, el.dataset.id),
  "composer-outro": () => escolherNoComposer(true),
  "ver-pergunta": (el) => verPergunta(el.dataset.id ?? ""),
  // A resposta pronta é TEXTO da pessoa (EMENDA 16): o toque manda as palavras da opção por `responder`.
  "responder-opcao": (el) =>
    agir(async () => {
      const alvo = conversaAtual();
      await api!.responder(el.dataset.id ?? "", el.dataset.texto ?? "");
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota", ...(alvo ? [`conversa:${alvo.conversaId}` as Invalidacao] : [])] });
    }),
  // A decisora designada que não é dona da conversa responde em "Sua vez" (não lê a conversa de outra pessoa).
  responder: (el) =>
    agir(async () => {
      const texto = document.querySelector<HTMLInputElement>(`input[data-resposta="${CSS.escape(el.dataset.id ?? "")}"]`)?.value.trim() ?? "";
      await api!.responder(el.dataset.id ?? "", texto);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] });
    }),
  // De "Sua vez": abre a conversa com o campo já respondendo a ESTA pergunta (mesmo abrir da barra lateral).
  "responder-na-conversa": (el) => {
    dispatch({ tipo: "composer", conversaId: el.dataset.conversa ?? "", escolha: { outroAssunto: false, alvoId: el.dataset.id ?? null } });
    return ACOES["abrir-conversa"]?.(el);
  },
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
  dispensar: (el) => agir(async () => void (await api!.dispensar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // Em série: são poucas, e uma recusa no meio não deixa metade gravada sem a tela saber.
  "limpar-vencidos": (el) => agir(async () => {
    for (const id of (el.dataset.ids ?? "").split(",").filter(Boolean)) await api!.dispensar(id);
    dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  }),
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
      await api!.editarPerfil(form.dataset.id ?? "", { nome: String(d.get("nome") ?? ""), titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? ""), ...escolhaInteligencia(d), forma: String(d.get("forma")) as FormaAgente, cor: String(d.get("cor")) as CorAgente });
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
  "app-github": (form) => agir(async () => {
    const d = new FormData(form);
    await api!.appGithub({ appId: String(d.get("appId") ?? ""), instalacaoId: String(d.get("instalacaoId") ?? ""), chavePrivada: String(d.get("chavePrivada") ?? "") });
    form.reset();
    dispatch({ tipo: "aviso-conexao", texto: "GitHub App da organização guardado. As rotinas de quem não conectou o próprio GitHub passam a usá-lo." });
  }),
  "token-github": (form) => agir(async () => {
    const d = new FormData(form);
    const r = await api!.tokenGithub(String(d.get("token") ?? ""));
    form.reset();
    dispatch({ tipo: "aviso-conexao", texto: r.conectado ? "Token guardado. O GitHub usa o gh desta máquina quando ele está logado, e o token nos outros casos." : "Token guardado, mas o GitHub não respondeu. Tente Conectar de novo em instantes." });
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
  if (cb.id === "composer-arquivos") {
    adicionarArquivos([...(cb.files ?? [])]);
    cb.value = "";
    return;
  }
  if (cb.matches('select[name="inteligencia"]')) {
    const select = ev.target as HTMLSelectElement;
    const chip = select.closest(".inteligencia-card")?.querySelector(".inteligencia-chip");
    if (chip) chip.textContent = select.selectedOptions[0]?.textContent?.split(" · ")[0] ?? "Automático";
    return;
  }
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

// Colar um print no campo (⌘V) anexa; texto colado segue normal.
document.addEventListener("paste", (ev) => {
  if ((ev.target as HTMLElement).id !== "composer-texto" || !document.getElementById("composer-arquivos")) return;
  const arquivos = [...(ev.clipboardData?.files ?? [])];
  if (arquivos.length === 0) return;
  ev.preventDefault();
  adicionarArquivos(arquivos);
});

// Arrastar sobre a conversa mostra onde soltar; só quando o composer aceita anexo.
let arrastando = 0;
const temArquivos = (ev: DragEvent) => [...(ev.dataTransfer?.types ?? [])].includes("Files");
function areaSoltar(visivel: boolean): void {
  const timeline = document.getElementById("timeline");
  let area = document.getElementById("anexo-soltar");
  if (!visivel) { area?.remove(); return; }
  if (area || !timeline) return;
  const nome = botGerido(estado.tela.tipo === "conversa" ? estado.tela.agenteId : undefined)?.nome ?? "o bot";
  const alvo = conversaAtual();
  area = document.createElement("div");
  area.id = "anexo-soltar";
  area.className = "anexo-soltar";
  // Com o campo respondendo a uma pergunta, soltar não anexa (emenda da ADR-045): a área já diz por quê.
  area.innerHTML = alvo && emModoResposta(alvo.conversaId)
    ? `<div><b>Arquivos não vão na resposta à pergunta</b><span>${esc(MOTIVO_SEM_ANEXO)}</span></div>`
    : `<div><b>Solte para mandar para ${esc(nome)}</b><span>Imagens, PDF e arquivos de texto · até 10 MB cada</span></div>`;
  timeline.parentElement?.appendChild(area);
}
document.addEventListener("dragenter", (ev) => {
  if (!temArquivos(ev) || !document.getElementById("composer-arquivos")) return;
  arrastando += 1;
  areaSoltar(true);
});
document.addEventListener("dragover", (ev) => { if (temArquivos(ev) && document.getElementById("composer-arquivos")) ev.preventDefault(); });
document.addEventListener("dragleave", (ev) => {
  if (!temArquivos(ev)) return;
  arrastando = Math.max(0, arrastando - 1);
  if (arrastando === 0) areaSoltar(false);
});
document.addEventListener("drop", (ev) => {
  if (!temArquivos(ev) || !document.getElementById("composer-arquivos")) return;
  ev.preventDefault();
  arrastando = 0;
  areaSoltar(false);
  adicionarArquivos([...(ev.dataTransfer?.files ?? [])]);
});

// Busca vazia que perde o foco some sem re-render: trocar o DOM entre o mousedown e o click engoliria o
// clique na linha que a pessoa foi abrir.
document.addEventListener("focusout", (ev) => {
  const campo = ev.target as HTMLInputElement;
  if (campo.id !== "busca-bots" || campo.value.trim()) return;
  buscaAberta = false;
  campo.closest("label")?.setAttribute("hidden", "");
});

document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); abrirBusca(); return; }
  if (ev.key === "Escape" && (ev.target as HTMLElement).id === "busca-bots") { fecharBusca(); return; }
  // definido em 2026-09-25 (revisão do PR #68): Esc fecha a gaveta do app e o "+ Dar acesso" do painel.
  if (ev.key === "Escape" && estado.tela.tipo === "conectores" && estado.tela.gaveta) { ev.preventDefault(); void ACOES["fechar-gaveta"]?.(document.body); return; }
  if (ev.key === "Escape" && estado.dandoAcesso) { ev.preventDefault(); dispatch({ tipo: "dar-acesso", agenteId: null }); return; }
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.id !== "composer-texto") return;
  // Esc com o campo respondendo: a próxima mensagem vira mensagem comum (o mesmo "Outro assunto").
  if (ev.key === "Escape") {
    const alvo = conversaAtual();
    if (alvo && emModoResposta(alvo.conversaId)) {
      ev.preventDefault();
      escolherNoComposer(true);
    }
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void enviarComposer();
  }
});

document.addEventListener("input", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.matches("[data-customiza-mascote]")) {
    const form = ta.closest<HTMLFormElement>('form[data-form="editar-perfil"]');
    const preview = form?.querySelector<HTMLElement>("[data-mascote-preview]");
    const forma = form?.querySelector<HTMLInputElement>('input[name="forma"]:checked')?.value as FormaAgente | undefined;
    const cor = form?.querySelector<HTMLInputElement>('input[name="cor"]:checked')?.value;
    if (preview && forma && cor) atualizarMascote(preview, forma, cor);
    if (forma && cor) form?.querySelectorAll<HTMLElement>("[data-gallery]").forEach(el => atualizarMascote(el, forma, cor));
    return;
  }
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

// definido em 2026-09-24 ("aviso no Mac"): a leitura feita com a janela atrás não carimbou vista_em
// (?ver=0); quando a pessoa volta, "Sua vez" é relida já contando como vista. O menu do app também pode
// ter mudado a preferência dos avisos.
function aoVoltarParaFrente(): void {
  if (!naFrente()) return;
  void canalAvisos.reler();
  if (suaVezSemVer && estado.sessao) dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
}
window.addEventListener("focus", aoVoltarParaFrente);
document.addEventListener("visibilitychange", aoVoltarParaFrente);

void boot();

// Exposto para inspeção manual no console (nunca como API): o estado atual e o agente da tela.
declare global {
  interface Window {
    nod?: { estado(): Estado; agente(): string | null };
  }
}
window.nod = { estado: () => estado, agente: () => agenteDaTela(estado) };

// Segurar um gatilho por MS_SEGURAR dispara a ação de data-segurar; o clique curto
// segue para o data-act normal. Mesma ideia do contextmenu abaixo: um gesto alternativo
// sobre um botão que já tem um clique primário.
// Fonte única do tempo do hold: o CSS lê --ms-segurar para a animação do anel,
// senão os dois relógios andam separados e o anel fecha fora de hora.
const MS_SEGURAR = 500;
document.documentElement.style.setProperty("--ms-segurar", `${MS_SEGURAR}ms`);
let segurando: { el: HTMLElement; timer: number; disparou: boolean } | null = null;

function encerrarSegurar(): boolean | undefined {
  if (!segurando) return;
  clearTimeout(segurando.timer);
  segurando.el.classList.remove("segurando");
  const disparou = segurando.disparou;
  segurando = null;
  return disparou;
}

document.addEventListener("pointerdown", (ev) => {
  if ((ev as PointerEvent).button !== 0) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (!el) return;
  encerrarSegurar();
  ultimoHoldDisparou = false;
  const acao = el.dataset.segurar ?? "";
  const alvo = { el, disparou: false } as { el: HTMLElement; timer: number; disparou: boolean };
  alvo.timer = window.setTimeout(() => {
    alvo.disparou = true;
    // O sidebar é regravado por innerHTML a cada frame do SSE: o botão de agora pode não
    // ser mais o nó em que o gesto começou. Tira a classe de quem estiver no DOM.
    for (const n of document.querySelectorAll<HTMLElement>(".segurando")) n.classList.remove("segurando");
    const fn = ACOES[acao];
    if (fn) void fn(alvo.el);
  }, MS_SEGURAR);
  segurando = alvo;
  el.classList.add("segurando");
});

// O click só deve navegar se o hold não completou. pointerup vem antes do click,
// então guardamos o resultado para o listener de click consultar. O pointerdown
// acima zera a marca: se o click não vier (o ponteiro saiu do botão antes de soltar),
// ela não pode sobrar e engolir o clique seguinte.
let ultimoHoldDisparou = false;
for (const evento of ["pointerup", "pointercancel"]) {
  document.addEventListener(evento, () => { ultimoHoldDisparou = encerrarSegurar() ?? ultimoHoldDisparou; });
}

// Arrastar para fora aborta o gesto. pointerleave não borbulha e o botão ganha pointer
// capture implícito no pointerdown, então ouvir no document não resolve: o jeito é medir
// a posição contra o retângulo do próprio botão.
document.addEventListener("pointermove", (ev) => {
  if (!segurando) return;
  const r = segurando.el.getBoundingClientRect();
  const dentro = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  if (!dentro) encerrarSegurar();
});

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (el && ultimoHoldDisparou) { ev.preventDefault(); ev.stopPropagation(); }
  // Zera em qualquer clique, não só no do gatilho: se o próximo clique cair noutro
  // lugar, a marca não pode ficar pendurada esperando o clique seguinte no "+".
  ultimoHoldDisparou = false;
}, true);

// Equivalente de teclado do segurar: quem navega por teclado não consegue fazer o hold.
document.addEventListener("keydown", (ev) => {
  // ev.repeat: segurar a tecla repete o keydown, e sem essa guarda um toque
  // um pouco mais longo criaria vários agentes de uma vez.
  if (ev.repeat || !ev.shiftKey || (ev.key !== "Enter" && ev.key !== " ")) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (!el) return;
  ev.preventDefault();
  const acao = ACOES[el.dataset.segurar ?? ""];
  if (acao) void acao(el);
});

document.addEventListener("contextmenu", (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-bot-contexto]");
  if (!row) return;
  ev.preventDefault();
  const botao = row.querySelector<HTMLElement>("[data-act=menu-agente]");
  if (botao) menuDoBot(botao);
});
