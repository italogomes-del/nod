import type { Agente, EsforcoAgente } from "../../src/contracts/agente.ts";
import type { ContaIa } from "../../src/contracts/contas-ia.ts";
import type { IaDaPessoa, PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc, hora } from "../lib/render.ts";
import { ehIaMac, logoDaIa, PROVEDOR, UI_IAS_INICIAL, type IaMac } from "./cartao-ia.ts";
import { contaEmUso } from "./contas-lista.ts";
import {
  conectada, escolhaEfetiva, iaEmUso, iasDaTela, iasDoBot, inteligenciaDoBot, modelosDoMenu, mudarRascunho, niveisDoModelo, NIVEIS, noLimite,
  nomeDoModelo, nomeDoNivel, pedidoDoMenu, pedidoDoRascunho, rascunhoDe, type ContextoInteligencia,
} from "./inteligencia.ts";

/**
 * O seletor de IA no campo (definido em 2026-10-16, plano "tela limpa", T6; protótipos B1 e B2 do canvas "limite e
 * troca"): a troca de IA e de modelo saiu da gaveta e foi para o campo, entre o texto e o microfone, como no Claude
 * Code/Conductor e no ChatGPT. O botão mostra o logo da IA em uso dentro de um anel com o uso da janela de 5 h da
 * assinatura e o rótulo "Auto · Opus" (Automático) ou "Opus" (o bot fixo naquele modelo); a partir de 90% o anel e o
 * número ficam âmbar e o rótulo mostra o número.
 *
 * O menu: o cabeçalho com a conta em uso (só o apelido, nunca o e-mail), o uso e o que acontece se acabar; "Automático";
 * os modelos de cada IA (um clique fixa o bot no modelo); a régua de raciocínio com os níveis que o modelo do momento
 * aceita; e o link para a fila de contas em Provedores de IA. Grava em `PUT agentes/:id/inteligencia` com os mesmos
 * pedidos da gaveta (`pedidoDoMenu`, `pedidoDoRascunho`). A linha "Inteligência" da gaveta continua (ordem, 2B).
 *
 * Funções puras (tests/unit/web/seletor-ia.test.ts); a metade com DOM é web/lib/menu-ia.ts e o miolo é trocado no nó pelo
 * main (o campo nunca é regravado, web/lib/regioes.ts).
 */

/** A partir daqui o anel e o número ficam âmbar (definido em 2026-10-16, canvas B2: "vai acontecer"). */
export const ALERTA_USO = 0.9;

/** O botão do campo, criado uma vez com o composer; o miolo é trocado por `mioloDoSeletor` a cada render. */
export const HTML_SELETOR_IA = '<button type="button" class="seletor-ia" id="composer-ia" data-act="seletor-ia" aria-haspopup="menu" aria-expanded="false" hidden></button>';

export type GrupoDoSeletor = { ia: IaMac; serve: boolean; modelos: { id: string; nome: string; marcado: boolean }[] };

export type DadosSeletor = {
  agenteId: string;
  nome: string;
  dona: boolean;
  auto: boolean;
  /** A IA que responde agora; null = nenhuma conectada. */
  ia: IaMac | null;
  /** O nome do modelo em uso ("Opus"); vazio sem IA. */
  modelo: string;
  /** O modelo que o Automático usaria agora (o subtítulo do item "Automático"). */
  modeloDoAuto: string;
  /** O uso da janela de 5 h da IA em uso (0 a 1, pode passar de 1); null = o CLI ainda não informou. */
  uso: number | null;
  renovaEm: number | null;
  /** O apelido da conta em uso (nunca o e-mail); null = a lista de contas não chegou ou não há conta logada. */
  conta: string | null;
  /** Para onde a conversa vai se a conta acabar ("Claude · Pessoal", "ChatGPT"); null = espera a conta voltar. */
  seguir: string | null;
  raciocinio: EsforcoAgente | null;
  niveis: readonly EsforcoAgente[];
  grupos: GrupoDoSeletor[];
};

const livre = (c: ContaIa, agora: number) => c.noLimiteAte === null || c.noLimiteAte <= agora;
const logada = (c: ContaIa) => c.maquinas.some((v) => v.estado === "pronta");

/**
 * Para onde a conversa segue se a conta acabar, pela regra de hoje (src/domain/contas-da-pessoa.ts, ADR-101/102): outra
 * conta livre da mesma IA quando a pessoa deixou "Trocar sozinho" (corporativa só marcada); senão, no Automático, a
 * próxima IA pronta da ordem; senão nada — o bot espera a conta voltar. definido em 2026-10-16: vale também para o bot
 * fixo, porque a troca entre contas da mesma IA não muda o modelo.
 */
function seguirNo(estado: Estado, ia: IaDaPessoa, auto: boolean, ordem: Parameters<typeof iasDoBot>[1], c: ContextoInteligencia, atual: ContaIa | null): string | null {
  const contas = estado.contasIa?.contas ?? [];
  if (atual && estado.contasIa?.modo === "automatico") {
    const outra = contas.find((x) => x.ia === atual.ia && x.id !== atual.id && livre(x, c.agora) && logada(x) && (!x.corporativa || x.entraNaTrocaAutomatica));
    if (outra && ehIaMac(outra.ia)) return `${PROVEDOR[outra.ia].nome} · ${outra.apelido}`;
  }
  if (!auto) return null;
  const proxima = iasDoBot(c.ias, ordem).find((x) => x.id !== ia.id && ehIaMac(x.id) && conectada(x, c) && !noLimite(x, c));
  if (!proxima || !ehIaMac(proxima.id)) return null;
  const conta = contaEmUso(contas, c.agora, { ia: proxima.id });
  return conta ? `${PROVEDOR[proxima.id].nome} · ${conta.apelido}` : PROVEDOR[proxima.id].nome;
}

/** Tudo o que o botão e o menu mostram para o bot da conversa. null = bot desconhecido (frota ainda não chegou). */
export function dadosDoSeletor(estado: Estado, agenteId: string): DadosSeletor | null {
  const a = estado.frota?.agentes.find((x) => x.id === agenteId);
  if (!a) return null;
  const c: ContextoInteligencia = { ias: iasDaTela(estado), ui: estado.iasMac ?? UI_IAS_INICIAL, agora: estado.agora };
  const i = inteligenciaDoBot(a);
  const auto = i.modo === "auto";
  const uso = iaEmUso(i, c);
  const ia = uso && ehIaMac(uso.id) ? uso.id : null;
  const doAuto = auto ? uso : iaEmUso({ ...i, modo: "auto" }, c);
  const escolha = uso ? escolhaEfetiva(uso, i.escolhas) : null;
  const plano = ia ? estado.usoDoPlano?.planos.find((p) => p.harness === ia) ?? null : null;
  const conta = ia ? contaEmUso(estado.contasIa?.contas ?? [], estado.agora, { ia }) : null;
  const grupos = iasDoBot(c.ias, i.ordem).filter((x) => ehIaMac(x.id)).map((x): GrupoDoSeletor => {
    const id = x.id as IaMac;
    const escolhido = !auto && i.fixa === id ? escolhaEfetiva(x, i.escolhas).modelo : null;
    return { ia: id, serve: conectada(x, c), modelos: modelosDoMenu(x, escolhido).map((m) => ({ id: m.id, nome: m.nome, marcado: m.id === escolhido })) };
  });
  return {
    agenteId: a.id,
    nome: a.nome,
    dona: a.ownerId === estado.sessao?.pessoaId,
    auto,
    ia,
    modelo: uso && escolha ? nomeDoModelo(uso, escolha.modelo) : "",
    modeloDoAuto: doAuto ? nomeDoModelo(doAuto, escolhaEfetiva(doAuto, i.escolhas).modelo) : "",
    uso: plano?.cincoHoras?.utilizacao ?? null,
    renovaEm: plano?.cincoHoras?.renovaEm ?? null,
    conta: conta?.apelido ?? null,
    seguir: uso ? seguirNo(estado, uso, auto, i.ordem, c, conta) : null,
    raciocinio: escolha?.raciocinio ?? null,
    niveis: uso && escolha ? niveisDoModelo(uso, escolha.modelo) : [],
    grupos,
  };
}

const pct = (uso: number): string => `${Math.round(uso * 100)}%`;
const SETA = (para: "baixo" | "cima") => `<svg class="seletor-seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${para === "baixo" ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"}"/></svg>`;
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const MAIS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
/** O anel tem raio 8,5 num quadro de 20: a volta inteira mede 2πr. */
const VOLTA = 2 * Math.PI * 8.5;

/** O anel de uso em volta do logo (20 px). Sem número, só o trilho. */
export function anelDeUso(ia: IaMac | null, uso: number | null): string {
  const feito = uso === null ? 0 : Math.max(0, Math.min(1, uso)) * VOLTA;
  const alerta = uso !== null && uso >= ALERTA_USO;
  const arco = uso === null ? "" : `<circle class="anel-uso" cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="${feito.toFixed(1)} ${VOLTA.toFixed(1)}" stroke-linecap="round"/>`;
  return `<span class="anel${alerta ? " anel-alerta" : ""}"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle class="anel-trilho" cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/>${arco}</svg>${ia ? logoDaIa(ia, "anel-logo") : ""}</span>`;
}

/** O rótulo do botão: "Auto · Opus" ou "Opus" (e "Auto" sozinho sem IA conectada). */
export function rotuloDoSeletor(d: Pick<DadosSeletor, "auto" | "modelo" | "ia">): string {
  if (!d.modelo) return d.auto ? "Automático" : "Escolher IA";
  return d.auto ? `Auto · ${d.modelo}` : d.modelo;
}

/** O miolo do botão do campo e o texto que o leitor de tela ouve. */
export function mioloDoSeletor(d: DadosSeletor, aberto = false): { html: string; titulo: string } {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const numero = alerta && d.uso !== null ? `<span class="seletor-pct">${pct(d.uso)}</span>` : "";
  const ia = d.ia ? `${PROVEDOR[d.ia].nome} ${d.modelo}` : "nenhuma IA conectada";
  const titulo = `IA e modelo: ${d.auto ? "Automático, agora " : ""}${ia}${d.uso !== null ? `, ${pct(d.uso)} da janela usada` : ""}${d.dona ? "" : " · só a dona do bot muda"}`;
  return { html: `${anelDeUso(d.ia, d.uso)}<span class="seletor-rotulo">${esc(rotuloDoSeletor(d))}</span>${numero}${d.dona ? SETA(aberto ? "cima" : "baixo") : ""}`, titulo };
}

/** A frase do cabeçalho do menu: quando renova e o que acontece se a conta acabar. */
export function fraseDoLimite(d: Pick<DadosSeletor, "uso" | "renovaEm" | "seguir">): string {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const renova = d.renovaEm !== null ? `Renova às ${esc(hora(d.renovaEm))}. ` : "";
  const quando = alerta ? "Se acabar agora," : "Se acabar,";
  if (!d.seguir) return `${renova}${quando} espera a conta voltar.`;
  return `${renova}${quando} ${alerta ? "a conversa segue" : "segue"} no <span class="ia-sel-forte">${esc(d.seguir)}</span>.`;
}

/** O menu do seletor (puro, para o teste ler o HTML). */
export function renderMenuIa(d: DadosSeletor): string {
  const alerta = d.uso !== null && d.uso >= ALERTA_USO;
  const cab = d.ia
    ? `<div class="ia-sel-cab${alerta ? " ia-sel-alerta" : ""}">
        <div class="ia-sel-conta">${logoDaIa(d.ia, "ia-sel-logo")}<b>${esc(PROVEDOR[d.ia].nome)}${d.conta ? ` · ${esc(d.conta)}` : ""}</b>${d.uso !== null ? `<span class="ia-sel-pct">${pct(d.uso)}</span>` : ""}</div>
        ${d.uso !== null ? `<div class="ia-sel-barra" aria-hidden="true"><span style="width:${(Math.max(0, Math.min(1, d.uso)) * 100).toFixed(1)}%"></span></div>` : ""}
        <p class="ia-sel-frase">${fraseDoLimite(d)}</p>
      </div><hr>`
    : "";
  const auto = `<button type="button" class="ia-sel-op" role="menuitemradio" aria-checked="${d.auto}" data-escolha="auto"><span class="ia-sel-txt"><span>Automático</span><small>${esc(d.modeloDoAuto ? `Agora no ${d.modeloDoAuto}. ` : "")}Troca de provedor sozinho se a conta acabar.</small></span>${d.auto ? CHECK : ""}</button>`;
  const grupos = d.grupos.map((g) => {
    const titulo = `<div class="ia-sel-grupo">${esc(PROVEDOR[g.ia].nome)} <span>· ${g.serve ? "fixa o bot neste modelo" : "não conectado"}</span></div>`;
    const modelos = g.modelos.map((m) => `<button type="button" class="ia-sel-op" role="menuitemradio" aria-checked="${m.marcado}" data-escolha="modelo" data-ia="${g.ia}" data-modelo="${esc(m.id)}"${g.serve ? "" : " disabled"}><span class="ia-sel-txt"><span>${esc(m.nome)}</span></span>${m.marcado ? CHECK : ""}</button>`).join("");
    return titulo + modelos;
  }).join("");
  return `<div role="menu" aria-label="IA e modelo de ${esc(d.nome)}">${cab}${auto}${grupos}${reguaDeRaciocinio(d)}<hr><button type="button" class="ia-sel-link" data-escolha="provedores"><span>Fila de contas e regra de troca</span>${MAIS}</button></div>`;
}

/** A régua "Raciocínio · Médio · 2 de 5 no Opus": um ponto por nível que o modelo aceita, um clique troca. */
function reguaDeRaciocinio(d: DadosSeletor): string {
  const niveis = NIVEIS.filter((n) => d.niveis.includes(n.id));
  if (!d.ia || niveis.length === 0) return "";
  const n = niveis.length;
  const atual = Math.max(0, niveis.findIndex((x) => x.id === d.raciocinio));
  const passo = 100 / n;
  const pontos = niveis.map((x, i) => `<button type="button" role="radio" class="ia-sel-ponto${i < atual ? " feito" : ""}${i === atual ? " atual" : ""}" aria-checked="${i === atual}" aria-label="${esc(x.nome)}" title="${esc(`${x.nome} · ${x.descricao}`)}" data-escolha="raciocinio" data-raciocinio="${x.id}"></button>`).join("");
  const nomes = niveis.map((x, i) => `<span${i === atual ? ' class="atual"' : ""}>${esc(x.nome)}</span>`).join("");
  const colunas = `grid-template-columns: repeat(${n}, minmax(0, 1fr))`;
  return `<hr><div class="ia-sel-regua">
      <div class="ia-sel-regua-cab"><span>Raciocínio</span><b>${esc(nomeDoNivel(d.raciocinio))}</b><small>· ${atual + 1} de ${n} no ${esc(d.modelo)}</small></div>
      <div class="ia-sel-trilho" role="radiogroup" aria-label="Raciocínio do ${esc(d.modelo)}" style="${colunas}"><span class="ia-sel-linha" aria-hidden="true" style="left:${(passo / 2).toFixed(2)}%;right:${(passo / 2).toFixed(2)}%"></span><span class="ia-sel-linha feita" aria-hidden="true" style="left:${(passo / 2).toFixed(2)}%;width:${(atual * passo).toFixed(2)}%"></span>${pontos}</div>
      <div class="ia-sel-nomes" aria-hidden="true" style="${colunas}">${nomes}</div>
    </div>`;
}

/** O que um clique no menu escolheu. */
export type EscolhaSeletor = { tipo: "auto" } | { tipo: "modelo"; ia: IaMac; modelo: string } | { tipo: "raciocinio"; raciocinio: EsforcoAgente } | { tipo: "provedores" };

/** Lê a escolha do item clicado (os `data-*` do menu). */
export function escolhaDoItem(dados: { escolha?: string; ia?: string; modelo?: string; raciocinio?: string }): EscolhaSeletor | null {
  if (dados.escolha === "auto") return { tipo: "auto" };
  if (dados.escolha === "provedores") return { tipo: "provedores" };
  if (dados.escolha === "modelo" && ehIaMac(dados.ia) && dados.modelo) return { tipo: "modelo", ia: dados.ia, modelo: dados.modelo };
  const nivel = NIVEIS.find((n) => n.id === dados.raciocinio);
  if (dados.escolha === "raciocinio" && nivel) return { tipo: "raciocinio", raciocinio: nivel.id };
  return null;
}

/**
 * O pedido de `PUT agentes/:id/inteligencia` para uma escolha do menu: Automático e modelo pelo `pedidoDoMenu` da gaveta
 * (2A); o raciocínio troca só o nível da IA em uso, pelo rascunho da 2B (o resto da inteligência fica como está). null =
 * nada a gravar (a escolha é a atual, ou não há IA em uso para o raciocínio).
 */
export function pedidoDoSeletor(a: Pick<Agente, "id" | "harness" | "modelo" | "esforco" | "inteligencia">, escolha: EscolhaSeletor, c: ContextoInteligencia): PedidoInteligencia | null {
  const i = inteligenciaDoBot(a);
  if (escolha.tipo === "provedores") return null;
  if (escolha.tipo === "auto") return i.modo === "auto" ? null : pedidoDoMenu(a, { modo: "auto" });
  if (escolha.tipo === "modelo") {
    const ia = c.ias.find((x) => x.id === escolha.ia);
    const atual = ia && i.modo === "fixa" && i.fixa === escolha.ia ? escolhaEfetiva(ia, i.escolhas).modelo : null;
    return atual === escolha.modelo ? null : pedidoDoMenu(a, { ia: escolha.ia, modelo: escolha.modelo });
  }
  const uso = iaEmUso(i, c);
  if (!uso || escolhaEfetiva(uso, i.escolhas).raciocinio === escolha.raciocinio) return null;
  return pedidoDoRascunho(mudarRascunho(rascunhoDe(a), { tipo: "raciocinio", ia: uso, raciocinio: escolha.raciocinio }, c));
}
