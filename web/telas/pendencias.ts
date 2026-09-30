import type { Pendencia } from "../../src/contracts/pendencia.ts";
import type { Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora } from "../lib/render.ts";

/**
 * O "a fazer" do bot (definido em 2026-09-30, ADR-064; canvas "Pendências", pranchas F6 e F7, A + C): o que ele anotou
 * para depois. Embaixo da última mensagem da conversa própria, o indicador "N a fazer" abre a lista ali mesmo; na
 * gaveta, a seção "A fazer · N" fica acima de Rotinas. Os dois mostram os mesmos itens com as mesmas ações: Fazer
 * agora (vira a fala "Fazer agora: …" da pessoa na conversa) e Descartar. Sem alarme: a hora só diz a partir de
 * quando o bot volta a ver a pendência.
 */

const DIA = 86_400_000;

/** "hoje às 16:20", "amanhã às 10:00", "ontem às 09:00" ou "03/10 às 09:00", no relógio da máquina. */
export function quandoPendencia(instante: number, agora: number): string {
  const dia = (t: number) => new Date(t).toDateString();
  const h = hora(instante);
  if (dia(instante) === dia(agora)) return `hoje às ${h}`;
  if (dia(instante) === dia(agora + DIA)) return `amanhã às ${h}`;
  if (dia(instante) === dia(agora - DIA)) return `ontem às ${h}`;
  const d = new Date(instante);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} às ${h}`;
}

/** A hora futura mais próxima entre as pendências (a que o indicador cita); null se nenhuma espera hora. */
export function proximaHora(pendencias: readonly Pendencia[], agora: number): number | null {
  const futuras = pendencias.flatMap((p) => (p.aPartirDe !== null && p.aPartirDe > agora ? [p.aPartirDe] : []));
  return futuras.length ? Math.min(...futuras) : null;
}

function anotada(p: Pendencia, agora: number): string {
  if (new Date(p.criadoEm).toDateString() === new Date(agora).toDateString()) return `anotada às ${hora(p.criadoEm)}`;
  const quando = quandoPendencia(p.criadoEm, agora);
  return /^\d/.test(quando) ? `anotada em ${quando}` : `anotada ${quando}`;
}

function item(p: Pendencia, agora: number): string {
  const chip = p.aPartirDe === null
    ? `<span class="pd-chip pd-proxima">${ICONE.proxima}Na próxima rotina ou conversa</span>`
    : `<span class="pd-chip">${ICONE.relogioMini}A partir de ${esc(quandoPendencia(p.aPartirDe, agora))}</span>`;
  // Profundidade 3 = o pedido já tinha dado três passes entre bots (ADR-063): quem anotou não podia repassar.
  const meta = [anotada(p, agora), p.profundidade === 3 ? "o pedido já tinha passado por 3 bots" : "", p.pedidaEm !== null ? `pedida às ${hora(p.pedidaEm)}` : ""].filter(Boolean).join(" · ");
  const dados = { agente: p.agenteId };
  const acoes = botao("pendencia-fazer-agora", "Fazer agora", { id: p.id, classe: "link pd-fazer", dados, titulo: "Manda na conversa: “Fazer agora: …”" })
    + botao("pendencia-descartar", "Descartar", { id: p.id, classe: "link pd-descartar", dados, aria: `Descartar: ${p.texto}` });
  return `<li class="pd-item" data-pendencia="${esc(p.id)}"><span class="pd-marca" aria-hidden="true"></span><div class="pd-corpo">
    <p class="pd-texto">${esc(p.texto)}</p><p class="pd-meta">${chip}<span>${esc(meta)}</span></p><div class="pd-acoes">${acoes}</div></div></li>`;
}

function contagem(n: number): string {
  return `${n} a fazer`;
}

/**
 * Embaixo da última mensagem da conversa própria: nada com zero; fechado, o indicador (com a hora futura mais próxima,
 * se houver); aberto, a lista com Fechar no topo. Lê `agora` só quando há pendência: sem nenhuma, o histórico não é
 * refeito a cada tique (web/lib/lembrar.ts).
 */
export function renderAFazerNaConversa(estado: Estado, agenteId: string): string {
  const lista = estado.pendencias[agenteId] ?? [];
  if (lista.length === 0) return "";
  const agora = estado.agora;
  const nome = estado.frota?.agentes.find((a) => a.id === agenteId)?.nome ?? "do bot";
  // `data-abrir` é o que o clique faz: abre a lista fechada, fecha a aberta.
  const alternar = (aberto: boolean) => `data-act="a-fazer" data-agente="${esc(agenteId)}" data-abrir="${aberto ? "0" : "1"}" aria-expanded="${aberto}"`;
  if (!estado.aFazerAberto[agenteId]) {
    const proxima = proximaHora(lista, agora);
    const quando = proxima !== null ? `<span class="a-fazer-quando">· a partir de ${esc(quandoPendencia(proxima, agora))}</span>` : "";
    return `<div class="a-fazer"><button type="button" class="a-fazer-bt" ${alternar(false)}>${ICONE.aFazer}<b>${contagem(lista.length)}</b>${quando}${ICONE.abrir}</button></div>`;
  }
  return `<div class="a-fazer"><section class="a-fazer-lista" aria-label="A fazer de ${esc(nome)}">
    <button type="button" class="a-fazer-cab" ${alternar(true)}>${ICONE.aFazer}<b>${contagem(lista.length)}</b><span class="a-fazer-fechar">Fechar</span>${ICONE.recolher}</button>
    <ul class="pd-lista">${lista.map((p) => item(p, agora)).join("")}</ul></section></div>`;
}

/** A seção da gaveta, acima de Rotinas; sem pendência, não ocupa lugar. */
export function renderAFazerNaGaveta(estado: Estado, agenteId: string): string {
  const lista = estado.pendencias[agenteId] ?? [];
  if (lista.length === 0) return "";
  return `<section class="gv-secao secao-a-fazer"><div class="gv-secao-cab"><h3>A fazer · ${lista.length}</h3></div>
    <ul class="gv-cartao pd-lista">${lista.map((p) => item(p, estado.agora)).join("")}</ul></section>`;
}
