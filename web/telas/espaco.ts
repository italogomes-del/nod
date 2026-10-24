import type { Estado, SecaoEspaco } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import type { Volta } from "../lib/volta.ts";
import { pilhaDeAvatares } from "./cartao-ia.ts";
import { renderChaves } from "./chaves.ts";
import { renderGestao } from "./gestao.ts";
import { renderPreferenciaModoDev } from "./modo-dev.ts";
import { renderProvedores } from "./provedores.ts";
import { renderEsteMac } from "./este-mac.ts";
import { renderMaquinas } from "./maquinas.ts";
import { renderRelatos } from "./relatos.ts";
import { ICONE_CB, htmlPainelComputadorDoBot } from "../lib/computador-pessoa.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. definido em 2026-09-30 (canvas "Menu, sidebar e
 * gaveta"): abre pelo menu do avatar, em tela cheia por cima da tela atual, já na seção escolhida. As seções ficam na
 * coluna da esquerda, no lugar da barra lateral, e trocar de seção não empilha: o único botão de saída é "‹ <de onde
 * veio>" (mais o Esc), que diz para onde a pessoa volta. Sem ×: os dois fariam a mesma coisa.
 */
export const SECOES_ESPACO: readonly { id: SecaoEspaco; nome: string; icone: string }[] = [
  // NOD-346: "Minha conta" (perfil, acesso e dados) abre a lista, mas só aparece com NOD_MINHA_CONTA ligada.
  { id: "conta", nome: "Minha conta", icone: ICONE.pessoa },
  // definido em 2026-10-10 (plano das IAs, protótipo Main): "Conexão" vira "Provedores de IA", com os logos das IAs.
  { id: "conexao", nome: "Provedores de IA", icone: pilhaDeAvatares(true) },
  { id: "avisos", nome: "Avisos", icone: ICONE.sino },
  { id: "preferencias", nome: "Preferências", icone: ICONE.codigo },
  { id: "este-mac", nome: "Este Mac", icone: ICONE.medidor },
  { id: "maquinas", nome: "Máquinas", icone: ICONE.servidor },
  { id: "computadores", nome: "Computadores", icone: ICONE.monitor },
  { id: "agentes", nome: "Gerenciar agentes", icone: ICONE.agentes },
  { id: "relatos", nome: "Relatos", icone: ICONE.bandeira },
];

/**
 * NOD-96 (computador do bot v2, só com NOD_COMPUTADORES=motor): a seção "Computador do bot" entra depois de Máquinas, e
 * "Computadores" (as chaves das máquinas) passa a se chamar "Chaves" — "computador" agora é o do bot. Sem v2, igual a antes.
 */
export function secoesDoEspaco(v2: boolean): readonly { id: SecaoEspaco; nome: string; icone: string }[] {
  if (!v2) return SECOES_ESPACO;
  return SECOES_ESPACO.flatMap((s) => s.id === "maquinas"
    ? [s, { id: "computador-do-bot" as const, nome: "Computador do bot", icone: ICONE_CB.pcBot }]
    : s.id === "computadores" ? [{ ...s, nome: "Chaves" }] : [s]);
}

/** O Entendi da faixa "entre nos sites de novo uma vez" fica neste navegador. */
export const CHAVE_AVISO_RECRIADO = "nod.computador.aviso-recriado";

function avisoRecriadoDispensado(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CHAVE_AVISO_RECRIADO) === "1";
  } catch {
    return false;
  }
}

export type Ambiente = { regime: string; porta?: number | null } | null;

export function textoAmbiente(ambiente: Ambiente): string | null {
  if (!ambiente) return null;
  const regime = ambiente.regime === "persistente" ? "Banco persistente" : ambiente.regime === "efemero" ? "Banco efêmero" : "Banco não identificado";
  return `${regime}${ambiente.porta ? ` · porta ${ambiente.porta}` : ""}`;
}

/** `minhaConta`: o HTML da seção Minha conta (web/telas/minha-conta.ts); null = flag desligada e a seção nem aparece. */
export function renderEspaco(estado: Estado, ambiente: Ambiente, avisos: EstadoAvisos, volta: Volta, minhaConta: string | null = null): string {
  const v2 = Boolean(estado.computadorPessoa);
  const pedida = estado.espaco?.secao ?? "conexao";
  const secao = (pedida === "conta" && minhaConta === null) || (pedida === "computador-do-bot" && !v2) ? "conexao" : pedida;
  const nav = secoesDoEspaco(v2).filter((s) => s.id !== "conta" || minhaConta !== null).map((s) => `<button type="button" class="espaco-item" data-act="secao-espaco" data-secao="${s.id}"${s.id === secao ? ' aria-current="page"' : ""}>${s.icone}<span>${esc(s.nome)}</span></button>`).join("");
  const banco = textoAmbiente(ambiente);
  return `<div class="espaco" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <nav class="espaco-nav" aria-label="Seções de Seu espaço">
      <div class="espaco-volta"><button type="button" class="espaco-voltar" data-act="fechar-espaco" aria-keyshortcuts="Escape" title="Voltar para ${esc(volta.rotulo)} (Esc)">${ICONE.voltar}${volta.icone}<span>${esc(volta.rotulo)}</span></button><kbd>esc</kbd></div>
      <h1 id="espaco-titulo">Seu espaço</h1>
      <div class="espaco-itens">${nav}</div>
      ${banco ? `<p class="espaco-banco banco-${esc(ambiente?.regime ?? "desconhecido")}"><span aria-hidden="true"></span>${esc(banco)}</p>` : ""}
    </nav>
    <main class="espaco-conteudo">${secao === "conta" ? minhaConta ?? "" : conteudo(estado, secao, avisos)}</main>
  </div>`;
}

function conteudo(estado: Estado, secao: SecaoEspaco, avisos: EstadoAvisos): string {
  switch (secao) {
    case "conta":
      return "";
    case "conexao":
      return renderProvedores(estado);
    case "avisos":
      return renderAvisos(avisos);
    case "preferencias":
      return renderPreferenciaModoDev(estado);
    case "este-mac":
      return renderEsteMac(estado);
    case "maquinas":
      return renderMaquinas(estado);
    case "computador-do-bot":
      return estado.computadorPessoa ? htmlPainelComputadorDoBot(estado.computadorPessoa, estado.frota?.agentes ?? [], estado.computadorUi, estado.agora, avisoRecriadoDispensado()) : "";
    case "computadores":
      return `<section class="espaco-secao"><h2>${estado.computadorPessoa ? "Chaves" : "Computadores"}</h2><p class="intro">Uma chave por computador. Perdeu ou trocou de computador? Cancele a chave dele aqui e gere outra.</p>${renderChaves(estado, false)}</section>`;
    case "agentes":
      return renderGestao(estado.gestao ?? null, estado.sessao?.pessoaId);
    case "relatos":
      return renderRelatos(estado);
  }
}

const SITUACAO: Record<EstadoAvisos["onde"], Record<EstadoAvisos["situacao"], string>> = {
  mac: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo macOS: libere em Ajustes do Sistema → Notificações → nod",
    indisponiveis: "Este Mac não mostra avisos do nod.",
  },
  navegador: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo navegador: libere as notificações deste site nos ajustes do navegador.",
    indisponiveis: "Este navegador não mostra avisos.",
  },
};

/** O estado dos avisos em uma palavra, para o menu da conta. */
export function situacaoCurtaAvisos(a: EstadoAvisos): string {
  return a.situacao === "ligados" ? "Ligados" : a.situacao === "desligados" ? "Desligados" : a.situacao === "bloqueados" ? "Bloqueados" : "Indisponíveis";
}

/**
 * NOD-115 (protótipo do Gil, 05/10): "Tocar som" logo abaixo do interruptor geral, recuado, para ler como parte dos
 * avisos. Com os avisos desligados, fica desabilitado na posição guardada e a ajuda diz que a escolha fica guardada.
 * Só existe quando o estado traz `som` (app do Mac com `definirSom`); no navegador e no app antigo a seção não muda.
 */
const AJUDA_SOM = "Desligado, o aviso aparece em silêncio: o banner e o número no Dock continuam.";
const AJUDA_SOM_TRAVADO = "Ligue os avisos para escolher. Sua escolha fica guardada.";

function renderSom(som: boolean, avisosLigados: boolean): string {
  return `
      <div class="avisos-som">
        <button type="button" class="avisos-interruptor" data-act="alternar-som" role="switch" aria-checked="${som ? "true" : "false"}" aria-describedby="avisos-som-ajuda"${avisosLigados ? "" : " disabled"}><span class="avisos-trilho" aria-hidden="true"></span><span>Tocar som</span></button>
        <p id="avisos-som-ajuda" class="avisos-som-ajuda">${esc(avisosLigados ? AJUDA_SOM : AJUDA_SOM_TRAVADO)}</p>
      </div>`;
}

/**
 * definido em 2026-09-24 ("aviso no Mac"): o interruptor dos avisos e as regras dele em palavras, para
 * a pessoa saber quando o nod vai (e não vai) chamá-la. No app, liga "Avisos no Mac" (o mesmo item do
 * menu); no navegador, pede a permissão no clique. Bloqueado no navegador, o clique não resolve — o
 * interruptor fica desligado e a linha diz onde liberar.
 */
export function renderAvisos(a: EstadoAvisos): string {
  const ligado = a.situacao === "ligados" || (a.onde === "mac" && a.situacao === "bloqueados");
  const travado = a.situacao === "indisponiveis" || (a.onde === "navegador" && a.situacao === "bloqueados");
  const numero = a.onde === "mac" ? "O número no ícone do Dock mostra quantos pedidos estão abertos." : "O título da aba mostra quantos pedidos estão abertos.";
  return `<section class="espaco-secao espaco-avisos">
      <h2>Avisos</h2>
      <div class="avisos-linha">
        <button type="button" class="avisos-interruptor" data-act="alternar-avisos" role="switch" aria-checked="${ligado ? "true" : "false"}"${travado ? " disabled" : ""}><span class="avisos-trilho" aria-hidden="true"></span><span>Avisar quando algo precisar de você</span></button>
        <span class="avisos-situacao situacao-${esc(a.situacao)}" role="status">${esc(SITUACAO[a.onde][a.situacao])}</span>
      </div>${a.som === undefined ? "" : renderSom(a.som, ligado)}
      <ul class="avisos-regras">
        <li>Só quando o nod não está na frente: com ele aberto, o pedido já aparece na tela.</li>
        <li>No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só.</li>
        <li>Nunca para quedas que se resolvem sozinhas, como o Mac sem contato, nem para pedidos vencidos.</li>
        <li>${numero}</li>
      </ul>
    </section>`;
}
