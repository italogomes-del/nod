import type { Estado, SecaoEspaco } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { inventarioEmUso, renderExecutor, textoInventario } from "./frota.ts";
import { renderChaves } from "./chaves.ts";
import { renderGestao } from "./gestao.ts";
import { logoApp } from "./marketplace.ts";
import { renderNegacoes, textoMotivo } from "./negacao.ts";
import { renderPreferenciaModoDev } from "./modo-dev.ts";
import { renderRelatos } from "./relatos.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. definido em 2026-09-30 (canvas "Menu, sidebar e
 * gaveta"): abre pelo menu do avatar, em tela cheia por cima da tela atual, já na seção escolhida. As seções ficam na
 * coluna da esquerda, no lugar da barra lateral, e trocar de seção não empilha: o único botão de saída é "‹ <de onde
 * veio>" (mais o Esc), que diz para onde a pessoa volta. Sem ×: os dois fariam a mesma coisa.
 */
export const SECOES_ESPACO: readonly { id: SecaoEspaco; nome: string; icone: string }[] = [
  { id: "conexao", nome: "Conexão", icone: ICONE.plug },
  { id: "avisos", nome: "Avisos", icone: ICONE.sino },
  { id: "preferencias", nome: "Preferências", icone: ICONE.codigo },
  { id: "computadores", nome: "Computadores", icone: ICONE.monitor },
  { id: "agentes", nome: "Gerenciar agentes", icone: ICONE.agentes },
  { id: "relatos", nome: "Relatos", icone: ICONE.bandeira },
];

export type Ambiente = { regime: string; porta?: number | null } | null;
/** Para onde "‹" volta, escrito: o nome do bot (com o mascote), da sala ou da tela. */
export type Volta = { rotulo: string; icone: string };

export function textoAmbiente(ambiente: Ambiente): string | null {
  if (!ambiente) return null;
  const regime = ambiente.regime === "persistente" ? "Banco persistente" : ambiente.regime === "efemero" ? "Banco efêmero" : "Banco não identificado";
  return `${regime}${ambiente.porta ? ` · porta ${ambiente.porta}` : ""}`;
}

export function renderEspaco(estado: Estado, ambiente: Ambiente, avisos: EstadoAvisos, volta: Volta): string {
  const secao = estado.espaco?.secao ?? "conexao";
  const nav = SECOES_ESPACO.map((s) => `<button type="button" class="espaco-item" data-act="secao-espaco" data-secao="${s.id}"${s.id === secao ? ' aria-current="page"' : ""}>${s.icone}<span>${esc(s.nome)}</span></button>`).join("");
  const banco = textoAmbiente(ambiente);
  return `<div class="espaco" role="dialog" aria-modal="true" aria-labelledby="espaco-titulo">
    <nav class="espaco-nav" aria-label="Seções de Seu espaço">
      <div class="espaco-volta"><button type="button" class="espaco-voltar" data-act="fechar-espaco" aria-keyshortcuts="Escape" title="Voltar para ${esc(volta.rotulo)} (Esc)">${ICONE.voltar}${volta.icone}<span>${esc(volta.rotulo)}</span></button><kbd>esc</kbd></div>
      <h1 id="espaco-titulo">Seu espaço</h1>
      <div class="espaco-itens">${nav}</div>
      ${banco ? `<p class="espaco-banco banco-${esc(ambiente?.regime ?? "desconhecido")}"><span aria-hidden="true"></span>${esc(banco)}</p>` : ""}
    </nav>
    <main class="espaco-conteudo">${conteudo(estado, secao, avisos)}</main>
  </div>`;
}

function conteudo(estado: Estado, secao: SecaoEspaco, avisos: EstadoAvisos): string {
  switch (secao) {
    case "conexao":
      return renderConexao(estado);
    case "avisos":
      return renderAvisos(avisos);
    case "preferencias":
      return renderPreferenciaModoDev(estado);
    case "computadores":
      return `<section class="espaco-secao"><h2>Computadores</h2><p class="intro">Uma chave por computador. Perdeu ou trocou de computador? Cancele a chave dele aqui e gere outra.</p>${renderChaves(estado, false)}</section>`;
    case "agentes":
      return renderGestao(estado.gestao ?? null, estado.sessao?.pessoaId);
    case "relatos":
      return renderRelatos(estado);
  }
}

/**
 * Conexão: quem executa o trabalho dos bots, escrito (ADR-029), e os conectores fora do ar — um por linha, com o app,
 * o motivo e desde quando, e "Tentar de novo" (a mesma sonda do marketplace).
 */
function renderConexao(estado: Estado): string {
  const inv = inventarioEmUso(estado);
  const pronto = inv?.estado === "pronto";
  const simulacao = estado.executor?.atual === "catcher";
  const titulo = !inv ? "Verificando conexão…" : !pronto ? (inv.estado === "nao_autenticado" ? "Sua IA não está conectada" : "Sua IA não foi encontrada") : simulacao ? "Modo de simulação" : "Sua IA está conectada";
  const negacoes = [...(estado.frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")];
  const fora = negacoes.filter((n) => n.classe === "conector_indisponivel");
  const outras = negacoes.filter((n) => n.classe !== "conector_indisponivel");
  const linhaFora = (n: (typeof fora)[number]) => {
    const c = estado.conectores.find((x) => x.slug === n.nome || x.nome === n.nome);
    const nome = c?.nome ?? n.nome;
    const tentar = c ? botao("sondar-conector", "Tentar de novo", { classe: "sm", id: c.id }) : "";
    const motivo = textoMotivo(n.motivo);
    return `<div class="espaco-fora" role="status">${logoApp(estado, c?.slug ?? n.nome, nome)}<div><b>${esc(nome)}</b>${motivo ? ` <span>· ${esc(motivo)}</span>` : ""}<small>desde ${esc(hora(n.desde))} (${esc(haQuanto(estado.agora - n.desde))})</small></div>${tentar}</div>`;
  };
  return `<section class="espaco-secao">
      <h2>Conexão</h2>
      <p class="intro">Quem executa o trabalho dos seus bots: a sua conta de IA ou a simulação sem custo.</p>
      <div class="espaco-cartao">
        <div class="espaco-ia"><span class="espaco-ponto ${pronto ? "ok" : "falha"}" aria-hidden="true"></span><div role="status"><b>${esc(titulo)}</b><small>${esc(textoInventario(inv, estado.agora))}</small></div>${botao("sondar-inventario", "Verificar de novo", { classe: "sm", titulo: "Verifica a conexão com sua conta" })}</div>
        ${renderExecutor(estado)}
      </div>
      ${fora.length ? `<h3 class="espaco-subtitulo">Fora do ar</h3>${fora.map(linhaFora).join("")}` : ""}
      ${renderNegacoes(outras, estado.agora)}
    </section>`;
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
      </div>
      <ul class="avisos-regras">
        <li>Só quando o nod não está na frente: com ele aberto, o pedido já aparece na tela.</li>
        <li>No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só.</li>
        <li>Nunca para quedas que se resolvem sozinhas, como o Mac sem contato, nem para pedidos vencidos.</li>
        <li>${numero}</li>
      </ul>
    </section>`;
}
