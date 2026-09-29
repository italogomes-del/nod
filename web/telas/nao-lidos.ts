import type { ConversaNaoLida } from "../../src/contracts/nao-lidos.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { botao, dataHora, esc, hora, iconeAgente } from "../lib/render.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { nomesDe } from "./conversa.ts";
import { abertasPorAgente, perguntasPorAgente } from "./sua-vez.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039; canvas "Nod — tela do agente", página "Não lidos"). Toda fala que
 * chega numa conversa que a pessoa não está vendo marca não lido: o ponto cinza do mascote (o mesmo de antes),
 * a prévia em tinta escura e, na sala, o ponto à direita. Com algo não lido, o ícone entre a busca e o + abre
 * esta tela, a conversa mais recente em cima. Ler aqui não marca como lido: só "Marcar como lido" ou abrir.
 */

export const BANDEJA = '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 5.2 4.5h9.6L17 11.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 11.5h4.2l1 2h3.6l1-2H17"/></svg>';

export function naoLidaDe(estado: Pick<Estado, "naoLidos">, conversaId: string): ConversaNaoLida | undefined {
  return estado.naoLidos?.conversas.find((c) => c.conversaId === conversaId);
}

function conversas(n: number): string {
  return `${n} ${n === 1 ? "conversa" : "conversas"}`;
}

/** "hoje, 08:00", "ontem, 18:40" ou a data: a pessoa lê quando chegou sem fazer conta. */
export function quando(instante: number, agora: number): string {
  const dia = (t: number) => new Date(t).toDateString();
  if (dia(instante) === dia(agora)) return `hoje, ${hora(instante)}`;
  if (dia(instante) === dia(agora - 86_400_000)) return `ontem, ${hora(instante)}`;
  return dataHora(instante);
}

/** O rótulo do ícone do topo da barra ("Não lidos: 4 conversas"). */
export function rotuloNaoLidos(estado: Pick<Estado, "naoLidos">): string {
  const n = estado.naoLidos?.conversas.length ?? 0;
  return n ? `Não lidos: ${conversas(n)}` : "Não lidos: nada novo";
}

function corpoDa(m: Mensagem): string {
  if (m.payload?.kind === "artefato") return `<p>▣ ${esc(m.payload.titulo)}</p>`;
  return textoFormatado(m.texto, { chave: `nao-lido:${m.id}` });
}

function grupo(c: ConversaNaoLida, estado: Estado, decisoes: Map<string, number>, perguntas: Map<string, number>): string {
  const agente = c.agenteId ? estado.frota?.agentes.find((a) => a.id === c.agenteId) : undefined;
  const sala = c.salaId ? estado.salas.find((s) => s.sala.id === c.salaId)?.sala : undefined;
  const nomes = nomesDe(estado);
  const esperando = c.agenteId && (decisoes.get(c.agenteId) ?? 0) > 0 ? "esperando sua decisão" : c.agenteId && (perguntas.get(c.agenteId) ?? 0) > 0 ? "esperando sua resposta" : "";
  const marca = c.tipo === "sala" ? '<span class="nl-sala" aria-hidden="true">#</span>' : agente ? iconeAgente(agente, "sm", "disponivel", esperando ? `data-aviso="${esperando === "esperando sua decisão" ? "decisao" : "pergunta"}"` : "") : "";
  const nome = c.tipo === "sala" ? `# ${sala?.nome ?? "sala"}` : (agente?.nome ?? "bot");
  const detalhe = c.daRotina ? `rotina das ${hora(c.desde)}` : `${c.total} ${c.total === 1 ? "nova" : "novas"}`;
  const chip = agente?.titulo ? `<i class="chip">${esc(agente.titulo)}</i>` : "";
  const tag = esperando ? `<span class="tag tag-ambar">${esc(esperando)}</span>` : "";
  const antes = c.total - c.mensagens.length;
  const mensagens = c.mensagens
    .map((m) => `<div class="nl-msg">${c.tipo === "sala" ? `<small>${esc(assinatura(m.autoria, nomes))}</small>` : ""}${corpoDa(m)}</div>`)
    .join("");
  const abrir = c.tipo === "sala" && c.salaId
    ? botao("abrir-sala", "Abrir conversa", { classe: "link sm", dados: { sala: c.salaId, conversa: c.conversaId } })
    : botao("abrir-conversa", "Abrir conversa", { classe: "link sm", dados: { conversa: c.conversaId, agente: c.agenteId ?? "" } });
  return `<section class="nl-grupo" aria-label="${esc(`${nome}: ${c.total} ${c.total === 1 ? "mensagem nova" : "mensagens novas"}`)}">
    <div class="nl-cab">${marca}<div class="nl-nome"><b>${esc(nome)}</b>${chip}<span>· ${esc(detalhe)}</span>${tag}</div><time>${esc(quando(c.ultimaEm, estado.agora))}</time></div>
    <div class="nl-corpo">${antes > 0 ? `<p class="nl-antes">${antes} ${antes === 1 ? "anterior" : "anteriores"} na conversa</p>` : ""}${mensagens}</div>
    <div class="nl-acoes">${abrir}${botao("marcar-lida", "Marcar como lido", { classe: "link sm mudo-bt", dados: { conversa: c.conversaId } })}</div>
  </section>`;
}

export function renderNaoLidos(estado: Estado): string {
  if (!estado.naoLidos) return '<div class="tela-nao-lidos"><p class="mudo">carregando…</p></div>';
  const lista = estado.naoLidos.conversas;
  const maisAntigo = lista.reduce((min, c) => Math.min(min, c.desde), Infinity);
  const sub = lista.length ? `${conversas(lista.length)} · o mais antigo é de ${quando(maisAntigo, estado.agora)}` : "Nada novo";
  const acao = lista.length ? botao("marcar-tudo-lido", "Marcar tudo como lido", { classe: "sm" }) : "";
  const decisoes = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const corpo = lista.length
    ? lista.map((c) => grupo(c, estado, decisoes, perguntas)).join("")
    : '<p class="nl-vazio">Quando um bot responder, uma rotina entregar ou alguém escrever numa sala enquanto você estiver em outra conversa, aparece aqui.</p>';
  return `<div class="tela-nao-lidos"><header class="nl-topo"><div><h1>Não lidos</h1><p>${esc(sub)}</p></div>${acao}</header>${corpo}</div>`;
}
