import type { Estado, SecaoEspaco } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import type { Volta } from "../lib/volta.ts";
import { pilhaDeAvatares } from "./cartao-ia.ts";
import { renderProvedores } from "./provedores.ts";
import { renderMaquinas } from "./maquinas.ts";
import { renderRelatos } from "./relatos.ts";
import { htmlPainelComputadorDoBot } from "../lib/computador-pessoa.ts";
import type { EscolhaTema } from "../lib/tema.ts";
import { renderConta, renderContaPagina, type DadosConta } from "./config-conta.ts";
import { renderAgentes } from "./config-agentes.ts";
import { renderGeral } from "./config-geral.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. definido em 2026-09-30 (canvas "Menu, sidebar e
 * gaveta"): abre pelo menu do avatar, em tela cheia por cima da tela atual, já na seção escolhida. As seções ficam na
 * coluna da esquerda, no lugar da barra lateral, e trocar de seção não empilha: o único botão de saída é "‹ <de onde
 * veio>" (mais o Esc), que diz para onde a pessoa volta. Sem ×: os dois fariam a mesma coisa.
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): passa a se chamar Configurações, com 6 seções fixas, nesta ordem.
 * Avisos e Preferências viram Geral; Este Mac, Computadores (as chaves) e o computador do bot (v2) viram Máquinas;
 * Relatos vira Feedback. A v2 não acrescenta seção.
 */
export const SECOES_ESPACO: readonly { id: SecaoEspaco; nome: string; icone: string }[] = [
  { id: "conta", nome: "Conta", icone: ICONE.pessoa },
  { id: "geral", nome: "Geral", icone: ICONE.ajustes },
  // definido em 2026-10-10 (plano das IAs, protótipo Main): "Conexão" vira "Provedores de IA", com os logos das IAs.
  { id: "conexao", nome: "Provedores de IA", icone: pilhaDeAvatares(true) },
  { id: "maquinas", nome: "Máquinas", icone: ICONE.servidor },
  { id: "agentes", nome: "Agentes", icone: ICONE.agentes },
  { id: "feedback", nome: "Feedback", icone: ICONE.bandeira },
];

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

export type ExtrasEspaco = {
  conta: DadosConta;
  /** A página de Minha conta aberta dentro de Conta (NOD-346); null = a lista. */
  contaPagina: string | null;
  tema: EscolhaTema;
};

export function renderEspaco(estado: Estado, ambiente: Ambiente, avisos: EstadoAvisos, volta: Volta, extras: ExtrasEspaco): string {
  const secao = estado.espaco?.secao ?? "conexao";
  const nav = SECOES_ESPACO.map((s) => `<button type="button" class="espaco-item" data-act="secao-espaco" data-secao="${s.id}"${s.id === secao ? ' aria-current="page"' : ""}>${s.icone}<span>${esc(s.nome)}</span></button>`).join("");
  return `<div class="espaco cfg-espaco" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <nav class="espaco-nav" aria-label="Seções das Configurações">
      <div class="espaco-volta"><button type="button" class="espaco-voltar" data-act="fechar-espaco" aria-keyshortcuts="Escape" title="Voltar para ${esc(volta.rotulo)} (Esc)">${ICONE.voltar}${volta.icone}<span>${esc(volta.rotulo)}</span></button><kbd>esc</kbd></div>
      <h1 id="espaco-titulo">Configurações</h1>
      <div class="espaco-itens">${nav}</div>
    </nav>
    <main class="espaco-conteudo">${conteudo(estado, secao, ambiente, avisos, extras)}</main>
  </div>`;
}

function conteudo(estado: Estado, secao: SecaoEspaco, ambiente: Ambiente, avisos: EstadoAvisos, extras: ExtrasEspaco): string {
  switch (secao) {
    case "conta":
      return extras.contaPagina !== null ? renderContaPagina(extras.contaPagina) : renderConta(extras.conta);
    case "geral": {
      const banco = textoAmbiente(ambiente);
      return renderGeral({
        tema: extras.tema,
        avisos,
        modoDev: estado.modoDev.ligado,
        experimentos: estado.experimentos,
        banco: banco ? { texto: banco, regime: ambiente?.regime ?? "desconhecido" } : null,
      }, estado.configUi);
    }
    case "conexao":
      return renderProvedores(estado);
    case "maquinas":
      return renderSecaoMaquinas(estado);
    case "agentes":
      return renderAgentes(estado);
    case "feedback":
      return renderRelatos(estado);
  }
}

/** Máquinas: a lista única (com Este Mac e as chaves dentro) e, na v2, o computador do bot. */
function renderSecaoMaquinas(estado: Estado): string {
  const cb = estado.computadorPessoa ? htmlPainelComputadorDoBot(estado.computadorPessoa, estado.frota?.agentes ?? [], estado.computadorUi, estado.agora, avisoRecriadoDispensado()) : "";
  return `${renderMaquinas(estado)}${cb}`;
}
