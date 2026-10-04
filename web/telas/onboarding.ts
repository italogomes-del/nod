import type { CamposEntrevista, EstadoOnboarding, IaNoMac, ModeloDeBot, TamanhoTime } from "../../src/contracts/onboarding.ts";
import type { IaDesktop } from "../../src/contracts/desktop.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { LOGOS_IA } from "./onboarding-logos.ts";

/**
 * O onboarding por ligação na web (definido em 2026-10-04, ADR-077; protótipo "HiFiMac" da Proposta 2, aprovado em
 * 2026-10-03). Região própria `#onboarding`, por cima do app e da ligação, com as camadas de tela cheia ("olá", a IA dos
 * bots, "está te ligando") e o painel "O que você contou" ao lado da entrevista. A configuração guiada (os três cards)
 * entra como um bloco na conversa da guia, e o painel da direita ganha "O que você contou" e "Montado até agora".
 *
 * Aqui só as funções de desenho, puras e sem DOM (tests/unit/web/onboarding.test.ts); o controlador que liga o
 * servidor, a ligação e os timers mora em web/telas/onboarding-controle.ts.
 */

/** O que a tela mostra agora: as etapas do servidor mais a abertura local ("olá" ainda não passou). */
export type FaseTela = "ola" | "executor" | "chamando" | "entrevista" | "configurando" | "fim";

export type EstadoTelaOnboarding = {
  dados: EstadoOnboarding;
  fase: FaseTela;
  /** A busca do Claude Code e do Codex ainda gira (os primeiros 2 s da etapa, como no protótipo). */
  procurando: boolean;
  /** O card de IA clicado: o login abriu no navegador e o app sonda. */
  iaEntrando: IaDesktop | null;
  /** Nota sob os cards (o que fazer fora do app, ou o que falhou). */
  notaIa: string | null;
  /** O clique em Atender ou em "Configurar sem voz" já saiu. */
  atendendo: boolean;
  /** A ligação desta tela está aberta (a pílula fica no alto durante a configuração). */
  emLigacao: boolean;
  /** O app do modelo está com o login aberto no navegador. */
  appConectando: boolean;
  /** Um clique de card em andamento (o botão fica ocupado). */
  ocupado: boolean;
};

// ---- textos -------------------------------------------------------------------------------------------------------------
export const TEXTO_VOZ_CURTO = "Sua fala é transcrita pelo Google, nos EUA; nada é gravado";

const ROTULO_TAMANHO: Record<TamanhoTime, string> = { so_eu: "Só você", "2_10": "2 a 10", "11_50": "11 a 50", "51_mais": "Mais de 50" };

/** As linhas de "O que você contou" (Nome / Conheceu por / Quer / Time), só as já respondidas. */
export function linhasContou(c: CamposEntrevista): { rotulo: string; valor: string }[] {
  const linhas: { rotulo: string; valor: string | null }[] = [
    { rotulo: "Nome", valor: c.apelido },
    { rotulo: "Conheceu por", valor: c.comoConheceu },
    { rotulo: "Quer", valor: c.objetivo },
    { rotulo: "Time", valor: c.tamanhoTime ? ROTULO_TAMANHO[c.tamanhoTime] : null },
  ];
  return linhas.filter((l): l is { rotulo: string; valor: string } => !!l.valor);
}

/** "Montado até agora": o bot, o app e a rotina, na ordem em que nascem. */
export function linhasMontado(d: EstadoOnboarding): string[] {
  const linhas: string[] = [];
  if (d.bot) linhas.push(`Bot ${d.bot.nome}`);
  if (d.appConectado) linhas.push(`${d.modelo.app.nome} conectado`);
  if (d.rotinaCriada) linhas.push(`Rotina: ${d.rotinaCriada.resumo.charAt(0).toLowerCase()}${d.rotinaCriada.resumo.slice(1)}`);
  return linhas;
}

export function textoTudoMontado(nomeGuia: string): string {
  return `Tudo montado. Quando quiser, é só chamar a ${nomeGuia} por aqui.`;
}

export function nomeDaGuia(d: EstadoOnboarding): string {
  return d.guia?.nome ?? "Nina";
}

// ---- ícones -------------------------------------------------------------------------------------------------------------
const svg = (d: string, t = 24, largura = 1.8): string => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONE = {
  semVoz: svg('<path d="M5 7h14M5 12h14M5 17h9"/>', 24, 1.7),
  atender: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 26),
};
const GIRA = '<span class="ob-gira" aria-hidden="true"></span>';

// ---- 1. "olá" -----------------------------------------------------------------------------------------------------------
/** A abertura: "olá" grande, que some sozinho em ~3,2 s; um clique pula. Nada toca antes de um clique. */
export function htmlOla(): string {
  return `<button type="button" class="ob-ola" data-act="onboarding-pular-ola" aria-label="Pular abertura"><span>olá</span></button>`;
}

// ---- 2. a IA dos bots -----------------------------------------------------------------------------------------------------
type CardIa = { id: "claude" | "chatgpt" | "grok" | "gemini"; nome: string; ia: IaDesktop | null };
const CARDS_IA: readonly CardIa[] = [
  { id: "claude", nome: "Claude", ia: "claude-cli" },
  { id: "chatgpt", nome: "ChatGPT", ia: "codex-cli" },
  { id: "grok", nome: "Grok", ia: null },
  { id: "gemini", nome: "Gemini", ia: null },
];

const NOME_CLI: Record<IaDesktop, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };

/** O estado de um card de IA: texto, cor do texto, botão e o que o clique faz. */
export function estadoDoCardIa(ia: IaDesktop, ias: readonly IaNoMac[], entrando: IaDesktop | null): { estado: string; tom: "mudo" | "ok"; acao: string | null; act: "onboarding-ia-entrar" | "onboarding-ia-instalar" | null; girando: boolean } {
  const inv = ias.find((i) => i.id === ia);
  const cli = NOME_CLI[ia];
  if (inv?.estado === "pronto") return { estado: "Conectado", tom: "ok", acao: "Conectado", act: null, girando: false };
  if (entrando === ia) return { estado: "Termine no navegador…", tom: "mudo", acao: "Esperando", act: null, girando: true };
  if (inv?.estado === "nao_autenticado") return { estado: `${cli} instalado · falta entrar`, tom: "mudo", acao: "Entrar", act: "onboarding-ia-entrar", girando: false };
  return { estado: `${cli} não está neste Mac`, tom: "mudo", acao: "Instalar e entrar", act: "onboarding-ia-instalar", girando: false };
}

export function htmlExecutor(e: Pick<EstadoTelaOnboarding, "dados" | "procurando" | "iaEntrando" | "notaIa">): string {
  const cabeca = `<div class="ob-cabeca"><h1>A IA dos seus bots</h1><p>Seus bots trabalham com a conta que você já assina, aqui neste Mac. O nod nunca vê sua senha nem sua chave.</p></div>`;
  if (e.procurando) return `<section class="ob-tela ob-executor" aria-label="A IA dos seus bots">${cabeca}<div class="ob-procurando" role="status">${GIRA}Procurando o Claude Code e o Codex neste Mac…</div><p class="ob-nota"></p></section>`;
  const cards = CARDS_IA.map((c) => {
    if (!c.ia) {
      return `<div class="ob-card-ia em-breve" aria-disabled="true"><span class="ob-logo">${LOGOS_IA[c.id]}</span><div class="ob-ia-txt"><b>${esc(c.nome)}</b><span>Em breve</span></div></div>`;
    }
    const s = estadoDoCardIa(c.ia, e.dados.executor.ias, e.iaEntrando);
    const bt = s.acao
      ? `<button type="button" class="ob-pilula${s.tom === "ok" ? " ok" : ""}"${s.act ? ` data-act="${s.act}" data-ia="${c.ia}"` : " disabled"}>${s.girando ? GIRA : ""}${esc(s.acao)}</button>`
      : "";
    return `<div class="ob-card-ia"><span class="ob-logo">${LOGOS_IA[c.id]}</span><div class="ob-ia-txt"><b>${esc(c.nome)}</b><span class="${s.tom === "ok" ? "ok" : ""}">${esc(s.estado)}</span></div>${bt}</div>`;
  }).join("");
  const nota = e.notaIa ?? "Dá para trocar ou adicionar outra depois, em Ajustes.";
  return `<section class="ob-tela ob-executor" aria-label="A IA dos seus bots">${cabeca}<div class="ob-cards-ia">${cards}</div><p class="ob-nota" role="status">${esc(nota)}</p></section>`;
}

/** A orientação quando o clique não chega a um app do Mac (navegador comum ou app antigo). */
export function notaForaDoApp(ia: IaDesktop, acao: "entrar" | "instalar"): string {
  if (ia === "claude-cli") return acao === "entrar" ? "No Terminal deste Mac, rode “claude auth login” e entre na sua conta; o nod percebe sozinho." : "Instale o Claude Code (claude.com/product/claude-code) e rode “claude auth login”; o nod percebe sozinho.";
  return acao === "entrar" ? "No Terminal deste Mac, rode “codex login” e entre na sua conta; o nod percebe sozinho." : "Instale o Codex (developers.openai.com/codex/cli) e rode “codex login”; o nod percebe sozinho.";
}

// ---- 3. "está te ligando" --------------------------------------------------------------------------------------------------
export function htmlChamando(e: Pick<EstadoTelaOnboarding, "dados" | "atendendo">): string {
  const nome = nomeDaGuia(e.dados);
  const guia = e.dados.guia;
  const mascote = guia ? iconeAgente(guia, "xxl") : "";
  const desab = e.atendendo ? " disabled" : "";
  return `<section class="ob-tela ob-chamando" aria-label="${esc(nome)} está te ligando">
    <div class="ob-toque"><span class="ob-anel"></span><span class="ob-anel b"></span><div class="ob-toque-mascote">${mascote}</div></div>
    <div class="ob-quem"><b>${esc(nome)}</b><span>está te ligando</span></div>
    <div class="ob-botoes-ligacao">
      <div class="ob-botao-ligacao"><button type="button" class="ob-redondo" data-act="onboarding-sem-voz"${desab}>${ICONE.semVoz}</button><span>Configurar sem voz</span></div>
      <div class="ob-botao-ligacao"><button type="button" class="ob-redondo atender" data-act="onboarding-atender"${desab} aria-describedby="ob-aviso-voz">${ICONE.atender}</button><span>Atender</span>
        <p class="ob-aviso-voz" id="ob-aviso-voz">${esc(TEXTO_VOZ_CURTO)} · <button type="button" class="ob-link" data-act="onboarding-saber-mais">saber mais</button></p></div>
    </div>
  </section>`;
}

// ---- 4. painel da entrevista -------------------------------------------------------------------------------------------------
function blocoContou(c: CamposEntrevista): string {
  const linhas = linhasContou(c);
  const corpo = linhas.length
    ? linhas.map((l) => `<div class="ob-linha"><span>${esc(l.rotulo)}</span><b>${esc(l.valor)}</b></div>`).join("")
    : '<p class="ob-vazio">Aparece aqui durante a ligação.</p>';
  return `<div class="ob-bloco"><h3>O que você contou</h3>${corpo}</div>`;
}

/** Ao lado da tela cheia da ligação, durante a entrevista (por cima, à direita, sem cobrir os controles). */
export function htmlPainelEntrevista(d: EstadoOnboarding): string {
  return `<aside class="ob-painel-entrevista" aria-label="O que você contou" aria-live="polite">${blocoContou(d.campos)}</aside>`;
}

/** No painel da guia (detalhes) durante a configuração: "O que você contou" e "Montado até agora". */
export function secaoOnboardingDetalhes(d: EstadoOnboarding): string {
  const montado = linhasMontado(d);
  const lista = montado.length
    ? montado.map((t) => `<div class="ob-montado"><span class="ob-check" aria-hidden="true">✓</span>${esc(t)}</div>`).join("")
    : '<p class="ob-vazio">Nada ainda.</p>';
  return `<section class="gv-secao ob-detalhes">${blocoContou(d.campos)}<div class="ob-bloco"><h3>Montado até agora</h3>${lista}</div></section>`;
}

// ---- 5. configuração guiada ------------------------------------------------------------------------------------------------
function cardBot(d: EstadoOnboarding, ocupado: boolean): string {
  const p = d.pendentes.bot;
  const m = d.modelo;
  const nome = p?.nome ?? m.nome;
  const descricao = p?.descricao ?? m.descricao;
  const mascote = iconeAgente({ nome, forma: p?.forma ?? m.forma, cor: p?.cor ?? m.cor }, "lg");
  return `<form class="ob-card" data-form="onboarding-bot"${p ? ` data-decisao-bot="${esc(p.decisaoId)}"` : ""}>
    <div class="ob-card-cab">${mascote}<div><span class="ob-sobre">Novo bot · preenchido com o que você contou</span><b class="ob-titulo">${esc(nome)}</b></div></div>
    <label class="ob-campo">Nome<input name="nome" id="ob-bot-nome" maxlength="60" value="${esc(nome)}" autocomplete="off" required /></label>
    <label class="ob-campo">O que ele faz<textarea name="descricao" id="ob-bot-descricao" rows="3" maxlength="600">${esc(descricao)}</textarea></label>
    <div class="ob-card-acoes">${p ? botao("onboarding-recusar-bot", "Agora não", { id: p.decisaoId, classe: "ob-secundario" }) : ""}<button type="submit" class="ob-pilula"${ocupado ? " disabled" : ""}>${ocupado ? GIRA : ""}Criar bot</button></div>
  </form>`;
}

function marcaApp(m: ModeloDeBot, grande = true): string {
  // A cor do app vem do servidor (marca de terceiros): única cor fora dos tokens neste card.
  return `<span class="ob-app${grande ? "" : " sm"}" style="background:${esc(m.app.cor)}" aria-hidden="true">${esc(m.app.letra)}</span>`;
}

function cardApp(d: EstadoOnboarding, e: Pick<EstadoTelaOnboarding, "appConectando" | "ocupado">): string {
  const m = d.modelo;
  const bot = d.bot?.nome ?? m.nome;
  const pode = m.pode.map((t) => `<li><span class="ob-sim" aria-hidden="true">✓</span>${esc(t)}</li>`).join("");
  const nao = `<li><span class="ob-nao" aria-hidden="true">×</span>${esc(m.nao)}</li>`;
  const pendente = d.pendentes.acesso;
  let acao: string;
  if (d.appConectado) acao = '<span class="ob-conectado">Conectado</span>';
  else if (pendente && !pendente.conectar) acao = `<button type="button" class="ob-pilula" data-act="onboarding-permitir-app" data-id="${esc(pendente.decisaoId)}"${e.ocupado ? " disabled" : ""}>Permitir</button>`;
  else acao = `<button type="button" class="ob-pilula" data-act="onboarding-conectar-app" data-slug="${esc(m.app.slug)}"${e.appConectando || e.ocupado ? " disabled" : ""}>${e.appConectando ? `${GIRA}Esperando o navegador` : "Entrar e conectar"}</button>`;
  return `<div class="ob-card">
    <div class="ob-card-cab">${marcaApp(m)}<div><span class="ob-sobre">Conectar para o ${esc(bot)}</span><b class="ob-titulo">${esc(m.app.nome)}</b></div></div>
    <ul class="ob-permissoes">${pode}${nao}</ul>
    <div class="ob-card-acoes">${acao}</div>
  </div>`;
}

function cardRotina(d: EstadoOnboarding, ocupado: boolean): string {
  const m = d.modelo;
  const bot = d.bot?.nome ?? m.nome;
  const pendente = d.pendentes.rotina;
  const proposta = pendente
    ? `<div class="ob-rotina proposta"><span class="ob-radio on" aria-hidden="true"></span><span class="ob-oque">${esc(pendente.resumo)}</span>${botao("onboarding-criar-rotina-proposta", "Criar rotina", { id: pendente.decisaoId, classe: "ob-pilula sm" })}</div>`
    : "";
  const opcoes = m.rotinas.map((r, i) => `<button type="button" class="ob-rotina" data-act="onboarding-escolher-rotina" data-indice="${i}"${ocupado ? " disabled" : ""}><span class="ob-radio" aria-hidden="true"></span><span class="ob-oque">${esc(r.oque)}</span><span class="ob-quando">${esc(r.quando)}</span></button>`).join("");
  return `<div class="ob-card ob-card-rotina"><span class="ob-sobre ob-sobre-lista">Rotina do ${esc(bot)}</span>${proposta}${opcoes}</div>`;
}

/**
 * O bloco da configuração guiada na conversa da guia: a fala de abertura e o card do passo (um por vez); no fim,
 * "Tudo montado" e "Ver o onboarding de novo".
 */
export function htmlGuia(e: EstadoTelaOnboarding): string {
  const d = e.dados;
  const nome = nomeDaGuia(d);
  const apelido = d.campos.apelido;
  const abertura = e.emLigacao
    ? `Oi, ${apelido ?? "tudo bem"}. Seguimos na ligação; eu vou montando tudo aqui enquanto a gente conversa.`
    : `Oi${apelido ? `, ${apelido}` : ""}. Vamos montar o seu primeiro bot: são três passos rápidos.`;
  const balao = `<div class="ob-balao">${esc(abertura)}</div>`;
  if (e.fase === "fim" || d.passo === "fim") {
    return `<section class="ob-guia" aria-label="Configuração inicial">${balao}<div class="ob-fim" role="status">${esc(textoTudoMontado(nome))}<button type="button" class="ob-link" data-act="onboarding-de-novo">Ver o onboarding de novo</button></div></section>`;
  }
  const card = d.passo === "bot" ? cardBot(d, e.ocupado) : d.passo === "app" ? cardApp(d, e) : cardRotina(d, e.ocupado);
  return `<section class="ob-guia" aria-label="Configuração inicial">${balao}${card}</section>`;
}

/** A camada de tela cheia de cada fase (vazia na entrevista e na configuração: aí mandam a ligação e a conversa). */
export function htmlCamada(e: EstadoTelaOnboarding, ligacaoCheia: boolean): string {
  switch (e.fase) {
    case "ola":
      return htmlOla();
    case "executor":
      return htmlExecutor(e);
    case "chamando":
      return htmlChamando(e);
    case "entrevista":
      return ligacaoCheia ? htmlPainelEntrevista(e.dados) : "";
    default:
      return "";
  }
}
