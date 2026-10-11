import "./lib/mascote-elemento.ts";
import { abrirComputador } from "./telas/computador.ts";
import { abrirWorkspace } from "./telas/workspace.ts";
import { listaDoQuePodem, rotuloPermitir, type EscolhaLiberar } from "./telas/card-liberar.ts";
import { CURTA } from "./telas/card-pasta.ts";
import { abrirReportarBug } from "./telas/reportar-bug.ts";
import { abrirRaioX } from "./telas/raio-x.ts";
import { renderInteligencia, escolhaInteligencia } from "./telas/inteligencia.ts";
import { abrirMenu, abrirMenuConta, pedirGestao, type BotGerido, type AcaoGestao } from "./telas/gestao-agentes.ts";
import { renderAvisoModo, renderChipModo } from "./telas/aprovacoes.ts";
import { abrirMenuModo, avisoFechado, fecharAviso, hidratarAvisosFechados } from "./lib/menu-modo.ts";
import type { FormaAgente, CorAgente } from "../src/contracts/agente.ts";
import type { AmbienteBancoDto, ModoSessaoDto } from "../src/contracts/api.ts";
import type { AlvoAviso } from "../src/contracts/desktop.ts";
import type { Escopo } from "../src/shared/types.ts";
import type { FrameSse } from "../src/contracts/frame.ts";
import { agenteDaTela, conversaDaTela, estadoInicial, invalidacoesAoRetomar, invalidacoesDaTela, mudouNaTela, reduzir, type Acao, type Estado, type Invalidacao, type NivelGaveta, type SecaoEspaco, type Tela } from "./estado/reducer.ts";
import { criarApi, ErroApi, sessao as sessaoApi, type Api } from "./lib/api.ts";
import { tabelaComo } from "./lib/texto-formatado.ts";
import { CHAVE_GUARDADA, lerGuardado, lerPedido, PARAMETROS_DO_PEDIDO, type PedidoPareamento } from "./lib/parear-mac.ts";
import { abrirPareamento } from "./telas/parear-mac.ts";
import { criarAvisador } from "./lib/avisador.ts";
import { criarCanalAvisos } from "./lib/canal-avisos.ts";
import { criarLiveEvents, type LiveEvents } from "./lib/live-events.ts";
import { enterEnvia } from "./lib/celular.ts";
import { criarCelular } from "./lib/gaveta-bots.ts";
import "./pwa.ts";
import { atualizarMascote, botao, esc, iconeAgente } from "./lib/render.ts";
import { avisoDeEstado } from "./lib/aviso-estado.ts";
import { aplicarTema } from "./lib/tema.ts";
import { estadoMascoteNaConversa } from "./lib/mascote.ts";
import { lembrar } from "./lib/lembrar.ts";
import { blocosMudariam, esquecerRegiao, regiao, regiaoMudaria, regiaoPorBlocos } from "./lib/regioes.ts";
import { criarRascunhos } from "./lib/rascunhos.ts";
import { criarRolagem } from "./lib/rolagem-na-tela.ts";
import { guardarCampo, restaurarCampo } from "./lib/campos-de-decisao.ts";
import { renderNovoBot } from "./telas/novo-bot.ts";
import { renderNovaRotina } from "./telas/nova-rotina.ts";
import { nivelDaGaveta, renderDetalhes } from "./telas/detalhes.ts";
import { renderEspaco, situacaoCurtaAvisos, textoAmbiente } from "./telas/espaco.ts";
import { USOS } from "./telas/este-mac.ts";
import { botsDaPessoa, maquinaNova } from "./telas/maquinas.ts";
import { voltaDaTela } from "./lib/volta.ts";
import { cabecalhoSecao, CHAVE_SECOES_RECOLHIDAS, chaveDaSecao, definirSecaoRecolhida, ESPERA, estadoDaSecao, lerSecoesRecolhidas, type AvisoBot } from "./lib/secoes.ts";
import { faixaDeConectores, type DadosMenuConta } from "./telas/menu-conta.ts";
import { renderConectores } from "./telas/conectores.ts";
import { appsQueFaltam } from "./telas/rotina-precisa.ts";
import { criarConexoes } from "./lib/conexao.ts";
import type { Proposta } from "../src/contracts/conversa.ts";
import { blocosAoVivo, blocosDoHistorico, htmlComposer, renderCabecalhoConversa, renderTimeline, type BlocoDaTimeline } from "./telas/conversa.ts";
import { criarArtefatosVivos } from "./telas/artefatos-vivos.ts";
import { instalarDicaDeLink } from "./lib/dica-link.ts";
import { inventarioEmUso, motorDesatualizado, situacaoMotorFora } from "./telas/frota.ts";
import { ehIa, inventarioDaIa, pedeInstalar } from "./telas/ia-fora.ts";
import { renderRotinas } from "./telas/rotinas.ts";
import { nomesDosMembros, renderCabecalhoSala, renderNovaSala } from "./telas/sala.ts";
import { abertasPorAgente, perguntasPorAgente, renderChamada, renderIncidentes, renderSuaVez, rotinasParadasPorAgente, SUBTITULO_ESPERANDO, SUBTITULO_ROTINA_PARADA } from "./telas/sua-vez.ts";
import { aparenciaDoComposer } from "./telas/pergunta.ts";
import { BANDEJA, naoLidaDe, renderNaoLidos, rotuloNaoLidos } from "./telas/nao-lidos.ts";
import { frotaAoSoltar, ordemAoSoltar, velocidadeAutoRolagem, type Destino } from "./lib/arrastar.ts";
import { rolagemDaBarra, type Faixa } from "./lib/rolagem-barra.ts";
import { comandoNoTexto, listaDaBarra, nomeDigitado, recentesDaConversa, type ItemDaBarra } from "./lib/barra.ts";
import { renderDicaBarra, renderListaBarra } from "./telas/barra.ts";
import type { ComandosDto } from "../src/contracts/comandos.ts";
import { destinoDoEnvio, enviarPeloComposer, modoDoComposer, MOTIVO_SEM_ANEXO } from "./lib/perguntas.ts";
import { criarEnvios, enviarUmaVez } from "./lib/envio-idempotente.ts";
import { iniciarMotorLigacao } from "./lib/ligacao.ts";
import { ICONE_LIGACAO, VELOCIDADES, VOZES } from "./telas/ligacao.ts";
import { criarTelaLigacao } from "./telas/ligacao-controle.ts";
import { criarControleDitado } from "./telas/ditado-controle.ts";
import { juntarAoCampo, textoDaFalha } from "./telas/ditado.ts";
import { criarTelaOnboarding, guardarFocoDaCamada } from "./telas/onboarding-controle.ts";
import { comportamentoDaRolagem, movimentoReduzido } from "./lib/movimento.ts";
import { gavetaPrendeFoco, irmaosAteARaiz, seletoresDaOrigem, voltaDoTab } from "./lib/foco-gaveta.ts";
import type { Ligacao } from "../src/contracts/ligacao.ts";
import type { MotivoAvaliacaoLigacao } from "./lib/api.ts";
import { mimeDe, motivoRecusa, POR_MENSAGEM, renderItens as renderItensAnexo, resumo as resumoAnexos, type Aceita, type ItemAnexo } from "./lib/anexos.ts";
import type { TipoLinha } from "../src/contracts/trabalho.ts";
import { aberto, abertosDoBot, leituraDoMac, listaPararTasks, telaAoFechar, telaDaTask, textoPararTasks, trabalhoPorId } from "./lib/trabalhos.ts";
import { criarTelemetria } from "./lib/telemetria-linhas.ts";
import { blocosAoVivoDaTask, blocosDoHistoricoDaTask, chipTrabalhosDoBot, htmlAcoesDaTask, renderFaixaTrabalhos, renderIconeTrabalhos, renderTelaLinha, renderTodosOsTrabalhos, renderTopoTrabalho } from "./telas/trabalhos.ts";

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
/**
 * O que estava digitado em cada conversa (definido em 2026-09-30): trocar de conversa recriava o campo vazio e a pessoa
 * perdia o texto. Agora ele fica com a conversa de onde ela saiu e volta quando ela volta — também depois de recarregar.
 */
// NOD-156: a chave de idempotência da fala nasce aqui, uma por fala, e sobrevive ao reenvio depois de uma falha.
const envios = criarEnvios();
const rascunhos = criarRascunhos(() => { try { return localStorage; } catch { return null; } });
/** A conversa acompanha o fim e a pílula da base sobe às não lidas (definido em 2026-10-05, web/lib/rolagem-na-tela.ts). */
const rolagem = criarRolagem(document.getElementById("timeline") as HTMLElement, document.getElementById("pilula-novas") as HTMLElement, () => !movimentoReduzido());
let reidratando = false;
let ambienteBanco: AmbienteBancoDto | null = null;
/**
 * Telemetria das linhas do chat (definido em 2026-10-07, #191): cada linha mostrada conta uma vez por carga da página e
 * cada clique conta; o lote vai para `POST telemetria/linhas` e a falha some (web/lib/telemetria-linhas.ts).
 */
const telemetria = criarTelemetria((eventos) => api?.telemetriaLinhas(eventos) ?? Promise.resolve(), (fn, ms) => window.setTimeout(fn, ms));
window.addEventListener("pagehide", () => telemetria.descarregar());
const tipoLinha = (v: string | undefined): TipoLinha | null => (v === "rotina" || v === "bots" || v === "task" ? v : null);

/** As linhas que o histórico desenhou entram na telemetria (cada chave uma vez por carga). */
function contarLinhasMostradas(): void {
  for (const el of document.querySelectorAll<HTMLElement>("#timeline [data-linha-chave]")) {
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.mostrada({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
  }
}

/**
 * A tela da task sobrevive a recarregar a página (definido em 2026-10-07, #195): o id e a tela de volta ficam na
 * sessionStorage desta aba e, na próxima sessão, a task abre de novo. As outras telas abrem como sempre.
 */
const CHAVE_TASK_ABERTA = "nod.taskAberta";
function lembrarTaskAberta(tela: Tela): void {
  try {
    if (tela.tipo === "trabalho") window.sessionStorage.setItem(CHAVE_TASK_ABERTA, JSON.stringify({ id: tela.id, voltar: tela.voltar.tipo === "conversa" || tela.voltar.tipo === "trabalhos" ? tela.voltar : { tipo: "inicio" } }));
    else window.sessionStorage.removeItem(CHAVE_TASK_ABERTA);
  } catch { /* sem storage, a task não volta sozinha */ }
}
function taskLembrada(): Extract<Tela, { tipo: "trabalho" }> | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CHAVE_TASK_ABERTA) ?? "null") as { id?: unknown; voltar?: { tipo?: unknown; conversaId?: unknown; agenteId?: unknown } } | null;
    if (!v || typeof v.id !== "string") return null;
    const w = v.voltar;
    const voltar: Tela = w?.tipo === "conversa" && typeof w.conversaId === "string" && typeof w.agenteId === "string" ? { tipo: "conversa", conversaId: w.conversaId, agenteId: w.agenteId } : w?.tipo === "trabalhos" ? { tipo: "trabalhos" } : { tipo: "inicio" };
    return { tipo: "trabalho", id: v.id, voltar };
  } catch {
    return null;
  }
}
/** Tela de entrada (ADR-030): o modo vem do servidor; `recusado` vem do redirect do callback do Google. */
let entrada: { modo: ModoSessaoDto | null; recusado: boolean } = { modo: null, recusado: false };

// definido em 2026-09-24 (revisão da interface): a tela principal é o chat; quem esconde o painel do
// bot espera achá-lo escondido na próxima conversa e no próximo carregamento.
// definido em 2026-10-05 ("direto eu me vejo fechando a gaveta"): a gaveta nasce FECHADA e só fica aberta quando a
// pessoa a abre pelo ícone do painel. Antes, sem nada guardado, ela nascia aberta (o app do Mac apaga o localStorage
// a cada conexão), e abrir um nível pelo menu ou pela barra gravava "aberta" para sempre. Agora abrir um nível mostra
// a gaveta só até a pessoa trocar de conversa. A chave mudou de nome para que ninguém herde o "aberta" antigo.
const CHAVE_PAINEL_ABERTO = "nod.painelAberto";
let painelAberto = ((): boolean => { try { return localStorage.getItem(CHAVE_PAINEL_ABERTO) === "1"; } catch { return false; } })();
/** Aberta para mostrar um nível (abrirNivel), sem virar preferência: fecha de novo ao trocar de conversa. */
let painelAbertoNaHora = false;
// ADR-094 (definido em 2026-10-10): no celular a barra de bots vira gaveta, aberta pelo ☰ do cabeçalho.
const celular = criarCelular();
// A busca da sidebar fica fechada até ser pedida (ícone ou ⌘K); aberta, fecha no Esc ou ao perder o foco vazia.
let buscaAberta = false;
const termoBusca = (): string => (document.getElementById("busca-bots") as HTMLInputElement | null)?.value ?? "";
function abrirBusca(): void {
  celular.abrirBots();
  buscaAberta = true;
  render();
  document.getElementById("busca-bots")?.focus();
}
function fecharBusca(): void {
  const campo = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (campo) campo.value = "";
  buscaAberta = false;
  filtrarBots("");
  render();
}
/** definido em 2026-10-07 (ADR-081): o logo do nod (os olhos num quadrado) — o Nod discreto, na barra de cima. */
const LOGO_NOD = '<svg class="logo-nod" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect class="logo-fundo" width="32" height="32" rx="7.5"/><g class="logo-olhos" transform="rotate(14 16 16)"><rect x="8.6" y="8.5" width="5.6" height="15" rx="2.8"/><rect x="17.8" y="8.5" width="5.6" height="15" rx="2.8"/></g></svg>';
const LUPA = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
const LOJA = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 4.5 3h11L17 7.5"/><path d="M3 7.5a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0"/><path d="M4.2 10v7h11.6v-7"/><path d="M8 17v-4h4v4"/></svg>';

// definido em 2026-10-04: as seções recolhidas da barra (web/lib/secoes.ts); um conjunto novo a cada troca.
let secoesRecolhidas: ReadonlySet<string> = lerSecoesRecolhidas();

function painelOculto(): boolean {
  return !painelAberto && !painelAbertoNaHora;
}

/**
 * Avisos (definido em 2026-09-24, "aviso no Mac"): depois de cada leitura de "Sua vez" o avisador decide
 * se chama a pessoa (web/lib/avisador.ts) e o canal mostra — notificação do macOS e Dock no app,
 * Notification API e título da aba no navegador (web/lib/canal-avisos.ts).
 */
const canalAvisos = criarCanalAvisos((alvo) => abrirAlvoDoAviso(alvo), () => { if (estado.sessao) render(); });
// definido em 2026-10-04 (ADR-070): no app do Mac, a escolha de tema mora em preferencias.json (o localStorage é apagado a
// cada conexão); ao abrir, ela volta para o localStorage e para o data-theme, e Preferências mostra o botão certo.
void window.nodDesktop?.preferencias().then((p) => { if (p.tema) aplicarTema(p.tema, document.documentElement); }, () => undefined);
const avisador = criarAvisador({
  relogio: { agora: () => Date.now(), esperar: (ms, fn) => { const t = window.setTimeout(fn, ms); return () => window.clearTimeout(t); } },
  temFoco: () => document.hasFocus(),
  ligado: () => canalAvisos.ligado(),
  pessoaId: () => estado.sessao?.pessoaId ?? null,
  mostrar: (aviso) => canalAvisos.mostrar(aviso),
});
/**
 * Artefatos do nod (ADR-051, definido em 2026-09-28): o card vem na timeline; o iframe sandbox, o estado
 * e a gravação moram aqui, fora do render por regiões.
 */
const artefatos = criarArtefatosVivos({
  carregar: (id, versao) => (api ? api.versaoArtefato(id, versao) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  salvar: (id, dados) => (api ? api.salvarEstadoArtefato(id, dados) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  salvarAoSair: (id, dados) => api?.salvarEstadoArtefatoAoSair(id, dados),
});
/**
 * Modo ligação (definido em 2026-10-04, ADR-071): a tela e o motor moram fora do reducer, como os artefatos — o áudio,
 * o WebSocket e a legenda mudam muitas vezes por segundo. O reducer só sabe QUAL ligação está viva (`ligacaoViva`), para
 * a barra lateral, o cabeçalho e a linha "Chat de voz".
 */
const telaLigacao = criarTelaLigacao({
  api: () => api,
  tenantId: () => estado.sessao?.tenantId ?? null,
  iniciarMotor: iniciarMotorLigacao,
  agente: (id) => botGerido(id),
  suaVez: () => estado.suaVez,
  aoMudar: () => sincronizarLigacao(),
  decidirPeloClique: (id, aprovar) => decidirPelaLigacao(id, aprovar),
  aoEncerrar: (l) => {
    dispatch({ tipo: "esquecer-disponibilidade-ligacao", agenteId: l.agenteId });
    dispatch({ tipo: "invalidar", quais: [`conversa:${l.conversaId}`, "ligacao"] });
    void telaOnboarding.aoLigacaoEncerrada();
  },
  aoOnboarding: (etapa, campos) => telaOnboarding.aoOnboarding(etapa, campos),
  // Rede de segurança da ligação (2026-10-05): o "Configurar sem voz" do aviso é o mesmo do onboarding.
  configurarSemVoz: () => telaOnboarding.acoes["onboarding-sem-voz"]?.(document.body),
});
/**
 * Ditado no campo de mensagem (definido em 2026-10-11, ADR-095): o 🎤 do composer. Como a ligação, mora fora do
 * reducer (o microfone e o canal mudam muitas vezes por segundo); o texto entra no campo pelo caminho do rascunho.
 */
const ditado = criarControleDitado({
  tenantId: () => estado.sessao?.tenantId ?? null,
  disponibilidade: () => (api ? api.disponibilidadeDitado() : Promise.resolve(null)),
  consentir: (versao) => (api ? api.consentirVoz(versao) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  aoTexto: (texto, destino) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (!ta) return;
    ta.value = juntarAoCampo(ta.value, texto);
    ajustarAltura(ta);
    if (composerDe) rascunhos.guardar(composerDe, ta.value);
    if (destino === "enviar") return void enviarComposer();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  },
  avisar: (texto) => dispatch({ tipo: "erro", erro: { codigo: "ditado", mensagem: texto } }),
  noApp: () => window.nodDesktop !== undefined,
});
function avisarDitado(f: Parameters<typeof textoDaFalha>[0]): void {
  dispatch({ tipo: "erro", erro: { codigo: "ditado", mensagem: textoDaFalha(f, window.nodDesktop !== undefined) } });
}
/**
 * Onboarding por ligação (definido em 2026-10-04, ADR-077): a camada `#onboarding` (olá, a IA do Mac, "está te
 * ligando", o painel da entrevista) e os cards guiados na conversa da guia. O que vem do servidor mora no reducer.
 */
const telaOnboarding = criarTelaOnboarding({
  api: () => api,
  dados: () => estado.onboarding,
  aberto: () => estado.onboardingAberto,
  hidratar: (o) => dispatch({ tipo: "hidratar-onboarding", onboarding: o }),
  abrir: (aberto) => dispatch({ tipo: "onboarding-aberto", aberto }),
  ligacao: { ativa: () => telaLigacao.ativa(), cheia: () => telaLigacao.cheia(), atenderOnboarding: (l) => telaLigacao.atenderOnboarding(l) },
  garantirAgente: async (agenteId) => {
    for (let i = 0; i < 6 && api; i++) {
      if (botGerido(agenteId)) return true;
      dispatch({ tipo: "hidratar-frota", frota: await api.frota() });
      if (botGerido(agenteId)) return true;
      await new Promise((r) => window.setTimeout(r, 400));
    }
    return !!botGerido(agenteId);
  },
  irParaConversa: (conversaId, agenteId) => navegar({ tipo: "conversa", conversaId, agenteId }),
  iniciarConexao: (slug, depois) => iniciarConexao(slug, depois),
  conectando: (slug) => slug in estado.conectando,
  conectorHabilitado: async (slug) => {
    const achar = () => estado.conectores.find((c) => c.slug === slug && c.habilitado)?.id ?? null;
    if (achar() || !api) return achar();
    dispatch({ tipo: "hidratar-conectores", ...(await api.conectores()) });
    return achar();
  },
  invalidar: () => dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "rotinas", "conectores", ...(conversaDaTela(estado) ? [`conversa:${conversaDaTela(estado)?.conversa.id}` as Invalidacao] : [])] }),
  erro: (e) => dispatch({ tipo: "erro", erro: erroDe(e) }),
  aoMudar: () => render(),
});
/** A ligação viva que a página achou ao abrir (recarregada no meio dela): volta como pílula quando o bot chegar na frota. */
let ligacaoParaRetomar: Ligacao | null = null;

function sincronizarLigacao(): void {
  const a = telaLigacao.ativa();
  dispatch({ tipo: "ligacao-viva", viva: a ? { ligacaoId: a.ligacaoId, agenteId: a.agenteId, conversaId: a.conversaId, local: true } : estado.ligacaoViva?.local ? null : estado.ligacaoViva });
}

/**
 * O clique em Aprovar/Recusar no card da ligação usa o fluxo normal de decisão (plano, "Aprovação por voz" §5): na
 * aprovação em lista, aprovar = a seleção padrão e recusar = todos os itens desmarcados; o "Retomar" retoma ou dispensa;
 * os outros tipos decidem ou recusam inteiros.
 */
async function decidirPelaLigacao(decisaoId: string, aprovar: boolean): Promise<void> {
  if (!api) return;
  const item = estado.suaVez?.itens.find((i) => i.decisao.id === decisaoId);
  const tipo = item?.decisao.tipo;
  if (tipo === "aprovacao" || tipo === "gate_rotina") await api.decidir(decisaoId, { itens: (item?.itensAprovacao ?? []).map((i) => ({ id: i.id, selecionado: aprovar && i.selecionado })) });
  else if (tipo === "retomar_turno") await (aprovar ? api.retomar(decisaoId) : api.dispensar(decisaoId));
  else await api.decidir(decisaoId, aprovar ? {} : { recusar: true });
  dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota", ...(item?.decisao.conversaId ? [`conversa:${item.decisao.conversaId}` as Invalidacao] : [])] });
}

/** A última leitura de "Sua vez" foi com a janela atrás (`?ver=0`): ao voltar, relê para carimbar vista_em. */
let suaVezSemVer = false;
/** A decisora designada que não é dona não recebe frames (ADR-016): a cada 4 ticks (60 s) "Sua vez" é relida. */
const TICKS_POR_RELEITURA = 4;

/** A janela está na frente da pessoa: visível E com foco. */
function naFrente(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Não lidos (definido em 2026-09-29, 0039): a conversa na tela, com a janela na frente, é lida. A linha "Novas"
 * só entra quando a pessoa acabou de abrir a conversa, voltou para a janela ou abriu o Nod (`linhaEm`); a fala que
 * chega enquanto ela olha é lida sem linha. Voltar com outra leva de novas muda a linha de lugar se a pessoa já viu a
 * linha de antes (2026-10-05): antes ela ficava na primeira leva da visita, e a pílula da base levava a um ponto já
 * lido. Sem ter visto, a linha fica onde estava e soma as novas, para a pílula levar ao começo de tudo.
 */
let linhaEm: string | null = null;
/** A leva de não lidas (a primeiraId dela) já contada na linha de cada conversa: a mesma leva nunca soma duas vezes. */
const levaContada = new Map<string, string>();
let primeiraLeitura = true;
/** A conversa que a pessoa marcou como não lida com ela aberta: continua não lida até ela sair. */
let deixarNaoLida: string | null = null;
const lendo = new Set<string>();

function lerConversaDaTela(): void {
  const t = estado.tela;
  if (!api || !estado.naoLidos || (t.tipo !== "conversa" && t.tipo !== "sala") || !naFrente() || estado.espaco) return;
  const conversaId = t.conversaId;
  const comLinha = linhaEm === conversaId || primeiraLeitura;
  linhaEm = null;
  primeiraLeitura = false;
  const nova = naoLidaDe(estado, conversaId);
  if (!nova || deixarNaoLida === conversaId || lendo.has(conversaId)) return;
  const atual = estado.novasDesde[conversaId];
  if (comLinha && atual?.mensagemId !== nova.primeiraId && levaContada.get(conversaId) !== nova.primeiraId) {
    levaContada.set(conversaId, nova.primeiraId);
    const linha = !atual || rolagem.jaViu(atual.mensagemId) ? { mensagemId: nova.primeiraId, em: nova.desde, total: nova.total } : { ...atual, total: atual.total + nova.total };
    dispatch({ tipo: "novas-desde", conversaId, ...linha });
  }
  lendo.add(conversaId);
  void api
    .marcarLida(conversaId)
    .then(() => dispatch({ tipo: "invalidar", quais: ["nao-lidos"] }), () => undefined)
    .finally(() => lendo.delete(conversaId));
}

/** O ponto de não lido: a conversa aberta, com a pessoa olhando, nunca pisca como nova enquanto a leitura vai ao servidor. */
function temNovas(conversaId: string, e: Estado = estado): boolean {
  if (!naoLidaDe(e, conversaId)) return false;
  const t = e.tela;
  const aberta = (t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId;
  return !(aberta && naFrente() && deixarNaoLida !== conversaId);
}

function dispatch(acao: Acao): void {
  estado = reduzir(estado, acao);
  render();
  void reidratar();
}

/**
 * Frames do SSE (definido em 2026-09-30): o estado muda na hora, mas a tela é redesenhada no máximo uma vez
 * por quadro, e só quando o frame mudou algo que ela mostra (`mudouNaTela`). Cada pedaço de texto de cada
 * bot é um frame: vários bots escrevendo são centenas por segundo. As ações da pessoa continuam
 * redesenhando na hora (dispatch), porque quem clica espera o DOM novo na linha seguinte (foco, rolagem).
 */
let quadroPendente = 0;
function renderNoQuadro(): void {
  if (quadroPendente) return;
  quadroPendente = window.requestAnimationFrame(() => {
    quadroPendente = 0;
    render();
  });
}

function receberFrame(frame: FrameSse): void {
  const antes = estado;
  estado = reduzir(estado, { tipo: "frame", frame, agora: Date.now() });
  if (mudouNaTela(antes, estado)) renderNoQuadro();
  telaOnboarding.aoFrame();
  // Só quem marcou algo para buscar precisa do REST; um pedaço de texto nunca marca.
  if (estado.invalidacoes !== antes.invalidacoes) void reidratar();
}

function erroDe(e: unknown): { codigo: string; mensagem: string; correlationId?: string | null } {
  // O correlation_id atravessa para o relato poder citá-lo (ADR-041): é o que liga o que a pessoa
  // viu na tela à linha de log do servidor. Continua fora do que se RENDERIZA (ADR-002).
  if (e instanceof ErroApi) return { codigo: e.codigo, mensagem: e.message, correlationId: e.correlationId };
  return { codigo: "falha_interna", mensagem: "Não conseguimos falar com o servidor. Confira a conexão e tente de novo." };
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

/**
 * ADR-064: a pendência pedida há menos de 30 s (outra aba, outro clique) ou já resolvida volta 409. O que a pessoa
 * queria já aconteceu, então não há faixa de erro: a lista relê e mostra como ficou.
 */
async function semConflito(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof ErroApi && e.status === 409)) throw e;
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
  if (q === "nao-lidos") return { tipo: "hidratar-nao-lidos", naoLidos: await api.naoLidos() };
  // ADR-083: servidor sem a rota (404) fica sem trabalhos — sem faixa, sem chip, sem ícone; nenhum erro sobe.
  if (q === "trabalhos") return { tipo: "hidratar-trabalhos", trabalhos: await api.trabalhos().catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return { trabalhos: [], pressao: null, memoriaTotalMb: null }; throw e; }) };
  if (q.startsWith("trabalho:")) {
    // Revisão W2 (2026-10-08): a task que sumiu (404) fecha a tela em vez de ficar "carregando" e pedir de novo.
    const id = q.slice(9);
    const detalhe = await api.trabalho(id).catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return null; throw e; });
    return detalhe ? { tipo: "hidratar-trabalho", detalhe, agora } : { tipo: "trabalho-sumiu", id };
  }
  if (q === "chaves") return { tipo: "hidratar-chaves", chaves: (await api.chaves()).chaves };
  // ADR-090: servidor sem a rota (404, versão anterior) fica sem máquinas; nenhum erro sobe.
  if (q === "maquinas") return { tipo: "hidratar-maquinas", maquinas: await api.maquinas().catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return { maquinas: [], padraoId: null }; throw e; }) };
  if (q === "relatos") return { tipo: "hidratar-relatos", relatos: (await api.relatos()).relatos };
  // ADR-077: falha fechada — sem a rota (ou com erro), o onboarding não abre e o app segue normal.
  if (q === "onboarding") return { tipo: "hidratar-onboarding", onboarding: await api.onboarding().catch(() => null) };
  if (q === "ligacao") {
    const local = telaLigacao.ativa();
    if (local) return { tipo: "ligacao-viva", viva: { ligacaoId: local.ligacaoId, agenteId: local.agenteId, conversaId: local.conversaId, local: true } };
    const { ligacao } = await api.ligacaoViva();
    const viva = ligacao && (ligacao.estado === "chamando" || ligacao.estado === "em_curso");
    return { tipo: "ligacao-viva", viva: viva ? { ligacaoId: ligacao.id, agenteId: ligacao.agenteId, conversaId: ligacao.conversaId, local: false } : null };
  }
  if (q.startsWith("disponibilidade:")) {
    const agenteId = q.slice(16);
    // Falha fechada: sem a resposta (rota ausente, erro), o botão "Ligar" não aparece — e nenhum erro sobe para a faixa.
    const disponibilidade = await api.disponibilidadeLigacao(agenteId).catch(() => null);
    return { tipo: "hidratar-disponibilidade-ligacao", agenteId, disponibilidade };
  }
  if (q.startsWith("conversa:")) {
    // Modo dev (0036): a faixa de cada resposta acompanha a conversa — o turno que acabou de assentar já tem Raio-X.
    void carregarRaioX(q.slice(9));
    return { tipo: "hidratar-conversa", conversa: await api.conversa(q.slice(9)), agora };
  }
  if (q.startsWith("memoria:")) return { tipo: "hidratar-memorias", agenteId: q.slice(8), memorias: (await api.memorias(q.slice(8))).memorias };
  if (q.startsWith("pendencias:")) return { tipo: "hidratar-pendencias", agenteId: q.slice(11), pendencias: (await api.pendencias(q.slice(11))).pendencias };
  if (q.startsWith("concessoes:")) return { tipo: "hidratar-concessoes", agenteId: q.slice(11), ...(await api.concessoes(q.slice(11))) };
  if (q.startsWith("execucoes:")) return { tipo: "hidratar-execucoes", rotinaId: q.slice(10), execucoes: (await api.execucoes(q.slice(10))).execucoes };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Modo dev (definido em 2026-09-28, 0036). A preferência mora no servidor: o app desktop limpa o localStorage.

/** A meia-noite de hoje no relógio da pessoa: o "Hoje com o bot" do cabeçalho. */
function meiaNoite(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function carregarRaioX(conversaId: string): Promise<void> {
  if (!api || !estado.modoDev.ligado) return;
  try {
    dispatch({ tipo: "hidratar-raio-x", conversaId, raioX: await api.raioXDaConversa(conversaId, meiaNoite()) });
  } catch {
    // Telemetria: sem o Raio-X, a conversa segue igual e a faixa só não aparece.
  }
  // #191: a taxa de abertura das linhas do chat, por tipo, junto do custo (só no Modo dev; sem a rota, nada aparece).
  try {
    dispatch({ tipo: "hidratar-taxas-linhas", taxas: await api.taxasLinhas() });
  } catch {
    // Sem a taxa, o selo do Modo dev mostra só o custo.
  }
}

async function alternarModoDev(): Promise<void> {
  if (!api) return;
  const p = await api.gravarPreferencias({ modoDev: !estado.modoDev.ligado });
  dispatch({ tipo: "modo-dev", ligado: p.modoDev });
  const c = conversaDaTela(estado);
  if (p.modoDev && c) await carregarRaioX(c.conversa.id);
}

async function reidratar(): Promise<void> {
  if (!api || reidratando) return;
  const pendentes = [...new Set([...estado.invalidacoes, ...invalidacoesDaTela(estado)])];
  // Só o que a tela atual olha entra agora; o resto fica marcado para quando a tela abrir.
  const relevantes = pendentes.filter((q) => relevante(q));
  // definido em 2026-09-30: nada relevante, nada a buscar nem a redesenhar. A conversa de outro bot fica marcada
  // até ser aberta, e antes cada frame caía aqui e redesenhava a tela inteira de forma síncrona.
  if (relevantes.length === 0) return;
  const telaAntes = estado.tela;
  reidratando = true;
  let lerDepois = false;
  try {
    // definido em 2026-09-17: consumir antes do GET preserva frames recebidos durante a busca.
    estado = reduzir(estado, { tipo: "invalidacoes-tratadas", quais: relevantes });
    for (const q of relevantes) {
      try {
        const acao = await buscar(q);
        if (acao) estado = reduzir(estado, acao);
        if (acao?.tipo === "hidratar-sua-vez") canalAvisos.contador(avisador.atualizar(acao.suaVez));
        if (acao?.tipo === "hidratar-nao-lidos") lerDepois = true;
        if (acao?.tipo === "trabalho-sumiu") lembrarTaskAberta(estado.tela);
      } catch (e) {
        if (!(e instanceof ErroApi && e.status === 404)) estado = reduzir(estado, { tipo: "erro", erro: erroDe(e) });
      }
    }
    render();
  } finally {
    reidratando = false;
  }
  if (lerDepois) lerConversaDaTela();
  // definido em 2026-09-28: a tela que mudou DURANTE a busca (clicar num bot com a primeira carga em andamento) também
  // pede o que lhe falta; antes a conversa esperava o próximo tique (15 s). Só quando a tela mudou: há falta que não se
  // resolve buscando (sem nenhuma sala, "salas" continua faltando) e voltaria a buscar sem parar.
  const telaMudou = estado.tela !== telaAntes && invalidacoesDaTela(estado).some((q) => relevante(q));
  if (telaMudou || estado.invalidacoes.some((q) => relevante(q))) void reidratar();
}

function relevante(q: Invalidacao): boolean {
  const t = estado.tela;
  if (q === "frota" || q === "inventario" || q === "executor" || q === "sua-vez" || q === "salas" || q === "nao-lidos" || q === "ligacao" || q === "trabalhos") return true;
  if (q.startsWith("trabalho:")) return t.tipo === "trabalho" && t.id === q.slice(9);
  if (q.startsWith("disponibilidade:")) return t.tipo === "conversa" && t.agenteId === q.slice(16);
  const secao = estado.espaco?.secao;
  if (q === "gestao") return secao === "agentes";
  if (q === "rotinas") return t.tipo === "rotinas" || t.tipo === "conversa";
  if (q === "conectores") return t.tipo === "conectores" || t.tipo === "conversa" || t.tipo === "sala";
  if (q === "chaves") return secao === "computadores";
  if (q === "maquinas") return secao === "maquinas" || t.tipo === "conversa";
  if (q === "relatos") return secao === "relatos";
  if (q.startsWith("conversa:")) return (t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha") && t.conversaId === q.slice(9);
  if (q.startsWith("memoria:")) return t.tipo === "conversa" && estado.gaveta?.agenteId === q.slice(8) && estado.gaveta.nivel.tipo === "memoria";
  if (q.startsWith("concessoes:")) return t.tipo === "conversa" && t.agenteId === q.slice(11) ? true : t.tipo === "conectores";
  // ADR-064: o "a fazer" só aparece na conversa do bot (embaixo da última mensagem e na gaveta).
  if (q.startsWith("pendencias:")) return t.tipo === "conversa" && t.agenteId === q.slice(11);
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

/**
 * A barra lateral lê o estado pelo PARÂMETRO (que encobre o `estado` do módulo de propósito): ela é desenhada
 * por `lembrar` (web/lib/lembrar.ts), que só enxerga o que passa pelo parâmetro. O que ela lê de fora do
 * estado entra nos extras de `redesenharSidebar`.
 */
function renderSidebar(estado: Estado): string {
  const agentes = estado.frota?.agentes ?? [];
  const abertas = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const paradas = rotinasParadasPorAgente(estado);
  const t = estado.tela;
  const atual = (conversaId: string) => ((t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId ? ' aria-current="true"' : "");
  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): os bots da pessoa se arrastam — para a grade (fixa), entre
  // seções ou para uma seção nova. Os da equipe não: fixar e seção são da dona.
  // ADR-081: o Nod não se arrasta — ele não entra em seção; topo e discreto são pelo menu dele.
  const arrastavel = (a: (typeof agentes)[number]) => (a.ownerId === estado.sessao?.pessoaId && a.papel !== "nod" ? ` draggable="true" data-arrastavel="${esc(a.id)}"` : "");
  const avisos = new Map(agentes.map((a): [string, AvisoBot] => [a.id, (abertas.get(a.id) ?? 0) > 0 ? "decisao" : perguntas.get(a.id) ? "pergunta" : temNovas(a.conversaId, estado) ? "nao-lido" : ""]));
  const avisoDe = (a: (typeof agentes)[number]): AvisoBot => avisos.get(a.id) ?? "";
  const linha = (a: (typeof agentes)[number], escondida = false) => {
    // definido em 2026-09-24 (revisão da interface): a linha só tem UM sinal, o ponto do próprio mascote.
    // A cor diz o tipo — âmbar decisão, azul pergunta, cinza mensagem não lida —; o mascote animado já
    // diz quando o bot trabalha. Selos ⚑, estrela de fixado e pontos soltos saíram.
    const perguntando = perguntas.get(a.id) ?? 0;
    // definido em 2026-09-24 (emenda da ADR-044): "rotina parada" (âmbar) quando uma rotina dele espera acesso.
    const nova = temNovas(a.conversaId, estado);
    const aviso = avisoDe(a);
    const rotuloAviso = aviso ? ` (${ESPERA[aviso]})` : "";
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    const estadoVisual = aviso && mascote === "disponivel" ? "aguardando" : mascote;
    // definido em 2026-09-24 (sidebar no estilo do Grok): o título vira um chip ao lado do nome e a linha de
    // baixo é a última mensagem; os estados que pedem ação (fora do ar, pergunta, rotina parada) ganham dela.
    // definido em 2026-10-04 (ADR-071): "Em ligação" ganha da última mensagem, discreto, com o fone.
    const emLigacao = estado.ligacaoViva?.agenteId === a.id;
    const subtitulo = emLigacao ? `<span class="sub-em-ligacao">${ICONE_LIGACAO.fone(12)}Em ligação</span>` : a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId ? '<span class="sub-fora-do-ar">computador fora do ar</span>' : perguntando ? SUBTITULO_ESPERANDO : paradas.has(a.id) ? SUBTITULO_ROTINA_PARADA : `<span${nova ? ' class="previa-nova"' : ""}>${esc(a.ultimaMensagem?.previa || a.descricaoEstado || "acabamos de nos conhecer")}</span>`;
    // ADR-083 (#196, K8 variante 3): com trabalho aberto, o chip com o número e o ponto na cor do bot ao lado do nome.
    const chip = (a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : "") + chipTrabalhosDoBot(estado, a);
    // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): sem ••• na linha nem no fixado — o menu do bot abre no
    // clique direito (ou Shift+F10) e no ⋯ do topo da gaveta. O nome inteiro, com o título, fica no title.
    return `<div class="bot-row${escondida ? " escondida" : ""}" data-bot-contexto="${esc(a.id)}"${arrastavel(a)} data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="row"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}" aria-label="Abrir conversa com ${esc(a.nome)}${emLigacao ? " (em ligação)" : ""}${rotuloAviso}" title="${esc(a.titulo ? `${a.nome} · ${a.titulo}` : a.nome)}">${iconeAgente(a, "", estadoVisual, aviso ? `data-aviso="${aviso}"` : "")}<span class="txt"><span class="nome-linha"><b>${esc(a.nome)}</b>${chip}</span>${subtitulo}</span></button></div>`;
  };
  const meus = agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId);
  // definido em 2026-10-04 (web/lib/secoes.ts): a seção recolhe pelo título. Recolhida, ficam à vista o bot da conversa
  // aberta e os com problema (computador fora do ar, em ligação); os outros continuam no HTML, escondidos pelo CSS — a
  // busca os mostra (data-buscando, em filtrarBots) e o arrasto abre a seção para medir a posição deles.
  const pessoaId = estado.sessao?.pessoaId ?? "";
  const conversaAberta = t.tipo === "conversa" ? t.conversaId : null;
  const alertaDe = (a: (typeof agentes)[number]) => (!!a.computadorForaDoAr && a.ownerId === pessoaId) || estado.ligacaoViva?.agenteId === a.id;
  const secaoDeBots = (nome: string, chave: string, lista: typeof agentes, atributos: string) => {
    const s = estadoDaSecao({ chave, recolhidas: secoesRecolhidas, conversaAberta, bots: lista.map((a) => ({ conversaId: a.conversaId, aviso: avisoDe(a), alerta: alertaDe(a) })) });
    return `<section class="section"${atributos}${s.recolhida ? " data-recolhida" : ""}>${cabecalhoSecao(nome, chave, { recolhida: s.recolhida, total: lista.length, aviso: s.aviso })}${lista.map((a, i) => linha(a, s.escondidos[i])).join("")}</section>`;
  };
  // Cada seção é um alvo de soltar (data-grupo); "Meus agentes" é a seção "" e continua alvo mesmo vazia (só aparece arrastando).
  const grupo = (nome: string, secao: string, lista: typeof agentes) => secaoDeBots(nome, chaveDaSecao(pessoaId, secao), lista, ` data-grupo="secao" data-secao="${esc(secao)}"${lista.length ? "" : " data-vazio"}`);
  // definido em 2026-09-24 (sidebar no estilo do Grok): fixados em grade de 4 — avatar grande, nome e o
  // título num chip. Mesmo aviso no mascote e o mesmo menu (clique direito / •••) da linha.
  const bloco = (a: (typeof agentes)[number]) => {
    const aviso = avisoDe(a);
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    const rotulo = aviso ? ` (${ESPERA[aviso]})` : "";
    const emLigacao = estado.ligacaoViva?.agenteId === a.id;
    return `<div class="fixado${emLigacao ? " em-ligacao" : ""}" data-bot-contexto="${esc(a.id)}"${arrastavel(a)} data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="fixado-bt"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" aria-label="Abrir conversa com ${esc(a.nome)}${rotulo}" title="${esc(a.titulo ? `${a.nome} · ${a.titulo}` : a.nome)}">${iconeAgente(a, "lg", aviso && mascote === "disponivel" ? "aguardando" : mascote, aviso ? `data-aviso="${aviso}"` : "")}<b>${esc(a.nome)}</b>${emLigacao ? `<i class="chip chip-em-ligacao">${ICONE_LIGACAO.fone(11)}Em ligação</i>` : chipTrabalhosDoBot(estado, a) || (a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : "")}</button></div>`;
  };
  // definido em 2026-10-07 (ADR-081): o Nod nunca entra numa seção. Fixado, é o primeiro da grade; desafixado (discreto),
  // vira o botão com o logo e o nome na barra de cima, à esquerda da lupa (canvas "Nod — bot fixo", Alt E).
  const nod = meus.find((a) => a.papel === "nod") ?? null;
  const comuns = meus.filter((a) => a.papel !== "nod");
  const secoes = [...new Set(comuns.filter((a) => !a.fixado && a.secao).map((a) => a.secao!))].sort((a, b) => a.localeCompare(b));
  const fixados = [...(nod?.fixado ? [nod] : []), ...comuns.filter((a) => a.fixado)];
  const grade = meus.length ? `<section class="fixados" aria-label="Fixados" data-grupo="fixados"${fixados.length ? "" : " data-vazio"}>${fixados.map(bloco).join("")}${fixados.length ? "" : '<p class="fixados-vazio">Solte aqui para fixar</p>'}</section>` : "";
  const bots = meus.length ? grupo("Meus agentes", "", comuns.filter((a) => !a.fixado && !a.secao)) + secoes.map((s) => grupo(s, s, comuns.filter((a) => !a.fixado && a.secao === s))).join("") + '<div class="nova-secao-alvo" data-grupo="nova-secao" aria-hidden="true">+ Nova seção</div>' : "";
  const avisoNod = nod ? avisoDe(nod) : "";
  const nodDiscreto = nod && !nod.fixado
    ? `<button class="nod-topo" data-bot-contexto="${esc(nod.id)}"${atual(nod.conversaId)} data-act="abrir-conversa" data-conversa="${esc(nod.conversaId)}" data-agente="${esc(nod.id)}" aria-label="Abrir o Nod${avisoNod ? ` (${ESPERA[avisoNod]})` : ""}" title="Nod">${LOGO_NOD}<span>Nod</span>${avisoNod ? `<span class="nod-topo-aviso" data-aviso="${avisoNod}" aria-hidden="true"></span>` : ""}</button>`
    : "";
  const daEquipe = agentes.filter((a) => a.ownerId !== estado.sessao?.pessoaId);
  const equipe = daEquipe.length ? secaoDeBots("Agentes da equipe", chaveDaSecao(pessoaId, null), daEquipe, "") : "";
  // definido em 2026-10-04: a seção Salas saiu da barra — só poluía. As salas voltam como uma feature pensada na
  // jornada inteira; até lá, a tela da sala continua existindo e abre por Não lidos e pelos avisos.

  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): o banco persistente é o de todo dia e foi para o rodapé do
  // menu da conta; o efêmero e o não identificado continuam na barra, porque pedem atenção.
  const ambiente = ambienteBanco && ambienteBanco.regime !== "persistente"
    ? `<div class="ambiente-banco ambiente-${esc(ambienteBanco.regime)}" role="status" title="Banco usado por esta instância do Nod"><span></span>${ambienteBanco.regime === "efemero" ? "Efêmero" : "Banco não identificado"}${ambienteBanco.porta ? ` · DB ${ambienteBanco.porta}` : ""}</div>`
    : "";
  // Sem o rail e sem o inventário na tela inicial, o rodapé é o ÚNICO lugar sempre visível que pode
  // avisar que o motor não está pronto (ADR-029: falha vira estado escrito, nunca só um ícone).
  const inv = inventarioEmUso(estado);
  const falhaMotor = !!inv && inv.estado !== "pronto";
  const situacaoMotor = !estado.executor
    ? "Verificando conexão…"
    : falhaMotor
      ? situacaoMotorFora(inv, estado.executor.atual)
      : estado.executor.atual === "catcher"
        ? "Modo de simulação"
        : "Sua IA conectada";
  // definido em 2026-09-24 (sidebar no estilo do Grok): sem marca e sem título — o topo tem só busca,
  // sino e +. A busca é um ícone; o campo aparece ao clicar, com ⌘K, ou enquanto tem texto.
  const buscando = buscaAberta || termoBusca() !== "";
  // definido em 2026-09-29 (0039, canvas "Não lidos"): o ícone só existe com algo não lido (ou com a tela aberta).
  const comNovas = (estado.naoLidos?.conversas ?? []).some((c) => temNovas(c.conversaId, estado));
  const naoLidos = comNovas || t.tipo === "nao-lidos"
    ? `<button class="icone-topo nao-lidos-bt" data-act="navegar" data-tela="nao-lidos" aria-current="${t.tipo === "nao-lidos" ? "page" : "false"}" aria-label="${esc(rotuloNaoLidos(estado))}" title="Não lidos">${BANDEJA}${comNovas ? '<span class="ponto-novo" aria-hidden="true"></span>' : ""}</button>`
    : "";
  return `<div class="search-wrap">
      <div class="sh">${nodDiscreto}<button class="icone-topo" data-act="abrir-busca" aria-label="Buscar agentes" aria-keyshortcuts="Meta+K Control+K" title="Buscar (⌘K)">${LUPA}</button>${naoLidos}${renderIconeTrabalhos(estado)}${renderChamada(estado)}<span class="create-actions"><button class="create-trigger" data-act="navegar" data-tela="novo-bot" data-segurar="criar-rapido" aria-label="Nova conversa (segure para criar um bot direto)" aria-keyshortcuts="Shift+Enter Shift+Space"><span class="segurar-anel" aria-hidden="true"></span>+</button></span></div>
      <label class="search"${buscando ? "" : " hidden"}><span>⌕</span><input id="busca-bots" placeholder="Buscar agentes…" aria-label="Buscar agentes" autocomplete="off" /><kbd>esc</kbd></label>
    </div>
    ${renderIncidentes(estado)}
    <div class="list">
      ${grade}
      ${bots || '<p class="mudo">Nenhum agente visível.</p>'}
      ${equipe}
    </div>
    ${ambiente}
    ${falhaMotor ? avisoDeEstado({ tom: "alerta", texto: situacaoMotor, papel: "status", classe: "aviso-compacto", acao: botao("secao-espaco", motorDesatualizado(estado) ? "Atualizar" : "Conectar", { classe: "pri sm", dados: { secao: "conexao" } }) }) : ""}
    <div class="rodape">
      <button class="me${falhaMotor ? " me-falha" : ""}" data-act="menu-conta" aria-haspopup="menu" aria-expanded="${estado.espaco ? "true" : "false"}" aria-label="Menu da conta: ${esc(situacaoMotor)}" title="Menu da conta · ${esc(situacaoMotor)}"><span class="av-me">eu</span><span class="me-conexao conexao-${esc(estado.conexao.estado)}" title="eventos ao vivo: ${esc(estado.conexao.estado)}"></span></button>
      <button class="marketplace-bt" data-act="navegar" data-tela="conectores" aria-current="${t.tipo === "conectores" ? "true" : "false"}">${LOJA}Marketplace</button>
    </div>`;
}

const MENU = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

/** O ☰ que abre a gaveta de bots no celular (ADR-094). No computador o CSS o esconde. */
function botaoAbrirBots(): string {
  return `<button type="button" class="abrir-bots" data-act="abrir-bots" aria-label="Bots e conversas" aria-controls="sidebar" aria-expanded="${celular.botsAbertos()}">${MENU}</button>`;
}

function renderPrincipal(): void {
  const t = estado.tela;
  // NOD-174: a pessoa lê a frase do servidor; o código fechado fica só no <details>, para quem depura.
  const erro = estado.erro ? `<div class="erro" role="alert">${esc(estado.erro.mensagem)} ${botao("fechar-erro", "×", { classe: "sm" })}<details class="erro-detalhe"><summary>Detalhes</summary><code>${esc(estado.erro.codigo)}</code></details></div>` : "";
  let cabecalho = "";
  let corpo = "";
  let partes: PartesDaTimeline | null = null;
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
    case "nao-lidos":
      corpo = renderNaoLidos(estado);
      break;
    case "rotinas":
      corpo = renderRotinas(estado);
      break;
    case "conectores":
      corpo = renderConectores(estado);
      break;
    case "nova-sala":
      corpo = renderNovaSala(estado);
      break;
    // ADR-083 (#195/#196): "Todos os trabalhos", a tela da task e a tela provisória de uma linha do chat.
    case "trabalhos":
      corpo = renderTodosOsTrabalhos(estado, t.filtro);
      break;
    case "trabalho":
      cabecalho = renderTopoTrabalho(estado, t.id);
      // Por blocos como a conversa (definido em 2026-10-08, revisão W1, ADR-061): o texto ao vivo só mexe na parte ao vivo.
      partes = partesDaTask(t.id);
      corpo = CASCA_TIMELINE_TASK;
      composer = { chave: `trabalho:${t.id}`, html: htmlComposer("Escreva para esta task…") + htmlAcoesDaTask(t.id) };
      break;
    case "linha":
      corpo = `<div class="timeline tk-timeline">${renderTelaLinha(estado, t)}</div>`;
      break;
    case "conversa":
      cabecalho = renderCabecalhoConversa(estado, t.agenteId);
      partes = partesDaTimeline();
      corpo = partes ? CASCA_TIMELINE : renderTimeline(null, estado);
      composer = { chave: `conversa:${t.conversaId}`, html: htmlComposer(placeholderPadrao(), (estado.frota?.agentes ?? []).filter((a) => a.id !== t.agenteId && a.ownerId === estado.sessao?.pessoaId && a.confirmado).map((a) => a.nome), { anexos: aceitaDo(botGerido(t.agenteId)?.harness), comandos: true, aprovacao: true }) };
      break;
    case "sala":
      cabecalho = renderCabecalhoSala(estado, t.salaId);
      partes = partesDaTimeline();
      corpo = partes ? CASCA_TIMELINE : renderTimeline(null, estado);
      composer = { chave: `sala:${t.salaId}`, html: htmlComposer(PLACEHOLDER_SALA, nomesDosMembros(estado, t.salaId)) };
      break;
  }
  // Um formulário da gaveta com algo digitado não é regravado por um frame qualquer; ele volta a acompanhar o estado
  // quando a pessoa salva, cancela ou sai do nível.
  if (gavetaSuja !== chaveDaGaveta()) regiao("detalhes", lembrar("detalhes", estado, [], renderDetalhes));
  document.querySelector(".app")?.classList.toggle("com-detalhes", t.tipo === "conversa");
  document.querySelector(".app")?.classList.toggle("detalhes-ocultos", painelOculto());
  // ADR-094: um cabeçalho só. No celular o ☰ da gaveta de bots entra no próprio cabeçalho da tela; tela sem cabeçalho
  // ganha uma faixa só com ele (`so-menu`, que no computador não aparece).
  regiao("cabecalho", botaoAbrirBots() + cabecalho);
  document.getElementById("cabecalho")?.classList.toggle("so-menu", cabecalho === "");
  document.getElementById("cabecalho")?.classList.toggle("cabecalho-task", t.tipo === "trabalho");
  regiao("erro", erro);
  // ADR-083 (#195): a faixa de Trabalhos fica colada em cima do campo, só na conversa e só com trabalho aberto do bot.
  regiao("faixa-trabalhos", t.tipo === "conversa" ? renderFaixaTrabalhos(estado, t.agenteId) : "");
  const cascaMuda = regiaoMudaria("timeline", corpo);
  const historicoMuda = cascaMuda || (partes !== null && blocosMudariam("timeline-historico", partes.historico));
  const aoVivoMuda = cascaMuda || (partes !== null && blocosMudariam("timeline-ao-vivo", partes.aoVivo));
  if (historicoMuda || aoVivoMuda) regravarTimeline(corpo, partes, { cascaMuda, historicoMuda, aoVivoMuda });
  // O composer só é regravado quando a conversa muda: o textarea preserva texto, foco e cursor.
  if (composer?.chave !== composerDe) {
    // ADR-095: a gravação é do campo que sai; o texto dela nunca cai no campo de outra conversa.
    ditado.descartar();
    const saindo = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (composerDe && saindo) rascunhos.guardar(composerDe, saindo.value);
    composerDe = composer?.chave ?? null;
    esquecerRegiao("composer");
    esquecerRegiao("composer-pergunta");
    esquecerRegiao("composer-aviso");
    regiao("composer", composer?.html ?? "");
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    const rascunho = composerDe ? rascunhos.ler(composerDe) : "";
    if (ta && rascunho) {
      ta.value = rascunho;
      ajustarAltura(ta);
      ta.setSelectionRange(rascunho.length, rascunho.length);
    }
    // No celular o foco abriria o teclado a cada conversa aberta: o campo espera o toque.
    if (!celular.ativo()) ta?.focus();
    redesenharAnexos();
  }
  atualizarComposer();
  ditado.atualizar();
  // O Parar da task some quando ela termina; o campo continua (escrever retoma a task do mesmo ponto).
  if (t.tipo === "trabalho") {
    const tr = trabalhoPorId(estado, t.id);
    document.querySelector<HTMLElement>('#composer [data-act="parar-trabalho"]')?.toggleAttribute("hidden", !tr || !aberto(tr));
  }
  document.body.classList.toggle("ocupado", estado.ocupado);
}

type PartesDaTimeline = { historico: BlocoDaTimeline[]; aoVivo: BlocoDaTimeline[] };

/**
 * A timeline de uma conversa em duas partes (definido em 2026-09-30, web/telas/conversa.ts): a casca fica e
 * cada parte é uma região por blocos. O histórico vem da lembrança (web/lib/lembrar.ts) e só é refeito quando
 * algo que ele lê muda; a parte ao vivo é refeita a cada quadro, e só o bloco do turno que escreveu é regravado.
 */
const CASCA_TIMELINE = '<div class="timeline"><div id="timeline-historico" class="timeline-parte"></div><div id="timeline-ao-vivo" class="timeline-parte"></div></div>';

/** A casca da tela da task: as mesmas duas partes da conversa, com o desenho da task (`tk-timeline`). */
const CASCA_TIMELINE_TASK = '<div class="timeline tk-timeline"><div id="timeline-historico" class="timeline-parte"></div><div id="timeline-ao-vivo" class="timeline-parte"></div></div>';

/** A tela da task em duas partes: o histórico lembrado (só muda com mensagem nova) e o ao vivo do turno do trabalho. */
function partesDaTask(id: string): PartesDaTimeline {
  return { historico: lembrar("task-historico", estado, [id], (e) => blocosDoHistoricoDaTask(e, id)), aoVivo: blocosAoVivoDaTask(estado, id) };
}

function partesDaTimeline(): PartesDaTimeline | null {
  const c = conversaDaTela(estado);
  if (!c) return null;
  // O chip de link do Slack diz "mensagem das HH:MM" no mesmo dia e "de DD/MM" depois: o dia é um extra.
  const historico = lembrar("timeline-historico", estado, [new Date().toDateString()], (e) => {
    const conversa = conversaDaTela(e);
    return conversa ? blocosDoHistorico(conversa, e) : [];
  });
  // ADR-077: os cards da configuração guiada entram como um bloco ao vivo na conversa da guia.
  const guia = telaOnboarding.blocoNaConversa(c.conversa.id);
  return { historico, aoVivo: guia ? [...blocosAoVivo(c, estado), { chave: "onboarding", html: guia }] : blocosAoVivo(c, estado) };
}

/**
 * Regrava os blocos que mudaram guardando o que a pessoa tem aberto ou digitado neles, e mantém no fim quem estava no
 * fim. Com o histórico parado, só a parte ao vivo é mexida, e só nela se procura o que guardar: procurar no documento
 * inteiro (dezenas de milhares de nós numa conversa longa) a cada quadro de streaming custava mais que o próprio desenho.
 */
function regravarTimeline(corpo: string, partes: PartesDaTimeline | null, muda: { cascaMuda: boolean; historicoMuda: boolean; aoVivoMuda: boolean }): void {
  const t = estado.tela;
  const timeline = document.getElementById("timeline");
  const escopo: ParentNode = muda.historicoMuda ? document : document.getElementById("timeline-ao-vivo") ?? document;
  const abertos = [...escopo.querySelectorAll<HTMLDetailsElement>("details[data-disclosure][open]")].map((el) => el.dataset.disclosure);
  const buscas = muda.cascaMuda ? ["busca-destinatario", "busca-marketplace"].map((id) => ({ id, valor: (document.getElementById(id) as HTMLInputElement | null)?.value ?? "" })) : [];
  // A pasta marcada no card de pasta sobrevive a um frame que re-renderiza a conversa no meio da escolha.
  const pastasMarcadas = [...escopo.querySelectorAll<HTMLInputElement>("input[data-pasta-de]:checked")].map((el) => ({ de: el.dataset.pastaDe ?? "", valor: el.value, foco: document.activeElement === el }));
  // ADR-082: a ação do lote do Nod que a pessoa desmarcou continua desmarcada depois de um frame que redesenha o card.
  const loteDesmarcado = [...escopo.querySelectorAll<HTMLInputElement>("[data-proposta] input[data-lote-i]")].filter((el) => !el.checked).map((el) => ({ proposta: el.closest<HTMLElement>("[data-proposta]")?.dataset.proposta ?? "", i: el.dataset.loteI ?? "" }));
  const respostas = [...escopo.querySelectorAll<HTMLInputElement>("[data-decisao] input")].map((el) => ({
    decisao: el.closest<HTMLElement>("[data-decisao]")?.dataset.decisao ?? "",
    atributo: el.hasAttribute("data-resposta") ? "data-resposta" : el.hasAttribute("data-item-texto") ? "data-item-texto" : "data-item",
    chave: el.dataset.resposta ?? el.dataset.itemTexto ?? el.dataset.item ?? "",
    campo: guardarCampo(el),
    foco: document.activeElement === el, inicio: el.selectionStart, fim: el.selectionEnd,
  }));
  // ADR-051: o iframe do artefato sai antes de a timeline ser regravada e volta sem recarregar (moveBefore),
  // no hidratar() logo abaixo — depois de os <details> reabrirem; sem moveBefore, ele é recriado do cache.
  if (muda.historicoMuda) artefatos.estacionar();
  regiao("timeline", corpo);
  if (muda.cascaMuda) {
    esquecerRegiao("timeline-historico");
    esquecerRegiao("timeline-ao-vivo");
  }
  if (partes) {
    if (muda.historicoMuda) regiaoPorBlocos("timeline-historico", partes.historico);
    if (muda.aoVivoMuda) regiaoPorBlocos("timeline-ao-vivo", partes.aoVivo);
  }
  for (const resposta of respostas) {
    const el = document.querySelector<HTMLInputElement>(`[data-decisao="${CSS.escape(resposta.decisao)}"] input[${resposta.atributo}="${CSS.escape(resposta.chave)}"]`);
    if (!el || !restaurarCampo(el, resposta.campo)) continue;
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
  for (const d of loteDesmarcado) {
    const el = document.querySelector<HTMLInputElement>(`[data-proposta="${CSS.escape(d.proposta)}"] input[data-lote-i="${CSS.escape(d.i)}"]`);
    if (el) el.checked = false;
  }
  for (const marcada of pastasMarcadas) {
    const el = [...document.querySelectorAll<HTMLInputElement>(`input[data-pasta-de="${CSS.escape(marcada.de)}"]`)].find((x) => x.value === marcada.valor);
    if (!el) continue;
    el.checked = true;
    if (marcada.foco) el.focus({ preventScroll: true });
  }
  // A busca do seletor de contatos e a do marketplace só existem nas telas que não são conversa (casca inteira).
  if (muda.cascaMuda) {
    filtrarBots((document.getElementById("busca-destinatario") as HTMLInputElement | null)?.value ?? "", ".contact-picker");
    filtrarApps((document.getElementById("busca-marketplace") as HTMLInputElement | null)?.value ?? "");
  }
  for (const el of escopo.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]")) if (abertos.includes(el.dataset.disclosure)) el.open = true;
  if (muda.historicoMuda) artefatos.hidratar(timeline ?? document);
  if ((muda.historicoMuda || muda.cascaMuda) && t.tipo === "conversa") contarLinhasMostradas();
  rolagem.depoisDeDesenhar(t.tipo === "conversa" || t.tipo === "sala" ? t.conversaId : t.tipo === "trabalho" ? `trabalho:${t.id}` : null, muda.historicoMuda || muda.cascaMuda);
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
  // ADR-094: no celular o texto de ajuda inteiro quebrava em duas linhas dentro do campo; lá fica o curto, e o leitor de
  // tela continua ouvindo o completo.
  const placeholder = celular.ativo() ? (a.resposta ? "Sua resposta" : "Mensagem") : a.placeholder;
  if (ta.placeholder !== placeholder) ta.placeholder = placeholder;
  if (ta.getAttribute("aria-label") !== a.placeholder) ta.setAttribute("aria-label", a.placeholder);
  if (nota && nota.textContent !== a.nota) nota.textContent = a.nota;
  // A dica de sempre ("Enter envia · Shift+Enter…") é de teclado de computador; o celular a esconde (web/mobile.css).
  nota?.classList.toggle("nota-padrao", a.nota === (nota.dataset.padrao ?? ""));
  const clipe = caixa.querySelector<HTMLButtonElement>('[data-act="anexar"]');
  if (clipe) {
    clipe.disabled = a.anexoBloqueado !== null;
    const titulo = a.anexoBloqueado ?? clipe.dataset.titulo ?? "";
    if (titulo) clipe.title = titulo;
    else clipe.removeAttribute("title");
  }
  atualizarModoNoComposer();
}

/**
 * ADR-059: o chip do modo de aprovação e o aviso acima do campo seguem o bot da conversa. O composer não se regrava
 * (ADR-020), então o miolo do chip é trocado no próprio nó, só quando muda — o texto digitado fica onde está.
 */
function atualizarModoNoComposer(): void {
  const chip = document.getElementById("composer-modo") as HTMLButtonElement | null;
  const t = estado.tela;
  const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
  if (!chip) return;
  if (!bot) { chip.hidden = true; regiao("composer-aviso", ""); return; }
  const modo = bot.modoAprovacao ?? "manual";
  const dona = bot.ownerId === estado.sessao?.pessoaId;
  const r = renderChipModo(modo, dona);
  chip.hidden = false;
  if (chip.dataset.modo !== modo || chip.dataset.dona !== String(dona)) {
    chip.innerHTML = r.html;
    chip.dataset.modo = modo;
    chip.dataset.dona = String(dona);
    chip.title = r.titulo;
    chip.setAttribute("aria-label", `Aprovações: ${r.titulo}`);
    chip.setAttribute("aria-disabled", String(!dona));
  }
  regiao("composer-aviso", avisoFechado(modo) ? "" : renderAvisoModo(bot.nome, modo));
}

function abrirModoAprovacao(el: HTMLElement): void {
  const t = estado.tela;
  const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
  if (!bot || bot.ownerId !== estado.sessao?.pessoaId) return;
  // revisto em 2026-10-06: trocar de modo não reabre o aviso fechado — a linha de sistema na conversa já confirma a troca.
  abrirMenuModo(el, bot.nome, bot.modoAprovacao ?? "manual", (modo) => {
    void agir(async () => { await mudarGestao(() => api!.mudarModoAprovacao(bot.id, modo)); });
  });
}

/**
 * Entrada (ADR-030). A recusa do Google é UMA mensagem para todos os motivos — o servidor não diz se
 * foi domínio, cadastro ou verificação, e a tela também não, para não contar a quem está de fora quem tem acesso.
 */
/** ADR-069: o pedido do app do Mac sobrevive à ida ao Google na sessionStorage desta aba. */
function pedidoPendente(): PedidoPareamento | null {
  try { return lerGuardado(window.sessionStorage.getItem(CHAVE_GUARDADA)); } catch { return null; }
}
function esquecerPedido(): void {
  try { window.sessionStorage.removeItem(CHAVE_GUARDADA); } catch { /* sem storage, nada guardado */ }
}

function renderEntrada(): string {
  const m = entrada.modo;
  const pedido = pedidoPendente();
  const doMac = pedido ? `<p class="mudo">Depois de entrar, você confirma a conexão do Mac <b>${esc(pedido.nome)}</b>.</p>` : "";
  const recusa = entrada.recusado
    ? `<p class="erro" role="alert">Não foi possível entrar com essa conta. Se ela ainda não tem acesso ao nod, peça para ser cadastrada.</p>`
    : "";
  if (!m) return `<section class="tela entrar"><h1>nod</h1><p class="mudo">carregando…</p></section>`;
  if (m.modo === "google") {
    return `<section class="tela entrar"><h1>nod</h1><p>Entre com a sua conta Google.</p>${doMac}${recusa}<a class="bt pri" href="${esc(sessaoApi.urlGoogle)}">Entrar com Google</a></section>`;
  }
  const pessoas = m.pessoas.length
    ? m.pessoas.map((p, i) => botao("entrar", `Entrar como ${esc(p.nome)}`, { classe: i === 0 ? "pri" : undefined, dados: { pessoa: p.id } })).join(" ")
    : '<p class="mudo">Nenhuma pessoa no cadastro. Rode <code>npm run db:seed</code>.</p>';
  return `<section class="tela entrar"><h1>nod</h1><p>Login de desenvolvimento (só nesta máquina): entre como uma pessoa do cadastro.</p>${pessoas}</section>`;
}

function render(): void {
  // Um redesenho síncrono já cobre o que o quadro pendente ia mostrar.
  if (quadroPendente) {
    window.cancelAnimationFrame(quadroPendente);
    quadroPendente = 0;
  }
  if (!estado.sessao) {
    document.querySelector(".app")?.classList.add("sem-sessao");
    regiao("detalhes", "");
    regiao("sidebar", "");
    regiao("cabecalho", "");
    regiao("timeline", renderEntrada());
    regiao("composer", "");
    rolagem.depoisDeDesenhar(null, true);
    prenderFocoNaGaveta(null);
    return;
  }
  document.querySelector(".app")?.classList.remove("sem-sessao");
  // NOD-122: quem tem o foco quando a gaveta do app abre é para onde ele volta quando ela fecha.
  const gavetaDoApp = gavetaPrendeFoco(estado.tela);
  if (gavetaDoApp && !gavetaMontada) origemDaGaveta = origemDoFoco();
  if (!arrastandoBot) redesenharSidebar();
  // Seu espaço é uma camada por cima: a tela de baixo continua montada e fica inerte (nem foco, nem clique) enquanto ela está aberta.
  regiaoReabrindo("espaco", estado.espaco ? renderEspaco(estado, ambienteBanco, canalAvisos.estado(), voltaDaTela(estado, estado.tela)) : "");
  document.getElementById("espaco")?.toggleAttribute("hidden", !estado.espaco);
  // A ligação em tela cheia também deixa a .app (e Seu espaço) inerte; a pílula não: a pessoa usa o nod com a ligação aberta.
  // O onboarding por cima (olá, IA do Mac, "está te ligando") também deixa a .app inerte (ADR-077).
  const camadaOnboarding = telaOnboarding.camada();
  const devolverFoco = regiaoMudaria("onboarding", camadaOnboarding) ? guardarFocoDaCamada(document.getElementById("onboarding")) : null;
  regiao("onboarding", camadaOnboarding);
  devolverFoco?.();
  document.getElementById("onboarding")?.toggleAttribute("hidden", camadaOnboarding === "");
  document.querySelector(".app")?.toggleAttribute("inert", !!estado.espaco || telaLigacao.cheia() || telaOnboarding.cobre());
  document.getElementById("espaco")?.toggleAttribute("inert", telaLigacao.cheia());
  telaLigacao.render();
  const retomar = ligacaoParaRetomar;
  if (retomar && botGerido(retomar.agenteId)) {
    ligacaoParaRetomar = null;
    queueMicrotask(() => telaLigacao.retomar(retomar));
  }
  renderPrincipal();
  prenderFocoNaGaveta(gavetaDoApp);
}

/**
 * NOD-122 (web/lib/foco-gaveta.ts): com a gaveta do app aberta, o resto da `.app` fica inerte e o Tab circula só nela.
 * A `.app` em si não fica inerte, porque a gaveta mora dentro dela. Ao abrir, o foco vai ao × da gaveta; ao fechar
 * (×, "Pronto", fundo ou Esc), volta a quem a abriu. Refeito a cada render, porque a grade é regravada.
 */
let gavetaMontada: string | null = null;
let origemDaGaveta: { act?: string; id?: string } | null = null;
let inertesDaGaveta: Element[] = [];
/** O que o Tab alcança dentro da gaveta (o ciclo de `voltaDoTab`). */
const FOCAVEIS_DA_GAVETA = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function origemDoFoco(): { act?: string; id?: string } | null {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLElement) || !ativo.closest(".mkt")) return null;
  return { act: ativo.dataset.act, id: ativo.dataset.id };
}

function prenderFocoNaGaveta(slug: string | null): void {
  for (const el of inertesDaGaveta) el.removeAttribute("inert");
  inertesDaGaveta = [];
  const app = document.querySelector(".app");
  const gaveta = slug ? document.querySelector<HTMLElement>(".tela-conectores .gaveta") : null;
  if (app && gaveta) {
    inertesDaGaveta = irmaosAteARaiz<Element>(gaveta, app, (no) => no.classList.contains("gaveta-fundo"));
    for (const el of inertesDaGaveta) el.setAttribute("inert", "");
  }
  const antes = gavetaMontada;
  gavetaMontada = gaveta ? slug : null;
  if (gavetaMontada && gavetaMontada !== antes) gaveta?.querySelector<HTMLElement>(".gaveta-fechar")?.focus();
  if (antes && !gavetaMontada) {
    const volta = seletoresDaOrigem(origemDaGaveta, antes, CSS.escape).map((s) => document.querySelector<HTMLElement>(s)).find((el) => el);
    volta?.focus();
    origemDaGaveta = null;
  }
}

/**
 * A barra lateral só é refeita quando algo que ela lê muda (definido em 2026-09-30): durante o streaming nada
 * nela muda, e o texto da busca e o filtro das linhas só precisam ser reaplicados quando as linhas são novas
 * (digitar na busca filtra direto, no ouvinte de input).
 */
function redesenharSidebar(): void {
  const html = lembrar("sidebar", estado, [ambienteBanco, buscaAberta, termoBusca() !== "", naFrente(), deixarNaoLida, secoesRecolhidas], renderSidebar);
  if (!regiaoMudaria("sidebar", html)) return;
  const busca = document.getElementById("busca-bots") as HTMLInputElement | null;
  const valorBusca = busca?.value ?? "";
  const focoBusca = document.activeElement === busca;
  const rolagem = document.querySelector<HTMLElement>("#sidebar .list")?.scrollTop ?? 0;
  regiao("sidebar", html);
  const novaBusca = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (novaBusca) { novaBusca.value = valorBusca; if (focoBusca) novaBusca.focus({ preventScroll: true }); }
  filtrarBots(valorBusca);
  manterRolagemDaBarra(rolagem);
}

/** A conversa cuja linha já foi trazida à vista: a barra só rola sozinha quando a conversa aberta muda. */
let conversaNaVistaDaBarra: string | null = null;

/**
 * definido em 2026-10-06 (web/lib/rolagem-barra.ts): a lista refeita volta à rolagem de antes; com conversa nova aberta,
 * a linha dela entra na vista com o mínimo de movimento. Mede depois do filtro da busca, que esconde linhas.
 */
function manterRolagemDaBarra(anterior: number): void {
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  if (!lista) return;
  const t = estado.tela;
  const conversa = t.tipo === "conversa" || t.tipo === "sala" ? t.conversaId : null;
  const el = conversa && conversa !== conversaNaVistaDaBarra ? lista.querySelector<HTMLElement>('[aria-current="true"]') : null;
  let linha: Faixa | null = null;
  if (el && el.offsetParent !== null) {
    const r = el.getBoundingClientRect();
    const caixa = lista.getBoundingClientRect();
    // Coordenadas do conteúdo da lista, já com a rolagem de antes.
    linha = { topo: r.top - caixa.top + anterior, base: r.bottom - caixa.top + anterior };
    conversaNaVistaDaBarra = conversa;
  }
  lista.scrollTop = rolagemDaBarra({ anterior, altura: lista.clientHeight, linha });
}

// ---------------------------------------------------------------------------------------------
// Sessão, SSE e relógio.

async function iniciarSessao(escopo: Escopo): Promise<void> {
  conexoes.cancelarTodas();
  // Os rascunhos são da pessoa: outra sessão, outros rascunhos.
  rascunhos.usar(`${escopo.tenantId}.${escopo.pessoaId}`);
  api = criarApi(escopo);
  // Outra sessão, outra fila: a primeira leitura volta a ser só a linha de base.
  avisador.reiniciar();
  canalAvisos.contador(0);
  ambienteBanco = await api.ambiente();
  dispatch({ tipo: "sessao", escopo });
  void api.preferencias().then((p) => {
    hidratarAvisosFechados(p.avisosFechados ?? []);
    if (p.usoDoMac) dispatch({ tipo: "uso-do-mac", uso: p.usoDoMac });
    atualizarModoNoComposer();
    dispatch({ tipo: "modo-dev", ligado: p.modoDev });
    const c = conversaDaTela(estado);
    if (p.modoDev && c) void carregarRaioX(c.conversa.id);
  }, () => undefined);
  // Outra sessão: a ligação da anterior sai da tela (o servidor a encerra se ninguém voltar em 10 s).
  telaLigacao.descartar();
  telaOnboarding.descartar();
  ligacaoParaRetomar = null;
  void api.ligacaoViva().then(({ ligacao }) => {
    if (ligacao && (ligacao.estado === "chamando" || ligacao.estado === "em_curso")) { ligacaoParaRetomar = ligacao; render(); }
  }, () => undefined);
  live?.disconnect();
  live = criarLiveEvents(api.urlEventos, {
    aoReidratar: () => dispatch({ tipo: "invalidar", quais: invalidacoesAoRetomar(estado) }),
  });
  live.subscribe((ev) => {
    if (ev.tipo === "frame") receberFrame(ev.frame);
    else if (ev.tipo === "conexao") dispatch({ tipo: "conexao", estado: ev.estado, tentativa: ev.tentativa, proximaEmMs: ev.proximaEmMs });
  });
  live.connect();
  dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "nao-lidos", "salas", "executor", "rotinas"] });
  const pedido = pedidoPendente();
  if (pedido) abrirPareamento(api, pedido, esquecerPedido);
  // #195: a task que estava aberta antes de recarregar volta aberta.
  const task = taskLembrada();
  if (task) navegar(task);
}

/**
 * Revisão do #228 (2026-10-09): regrava a região e reabre os `<details data-disclosure>` que estavam abertos, devolvendo
 * o foco ao que o tinha. Este Mac é relida a cada 30 s (ADR-091), e o "porquê" aberto pela pessoa fechava sozinho.
 */
function regiaoReabrindo(id: string, html: string): void {
  const raiz = document.getElementById(id);
  if (!raiz || !regiaoMudaria(id, html)) return regiao(id, html);
  const abertos = new Set([...raiz.querySelectorAll<HTMLDetailsElement>("details[data-disclosure][open]")].map((el) => el.dataset.disclosure));
  const ativo = document.activeElement instanceof HTMLElement && raiz.contains(document.activeElement) ? document.activeElement.closest<HTMLDetailsElement>("details[data-disclosure]")?.dataset.disclosure ?? null : null;
  regiao(id, html);
  for (const el of raiz.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]")) {
    if (abertos.has(el.dataset.disclosure)) el.open = true;
    if (ativo !== null && el.dataset.disclosure === ativo) el.querySelector("summary")?.focus();
  }
}

/** ADR-090: o código de pareamento da máquina que veio na URL, guardado até a sessão existir. */
const CHAVE_CODIGO_MAQUINA = "nod-parear-maquina";
async function boot(): Promise<void> {
  dispatch({ tipo: "tick", agora: Date.now() });
  let ticks = 0;
  window.setInterval(() => {
    ticks += 1;
    // definido em 2026-09-24 ("aviso no Mac"): a decisora designada que não é dona não recebe frame
    // decisao.* (o outbox manda à dona); sem isto o pedido dela só aparecia — e só avisava — quando
    // outra coisa relesse "Sua vez".
    if (ticks % TICKS_POR_RELEITURA === 0 && estado.sessao) estado = reduzir(estado, { tipo: "invalidar", quais: ["sua-vez"] });
    // ADR-091 (definido em 2026-10-09): o uso da CPU muda a cada leitura sem mudar de nível (e só a mudança de nível vira
    // frame) — com Este Mac aberta, os números são relidos a cada 30 s, a batida do amostrador.
    // Revisto em 2026-10-09: também com Máquinas aberta, que mostra a leitura de cada máquina.
    if (ticks % 2 === 0 && estado.sessao && (estado.espaco?.secao === "este-mac" || estado.espaco?.secao === "maquinas")) estado = reduzir(estado, { tipo: "invalidar", quais: ["trabalhos"] });
    dispatch({ tipo: "tick", agora: Date.now() });
  }, 15_000);
  const url = new URL(window.location.href);
  const pedidoNaUrl = lerPedido(url.searchParams);
  if (url.searchParams.has(PARAMETROS_DO_PEDIDO[0])) {
    if (pedidoNaUrl) { try { window.sessionStorage.setItem(CHAVE_GUARDADA, JSON.stringify(pedidoNaUrl)); } catch { /* sem storage: o diálogo não abre e o app espera até o prazo */ } }
    for (const k of PARAMETROS_DO_PEDIDO) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // ADR-090: o link que o motor mostra no terminal (`?parear-maquina=K7QM-4F2X`) abre Máquinas › Conectar com o código,
  // depois do login se preciso (fica na sessionStorage da aba até a sessão existir).
  const codigoMaquina = url.searchParams.get("parear-maquina");
  if (codigoMaquina !== null) {
    try { window.sessionStorage.setItem(CHAVE_CODIGO_MAQUINA, codigoMaquina.slice(0, 16)); } catch { /* sem storage: a pessoa digita o código */ }
    url.searchParams.delete("parear-maquina");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  if (url.searchParams.get("entrar") === "recusado") {
    entrada = { ...entrada, recusado: true };
    url.searchParams.delete("entrar");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  try {
    await iniciarSessao(await sessaoApi.atual());
    abrirCodigoDeMaquinaGuardado();
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
    abrirMarketplace(true);
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
  const antes = estado.tela;
  celular.fecharBots();
  // A gaveta aberta só para um nível (ou a sobreposta, na janela estreita) fecha quando a conversa muda.
  if (tela.tipo !== "conversa" || antes.tipo !== "conversa" || antes.conversaId !== tela.conversaId) {
    painelAbertoNaHora = false;
    document.querySelector(".app")?.classList.remove("detalhes-abertos");
  }
  linhaEm = tela.tipo === "conversa" || tela.tipo === "sala" ? tela.conversaId : null;
  deixarNaoLida = null;
  // A linha "Novas" some ao navegar (reducer); a conta das levas vai junto.
  levaContada.clear();
  dispatch({ tipo: "navegar", tela });
  lembrarTaskAberta(tela);
  lerConversaDaTela();
  if (tela.tipo !== "conversa" && tela.tipo !== "sala") document.getElementById("timeline")?.scrollTo({ top: 0 });
}

/**
 * definido em 2026-10-04: o Marketplace lembra de onde a pessoa veio para o "‹ <de onde veio>" do topo, como Seu espaço.
 * Andar dentro dele (Avançado, voltar ao Marketplace, clicar no botão de novo) não esquece a origem.
 */
function abrirMarketplace(avancado = false): void {
  const t = estado.tela;
  const voltar = t.tipo === "conectores" ? t.voltar : t.tipo === "inicio" ? undefined : t;
  navegar({ tipo: "conectores", ...(avancado ? { avancado: true as const } : {}), ...(voltar ? { voltar } : {}) });
}

/** Abre a tela da task; de dentro de outra task (ou de uma linha), o Fechar continua voltando para a tela de fora. */
function abrirTrabalho(id: string): void {
  if (id) navegar(telaDaTask(estado.tela, id));
}

function fecharTask(): void {
  const voltar = telaAoFechar(estado.tela);
  if (voltar) navegar(voltar);
}

async function mudarGestao(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao", "rotinas", "salas", "sua-vez"] });
  } catch (e) { dispatch({ tipo: "erro", erro: erroDe(e) }); throw e; }
}

function acaoDoBot(a: BotGerido, acao: AcaoGestao): void {
  const executar = (fn: () => Promise<unknown>) => void agir(async () => { await mudarGestao(fn); });
  if (acao === "perfil") { abrirNivel(a.id, { tipo: "perfil" }); return; }
  if (acao === "renomear") {
    pedirGestao("Renomear bot", `<label>Nome<input name="nome" value="${esc(a.nome)}" required maxlength="60" /></label>`, "Salvar", async (d) => mudarGestao(() => api!.editarPerfil(a.id, { nome: String(d.get("nome")) }))); return;
  }
  if (acao === "mover") {
    const secoes = [...new Set((estado.gestao?.agentes ?? estado.frota?.agentes ?? []).filter((b) => b.ownerId === estado.sessao?.pessoaId && !b.excluidoEm).map((b) => b.secao).filter(Boolean))];
    pedirGestao("Mover para", `<p>Escolha uma seção ou escreva um novo nome. Deixe vazio para tirar da seção.</p><label>Seção<input name="secao" value="${esc(a.secao ?? "")}" maxlength="60" list="secoes-bots" placeholder="Sem seção" /></label><datalist id="secoes-bots">${secoes.map((n) => `<option value="${esc(n!)}"></option>`).join("")}</datalist>`, "Mover", async (d) => mudarGestao(() => api!.organizarAgente(a.id, { secao: String(d.get("secao")) }))); return;
  }
  if (acao === "duplicar") {
    // definido em 2026-09-28 (emenda da ADR-034): a dona leva o bot inteiro; bot de equipe de outra pessoa, só o perfil.
    const texto = a.ownerId === estado.sessao?.pessoaId
      ? "<p>A cópia leva perfil, avatar, memória, acessos e rotinas. Rotinas ativas também rodam na cópia. Só o histórico da conversa não vem.</p>"
      : "<p>A cópia mantém perfil e avatar. Rotinas começam pausadas. Como o bot não é seu, memória e acessos ficam com a dona; o histórico também não vem.</p>";
    pedirGestao(`Duplicar ${a.nome}?`, texto, "Duplicar", async () => {
      const r = await api!.duplicar(a.id);
      await mudarGestao(async () => r);
      navegar({ tipo: "conversa", agenteId: r.agente.id, conversaId: r.conversa.id });
    }); return;
  }
  if (acao === "excluir") {
    pedirGestao(`Excluir ${a.nome}?`, "<p>O bot vai para Excluídos. Novos trabalhos serão bloqueados, rotinas pausadas e acessos revogados. Trabalhos em andamento receberão um pedido de interrupção; ações externas já realizadas não podem ser desfeitas.</p><p>Você pode recuperar o perfil e o histórico em Gerenciar agentes.</p>", "Excluir agente", async () => {
      await mudarGestao(() => api!.excluirAgente(a.id)); abrirEspaco("agentes");
    }, true); return;
  }
  if (acao === "copiar") {
    void navigator.clipboard.writeText(a.conversaId).then(() => pedirGestao("ID copiado", `<p>ID da conversa copiado para a área de transferência.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})).catch(() => pedirGestao("ID da conversa", `<p>Selecione e copie o ID abaixo.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})); return;
  }
  if (acao === "ocultar" && !a.oculto) {
    pedirGestao("Ocultar da barra lateral?", "<p>O bot e suas rotinas continuam funcionando. Para trazê-lo de volta, abra Gerenciar agentes → Ocultos.</p>", "Ocultar", async () => {
      await mudarGestao(() => api!.ocultar(a.id, true)); abrirEspaco("agentes");
    }); return;
  }
  if (acao === "nao-lido") {
    // definido em 2026-09-29 (0039): o menu vale pelo "lido até". Marcar a conversa aberta como não lida não pode ser
    // desfeito pela leitura automática: ela fica não lida até a pessoa sair dela.
    const nova = a.naoLido === true;
    if (!nova) deixarNaoLida = a.conversaId;
    void agir(async () => { await (nova ? api!.marcarLida(a.conversaId) : api!.marcarNaoLida(a.conversaId)); dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota"] }); });
    return;
  }
  executar(() => acao === "fixar" ? api!.fixar(a.id, !a.fixado) : acao === "restaurar" ? api!.restaurarAgente(a.id) : api!.ocultar(a.id, false));
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
  const a = [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
  // "Marcar como lido / não lido" no menu segue os não lidos, que chegam a cada mensagem (a frota não).
  return a && estado.naoLidos ? { ...a, naoLido: temNovas(a.conversaId) } : a;
}

function menuDoBot(el: HTMLElement): void {
  const a = botGerido(el.dataset.id);
  // O ⋯ do topo da gaveta abre o menu logo abaixo dele, alinhado pela direita (canvas "Gaveta 1").
  const r = el.getBoundingClientRect();
  const ponto = el.closest("#detalhes") ? { x: r.right - 268, y: r.bottom } : undefined;
  if (a) abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, el, (acao) => acaoDoBot(a, acao), ponto);
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

// ---- o "/" do campo (definido em 2026-09-28; canvas "Comandos /") --------------------------------------------------
// O catálogo vem do servidor (o que o Mac mandou no último turno) e é relido quando a lista abre, no máximo por minuto.
let comandosDto: ComandosDto | null = null;
let comandosLidosEm = 0;
let itensDaBarra: ItemDaBarra[] = [];
let selecionadoNaBarra = 0;

async function carregarComandos(): Promise<void> {
  if (!api || Date.now() - comandosLidosEm < 60_000) return;
  comandosLidosEm = Date.now();
  try {
    comandosDto = await api.comandos();
  } catch {
    // Sem a lista, o campo continua mandando texto: "/nome" ainda roda a skill no Mac.
  }
}

function nomeDoBotDaTela(): string {
  const t = estado.tela;
  return t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "o bot" : "o bot";
}

/** Abre, filtra ou fecha a lista pelo que está no campo; sem lista, a dica diz o que o comando escrito faz. */
function atualizarBarra(ta: HTMLTextAreaElement): void {
  const lista = document.getElementById("barra-lista");
  const dica = document.getElementById("barra-dica");
  if (!lista || !dica) return;
  const filtro = nomeDigitado(ta.value, ta.selectionStart);
  if (filtro !== null) {
    const recentes = recentesDaConversa(conversaDaTela(estado)?.mensagens ?? []);
    const l = listaDaBarra(comandosDto, filtro, recentes);
    itensDaBarra = l.itens;
    selecionadoNaBarra = Math.min(selecionadoNaBarra, Math.max(0, l.itens.length - 1));
    lista.innerHTML = renderListaBarra(l, { filtro, selecionado: selecionadoNaBarra, bot: nomeDoBotDaTela(), doMacEm: comandosDto?.doMacEm ?? null });
    lista.hidden = false;
    dica.hidden = true;
    // A primeira abertura busca a lista; quando ela chega, redesenha com o que estiver no campo.
    if (Date.now() - comandosLidosEm >= 60_000) void carregarComandos().then(() => { if (!lista.hidden) atualizarBarra(ta); });
    return;
  }
  fecharListaBarra();
  const c = comandoNoTexto(comandosDto, ta.value);
  dica.innerHTML = c ? renderDicaBarra(c, nomeDoBotDaTela()) : "";
  dica.hidden = !c;
}

function fecharListaBarra(): void {
  const lista = document.getElementById("barra-lista");
  if (lista) lista.hidden = true;
  itensDaBarra = [];
  selecionadoNaBarra = 0;
}

/** Troca o nome digitado pelo escolhido, deixa o cursor depois dele e mostra a dica. */
function escolherNaBarra(ta: HTMLTextAreaElement, item: ItemDaBarra): void {
  const depois = ta.value.slice(ta.selectionStart).replace(/^\S*/, "");
  const inicio = `/${item.nome} `;
  ta.value = inicio + depois.trimStart();
  ta.selectionStart = ta.selectionEnd = inicio.length;
  fecharListaBarra();
  atualizarBarra(ta);
  ta.focus();
}

/** Com a lista aberta, as setas andam, Enter e Tab escolhem, Esc fecha. Devolve true quando tratou a tecla. */
function teclaNaBarra(ev: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
  const lista = document.getElementById("barra-lista");
  if (!lista || lista.hidden) return false;
  if (ev.key === "Escape") { fecharListaBarra(); return true; }
  if (itensDaBarra.length === 0) return false;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    selecionadoNaBarra = (selecionadoNaBarra + (ev.key === "ArrowDown" ? 1 : itensDaBarra.length - 1)) % itensDaBarra.length;
    atualizarBarra(ta);
    lista.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return true;
  }
  if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Tab") {
    const item = itensDaBarra[selecionadoNaBarra];
    if (item) escolherNaBarra(ta, item);
    return true;
  }
  return false;
}

/**
 * Os comandos que o nod resolve sem turno: /nova-sessao zera a sessão do bot (o /clear do CLI não esquece — medido)
 * e /modelo abre a escolha de modelo e esforço. Os outros seguem como mensagem: o servidor põe o nome do CLI.
 */
async function comandoDoNod(texto: string, alvo: { conversaId: string; salaId?: string | null }): Promise<boolean> {
  const c = comandoNoTexto(comandosDto, texto);
  if (!c || !("conversa" in c) || alvo.salaId || !api) return false;
  const t = estado.tela;
  if (c.conversa.acao === "nod") {
    const a = api;
    await agir(async () => {
      await a.novaSessao(alvo.conversaId);
      dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    });
    return true;
  }
  if (c.conversa.acao === "tela" && t.tipo === "conversa") {
    abrirInteligencia(t.agenteId);
    return true;
  }
  return false;
}

/** A altura do campo acompanha o texto, até 170 px. */
function ajustarAltura(ta: HTMLTextAreaElement): void {
  ta.style.height = "auto";
  ta.style.height = `${Math.min(ta.scrollHeight, 170)}px`;
}

/**
 * Depois de enviar, o campo e o rascunho só se esvaziam se ainda têm o texto enviado: o que a pessoa digitou enquanto
 * a mensagem ia ao servidor, ou numa conversa para onde ela foi no meio, fica onde está.
 */
function limparDepoisDeEnviar(ta: HTMLTextAreaElement, chave: string | null, texto: string): void {
  const naTela = ta.isConnected && composerDe === chave;
  if (naTela && ta.value.trim() === texto) {
    ta.value = "";
    ta.style.height = "auto";
    atualizarBarra(ta);
  }
  if (!chave) return;
  if (naTela) rascunhos.guardar(chave, ta.value);
  else if (rascunhos.ler(chave).trim() === texto) rascunhos.guardar(chave, "");
}

/** O campo da tela da task (#195): o texto vai para a task (`POST trabalhos/:id/mensagens`), nunca para a conversa. */
async function enviarParaTrabalho(id: string): Promise<void> {
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const chave = composerDe;
  const texto = ta?.value.trim() ?? "";
  if (!ta || !api || !texto) return;
  const a = api;
  rolagem.colar();
  // Revisão W3 (2026-10-08): Enter + botão não mandam o mesmo recado duas vezes (a rota da task não leva `idEnvio`).
  await enviarUmaVez(envios, `trabalho:${id}`, texto, () => agir(async () => {
    await a.escreverNoTrabalho(id, texto);
    limparDepoisDeEnviar(ta, chave, texto);
    dispatch({ tipo: "invalidar", quais: [`trabalho:${id}`, "trabalhos"] });
  }));
}

async function enviarComposer(): Promise<void> {
  // ADR-095: com o ditado gravando, o ↑ (e o Enter) param a gravação e enviam o texto direto, sem prévia.
  if (ditado.ativo()) return ditado.concluir("enviar");
  const tela = estado.tela;
  if (tela.tipo === "trabalho") return enviarParaTrabalho(tela.id);
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const chave = composerDe;
  const alvo = conversaAtual();
  if (!ta || !alvo || !api) return;
  const texto = ta.value.trim();
  const fila = alvo.salaId ? [] : anexosPendentes.get(alvo.conversaId) ?? [];
  // Não sai com arquivo pela metade: o clique espera o upload terminar (o chip mostra a barra).
  if (fila.some((i) => i.estado === "enviando")) return;
  const ids = fila.flatMap((i) => (i.estado === "pronto" && i.meta ? [i.meta.id] : []));
  if (!texto && ids.length === 0) return;
  // Quem manda mensagem quer ver a própria mensagem e a resposta: a conversa volta a acompanhar o fim.
  rolagem.colar();
  // definido em 2026-09-24 (emenda da ADR-045): com pergunta aberta, a mensagem RESPONDE por
  // POST decisoes/:id/responder (a retomada nasce lá), salvo "Outro assunto".
  if (ids.length === 0 && (await comandoDoNod(texto, alvo))) {
    limparDepoisDeEnviar(ta, chave, texto);
    return;
  }
  const destino = destinoDoEnvio(modoDoComposer(estado, alvo.conversaId));
  const a = api;
  // Só a mensagem comum leva chave; com um envio dela em voo nesta conversa, o segundo (Enter + botão) é ignorado.
  const comum = destino.tipo === "mensagem" && !alvo.salaId;
  const idEnvio = comum ? envios.iniciar(alvo.conversaId, texto, ids) : undefined;
  if (idEnvio === null) return;
  await agir(async () => {
    let enviou = false;
    let r: Awaited<ReturnType<typeof enviarPeloComposer>>;
    try {
      r = await enviarPeloComposer(a, alvo, destino, texto, ids, idEnvio);
      enviou = true;
    } finally {
      if (idEnvio) envios.concluir(alvo.conversaId, enviou);
    }
    if ("recusado" in r) {
      recusarAnexoNaResposta();
      return;
    }
    limparDepoisDeEnviar(ta, chave, texto);
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
  rolagem.soltar();
  balao.scrollIntoView({ block: "center", behavior: comportamentoDaRolagem(movimentoReduzido()) });
  balao.classList.add("realce");
  window.setTimeout(() => balao.classList.remove("realce"), 1600);
}

/** "Ver aprovação" (definido em 2026-10-03): da lista "N coisas esperam você" ao card do pedido na timeline. */
function verDecisao(decisaoId: string): void {
  const id = CSS.escape(decisaoId);
  const card = document.querySelector<HTMLElement>(`[data-decisao="${id}"], [data-proposta="${id}"]`);
  if (!card) return;
  rolagem.soltar();
  card.scrollIntoView({ block: "center", behavior: comportamentoDaRolagem(movimentoReduzido()) });
  card.classList.add("realce");
  window.setTimeout(() => card.classList.remove("realce"), 1600);
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

/** O que está marcado no cartão de liberar apps (card-liberar.ts): cada app marcado com o nível do seletor dele. */
function escolhasDoCardLiberar(card: HTMLElement | null): (EscolhaLiberar & { conectorId: string })[] {
  if (!card) return [];
  return [...card.querySelectorAll<HTMLInputElement>("input[data-liberar-app]:checked")].map((cb) => {
    const conectorId = cb.dataset.liberarApp ?? "";
    const nivel = card.querySelector<HTMLSelectElement>(`select[data-liberar-nivel="${CSS.escape(conectorId)}"]`)?.value;
    return { conectorId, slug: cb.dataset.slug ?? "", nivel: nivel === "escrita" ? "escrita" : "leitura" };
  });
}

/**
 * O botão e a lista pode/não pode do cartão seguem o que a pessoa marca, no lugar: o cartão não é redesenhado (o foco
 * fica no controle que ela acabou de mexer) e o HTML do bloco continua o mesmo para o render por blocos.
 */
function atualizarCardLiberar(card: HTMLElement): void {
  const escolhas = escolhasDoCardLiberar(card);
  const permitir = card.querySelector<HTMLElement>('[data-act="liberar-apps"]');
  if (permitir) permitir.textContent = rotuloPermitir(escolhas);
  const lista = card.querySelector(".pode-nao");
  if (lista) lista.outerHTML = listaDoQuePodem(estado, escolhas);
}

function filtrarApps(texto: string): void {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-app-busca]")];
  for (const el of cards) el.hidden = !el.dataset.appBusca?.includes(texto.trim().toLowerCase());
  // ADR-057: a seção "Mais apps" some inteira quando a busca não deixa nenhum cartão dela.
  for (const secao of document.querySelectorAll<HTMLElement>("[data-secao-apps]")) secao.hidden = !secao.querySelector("[data-app-busca]:not([hidden])");
  const vazio = document.getElementById("marketplace-vazio");
  if (vazio) vazio.hidden = cards.some((el) => !el.hidden);
}

/** A escolha de modelo e esforço de um bot da pessoa (o menu da gestão e o /modelo do campo). */
function abrirInteligencia(agenteId: string | undefined): void {
  const a = botGerido(agenteId);
  if (!a || a.ownerId !== estado.sessao?.pessoaId) return;
  // definido em 2026-09-30: com a conversa do bot na tela, a escolha abre na gaveta dele; fora dela, no diálogo.
  if (estado.tela.tipo === "conversa" && estado.tela.agenteId === a.id) { abrirNivel(a.id, { tipo: "inteligencia" }); return; }
  pedirGestao(`Inteligência de ${a.nome}`, renderInteligencia(a, estado.executor?.harnesses, true), "Salvar escolha", async (d) => mudarGestao(() => api!.editarPerfil(a.id, escolhaInteligencia(d))));
}

function filtrarBots(texto: string, raiz = "#sidebar"): void {
  const termo = texto.trim().toLowerCase();
  for (const el of document.querySelectorAll<HTMLElement>(`${raiz} [data-busca]`)) el.hidden = !el.dataset.busca?.includes(termo);
  // Buscando, as seções recolhidas mostram o que casa (navegacao.css) — por atributo, sem redesenhar a barra no meio da
  // digitação: refazer o campo cortava o acento de tecla morta ("´é") e o focusout fechava a busca (definido em 2026-10-04).
  if (raiz === "#sidebar") document.getElementById("sidebar")?.toggleAttribute("data-buscando", termo !== "");
}

const ACOES: Record<string, (el: HTMLElement) => Promise<void> | void> = {
  ...telaOnboarding.acoes,
  "abrir-raio-x": (el) => {
    const t = estado.tela;
    const nome = t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "agente" : "sala";
    if (api && el.dataset.id) void abrirRaioX(api, el.dataset.id, nome, el);
  },
  "alternar-modo-dev": () => agir(alternarModoDev),
  // Modo ligação (definido em 2026-10-04, ADR-071).
  "iniciar-ligacao": () => { const t = estado.tela; if (t.tipo === "conversa") void telaLigacao.ligar(t.agenteId); },
  "ligacao-encolher": () => telaLigacao.encolher(),
  "ligacao-expandir": () => telaLigacao.expandir(),
  "ligacao-mudo": () => telaLigacao.alternarMudo(),
  "ligacao-teclado": () => telaLigacao.alternarTeclado(),
  "ligacao-ajustes": (el) => telaLigacao.abrirAjustes(el),
  "ligacao-desligar": () => telaLigacao.desligar(),
  "ligacao-aprovar": (el) => agir(() => telaLigacao.decidir(el.dataset.id ?? "", true)),
  "ligacao-recusar": (el) => agir(() => telaLigacao.decidir(el.dataset.id ?? "", false)),
  "ligacao-retomar-audio": () => telaLigacao.retomarAudio(),
  "ligacao-sugestao": (el) => { telaLigacao.enviarTexto(el.dataset.texto ?? ""); },
  // Rede de segurança (2026-10-05): a IA do Mac caiu no meio da ligação.
  "ligacao-continuar-ia": (el) => telaLigacao.continuarCom(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli"),
  "ligacao-ia-entrar": (el) => telaLigacao.iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "entrar"),
  "ligacao-ia-instalar": (el) => telaLigacao.iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "instalar"),
  "ligacao-sem-voz": () => telaLigacao.semVoz(),
  "ligacao-avaliar": (el) => telaLigacao.avaliar(el.dataset.nota === "ruim" ? "ruim" : "boa"),
  "ligacao-motivo": (el) => telaLigacao.motivo((el.dataset.motivo ?? "outro") as MotivoAvaliacaoLigacao),
  "ligacao-fechar-avaliacao": () => telaLigacao.fecharAvaliacao(),
  "ligacao-fechar-recusa": () => telaLigacao.fecharRecusa(),
  "ver-transcricao": (el) => {
    const t = estado.tela;
    void telaLigacao.verTranscricao(el.dataset.id ?? "", t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "Bot" : "Bot");
  },
  "apagar-transcricao": (el) => {
    const id = el.dataset.id ?? "";
    const alvo = conversaAtual();
    pedirGestao("Apagar a transcrição?", "<p>O resumo continua na conversa.</p>", "Apagar transcrição", async () => {
      await telaLigacao.apagarTranscricao(id);
      if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    }, true);
  },
  "escolher-tema": (el) => {
    const escolha = el.dataset.tema === "claro" || el.dataset.tema === "escuro" ? el.dataset.tema : "sistema";
    aplicarTema(escolha, document.documentElement);
    // No app do Mac o localStorage some a cada conexão: o tema também vai para o processo principal (nativeTheme).
    void window.nodDesktop?.definirTema?.(escolha).catch(() => undefined);
    for (const b of el.parentElement?.querySelectorAll<HTMLElement>("[data-tema]") ?? []) {
      b.classList.toggle("ativo", b === el);
      b.setAttribute("aria-pressed", String(b === el));
    }
  },
  "relatar-mensagem": (el) => {
    const id = el.dataset.id;
    // definido em 2026-09-21: o correlation_id NÃO vai junto. `estado.erro` é o slot do último erro
    // do app inteiro — pode ser de outra chamada, de vinte minutos atrás, e some quando qualquer
    // agir() dá certo. Carimbar isso no relato mandaria quem investiga para a linha de log errada;
    // o turno e a mensagem já ligam o relato ao que aconteceu.
    if (id && api) abrirReportarBug(api, id, __NOD_VERSAO__, null);
  },
  // ADR-051: o artefato numa janela grande (o mesmo documento, o mesmo estado) e o .html para guardar.
  "artefato-tela-cheia": (el) => agir(() => artefatos.telaCheia(el.dataset.mensagem ?? "")),
  "artefato-baixar": (el) => agir(() => artefatos.baixar(el.dataset.mensagem ?? "")),
  "artefato-nova-aba": (el) => agir(() => artefatos.novaAba(el.dataset.mensagem ?? "")),
  // ADR-053: a tabela do bot vai para a área de transferência com as colunas separadas, pronta para a planilha.
  // definido em 2026-10-03: o rodapé da tabela copia como Planilha, CSV ou JSON (web/lib/texto-formatado.ts rodapeDaTabela).
  "copiar-tabela": async (el) => {
    const antes = el.textContent ?? "";
    const formato = el.dataset.formato === "csv" || el.dataset.formato === "json" ? el.dataset.formato : "tsv";
    try {
      const celulas: unknown = JSON.parse(el.dataset.tabela ?? "[]");
      const linhas = Array.isArray(celulas) ? celulas.map((l) => (Array.isArray(l) ? l.map(String) : [])) : [];
      await navigator.clipboard.writeText(tabelaComo(formato, linhas));
      el.textContent = "Copiada";
    } catch {
      el.textContent = "Não copiou";
    }
    setTimeout(() => { el.textContent = antes; }, 1500);
  },
  entrar: (el) => agir(async () => iniciarSessao(await sessaoApi.entrar(el.dataset.pessoa ?? ""))),
  navegar: (el) => {
    const tela = el.dataset.tela;
    if (tela === "conectores") abrirMarketplace();
    else if (tela === "sua-vez" || tela === "nao-lidos" || tela === "rotinas" || tela === "nova-sala" || tela === "novo-bot" || tela === "nova-rotina" || tela === "trabalhos") navegar({ tipo: tela });
    // As antigas telas da conta são seções de Seu espaço desde 2026-09-30.
    else if (tela === "chaves") abrirEspaco("computadores");
    else if (tela === "relatos") abrirEspaco("relatos");
    else if (tela === "gestao") abrirEspaco("agentes");
    else if (tela === "espaco") abrirEspaco("conexao");
  },
  "menu-conta": (el) => abrirMenuConta(el, dadosMenuConta(), { secao: abrirEspaco, modoDev: async () => { await agir(alternarModoDev); return estado.modoDev.ligado; }, onboarding: () => void telaOnboarding.deNovo() }),
  "secao-espaco": (el) => abrirEspaco((el.dataset.secao as SecaoEspaco | undefined) ?? "conexao"),
  // definido em 2026-10-05 (ia-fora.ts): os botões do aviso "a conta da IA não serve". Só existem dentro do app do Mac;
  // o login abre no navegador e o app percebe sozinho quando termina (testa a conta nova e reanuncia).
  "ia-entrar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void window.nodDesktop?.iaEntrar?.(ia).catch(() => undefined); },
  "ia-conectar": (el) => {
    const ia = el.dataset.ia;
    if (!ehIa(ia)) return;
    const mac = window.nodDesktop;
    void (pedeInstalar(inventarioDaIa(estado, ia)) ? mac?.iaInstalar?.(ia) : mac?.iaEntrar?.(ia))?.catch(() => undefined);
  },
  // NOD-171: "Atualizar" do CLI abaixo do piso. No app do Mac abre a página oficial (o mesmo `iaInstalar`; quem atualiza é a
  // pessoa, no Terminal); fora dele, a seção Conexão, que mostra o comando.
  "ia-atualizar": (el) => {
    const ia = el.dataset.ia;
    const mac = window.nodDesktop;
    if (ehIa(ia) && mac?.iaInstalar) void mac.iaInstalar(ia).catch(() => undefined);
    else abrirEspaco("conexao");
  },
  "copiar-texto": async (el) => {
    const antes = el.textContent ?? "";
    try { await navigator.clipboard.writeText(el.dataset.texto ?? ""); el.textContent = "Copiado"; } catch { el.textContent = "Não copiou"; }
    setTimeout(() => { el.textContent = antes; }, 1500);
  },
  "fechar-espaco": () => fecharEspaco(),
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
  "recolher-secao": (el) => {
    // Buscando, o título é só texto (navegacao.css): a escolha gravada não muda às cegas.
    if (document.getElementById("sidebar")?.hasAttribute("data-buscando")) return;
    const chave = el.dataset.chave ?? "";
    const comFoco = document.activeElement === el;
    secoesRecolhidas = definirSecaoRecolhida(secoesRecolhidas, chave, !secoesRecolhidas.has(chave));
    render();
    // A barra é refeita: quem recolheu pelo teclado continua no mesmo título.
    if (comFoco) document.querySelector<HTMLElement>(`#sidebar .secao-cab[data-chave="${CSS.escape(chave)}"]`)?.focus({ preventScroll: true });
  },
  "abrir-avancado": () => abrirMarketplace(true),
  "navegar-marketplace": () => abrirMarketplace(),
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
  "dar-acesso": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "dar-acesso" }),
  // definido em 2026-10-05: o cartão que oferece liberar apps recém-conectados (card-liberar.ts). Permitir leva os apps
  // marcados com o nível do seletor de cada um; o servidor concede pela rota de pessoa e chama o bot de volta.
  "liberar-apps": (el) => agir(async () => {
    const agenteId = el.dataset.id ?? "";
    const escolhas = escolhasDoCardLiberar(el.closest<HTMLElement>("[data-liberar]"));
    if (escolhas.length === 0) { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Marque pelo menos um app para permitir." } }); return; }
    await api!.liberarApps(agenteId, escolhas.map((e) => ({ conectorId: e.conectorId, nivel: e.nivel })));
    dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`, "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  // "Agora não": a dispensa fica no servidor (0054) e sobrevive a recarregar; o cartão sai quando as concessões voltam.
  "dispensar-liberar": (el) => agir(async () => {
    const agenteId = el.dataset.id ?? "";
    await api!.dispensarLiberacao(agenteId, (el.dataset.conectores ?? "").split(",").filter(Boolean));
    dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`] });
  }),
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
  // definido em 2026-09-25 (card de pasta simplificado): com a lista aberta, a pasta é a opção marcada. O
  // segundo clique enquanto o primeiro corre é ignorado: com a lista, ele podia conceder OUTRA pasta.
  "permitir-pasta": (el) => estado.ocupado ? undefined : agir(async () => {
    const alvo = conversaAtual();
    const pasta = el.dataset.pasta ?? el.closest("[data-proposta]")?.querySelector<HTMLInputElement>("input[data-pasta-de]:checked")?.value;
    if (!alvo || alvo.salaId || !pasta) return;
    await api!.permitirPasta(el.dataset.id ?? "", pasta);
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
  }),
  // A re-renderização troca o botão clicado: o foco vai para a opção marcada (ao abrir a lista) ou para a
  // primeira que "Mostrar mais" revelou, para o teclado e o leitor de tela não caírem no começo da página.
  "lista-de-pasta": (el) => {
    const id = el.dataset.id;
    if (!id) return;
    const todas = el.dataset.lista === "todas";
    dispatch({ tipo: "lista-de-pasta", propostaId: id, lista: todas ? "todas" : "curta" });
    const card = document.querySelector(`[data-proposta="${CSS.escape(id)}"]`);
    const alvo = todas ? card?.querySelectorAll<HTMLElement>("input[data-pasta-de]")[CURTA] : card?.querySelector<HTMLElement>("input[data-pasta-de]:checked");
    alvo?.focus({ preventScroll: true });
  },
  anexar: () => document.getElementById("composer-arquivos")?.click(),
  ditar: () => ditado.comecar(),
  "ditado-parar": () => ditado.concluir("campo"),
  "remover-anexo": (el) => removerAnexo(el.dataset.id ?? ""),
  "abrir-busca": () => abrirBusca(),
  "abrir-bots": () => celular.alternarBots(),
  // O botão some ao ser usado: o foco vai para o campo, e não para o <body>.
  "rolar-para-novas": () => {
    rolagem.irParaNovas();
    document.getElementById("composer-texto")?.focus({ preventScroll: true });
  },
  "alternar-detalhes": () => {
    const app = document.querySelector(".app");
    if (!app) return;
    // Estreita, o painel é sobreposto e abre/fecha a cada vez; larga, esconder é preferência que fica.
    if (window.matchMedia("(max-width: 1099px)").matches) { app.classList.toggle("detalhes-abertos"); return; }
    const oculto = !app.classList.contains("detalhes-ocultos");
    app.classList.toggle("detalhes-ocultos", oculto);
    painelAberto = !oculto;
    painelAbertoNaHora = false;
    try { localStorage.setItem(CHAVE_PAINEL_ABERTO, oculto ? "0" : "1"); } catch { /* sem storage, vale só nesta aba */ }
  },
  "preencher-prompt": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { ta.value = el.dataset.texto ?? ""; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; if (composerDe) rascunhos.guardar(composerDe, ta.value); }
  },
  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): o que é do bot abre DENTRO da gaveta, com ‹ para voltar.
  gaveta: (el) => {
    const nivel = nivelDaGaveta(el.dataset.nivel, el.dataset.id ?? "");
    if (nivel) abrirNivel(el.dataset.agente ?? "", nivel);
  },
  "gaveta-voltar": () => voltarNivel(),
  // definido em 2026-09-24 (emenda da ADR-044): parada pelo pré-voo (`ids.bloqueada`), o teste não roda —
  // a conversa abre com o card de acesso "rotina parada" e o botão que a destrava; "Sua vez" relê.
  "executar-rotina": (el) => agir(async () => {
    const r = await api!.executarRotina(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["rotinas", `execucoes:${el.dataset.id ?? ""}`, ...(r.ids.bloqueada ? (["sua-vez", `conversa:${r.ids.conversaId ?? ""}`] as const) : [])] });
    navegar({ tipo: "conversa", conversaId: r.ids.conversaId ?? "", agenteId: el.dataset.agente ?? "" });
  }),
  "abrir-conversa": (el) => navegar({ tipo: "conversa", conversaId: el.dataset.conversa ?? "", agenteId: el.dataset.agente ?? "" }),
  "marcar-lida": (el) => agir(async () => { await api!.marcarLida(el.dataset.conversa ?? ""); dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota"] }); }),
  "marcar-tudo-lido": () => agir(async () => { await api!.marcarTudoLido(); dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota"] }); }),
  "abrir-sala": (el) => navegar({ tipo: "sala", salaId: el.dataset.sala ?? "", conversaId: el.dataset.conversa ?? "" }),
  "menu-agente": (el) => menuDoBot(el),
  "inteligencia": (el) => abrirInteligencia(el.dataset.id),
  // ADR-059: o chip do campo abre os três modos; o × do aviso o fecha para este bot e este modo.
  "modo-aprovacao": (el) => abrirModoAprovacao(el),
  // Prévia da voz do bot (Editar perfil): toca a amostra do provedor das ligações.
  "ouvir-voz": (el) => {
    const tenant = estado.sessao?.tenantId;
    const voz = el.dataset.voz;
    if (!tenant || !voz) return;
    const vel = el.closest("form")?.querySelector<HTMLInputElement>('input[name="vozVelocidade"]:checked')?.value ?? "1";
    void new Audio(`/api/t/${encodeURIComponent(tenant)}/voz/amostra?voz=${encodeURIComponent(voz)}&velocidade=${encodeURIComponent(vel)}`).play().catch(() => undefined);
  },
  "fechar-aviso-modo": () => {
    const t = estado.tela;
    const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
    if (!bot) return;
    const chave = fecharAviso(bot.modoAprovacao ?? "manual");
    atualizarModoNoComposer();
    // Falhou a gravação: o aviso segue fechado nesta tela (cache) e o próximo fechar tenta de novo.
    void api?.fecharAviso(chave).catch(() => undefined);
  },
  "atualizar-gestao": () => dispatch({ tipo: "invalidar", quais: ["gestao"] }),
  "restaurar-agente": (el) => agir(async () => { await mudarGestao(() => api!.restaurarAgente(el.dataset.id ?? "")); }),
  "ir-perfil": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "perfil" }),
  "ir-memoria": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "memoria" }),
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
  // ADR-083 (#195): com tasks abertas, o Parar do chat para tudo do bot — e mostra a lista antes; sem tasks, igual a antes.
  "parar-conversa": () => {
    const t = estado.tela;
    const tasks = t.tipo === "conversa" ? abertosDoBot(estado, t.agenteId, t.conversaId) : [];
    const parar = (): Promise<void> => agir(async () => {
      const alvo = conversaAtual();
      if (!alvo) return;
      dispatch({ tipo: "faixa", faixa: await api!.pararConversa(alvo.conversaId) });
      // O servidor para as tasks do bot junto (parar.ts); cada uma é pedida de novo, e a que já parou responde sem efeito.
      await Promise.allSettled(tasks.map((x) => api!.pararTrabalho(x.id)));
      dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`, "frota", "trabalhos"] });
    });
    if (tasks.length === 0) return parar();
    const nome = botGerido(t.tipo === "conversa" ? t.agenteId : undefined)?.nome;
    pedirGestao(textoPararTasks(tasks, nome), `${listaPararTasks(tasks)}<p>${esc(nome ?? "O bot")} para também o que estiver fazendo nesta conversa. O que já foi feito fica.</p>`, tasks.length === 1 ? "Parar a task" : "Parar tudo", parar, true);
  },
  // A tela da task (#195): Parar task para só ela; Fechar (ou Esc) volta para onde a pessoa estava.
  "abrir-trabalho": (el) => abrirTrabalho(el.dataset.id ?? ""),
  "abrir-linha": (el) => {
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.aberta({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
    const trabalho = el.dataset.trabalho;
    if (trabalho) { abrirTrabalho(trabalho); return; }
    const t = estado.tela;
    navegar({ tipo: "linha", conversaId: el.dataset.conversa ?? "", mensagens: (el.dataset.mensagens ?? "").split(",").filter(Boolean), titulo: el.dataset.titulo ?? "", voltar: t.tipo === "trabalho" || t.tipo === "linha" ? t.voltar : t, ...(tipo === "rotina" ? { rotina: true } : {}) });
  },
  "fechar-trabalho": () => fecharTask(),
  "parar-trabalho": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    await api!.pararTrabalho(id);
    dispatch({ tipo: "invalidar", quais: [`trabalho:${id}`, "trabalhos"] });
  }),
  "trabalho-depois": (el) => estado.ocupado ? undefined : agir(async () => {
    await api!.trabalhoDepois(el.dataset.id ?? "", el.dataset.depois ?? "");
    dispatch({ tipo: "invalidar", quais: ["trabalhos", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "trabalho-fazer-aqui": (el) => estado.ocupado ? undefined : agir(async () => {
    await api!.trabalhoFazerAqui(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["trabalhos", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  // ADR-085: Seu espaço › Este Mac. Otimista: a tela muda já; se o servidor recusar, volta ao que estava.
  "uso-do-mac": (el) => {
    const uso = USOS.find((u) => u.id === el.dataset.uso)?.id;
    if (!uso || !api) return;
    const antes = estado.usoDoMac;
    const comFoco = document.activeElement === el;
    // A seção é refeita: quem escolheu pelo teclado continua na escolha (a de antes, se a gravação falhar).
    const focar = (u: string) => { if (comFoco) document.querySelector<HTMLElement>(`[data-act="uso-do-mac"][data-uso="${CSS.escape(u)}"]`)?.focus({ preventScroll: true }); };
    dispatch({ tipo: "uso-do-mac", uso });
    focar(uso);
    void api.gravarPreferencias({ usoDoMac: uso }).then(() => dispatch({ tipo: "invalidar", quais: ["trabalhos"] }), () => { dispatch({ tipo: "uso-do-mac", uso: antes }); focar(antes); });
  },
  // O status do topo da task abre e fecha o cartão do tempo (protótipo "Nod — tempo da task").
  "tempo-task": (el) => {
    const id = el.dataset.id ?? null;
    dispatch({ tipo: "tempo-task", id: id && estado.tempoTaskAberto !== id ? id : null });
  },
  // A pílula abre a faixa e a faixa recolhe na pílula. revisto em 2026-10-09: a escolha vale só enquanto a pessoa está na
  // conversa (o padrão ao entrar é a pílula; reducer.ts, `faixaAbertaAoNavegar`) — não vai mais para as preferências.
  "faixa-trabalhos": (el) => {
    const t = estado.tela;
    dispatch({ tipo: "faixa-trabalhos", agenteId: el.dataset.recolher === "1" || t.tipo !== "conversa" ? null : t.agenteId });
  },
  "filtro-trabalhos": (el) => {
    const f = el.dataset.id;
    if (f === "todos" || f === "voce" || f === "rotinas" || f === "bots") navegar({ tipo: "trabalhos", filtro: f });
  },
  "parar-sala": (el) =>
    agir(async () => {
      dispatch({ tipo: "faixa", faixa: await api!.pararSala(el.dataset.id ?? "") });
      const alvo = conversaAtual();
      if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    }),
  "confirmar-proposta": (el) => agir(async () => void (await api!.confirmarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota", "rotinas", "sua-vez", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // definido em 2026-09-25: como em "permitir-pasta", o clique que chega com outro pedido correndo é ignorado.
  "recusar-proposta": (el) => estado.ocupado ? undefined : agir(async () => void (await api!.recusarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
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
      gavetaSuja = null;
      const li = el.closest("[data-memoria]");
      const texto = li?.querySelector<HTMLInputElement>('[data-campo="texto"]')?.value ?? "";
      const tipo = li?.querySelector<HTMLSelectElement>('[data-campo="tipo"]')?.value as "preferencia" | "fato" | "resumo" | undefined;
      await api!.editarMemoria(el.dataset.agente ?? "", el.dataset.id ?? "", { texto, tipo });
      dispatch({ tipo: "invalidar", quais: [`memoria:${el.dataset.agente ?? ""}`] });
    }),
  "apagar-memoria": (el) => agir(async () => void (gavetaSuja = null, await api!.apagarMemoria(el.dataset.agente ?? "", el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [`memoria:${el.dataset.agente ?? ""}`] }))),
  // ADR-064: o "a fazer" do bot. Abrir e fechar a lista é da tela; Fazer agora e Descartar vão ao servidor, e o clique que
  // chega com outro pedido correndo é ignorado, como em "permitir-pasta".
  "a-fazer": (el) => dispatch({ tipo: "a-fazer", agenteId: el.dataset.agente ?? "", aberto: el.dataset.abrir === "1" }),
  "pendencia-fazer-agora": (el) => estado.ocupado ? undefined : agir(async () => {
    const agenteId = el.dataset.agente ?? "";
    await semConflito(() => api!.fazerPendenciaAgora(agenteId, el.dataset.id ?? ""));
    // A fala "Fazer agora: …" entra na conversa e o bot começa: a lista fecha para a pessoa ver o que acontece.
    dispatch({ tipo: "a-fazer", agenteId, aberto: false });
    dispatch({ tipo: "invalidar", quais: [`pendencias:${agenteId}`, ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "pendencia-descartar": (el) => estado.ocupado ? undefined : agir(async () => {
    const agenteId = el.dataset.agente ?? "";
    await semConflito(() => api!.descartarPendencia(agenteId, el.dataset.id ?? ""));
    dispatch({ tipo: "invalidar", quais: [`pendencias:${agenteId}`] });
  }),
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
  // definido em 2026-09-28 (emenda da ADR-037): aprova este passo e libera o computador até o fim da tarefa.
  "decidir-aprovacao-resto": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? ""), restoDaTarefa: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  "decidir-aprovacao-sempre": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? ""), sempre: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  "decidir-aprovacao-nenhum": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "").map((m) => ({ ...m, selecionado: false })) }), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // 0062: o filtro por tipo da tela Relatos é atributo na seção (o CSS esconde o resto); nada é redesenhado.
  "filtrar-relatos": (el) => {
    const secao = el.closest<HTMLElement>(".relatos");
    if (!secao) return;
    secao.dataset.filtro = el.dataset.filtroTipo ?? "todos";
    for (const b of secao.querySelectorAll<HTMLButtonElement>("[data-act=filtrar-relatos]")) b.setAttribute("aria-pressed", String(b === el));
  },
  // ADR-082: o card do lote do Nod — manda os índices das ações que ficaram marcadas.
  "decidir-lote": (el) => agir(async () => {
    const card = el.closest<HTMLElement>("[data-proposta]");
    const selecionados = [...(card?.querySelectorAll<HTMLInputElement>("input[data-lote-i]") ?? [])].filter((c) => c.checked).map((c) => Number(c.dataset.loteI));
    await api!.decidir(el.dataset.id ?? "", { selecionados });
    dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", "gestao", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "decidir-proposta": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", {}), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  "recusar-decisao": (el) => agir(async () => void (await api!.decidir(el.dataset.id ?? "", { recusar: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta se responde pelo campo da conversa — sem card
  // nem caixa própria. Estes são os gestos em volta dele: o modo, o balão, o toque e a vinda de "Sua vez".
  "composer-responder": (el) => escolherNoComposer(false, el.dataset.id),
  "composer-outro": () => escolherNoComposer(true),
  "ver-pergunta": (el) => verPergunta(el.dataset.id ?? ""),
  "ver-decisao": (el) => verDecisao(el.dataset.id ?? ""),
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
  // ADR-090: Seu espaço › Máquinas.
  // As chaves que JÁ existem precisam estar carregadas: a máquina nova é a que não estava nelas (revisão do PR: sem isso,
  // com a seção ainda carregando, a "nova" seria o Mac e todos os bots iriam para ele).
  "conectar-maquina": () => agir(async () => {
    const chavesAntes = await chavesAtuais();
    dispatch({ tipo: "conectar-maquina", conectar: { passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes, marcados: [] } });
  }),
  "fechar-conectar-maquina": () => dispatch({ tipo: "conectar-maquina", conectar: null }),
  "passo-conectar-maquina": (el) => {
    const passo = el.dataset.passo as NonNullable<typeof estado.conectarMaquina>["passo"];
    // Na escolha dos bots, todos começam marcados: quem conecta uma VM quer tirar o trabalho do Mac.
    const marcados = passo === "bots" && estado.conectarMaquina?.marcados.length === 0 ? botsDaPessoa(estado).map((a) => a.id) : undefined;
    atualizarConectar({ passo, erro: null, ...(marcados ? { marcados } : {}) });
  },
  "ver-codigo-maquina": () => agir(async () => {
    const codigo = document.querySelector<HTMLInputElement>("#codigo-maquina")?.value.trim() ?? "";
    if (!codigo) { atualizarConectar({ erro: "Digite o código que apareceu na máquina." }); return; }
    const pedido = await api!.verDispositivo(codigo).catch(() => null);
    atualizarConectar(pedido ? { passo: "confirmar", codigo, pedido, erro: null } : { codigo, erro: "Esse código não existe ou venceu. Confira na máquina ou rode a instalação de novo." });
  }),
  "aprovar-maquina": () => agir(async () => {
    const c = estado.conectarMaquina;
    if (!c) return;
    const ok = await api!.aprovarDispositivo(c.codigo).then(() => true, () => false);
    if (!ok) { atualizarConectar({ passo: "codigo", erro: "O código venceu. Rode a instalação de novo para pegar outro." }); return; }
    atualizarConectar({ passo: "ias", erro: null });
    void esperarMaquinaNova();
  }),
  "marcar-bot-maquina": (el) => {
    const c = estado.conectarMaquina;
    const id = el.dataset.id ?? "";
    if (c) atualizarConectar({ marcados: c.marcados.includes(id) ? c.marcados.filter((x) => x !== id) : [...c.marcados, id] });
  },
  "marcar-bots-maquina": (el) => atualizarConectar({ marcados: el.dataset.todos === "1" ? botsDaPessoa(estado).map((a) => a.id) : [] }),
  "mover-bots-maquina": () => agir(async () => {
    const c = estado.conectarMaquina;
    const nova = c ? maquinaNova(estado, c) : null;
    if (!c || !nova) return;
    if (c.marcados.length > 0) {
      await api!.moverBots(nova.id, c.marcados);
      // ADR-092: com o servidor no Mac, bot novo continua no Mac — a VM só leva os escolhidos.
      if (!estado.maquinas?.servidorNoMac) await api!.maquinaPadrao(nova.id);
    }
    dispatch({ tipo: "conectar-maquina", conectar: null });
    dispatch({ tipo: "invalidar", quais: ["frota", "maquinas"] });
  }),
  "maquina-do-bot": (el) => agir(async () => {
    await api!.maquinaDoBot(el.dataset.id ?? "", el.dataset.maquina || null);
    dispatch({ tipo: "invalidar", quais: ["frota", "maquinas"] });
  }),
  "maquina-padrao": (el) => agir(async () => {
    await api!.maquinaPadrao(el.dataset.maquina || null);
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  }),
  "rodar-desta-vez": (el) => agir(async () => {
    const conversaId = el.dataset.conversa ?? "";
    await api!.rodarDestaVez(conversaId, el.dataset.maquina ?? "");
    dispatch({ tipo: "invalidar", quais: [`conversa:${conversaId}` as Invalidacao] });
  }),
  reabrir: (el) => agir(async () => void (await api!.reabrir(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  dispensar: (el) => agir(async () => void (await api!.dispensar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // Em série: são poucas, e uma recusa no meio não deixa metade gravada sem a tela saber.
  "limpar-vencidos": (el) => agir(async () => {
    for (const id of (el.dataset.ids ?? "").split(",").filter(Boolean)) await api!.dispensar(id);
    dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  }),
};

const FORMS: Record<string, (form: HTMLFormElement) => Promise<void>> = {
  "onboarding-bot": async (form) => { await telaOnboarding.forms["onboarding-bot"]?.(form); },
  // O teclado da ligação: o texto entra como uma vez da pessoa, sem passar pelo STT.
  "ligacao-texto": async (form) => {
    const campo = form.elements.namedItem("texto") as HTMLInputElement | null;
    if (campo && telaLigacao.enviarTexto(campo.value)) campo.value = "";
    campo?.focus();
  },
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
  "criar-rotina": (form) => { const d = new FormData(form); const naGaveta = !!form.closest("#detalhes"); return agir(async () => {
    const [hora, minuto] = String(d.get("horario")).split(":").map(Number);
    await api!.criarRotina({ agenteId: String(d.get("agenteId")), cron: String(d.get("frequencia")).startsWith("intervalo:") ? `*/${String(d.get("frequencia")).split(":")[1]} * * * *` : d.get("frequencia") === "hora" ? "0 * * * *" : `${minuto} ${hora} * * ${d.get("frequencia")}`, fusoIana: String(d.get("fusoIana")), instrucao: String(d.get("instrucao")), fonte: String(d.get("fonte")), entregavel: String(d.get("entregavel")), limitesAprovacao: String(d.get("limitesAprovacao")), politicaSemDado: String(d.get("politicaSemDado")) });
    dispatch({ tipo: "invalidar", quais: ["rotinas"] });
    // Da gaveta, a rotina criada aparece na visão geral do bot; da tela cheia, na lista de rotinas.
    if (naGaveta) fecharNivel();
    else navegar({ tipo: "rotinas" });
  }); },
  // definido em 2026-09-30: o perfil enxuto da gaveta não traz a escolha de modelo — sem o campo, ela não muda (antes,
  // o formulário sem "inteligencia" voltaria o bot para Automático).
  "editar-perfil": (form) => {
    const d = new FormData(form);
    return agir(async () => {
      await api!.editarPerfil(form.dataset.id ?? "", { nome: String(d.get("nome") ?? ""), titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? ""), ...(d.has("inteligencia") ? escolhaInteligencia(d) : {}), forma: String(d.get("forma")) as FormaAgente, cor: String(d.get("cor")) as CorAgente });
      // ADR-071: a voz nas ligações mora em rota própria (vale na próxima frase de uma ligação em curso).
      const voz = VOZES.find((v) => v.id === d.get("voz"))?.id;
      const vozVelocidade = VELOCIDADES.find((v) => String(v) === d.get("vozVelocidade"));
      if (voz || vozVelocidade) await api!.ajustarVoz(form.dataset.id ?? "", { ...(voz ? { voz } : {}), ...(vozVelocidade ? { vozVelocidade } : {}) });
      dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
      fecharNivel();
    });
  },
  inteligencia: (form) => {
    const d = new FormData(form);
    return agir(async () => {
      await mudarGestao(() => api!.editarPerfil(form.dataset.id ?? "", escolhaInteligencia(d)));
      fecharNivel();
    });
  },
  "criar-memoria": (form) =>
    agir(async () => {
      const d = new FormData(form);
      await api!.criarMemoria(form.dataset.id ?? "", String(d.get("tipo") ?? "fato") as "preferencia" | "fato" | "resumo", String(d.get("texto") ?? ""));
      form.reset();
      gavetaSuja = null;
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

instalarDicaDeLink(document);

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
  if (cb.matches("[data-liberar-app], [data-liberar-nivel]")) {
    const card = cb.closest<HTMLElement>("[data-liberar]");
    if (card) atualizarCardLiberar(card);
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
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "d" && estado.sessao) { ev.preventDefault(); void agir(alternarModoDev); return; }
  if (ev.key === "Escape" && (ev.target as HTMLElement).id === "busca-bots") { fecharBusca(); return; }
  // ADR-095: Esc com o ditado aberto joga a gravação fora (no campo fica o que já estava escrito).
  if (ev.key === "Escape" && ditado.ativo() && !(ev.target as HTMLElement).closest?.("dialog")) { ev.preventDefault(); ditado.descartar(); return; }
  // Esc na ligação em tela cheia encolhe para a pílula; nunca desliga (definido em 2026-10-04).
  if (ev.key === "Escape" && telaLigacao.cheia() && !(ev.target as HTMLElement).closest?.("dialog")) { ev.preventDefault(); telaLigacao.encolher(); return; }
  if (ev.key === "Escape" && estado.espaco && !(ev.target as HTMLElement).closest?.("dialog")) { ev.preventDefault(); fecharEspaco(); return; }
  // definido em 2026-09-25 (revisão do PR #68): Esc fecha a gaveta do app e o "+ Dar acesso" do painel.
  if (ev.key === "Escape" && estado.tela.tipo === "conectores" && estado.tela.gaveta) { ev.preventDefault(); void ACOES["fechar-gaveta"]?.(document.body); return; }
  // NOD-122: com a gaveta aberta o Tab dá a volta nela, em vez de sair para a barra do navegador.
  if (ev.key === "Tab" && gavetaMontada && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
    const gaveta = document.querySelector<HTMLElement>(".tela-conectores .gaveta");
    const focaveis = gaveta ? [...gaveta.querySelectorAll<HTMLElement>(FOCAVEIS_DA_GAVETA)].filter((el) => el.getClientRects().length > 0) : [];
    const alvo = voltaDoTab(focaveis.length, focaveis.indexOf(document.activeElement as HTMLElement), ev.shiftKey);
    if (alvo !== null) { ev.preventDefault(); focaveis[alvo]?.focus(); return; }
  }
  // Sem gaveta, Esc no Marketplace volta para onde a pessoa estava (definido em 2026-10-04) — menos digitando num campo.
  if (ev.key === "Escape" && estado.tela.tipo === "conectores" && estado.tela.voltar && !(ev.target as HTMLElement).closest?.("dialog, input, textarea, select")) { ev.preventDefault(); void ACOES["voltar-conexao"]?.(document.body); return; }
  // A tela da task (e a provisória de uma linha) fecha no Esc — menos com algo digitado no campo dela.
  if (ev.key === "Escape" && (estado.tela.tipo === "trabalho" || estado.tela.tipo === "linha") && !(ev.target as HTMLElement).closest?.("dialog, input, select, #detalhes") && !((ev.target as HTMLTextAreaElement).id === "composer-texto" && (ev.target as HTMLTextAreaElement).value.trim())) { ev.preventDefault(); fecharTask(); return; }
  // Esc dentro da gaveta, num nível interno, volta um nível (o mesmo ‹ do topo).
  if (ev.key === "Escape" && estado.gaveta && (ev.target as HTMLElement).closest?.("#detalhes")) { ev.preventDefault(); voltarNivel(); return; }
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.id !== "composer-texto") return;
  if (teclaNaBarra(ev, ta)) { ev.preventDefault(); return; }
  // Esc com o campo respondendo: a próxima mensagem vira mensagem comum (o mesmo "Outro assunto").
  if (ev.key === "Escape") {
    const alvo = conversaAtual();
    if (alvo && emModoResposta(alvo.conversaId)) {
      ev.preventDefault();
      escolherNoComposer(true);
    }
    return;
  }
  if (enterEnvia(ev, celular.ativo())) {
    ev.preventDefault();
    void enviarComposer();
  }
});

document.addEventListener("input", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
  if (ta.closest?.("#detalhes") && estado.gaveta) gavetaSuja = chaveDaGaveta();
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
  ajustarAltura(ta);
  if (composerDe) rascunhos.guardar(composerDe, ta.value);
  atualizarBarra(ta);
  const caixa = document.getElementById("autocomplete");
  if (!caixa) return;
  const sugestoes = JSON.parse(ta.dataset.sugestoes ?? "[]") as string[];
  const m = /(^|\s)@([\p{L}\d_-]*)$/u.exec(ta.value.slice(0, ta.selectionStart));
  const lista = m ? sugestoes.filter((n) => n.toLowerCase().startsWith((m[2] ?? "").toLowerCase())) : [];
  caixa.hidden = lista.length === 0;
  caixa.innerHTML = lista.map((n) => `<button type="button" class="sug" data-nome="${esc(n)}">@${esc(n)}</button>`).join("");
});

document.addEventListener("mousedown", (ev) => {
  const item = (ev.target as HTMLElement).closest<HTMLElement>(".barra-item");
  const campo = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (item && campo) {
    ev.preventDefault();
    const escolhido = itensDaBarra[Number(item.dataset.indice)];
    if (escolhido) escolherNaBarra(campo, escolhido);
    return;
  }
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
  // O que chegou com a janela atrás fica com a linha "Novas" quando a pessoa volta (definido em 2026-09-29).
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala") linhaEm = t.conversaId;
  lerConversaDaTela();
}
window.addEventListener("focus", aoVoltarParaFrente);
document.addEventListener("visibilitychange", aoVoltarParaFrente);
// ADR-094: voltar ao app (celular desbloqueado, aba à frente, rede de volta) só reabre o stream se ele caiu de fato; o
// que se perdeu chega pelo replay do `since` ou, sem replay possível, pela releitura do aoReidratar.
function retomarStream(): void {
  if (document.visibilityState === "visible" && navigator.onLine) live?.retomar();
}
document.addEventListener("visibilitychange", retomarStream);
// ADR-095: tela bloqueada ou app no fundo: o iPhone corta o microfone; a gravação é descartada e a pessoa sabe por quê.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !ditado.ativo()) return;
  ditado.descartar();
  avisarDitado("tela-bloqueou");
});
window.addEventListener("online", retomarStream);
window.addEventListener("pageshow", retomarStream);
// Outra aba recolheu ou abriu uma seção: esta acompanha (definido em 2026-10-04).
window.addEventListener("storage", (ev) => {
  if (ev.key !== CHAVE_SECOES_RECOLHIDAS) return;
  secoesRecolhidas = lerSecoesRecolhidas();
  render();
});

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

// O menu do bot na barra lateral: abre onde o cursor está; pelo teclado (Shift+F10, tecla de menu) o evento vem sem
// posição e o menu abre ao lado do bot.
document.addEventListener("contextmenu", (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-bot-contexto]");
  if (!row) return;
  ev.preventDefault();
  const a = botGerido(row.dataset.botContexto);
  const ponto = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : undefined;
  if (a) abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, row, (acao) => acaoDoBot(a, acao), ponto);
});

// ---- arrastar na barra lateral (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") ---------------------------------
// Soltar na grade fixa, numa seção move, em "+ Nova seção" pede o nome. A barra se reorganiza na hora (frotaAoSoltar) e o
// servidor recebe a ordem inteira do grupo de destino (0041). Esc ou soltar fora devolve o bot: o navegador cancela o arrasto.
let arrastandoBot: string | null = null;
let alvoArrasto: { destino: Destino | "nova"; indice: number; el: HTMLElement } | null = null;

function limparIndicadores(): void {
  for (const n of document.querySelectorAll("#sidebar .vaga-fixar, #sidebar .linha-insercao")) n.remove();
  for (const n of document.querySelectorAll("#sidebar .alvo-soltar")) n.classList.remove("alvo-soltar");
}

function encerrarArrasto(): void {
  if (!arrastandoBot) return;
  limparIndicadores();
  document.getElementById("sidebar")?.classList.remove("arrastando-bot");
  for (const n of document.querySelectorAll("#sidebar .origem-arrasto")) n.classList.remove("origem-arrasto");
  // A seção aberta só pelo arrasto volta a recolher: o render abaixo não a refaz quando o HTML não mudou. Se o bot foi
  // solto nela, o drop já a abriu de vez e o render desenha a seção aberta.
  for (const s of document.querySelectorAll("#sidebar [data-aberta-no-arrasto]")) {
    s.removeAttribute("data-aberta-no-arrasto");
    s.setAttribute("data-recolhida", "");
    for (const n of s.querySelectorAll(":scope > [data-escondida-no-arrasto]")) { n.removeAttribute("data-escondida-no-arrasto"); n.classList.add("escondida"); }
  }
  arrastandoBot = null;
  alvoArrasto = null;
  if (quadroDaRolagem) cancelAnimationFrame(quadroDaRolagem);
  quadroDaRolagem = 0;
  render();
}

/**
 * Rolagem automática enquanto se arrasta (definido em 2026-10-06, web/lib/arrastar.ts): com o cursor perto da borda da
 * lista, ou em cima do rodapé ou da busca, a lista rola um passo por quadro. O dragover chega a cada ~50 ms mesmo com o
 * cursor parado e só guarda a posição; o laço anda e se reagenda enquanto a lista ainda tem para onde rolar.
 * NOD-122: não para com "Reduzir movimento": não é enfeite, é a pessoa levando o bot até uma linha fora da vista, e a
 * rolagem só anda enquanto o cursor fica na borda (como a rolagem do próprio navegador ao arrastar).
 */
let cursorDoArrasto = { x: 0, y: 0 };
let quadroDaRolagem = 0;

function rolarNoArrasto(x: number, y: number): void {
  cursorDoArrasto = { x, y };
  if (!quadroDaRolagem) quadroDaRolagem = requestAnimationFrame(passoDaRolagem);
}

function passoDaRolagem(): void {
  quadroDaRolagem = 0;
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  const barra = document.getElementById("sidebar")?.getBoundingClientRect();
  if (!arrastandoBot || !lista || !barra) return;
  const { x, y } = cursorDoArrasto;
  if (x < barra.left || x > barra.right) return;
  const caixa = lista.getBoundingClientRect();
  const passo = velocidadeAutoRolagem(y, caixa.top, caixa.bottom);
  if (passo === 0) return;
  const antes = lista.scrollTop;
  lista.scrollTop = antes + passo;
  if (lista.scrollTop !== antes) quadroDaRolagem = requestAnimationFrame(passoDaRolagem);
}

/** O índice é contado entre os OUTROS bots do grupo; a vaga e a linha não entram na conta, então não oscilam. */
function marcarAlvo(grupo: HTMLElement, x: number, y: number): void {
  if (grupo.dataset.grupo === "nova-secao") {
    if (alvoArrasto?.el === grupo) return;
    limparIndicadores();
    grupo.classList.add("alvo-soltar");
    alvoArrasto = { destino: "nova", indice: 0, el: grupo };
    return;
  }
  const fixados = grupo.dataset.grupo === "fixados";
  const itens = [...grupo.querySelectorAll<HTMLElement>(fixados ? ":scope > .fixado" : ":scope > .bot-row")].filter((n) => n.dataset.arrastavel !== arrastandoBot);
  let indice = itens.length;
  for (const [i, n] of itens.entries()) {
    const r = n.getBoundingClientRect();
    if (fixados ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2) { indice = i; break; }
  }
  if (alvoArrasto?.el === grupo && alvoArrasto.indice === indice) return;
  limparIndicadores();
  alvoArrasto = { destino: fixados ? { grupo: "fixados" } : { grupo: "secao", secao: grupo.dataset.secao ?? "" }, indice, el: grupo };
  const antesDe = itens[indice] ?? (fixados ? grupo.querySelector(".fixados-vazio") : null);
  const marca = document.createElement("div");
  marca.setAttribute("aria-hidden", "true");
  if (fixados) { marca.className = "vaga-fixar"; marca.textContent = "Fixar"; } else { marca.className = "linha-insercao"; grupo.classList.add("alvo-soltar"); }
  grupo.insertBefore(marca, antesDe);
}

function soltarBot(id: string, destino: Destino, indice: number): void {
  const frota = estado.frota;
  const pessoaId = estado.sessao?.pessoaId;
  if (!frota || !pessoaId || !api) return;
  const ordem = ordemAoSoltar(frota.agentes, pessoaId, id, destino, indice);
  dispatch({ tipo: "hidratar-frota", frota: { ...frota, agentes: frotaAoSoltar(frota.agentes, id, destino, ordem) } });
  void agir(async () => {
    await mudarGestao(() => api!.organizarAgente(id, destino.grupo === "fixados" ? { fixado: true, ordem } : { fixado: false, secao: destino.secao, ordem }));
  });
}

function pedirNovaSecao(id: string): void {
  const nome = botGerido(id)?.nome ?? "o bot";
  pedirGestao("Nova seção", `<p>${esc(nome)} vai para a seção nova.</p><label>Nome da seção<input name="secao" required maxlength="60" placeholder="Produto e Engenharia" /></label>`, "Criar seção", async (d) => {
    const secao = String(d.get("secao") ?? "").trim();
    if (!secao) return;
    // Seção nova nasce aberta, mesmo que uma antiga com o mesmo nome tenha ficado recolhida neste navegador.
    const chave = chaveDaSecao(estado.sessao?.pessoaId ?? "", secao);
    if (secoesRecolhidas.has(chave)) secoesRecolhidas = definirSecaoRecolhida(secoesRecolhidas, chave, false);
    await mudarGestao(() => api!.organizarAgente(id, { fixado: false, secao, ordem: [id] }));
  });
}

document.addEventListener("dragstart", (ev) => {
  const el = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar [data-arrastavel]");
  if (!el || !ev.dataTransfer) return;
  arrastandoBot = el.dataset.arrastavel ?? null;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("application/x-nod-bot", arrastandoBot ?? "");
  // O fantasma é uma cópia do bot com sombra, fora da tela: o navegador fotografa e ela sai no mesmo quadro.
  const r = el.getBoundingClientRect();
  const fantasma = el.cloneNode(true) as HTMLElement;
  fantasma.classList.add("fantasma-arrasto");
  fantasma.style.width = `${r.width}px`;
  document.body.append(fantasma);
  ev.dataTransfer.setDragImage(fantasma, ev.clientX - r.left, ev.clientY - r.top);
  window.setTimeout(() => fantasma.remove(), 0);
  // A origem esmaece e os alvos aparecem só depois da foto do fantasma.
  window.requestAnimationFrame(() => {
    if (arrastandoBot !== el.dataset.arrastavel) return;
    el.classList.add("origem-arrasto");
    document.getElementById("sidebar")?.classList.add("arrastando-bot");
  });
});
document.addEventListener("dragover", (ev) => {
  if (!arrastandoBot) return;
  rolarNoArrasto(ev.clientX, ev.clientY);
  const grupo = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar [data-grupo]");
  if (!grupo) {
    if (alvoArrasto) { limparIndicadores(); alvoArrasto = null; }
    return;
  }
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  // Seção recolhida abre ao passar com o bot (definido em 2026-10-04): as linhas aparecem e a posição de soltar é medida
  // nelas — escondidas, todas mediam zero e o bot ia sempre para o fim. Ao fim do arrasto, encerrarArrasto desfaz.
  if (grupo.hasAttribute("data-recolhida")) {
    grupo.removeAttribute("data-recolhida");
    grupo.setAttribute("data-aberta-no-arrasto", "");
    for (const n of grupo.querySelectorAll(":scope > .bot-row.escondida")) { n.classList.remove("escondida"); n.setAttribute("data-escondida-no-arrasto", ""); }
  }
  marcarAlvo(grupo, ev.clientX, ev.clientY);
});
document.addEventListener("drop", (ev) => {
  if (!arrastandoBot) return;
  ev.preventDefault();
  const id = arrastandoBot;
  const alvo = alvoArrasto;
  // Soltou numa seção recolhida: ela fica aberta, para o bot não sumir da vista.
  const chave = alvo && alvo.destino !== "nova" && alvo.destino.grupo === "secao" ? alvo.el.querySelector<HTMLElement>(".secao-cab")?.dataset.chave : undefined;
  if (chave && secoesRecolhidas.has(chave)) secoesRecolhidas = definirSecaoRecolhida(secoesRecolhidas, chave, false);
  encerrarArrasto();
  if (!alvo) return;
  if (alvo.destino === "nova") pedirNovaSecao(id);
  else soltarBot(id, alvo.destino, alvo.indice);
});
document.addEventListener("dragend", () => encerrarArrasto());

// ---- Máquinas (ADR-090): conectar uma VM por código e escolher onde cada bot trabalha --------------------------------------
function abrirCodigoDeMaquinaGuardado(): void {
  let codigo: string | null = null;
  try { codigo = window.sessionStorage.getItem(CHAVE_CODIGO_MAQUINA); window.sessionStorage.removeItem(CHAVE_CODIGO_MAQUINA); } catch { /* sem storage */ }
  if (!codigo || !estado.sessao) return;
  abrirEspaco("maquinas");
  const guardado = codigo;
  void chavesAtuais().then((chavesAntes) => dispatch({ tipo: "conectar-maquina", conectar: { passo: "codigo", codigo: guardado, pedido: null, erro: null, chavesAntes, marcados: [] } }));
}
/** As chaves de máquina da pessoa agora (relê do servidor e hidrata a seção). */
async function chavesAtuais(): Promise<string[]> {
  const dados = await api!.maquinas().catch(() => estado.maquinas ?? { maquinas: [], padraoId: null });
  dispatch({ tipo: "hidratar-maquinas", maquinas: dados });
  return dados.maquinas.map((m) => m.id);
}
/** Depois do "Conectar", a chave nova aparece quando o motor troca o código (a cada 5 s): relê até ela aparecer, por 2 min. */
async function esperarMaquinaNova(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const c = estado.conectarMaquina;
    if (!c || !api) return;
    const dados = await api.maquinas().catch(() => null);
    if (dados) dispatch({ tipo: "hidratar-maquinas", maquinas: dados });
    const nova = estado.conectarMaquina ? maquinaNova(estado, estado.conectarMaquina) : null;
    // Na tela das IAs, continua relendo até o Claude Code ficar pronto (a pessoa está logando no terminal).
    if (nova && (estado.conectarMaquina?.passo !== "ias" || nova.ias["claude-cli"] === "pronto")) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}
function atualizarConectar(p: Partial<NonNullable<typeof estado.conectarMaquina>>): void {
  const c = estado.conectarMaquina;
  if (c) dispatch({ tipo: "conectar-maquina", conectar: { ...c, ...p } });
}

// ---- Seu espaço e o menu da conta (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") -----------------------------
function abrirEspaco(secao: SecaoEspaco): void {
  celular.fecharBots();
  // O menu "Avisos no Mac" muda a preferência sem passar por aqui: a seção relê ao abrir.
  if (secao === "avisos") void canalAvisos.reler();
  const jaAberto = !!estado.espaco;
  dispatch({ tipo: "espaco", secao });
  document.querySelector<HTMLElement>(jaAberto ? `#espaco [data-secao="${secao}"]` : "#espaco .espaco-voltar")?.focus();
}

/** Volta exatamente para onde estava: a tela de baixo nunca saiu do lugar. O que chegou enquanto isso ganha a linha "Novas". */
function fecharEspaco(): void {
  if (!estado.espaco) return;
  dispatch({ tipo: "espaco", secao: null });
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala") linhaEm = t.conversaId;
  lerConversaDaTela();
  document.querySelector<HTMLElement>("#sidebar .rodape .me")?.focus();
}

function dadosMenuConta(): DadosMenuConta {
  const inv = inventarioEmUso(estado);
  const falha = !!inv && inv.estado !== "pronto";
  const fora = [...new Set((estado.frota?.negacoes ?? []).filter((n) => n.classe === "conector_indisponivel").map((n) => estado.conectores.find((c) => c.slug === n.nome || c.nome === n.nome)?.nome ?? n.nome))];
  const faixa = falha
    ? { texto: situacaoMotorFora(inv, estado.executor?.atual), botao: motorDesatualizado(estado) ? "Atualizar" : "Conectar" }
    : fora.length ? { texto: faixaDeConectores(fora), botao: "Ver" } : null;
  const banco = textoAmbiente(ambienteBanco);
  return {
    faixa,
    conexao: !estado.executor ? "Verificando" : falha ? "Desconectada" : estado.executor.atual === "catcher" ? "Simulação" : "Conectada",
    avisos: situacaoCurtaAvisos(canalAvisos.estado()),
    modoDev: estado.modoDev.ligado,
    banco: banco ? { texto: banco, regime: ambienteBanco?.regime ?? "desconhecido" } : null,
    // #219: com o disco quase cheio, o menu diz o disco (é o que pede a mão da pessoa).
    // Revisto em 2026-10-09 (a tela fala por máquina): só a leitura do Mac — a VM ocupada não diz "Ocupado" em Este Mac.
    esteMac: ((m) => (m.motivoEspera === "disco" ? "Disco quase cheio" : m.motivoEspera ? "Ocupado" : (USOS.find((u) => u.id === estado.usoDoMac)?.nome ?? "")))(leituraDoMac(estado.trabalhos)),
  };
}

// ---- a gaveta do bot por níveis (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") -------------------------------
/** O nível da gaveta com algo digitado e ainda não salvo (a chave de chaveDaGaveta); null = nada pendente. */
let gavetaSuja: string | null = null;

function chaveDaGaveta(): string {
  return JSON.stringify(estado.gaveta);
}

/** Abre o nível na gaveta do bot; se a conversa na tela é de outro bot, vai para a dele antes. Escondida, a gaveta aparece. */
function abrirNivel(agenteId: string, nivel: NivelGaveta): void {
  const a = botGerido(agenteId);
  if (!a) return;
  const t = estado.tela;
  if (t.tipo !== "conversa" || t.agenteId !== a.id) navegar({ tipo: "conversa", conversaId: a.conversaId, agenteId: a.id });
  gavetaSuja = null;
  const app = document.querySelector(".app");
  if (window.matchMedia("(max-width: 1099px)").matches) app?.classList.add("detalhes-abertos");
  else if (painelOculto()) painelAbertoNaHora = true;
  dispatch({ tipo: "gaveta", agenteId: a.id, nivel });
  document.querySelector<HTMLElement>("#detalhes .gv-voltar")?.focus();
}

function fecharNivel(): void {
  gavetaSuja = null;
  const g = estado.gaveta;
  if (g) dispatch({ tipo: "gaveta", agenteId: g.agenteId, nivel: null });
  document.querySelector<HTMLElement>("#detalhes .gv-painel")?.focus();
}

/** ‹ (ou Esc): com mudança não salva, pergunta antes; o que está salvo não pergunta nada. */
function voltarNivel(): void {
  if (gavetaSuja && gavetaSuja === chaveDaGaveta()) {
    pedirGestao("Descartar as mudanças?", "<p>O que você mudou aqui ainda não foi salvo.</p>", "Descartar", async () => fecharNivel(), true);
    return;
  }
  fecharNivel();
}
