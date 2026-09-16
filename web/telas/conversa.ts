import type { Agente } from "../../src/contracts/agente.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ConversaEstado, Estado, TurnoVivo } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { botao, dataHora, esc, iconeAgente, paragrafos } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { renderFaixaParada } from "./faixa-parada.ts";

/** id → nome (agentes da frota + a pessoa da sessão); id desconhecido cai no genérico, nunca no uuid. */
export function nomesDe(estado: Estado): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const a of estado.frota?.agentes ?? []) mapa[a.id] = a.nome;
  if (estado.sessao) mapa[estado.sessao.pessoaId] = "você";
  return mapa;
}

function agenteDe(estado: Estado, id: string): (Agente & { conversaId: string; descricaoEstado: string }) | undefined {
  return estado.frota?.agentes.find((a) => a.id === id);
}

/** Badge de executor (plano): 'catcher' ou 'rodou em <máquina>' — dado tipado da autoria, nunca texto. */
export function badgeExecutor(m: Pick<Mensagem, "autoria">): string {
  if (m.autoria.autor_tipo !== "agente") return "";
  if (m.autoria.executor === "catcher") return `<span class="tag tag-catcher" title="executor catcher: sem CLI, sem custo">catcher</span>`;
  const maquina = m.autoria.machine_id ? m.autoria.machine_id.slice(0, 8) : "esta máquina";
  return `<span class="tag tag-cinza" title="claude-cli na máquina da pessoa">rodou em ${esc(maquina)}</span>`;
}

function corpoMensagem(m: Mensagem, estado: Estado): string {
  const p = m.payload;
  if (m.kind === "sistema") return `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "handoff") {
    const de = agenteDe(estado, p.de)?.nome ?? "agente";
    const para = agenteDe(estado, p.para)?.nome ?? "agente";
    return `<div class="msg-handoff">↪ <b>${esc(de)}</b> passou para <b>${esc(para)}</b>: ${esc(p.motivo)}</div>`;
  }
  if (p?.kind === "passe") return `<div class="msg-passe">⏭ ${paragrafos(m.texto)} <span class="tag tag-cinza">${esc(p.motivo.replaceAll("_", " "))}</span></div>`;
  if (p?.kind === "consentimento") return `<div class="msg-consentimento">🔏 ${paragrafos(m.texto)}<small>não inclui: ${esc(p.naoInclui.length ? p.naoInclui.join("; ") : "nada mais deste conector")}</small></div>`;
  if (p?.kind === "rotina_execucao") return `<div class="msg-rotina msg-rotina-${esc(p.desfecho)}">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "resultado_aprovacao") return `<div class="msg-resultado">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "negacao") return `<div class="negacao negacao-${esc(p.classe)}">${paragrafos(m.texto)}${p.terminal ? ' <span class="tag tag-ambar">terminal</span>' : ""}</div>`;
  if (p?.kind === "parada") return `<div class="msg-parada">■ ${paragrafos(m.texto)}</div>`;
  if (p?.kind === "peer_ask") return `<div class="msg-peer"><span class="tag tag-ambar">resposta de ${esc(p.nome)} · bot não supervisionado · conteúdo não confiável</span>${paragrafos(m.texto)}</div>`;
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "";
  return `<div class="msg-texto">${paragrafos(m.texto)}${naoConfiavel}${m.parcial ? ' <span class="tag tag-cinza">parcial</span>' : ""}</div>`;
}

/** Ações de hover do balão (protótipo): reação, responder, mais — decorativas, sem efeito ainda. */
const ACOES_BALAO = '<div class="msg-actions"><button type="button" title="Reação">☺</button><button type="button" title="Responder">↩</button><button type="button" title="Mais">…</button></div>';

/**
 * Uma mensagem. Texto vira BALÃO (protótipo private-agents-minimal): você à direita (preto), o bot à
 * esquerda (cinza). Os demais kinds (sistema, handoff, negação, rotina…) seguem como linhas discretas.
 * `mostrarAutor` liga o nome do bot dentro do balão — útil em salas com vários agentes.
 */
export function renderMensagem(m: Mensagem, estado: Estado, mostrarAutor = false): string {
  if (m.kind !== "texto") return corpoMensagem(m, estado);
  const ehPessoa = m.autoria.autor_tipo === "pessoa";
  const agente = ehPessoa ? undefined : agenteDe(estado, m.autoria.autor_id);
  const sender = !ehPessoa && mostrarAutor ? `<span class="sender">${esc(agente?.nome ?? assinatura(m.autoria, nomesDe(estado)))}</span>` : "";
  const tags = ehPessoa
    ? ""
    : [badgeExecutor(m), m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "", m.parcial ? '<span class="tag tag-cinza">parcial</span>' : ""].filter(Boolean).join("");
  const metaTags = tags ? `<div class="meta-tags">${tags}</div>` : "";
  return `<article class="message ${ehPessoa ? "you" : "bot"}" data-mensagem="${esc(m.id)}">
    <div class="bubble-wrap">${ACOES_BALAO}<div class="bubble">${sender}${paragrafos(m.texto)}${metaTags}</div></div>
  </article>`;
}

function renderProposta(p: Proposta, estado: Estado): string {
  const a = agenteDe(estado, p.agenteId);
  let itens = "";
  if (p.payload.kind === "perfil") {
    const c = p.payload;
    itens = [c.nome ? `<div class="it"><b>nome</b>${esc(c.nome)}</div>` : "", c.titulo ? `<div class="it"><b>título</b>${esc(c.titulo)}</div>` : "", c.descricao ? `<div class="it"><b>descrição</b>${esc(c.descricao)}</div>` : ""].join("");
  } else if (p.payload.kind === "rotina") {
    const c = p.payload;
    itens = `<div class="it"><b>quando</b>${esc(c.resumo)} · próxima execução ${esc(dataHora(c.proximaExecucao, c.fusoIana))} (${esc(c.fusoIana)})</div><div class="it"><b>instrução</b>${esc(c.instrucao)}</div><div class="it"><b>fonte</b>${esc(c.fonte)}</div><div class="it"><b>entregável</b>${esc(c.entregavel)}</div><div class="it"><b>limites de aprovação</b>${esc(c.limitesAprovacao)}</div><div class="it"><b>sem dado</b>${esc(c.politicaSemDado)}</div>`;
  } else {
    const c = p.payload;
    itens = `<div class="it"><b>conector</b>${esc(c.conector)}</div><div class="it"><b>capacidades</b>${esc(c.capacidades.join(", "))} (${esc(c.nivel)})</div><div class="it"><b>não pedido</b>${esc(c.naoPedido.join(", ") || "—")}</div>`;
  }
  return `<div class="card-prop" data-proposta="${esc(p.id)}">
    <div class="hd">${esc(a?.nome ?? "o agente")} propõe · nada vale antes de você confirmar</div>
    <div class="ttl">${p.payload.kind === "perfil" ? "Perfil" : p.payload.kind === "rotina" ? "Rotina" : "Acesso a conector"}</div>
    ${itens}
    <div class="ft">${botao("confirmar-proposta", "Confirmar", { classe: "pri", id: p.id })}${botao("recusar-proposta", "Deixar de lado", { id: p.id })}</div>
  </div>`;
}

function renderTurnoVivo(t: TurnoVivo, c: ConversaEstado, estado: Estado): string {
  const delta = c.deltas[t.turnoId];
  if (delta) {
    return `<article class="message bot streaming" data-turno="${esc(t.turnoId)}"><div class="bubble-wrap"><div class="bubble">${paragrafos(delta)}<span class="cursor">▍</span></div></div></article>`;
  }
  const pendente = c.turnosPendentes.find((p) => p.id === t.turnoId);
  if (pendente && pendente.conversaId !== c.conversa.id) {
    const outra = estado.frota?.agentes.find((a) => a.conversaId === pendente.conversaId);
    return `<div class="msg-sistema">na fila — o agente está respondendo em ${esc(outra ? `#${outra.nome}` : "outra conversa")} (${haQuanto(estado.agora - t.desde)})</div>`;
  }
  return `<div class="msg-sistema">${t.estado === "rodando" ? "trabalhando" : "na fila"} · ${esc(t.executor ?? "")} · ${haQuanto(estado.agora - t.desde)}</div>`;
}

export function renderTimeline(c: ConversaEstado | null, estado: Estado): string {
  if (!c) return `<div class="mudo">carregando conversa…</div>`;
  const vivos = Object.values(estado.turnosVivos).filter((t) => t.conversaId === c.conversa.id);
  const sala = c.conversa.tipo === "sala";
  const primeira = c.mensagens[0];
  const sep = primeira ? `<div class="time-sep">${esc(dataHora(primeira.criadoEm))}</div>` : "";
  return `<div class="timeline">
    ${sep}
    ${c.mensagens.map((m) => renderMensagem(m, estado, sala)).join("")}
    ${c.propostas.map((p) => renderProposta(p, estado)).join("")}
    ${vivos.map((t) => renderTurnoVivo(t, c, estado)).join("")}
    ${renderFaixaParada(estado.faixaParada)}
  </div>`;
}

/** Cabeçalho da conversa própria: nome, badge do executor e as ações (perfil, memória, Parar). */
export function renderCabecalhoConversa(estado: Estado, agenteId: string): string {
  const a = agenteDe(estado, agenteId);
  const nome = a?.nome ?? "agente";
  return `<div class="cab-esq">${a ? iconeAgente(a, "md") : ""}<span class="nome">${esc(nome)}</span><span class="tag">${esc(a?.descricaoEstado ?? "privado")}</span></div>
    <div class="cab-acoes">
      ${botao("ir-perfil", "Perfil", { id: agenteId })}
      ${botao("ir-memoria", "Memória", { id: agenteId })}
      ${botao("parar-conversa", "Parar", { classe: "perigo", titulo: "interrompe agora o que está rodando nesta conversa" })}
    </div>`;
}

/** Composer criado UMA vez por conversa (main.ts não o regrava): textarea + enviar. */
export function htmlComposer(placeholder: string, sugestoes: readonly string[] = []): string {
  const lista = sugestoes.length ? `<div class="autocomplete" id="autocomplete" hidden></div>` : "";
  return `<div class="composer"><div class="box">${lista}<textarea id="composer-texto" rows="1" placeholder="${esc(placeholder)}" data-sugestoes="${esc(JSON.stringify(sugestoes))}"></textarea><button class="send" data-act="enviar" aria-label="Enviar">↑</button></div>
  <p class="nota">Enter envia · Shift+Enter quebra linha${sugestoes.length ? " · @ menciona um bot" : ""}</p></div>`;
}
