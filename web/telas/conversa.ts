import type { Agente } from "../../src/contracts/agente.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ConversaEstado, Estado, TurnoVivo } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { botao, dataHora, esc, hora, iconeAgente, paragrafos } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { estadoMascoteNaConversa } from "../lib/mascote.ts";
import { renderFaixaParada } from "./faixa-parada.ts";
import { renderDecisoesDaConversa } from "./sua-vez.ts";

/** id → nome (agentes da frota + a pessoa da sessão); id desconhecido cai no genérico, nunca no uuid. */
export function nomesDe(estado: Estado): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const a of estado.frota?.agentes ?? []) mapa[a.id] = a.nome;
  if (estado.sessao) mapa[estado.sessao.pessoaId] = "você";
  return mapa;
}

function agenteDe(estado: Estado, id: string): (Agente & { conversaId: string; descricaoEstado: string }) | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
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
    const alvo = agenteDe(estado, p.para);
    return `<div class="msg-handoff"><div class="handoff-titulo">↗ <b>${esc(de)} → ${esc(para)}</b><span>${p.tarefaId ? "pedido de colaboração" : "passou a vez"}</span></div><p>${esc(p.motivo)}</p>${alvo ? botao("abrir-conversa", "Ver conversa de " + esc(para), { classe: "link", dados: { conversa: alvo.conversaId, agente: alvo.id } }) : ""}</div>`;
  }
  if (p?.kind === "passe") return `<div class="msg-passe">⏭ ${paragrafos(m.texto)} <span class="tag tag-cinza">${esc(p.motivo.replaceAll("_", " "))}</span></div>`;
  if (p?.kind === "consentimento") return `<div class="msg-consentimento"><b>Acesso permitido · ${esc(p.slug)}</b><div>${esc(p.capacidade)}</div><details data-disclosure="consentimento-${esc(m.id)}"><summary>Ver registro de autorização</summary>${paragrafos(m.texto)}</details></div>`;
  if (p?.kind === "rotina_execucao") return `<div class="msg-rotina msg-rotina-${esc(p.desfecho)}">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "resultado_aprovacao") return `<div class="msg-resultado">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "negacao") return `<div class="negacao negacao-${esc(p.classe)}">${paragrafos(m.texto)}${p.terminal ? ' <span class="tag tag-ambar">terminal</span>' : ""}</div>`;
  if (p?.kind === "parada") return `<div class="msg-parada">■ ${paragrafos(m.texto)}</div>`;
  if (p?.kind === "peer_ask") return `<div class="msg-peer"><div class="handoff-titulo">↙ <b>Resposta de ${esc(p.nome)}</b></div><div>${textoFormatado(m.texto)}</div><small class="mudo">Contribuição de outro bot · confira as fontes</small></div>`;
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "";
  return `<div class="msg-texto">${paragrafos(m.texto)}${naoConfiavel}${m.parcial ? ' <span class="tag tag-cinza">parcial</span>' : ""}</div>`;
}

/**
 * Uma mensagem. Texto vira BALÃO (protótipo private-agents-minimal): você à direita (preto), o bot à
 * esquerda (cinza). Os demais kinds (sistema, handoff, negação, rotina…) seguem como linhas discretas.
 * `mostrarAutor` liga o nome do bot dentro do balão — útil em salas com vários agentes.
 */
export function renderMensagem(m: Mensagem, estado: Estado, _mostrarAutor = false): string {
  if (m.kind !== "texto") return corpoMensagem(m, estado);
  const ehPessoa = m.autoria.autor_tipo === "pessoa";
  const agente = ehPessoa ? undefined : agenteDe(estado, m.autoria.autor_id);
  const sender = `<div class="msg-autor"><b>${ehPessoa ? "Você" : esc(agente?.nome ?? assinatura(m.autoria, nomesDe(estado)))}</b><time>${hora(m.criadoEm)}</time></div>`;
  const tags = ehPessoa || m.payload?.kind === "peer_pedido" || m.payload?.kind === "boas_vindas"
    ? ""
    : [badgeExecutor(m), m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "", m.parcial ? '<span class="tag tag-cinza">parcial</span>' : ""].filter(Boolean).join("");
  const metaTags = tags ? `<div class="meta-tags">${tags}</div>` : "";
  return `<article class="message ${ehPessoa ? "you" : "bot"}" data-mensagem="${esc(m.id)}">
    ${!ehPessoa && agente ? iconeAgente(agente, "md") : ""}<div class="bubble-wrap">${sender}<div class="bubble">${ehPessoa ? paragrafos(m.texto) : textoFormatado(m.texto)}${metaTags}</div></div>
  </article>`;
}

function renderProposta(p: Proposta, estado: Estado): string {
  const a = agenteDe(estado, p.agenteId);
  if (p.payload.kind === "acesso" && p.payload.conectar) {
    const slug = p.payload.conector;
    const conectado = estado.conectores.some((c) => c.slug === slug && c.habilitado);
    const nome = estado.marketplace.find((a) => a.slug === slug)?.nome ?? p.payload.conector;
    return `<section class="connection-card"><span class="app-logo app-${esc(p.payload.conector)}">${esc(nome.slice(0, 1).toUpperCase())}</span><div><b>${conectado ? `${esc(nome)} conectado` : `Conecte o ${esc(nome)}`}</b><p>${conectado ? "Tudo pronto para continuar com seu bot." : "Para seguir com essa tarefa, preciso de acesso a este app."}</p>${conectado ? botao("retomar-conexao", "Continuar tarefa", { classe: "pri", id: p.id, dados: { slug: p.payload.conector } }) : botao("abrir-conexao", "Conectar", { classe: "pri", id: p.payload.conector })}${botao("recusar-proposta", "Agora não", { classe: "link", id: p.id })}</div></section>`;
  }
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
    ${p.payload.kind === "acesso" ? '<div class="it">Revise o pedido. A autorização final aparecerá aqui na conversa.</div>' : ""}
    <div class="ft">${botao("confirmar-proposta", p.payload.kind === "acesso" ? "Revisar acesso" : "Confirmar", { classe: "pri", id: p.id })}${botao("recusar-proposta", "Deixar de lado", { id: p.id })}</div>
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

/** definido em 2026-09-17: uma linha por turno remetente; respostas se ligam pelo tarefaId, não pelo texto. */
export function renderMensagensAgrupadas(mensagens: Mensagem[], estado: Estado, sala = false): string {
  const grupos = new Map<string, Mensagem[]>();
  const tarefas = new Map<string, string>();
  for (const m of mensagens) {
    if (m.payload?.kind === "handoff" && m.payload.tarefaId) tarefas.set(m.payload.tarefaId, m.turnoId ?? m.id);
  }
  const grupoDe = (m: Mensagem): string | undefined => {
    if (m.payload?.kind === "handoff" && m.payload.tarefaId) return tarefas.get(m.payload.tarefaId);
    if (m.payload?.kind === "peer_ask") return tarefas.get(m.payload.tarefaId) ?? m.payload.turnoOrigemId ?? m.id;
    return undefined;
  };
  for (const m of mensagens) {
    const k = grupoDe(m);
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }
  const mostrados = new Set<string>();
  return mensagens.map((m) => {
    const k = grupoDe(m);
    if (!k) return renderMensagem(m, estado, sala);
    if (mostrados.has(k)) return "";
    mostrados.add(k);
    const grupo = grupos.get(k) ?? [];
    const participantes = [...new Set(grupo.flatMap((x) => x.payload?.kind === "handoff" ? [x.payload.para] : x.payload?.kind === "peer_ask" ? [x.payload.agenteId] : []))];
    const avatares = participantes.map((id) => agenteDe(estado, id)).flatMap((a) => a ? [iconeAgente(a, "sm")] : []).join("");
    const nome = participantes.length === 1 ? agenteDe(estado, participantes[0] ?? "")?.nome ?? "outro bot" : `${participantes.length} bots`;
    return `<details class="collaboration" data-disclosure="${esc(k)}"><summary>${grupo.length} ${grupo.length === 1 ? "mensagem" : "mensagens"} com <span class="avatar-stack">${avatares}</span><span>${esc(nome)}</span><span class="chevron">⌄</span></summary><div class="collaboration-panel">${participantes.map((id) => {
      const a = agenteDe(estado, id);
      const trocas = grupo.filter((x) => x.payload?.kind === "handoff" ? x.payload.para === id : x.payload?.kind === "peer_ask" && x.payload.agenteId === id);
      return `<details data-disclosure="${esc(k + id)}"><summary>${a ? iconeAgente(a, "sm") : ""}<b>${esc(a?.nome ?? "Outro bot")}</b><small>${trocas.length} mensagens</small></summary><div class="collaboration-messages">${trocas.map((x) => `<div><small>${x.payload?.kind === "handoff" ? "Pedido" : "Resposta"} · ${hora(x.criadoEm)}</small>${textoFormatado(x.payload?.kind === "handoff" ? x.payload.motivo : x.texto)}</div>`).join("")}${a ? botao("abrir-conversa", `Conversar com ${esc(a.nome)}`, { classe: "link", dados: { conversa: a.conversaId, agente: a.id } }) : ""}</div></details>`;
    }).join("")}</div></details>`;
  }).join("");
}

export function renderTimeline(c: ConversaEstado | null, estado: Estado): string {
  if (!c) return `<div class="mudo">carregando conversa…</div>`;
  const vivos = Object.values(estado.turnosVivos).filter((t) => t.conversaId === c.conversa.id);
  const sala = c.conversa.tipo === "sala";
  const primeira = c.mensagens[0];
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const acolhimento = agente && !agente.confirmado && c.mensagens.some((m) => m.payload?.kind === "boas_vindas") && !c.mensagens.some((m) => m.kind === "texto" && m.autoria.autor_tipo === "pessoa") ? `<section class="welcome-options"><h2>Por onde começamos?</h2><p>Escolha uma ideia ou escreva no chat.</p>${[
    ["Tarefas do dia a dia", "Lembretes, organização e acompanhamento", "Quero ajuda com tarefas do dia a dia: lembretes e organização."],
    ["Trabalho e projetos", "Prioridades, equipe, Slack e código", "Quero ajuda com meu trabalho e projetos."],
    ["Pesquisa e ideias", "Explorar assuntos e encontrar respostas", "Quero ajuda com pesquisa e desenvolvimento de ideias."],
    ["Ainda não sei", "Vamos descobrir juntos", "Ainda não sei. Me ajude a descobrir como você pode ser útil."],
  ].map(([titulo, descricao, texto], i) => botao("escolher-missao", `<span class="option-key">${String.fromCharCode(65 + i)}</span><span><b>${titulo}</b><small>${descricao}</small></span><span>↗</span>`, { classe: "welcome-option", dados: { texto: texto ?? "" } })).join("")}</section>` : "";
  const sep = primeira ? `<div class="time-sep">${esc(dataHora(primeira.criadoEm))}</div>` : "";
  return `<div class="timeline">
    ${sep}
    ${renderMensagensAgrupadas(c.mensagens, estado, sala)}
    ${acolhimento}
    ${c.propostas.map((p) => renderProposta(p, estado)).join("")}
    ${renderDecisoesDaConversa(estado, c.conversa.id, new Set(c.propostas.map((p) => p.id)))}
    ${vivos.map((t) => renderTurnoVivo(t, c, estado)).join("")}
    ${renderFaixaParada(estado.faixaParada)}
  </div>`;
}

/** Cabeçalho da conversa própria: nome, badge do executor e as ações (perfil, memória, Parar). */
export function renderCabecalhoConversa(estado: Estado, agenteId: string): string {
  const a = agenteDe(estado, agenteId);
  const nome = a?.nome ?? "agente";
  const vivo = Object.values(estado.turnosVivos).find((v) => v.conversaId === a?.conversaId);
  const pendente = estado.suaVez?.itens.some((item) => item.decisao.conversaId === a?.conversaId && item.estadoColuna !== "vencido");
  return `<div class="cab-esq">${a ? iconeAgente(a, "lg", estadoMascoteNaConversa(estado, a.conversaId)) : ""}<div class="cab-identidade"><div><span class="nome">${esc(nome)}</span><span class="presenca ${vivo ? "ativa" : ""}">${pendente ? "Aguardando você" : vivo ? "Trabalhando" : estado.executor?.atual === "claude-cli" ? "Disponível" : "Simulação"}</span></div><p>${esc(a?.titulo || "Seu bot")}</p></div></div>
    <div class="cab-acoes">
      ${botao("menu-agente", "•••", { id: agenteId, titulo: `Ações de ${nome}` })}
      ${botao("alternar-detalhes", "Detalhes", { classe: "toggle-detalhes" })}${botao("ir-perfil", "Perfil", { id: agenteId })}
      ${botao("ir-memoria", "Memória", { id: agenteId })}
      ${botao("parar-conversa", "Parar", { classe: "perigo", titulo: "interrompe agora o que está rodando nesta conversa" })}
    </div>`;
}

/** Composer criado UMA vez por conversa (main.ts não o regrava): textarea + enviar. */
export function htmlComposer(placeholder: string, sugestoes: readonly string[] = []): string {
  const lista = sugestoes.length ? `<div class="autocomplete" id="autocomplete" hidden></div>` : "";
  return `<div class="composer"><div class="box">${lista}<textarea id="composer-texto" rows="1" placeholder="${esc(placeholder)}" data-sugestoes="${esc(JSON.stringify(sugestoes))}"></textarea><button class="send" data-act="enviar" aria-label="Enviar">➤</button></div>
  <p class="nota">Enter envia · Shift+Enter quebra linha${sugestoes.length ? " · @ menciona um bot" : ""}</p></div>`;
}
