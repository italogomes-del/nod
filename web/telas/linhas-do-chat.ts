import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TipoLinha, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { aberto, abertosDoBot, juntar, pilulaMemoria, tempoDe, trabalhosConhecidos } from "../lib/trabalhos.ts";
import { usd } from "./modo-dev.ts";

/**
 * Chat limpo (definido em 2026-10-07, #191/#195, ADR-081): o que NÃO é a conversa entre a pessoa e o bot sai do caminho.
 * Este módulo decide, mensagem a mensagem, o que a timeline desenha:
 *
 * - **rotina**: execuções seguidas da mesma rotina, sem nada para a pessoa, viram UMA linha centralizada
 *   ("Triagem do Slack rodou 4 vezes · 11:00 a 11:30 · nada para você"); a execução que termina com algo para ela vira
 *   balão com a etiqueta "da rotina …"; a que falhou continua com a linha de sempre;
 * - **bots entre si** (o padrão do Grok): quem recebe um pedido vê "Pedido do Chico · 3 mensagens" no lugar do pedido e
 *   das falas da delegação; quem pede vê "Enviou mensagem para Dev 1 e Dev 2" e, quando as respostas voltam, "5 mensagens
 *   com Dev 1 e Dev 2" — a fala de quem pediu, depois, continua balão;
 * - **task**: a linha "Abriu a task …"; as falas do meio do trabalho ficam só na tela da task; a pergunta e o resultado
 *   viram balão com a etiqueta "da task …".
 *
 * A web nunca adivinha: só agrupa com os campos que o servidor marca (`origemTurno`, `trabalhoId`, `fimDoTurno`). Uma
 * mensagem sem eles (servidor anterior ao épico) segue como antes. As linhas abrem a tela da task (ou, sem trabalho por
 * trás, a tela provisória com as mensagens que a linha recolheu) e contam na telemetria pelos `data-linha-*`.
 */

export type PlanoMensagem =
  | { tipo: "oculta" }
  /** `antes`: uma linha que entra logo acima do balão ("Migrar relatórios terminou · 39 min"). */
  | { tipo: "balao"; etiqueta: string; antes?: string }
  | { tipo: "linha"; html: string; chave: string };

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** Uma execução de rotina, um pedido de colega ou um trabalho: as mensagens do mesmo trabalho (ou do mesmo turno, sem ele). */
type Unidade = { chave: string; tipo: "rotina" | "colega" | "task" | null; mensagens: Mensagem[]; trabalhoId: string | null; trabalho: TrabalhoDto | undefined; rotinaId: string | null };

/** Rotina que parou sem nada para dizer (registrarDesfechoRotina, SILENCIOSOS): nenhuma linha dela vai ao chat. */
const DESFECHOS_SILENCIOSOS = new Set(["sem_novidade", "interrompida"]);
/** Rotina que falhou ou ficou parada esperando acesso: a linha de sempre continua à vista, fora do grupo. */
const DESFECHOS_A_VISTA = new Set(["falhou", "bloqueada"]);

function agente(estado: Estado, id: string | null | undefined): Agente | undefined {
  if (!id) return undefined;
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

/** A mensagem veio de um servidor que já marca turno e trabalho (ADR-081)? Sem as marcas, nada muda. */
const marcada = (m: Mensagem): boolean => m.origemTurno !== undefined || m.trabalhoId !== undefined || m.fimDoTurno !== undefined;

/** Fala da pessoa ou do bot que pode sumir para dentro de uma linha (os cards, recibos e avisos ficam à vista). */
function recolhivel(m: Mensagem): boolean {
  const k = m.payload?.kind;
  if (k === "trabalho_aberto" || k === "pedido_a_pessoa") return false;
  return m.kind === "texto" || m.kind === "rotina_execucao" || m.kind === "handoff" || m.kind === "peer_ask";
}

/**
 * A fala da pessoa fica no chat, salvo a que ela escreveu no campo da tela da task (definido em 2026-10-08, revisão W8):
 * essa leva o `trabalhoId` e mora na task. A da `rede` é a exceção — ali a conversa é que virou task, e a fala foi
 * escrita no chat. Sem saber a origem (o trabalho fora da lista e sem a linha "Abriu a task"), a fala fica à vista.
 */
function falaDaPessoaNoChat(m: Mensagem, origens: ReadonlyMap<string, string>): boolean {
  if (m.autoria.autor_tipo !== "pessoa" || m.kind !== "texto") return false;
  const origem = m.trabalhoId ? origens.get(m.trabalhoId) : undefined;
  return origem === undefined || origem === "rede";
}

function unidadesDe(mensagens: readonly Mensagem[], conhecidos: ReadonlyMap<string, TrabalhoDto>): Map<string, Unidade> {
  const unidades = new Map<string, Unidade>();
  const origens = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "trabalho_aberto") origens.set(m.payload.trabalhoId, m.payload.origem);
  for (const t of conhecidos.values()) origens.set(t.id, t.origem);
  for (const m of mensagens) {
    if (!marcada(m) || falaDaPessoaNoChat(m, origens)) continue;
    const chave = m.trabalhoId ? `trabalho:${m.trabalhoId}` : m.turnoId ? `turno:${m.turnoId}` : null;
    if (!chave) continue;
    const u = unidades.get(chave) ?? { chave, tipo: null, mensagens: [], trabalhoId: m.trabalhoId ?? null, trabalho: m.trabalhoId ? conhecidos.get(m.trabalhoId) : undefined, rotinaId: null };
    u.mensagens.push(m);
    unidades.set(chave, u);
  }
  for (const u of unidades.values()) {
    const p = u.mensagens.map((m) => m.payload?.kind);
    const execucao = u.mensagens.find((m) => m.payload?.kind === "rotina_execucao")?.payload;
    u.rotinaId = u.trabalho?.rotinaId ?? (execucao?.kind === "rotina_execucao" ? execucao.rotinaId : null);
    const origem = u.trabalho?.origem;
    if (origem === "rotina" || (!origem && (p.includes("rotina_execucao") || u.mensagens.some((m) => m.origemTurno === "rotina")))) u.tipo = "rotina";
    else if (origem === "colega" || (!origem && (p.includes("peer_pedido") || u.mensagens.some((m) => m.origemTurno === "delegacao")))) u.tipo = "colega";
    else if (origem || u.trabalhoId) u.tipo = "task";
  }
  return unidades;
}

/** "09:10", "09:10 e 09:20", "11:00 a 11:30". */
export function horariosDaRotina(instantes: readonly number[]): string {
  const h = [...instantes].sort((a, b) => a - b).map((t) => hora(t));
  if (h.length <= 1) return h[0] ?? "";
  if (h.length === 2) return `${h[0]} e ${h[1]}`;
  return `${h[0]} a ${h[h.length - 1]}`;
}

function nomeDaRotina(estado: Estado, u: Unidade): string | null {
  if (u.trabalho?.rotinaNome) return u.trabalho.rotinaNome;
  const r = u.rotinaId ? estado.rotinas.find((x) => x.rotina.id === u.rotinaId)?.rotina : undefined;
  if (r) return r.instrucao.length > 48 ? `${r.instrucao.slice(0, 47).trimEnd()}…` : r.instrucao;
  return u.trabalho?.titulo ?? null;
}

const SETA = '<span class="linha-seta" aria-hidden="true">›</span>';

/**
 * A linha centralizada clicável. Abre a tela da task (`trabalho`) ou, sem trabalho por trás, a tela provisória com as
 * mensagens que ela recolheu. `data-linha-*` é o que a telemetria conta (web/lib/telemetria-linhas.ts).
 */
export function htmlLinha(l: { tipo: TipoLinha; chave: string; agenteId: string; conteudo: string; trabalhoId?: string | null; conversaId: string; mensagens: readonly string[]; titulo: string; extra?: string }): string {
  const alvo = l.trabalhoId ? ` data-trabalho="${esc(l.trabalhoId)}"` : ` data-conversa="${esc(l.conversaId)}" data-mensagens="${esc(l.mensagens.join(","))}"`;
  return `<div class="linha-centro-wrap"><button type="button" class="linha-centro linha-${l.tipo}" data-act="abrir-linha" data-linha-tipo="${l.tipo}" data-linha-chave="${esc(l.chave)}" data-agente="${esc(l.agenteId)}" data-titulo="${esc(l.titulo)}"${alvo}>${l.conteudo}${SETA}</button>${l.extra ?? ""}</div>`;
}

const mascote = (a: Agente | undefined): string => (a ? iconeAgente(a, "sm") : "");
/** "<mascote> Dev 1 e <mascote> Dev 2" (com mais de três, "4 bots"). `conhecidos`: o nome que a própria mensagem traz. */
function quem(estado: Estado, ids: readonly string[], conhecidos: ReadonlyMap<string, string> = new Map()): { html: string; texto: string } {
  const bots = ids.map((id) => ({ id, a: agente(estado, id) }));
  const nomes = bots.map((b) => b.a?.nome ?? conhecidos.get(b.id) ?? "outro bot");
  if (bots.length > 3) return { html: `<span class="linha-nome">${bots.length} bots</span>`, texto: `${bots.length} bots` };
  const partes = bots.map((b, i) => `${mascote(b.a)}<span class="linha-nome">${esc(nomes[i] ?? "")}</span>`);
  const html = partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join('<span class="linha-sep">, </span>')}<span class="linha-sep"> e </span>${partes[partes.length - 1]}`;
  return { html, texto: juntar(nomes) };
}

/**
 * O plano de cada mensagem (as ausentes do mapa seguem o desenho de sempre). Puro: a mesma lista e o mesmo estado dão o
 * mesmo plano, e as chaves das linhas são estáveis (a primeira mensagem do grupo), para a timeline trocar só o bloco
 * que mudou.
 */
export function planejarLinhas(mensagens: readonly Mensagem[], estado: Estado): Map<string, PlanoMensagem> {
  const planos = new Map<string, PlanoMensagem>();
  const conversaId = mensagens[0]?.conversaId ?? "";
  const conversa = estado.conversas[conversaId]?.conversa;
  const donoDaConversa = conversa?.agenteId ?? null;
  const lista = trabalhosConhecidos(estado, conversaId);
  const conhecidos = new Map(lista.map((t) => [t.id, t]));
  // O título de cada trabalho também vem da linha "Abriu a task": o trabalho que já terminou pode não estar na lista.
  const titulos = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "trabalho_aberto") titulos.set(m.payload.trabalhoId, m.payload.titulo);
  const tituloDe = (u: Unidade): string => u.trabalho?.titulo ?? (u.trabalhoId ? titulos.get(u.trabalhoId) : undefined) ?? "sem título";
  const unidades = unidadesDe(mensagens, conhecidos);
  const unidadeDe = new Map<string, Unidade>();
  for (const u of unidades.values()) for (const m of u.mensagens) unidadeDe.set(m.id, u);

  // ---- rotina, colega e task -----------------------------------------------------------------------------------------
  const nadaParaVoce = new Set<Unidade>();
  for (const u of unidades.values()) {
    if (!u.tipo) continue;
    const execucoes = u.mensagens.flatMap((m) => (m.payload?.kind === "rotina_execucao" ? [m.payload.desfecho] : []));
    const falou = u.tipo !== "rotina" || execucoes.some((d) => !DESFECHOS_SILENCIOSOS.has(d));
    const etiqueta = u.tipo === "rotina" ? `da rotina ${nomeDaRotina(estado, u) ?? ""}`.trim() : `da task ${tituloDe(u)}`;
    const baloes = u.mensagens.filter((m) => m.payload?.kind === "pedido_a_pessoa" || (u.tipo !== "colega" && falou && m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.fimDoTurno === true));
    // O resultado do trabalho que terminou ganha a linha "… terminou · 39 min · US$ 0,88" logo acima (K5).
    const ultimoFim = [...baloes].reverse().find((m) => m.payload?.kind !== "pedido_a_pessoa");
    for (const m of baloes) {
      const t = u.trabalho;
      const antes = u.tipo === "task" && t && t.estado === "terminado" && m === ultimoFim ? linhaTerminou(t, estado) : undefined;
      planos.set(m.id, { tipo: "balao", etiqueta, ...(antes ? { antes } : {}) });
    }
    const recolhidas = u.mensagens.filter((m) => !planos.has(m.id) && recolhivel(m) && !(m.payload?.kind === "rotina_execucao" && DESFECHOS_A_VISTA.has(m.payload.desfecho)));
    for (const m of recolhidas) planos.set(m.id, { tipo: "oculta" });
    // Revisão W7 (2026-10-08): "nada para você" só da execução que acabou — com o trabalho aberto, ou sem a linha da
    // execução nem a última fala do turno, ela ainda pode ter algo a dizer.
    const acabou = !(u.trabalho && aberto(u.trabalho)) && (execucoes.length > 0 || u.mensagens.some((m) => m.fimDoTurno === true));
    if (u.tipo === "rotina" && acabou && baloes.length === 0 && !execucoes.some((d) => DESFECHOS_A_VISTA.has(d)) && recolhidas.length > 0) nadaParaVoce.add(u);
    if (u.tipo === "colega" && recolhidas[0]) {
      const pedido = u.mensagens.find((m) => m.payload?.kind === "peer_pedido");
      const quemPediu = u.trabalho?.pedidoPorAgenteId ?? (pedido?.autoria.autor_tipo === "agente" ? pedido.autoria.autor_id : null);
      const bot = agente(estado, quemPediu);
      const nome = u.trabalho?.pedidoPorNome ?? bot?.nome ?? "outro bot";
      const n = recolhidas.length;
      const conteudo = `<span>Pedido do</span>${mascote(bot)}<span class="linha-nome">${esc(nome)}</span><span>· ${n} ${n === 1 ? "mensagem" : "mensagens"}</span>`;
      planos.set(recolhidas[0].id, { tipo: "linha", chave: `linha:${recolhidas[0].id}`, html: htmlLinha({ tipo: "bots", chave: `bots:${u.chave}`, agenteId: donoDaConversa ?? "", conteudo, trabalhoId: u.trabalhoId, conversaId, mensagens: recolhidas.map((m) => m.id), titulo: `Pedido do ${nome}` }) });
    }
  }

  // ---- quem pede a um colega (o <details class="collaboration"> de antes) ---------------------------------------------
  const origemDaTarefa = new Map<string, string>();
  for (const m of mensagens) if (m.payload?.kind === "handoff" && m.payload.tarefaId) origemDaTarefa.set(m.payload.tarefaId, m.turnoId ?? m.id);
  const grupos = new Map<string, { pedidos: Mensagem[]; respostas: Mensagem[] }>();
  for (const m of mensagens) {
    if (planos.has(m.id)) continue;
    const p = m.payload;
    const k = p?.kind === "handoff" && p.tarefaId ? origemDaTarefa.get(p.tarefaId) : p?.kind === "peer_ask" ? origemDaTarefa.get(p.tarefaId) ?? p.turnoOrigemId ?? m.id : undefined;
    if (!k) continue;
    const g = grupos.get(k) ?? { pedidos: [], respostas: [] };
    (p?.kind === "handoff" ? g.pedidos : g.respostas).push(m);
    grupos.set(k, g);
  }
  for (const [k, g] of grupos) {
    const todas = [...g.pedidos, ...g.respostas];
    const ids = [...new Set(todas.flatMap((m) => (m.payload?.kind === "handoff" ? [m.payload.para] : m.payload?.kind === "peer_ask" ? [m.payload.agenteId] : [])))];
    const nomes = quem(estado, ids, new Map(todas.flatMap((m) => (m.payload?.kind === "peer_ask" ? [[m.payload.agenteId, m.payload.nome] as const] : []))));
    const trabalhoId = trabalhoDoPedido(todas, ids, lista);
    const comum = { agenteId: donoDaConversa ?? "", trabalhoId, conversaId, mensagens: todas.map((m) => m.id) };
    const [primeiroPedido] = g.pedidos;
    if (primeiroPedido) {
      planos.set(primeiroPedido.id, { tipo: "linha", chave: `linha:${primeiroPedido.id}`, html: htmlLinha({ ...comum, tipo: "bots", chave: `bots:${k}`, conteudo: `<span>Enviou mensagem para</span>${nomes.html}`, titulo: `Mensagem para ${nomes.texto}` }) });
      for (const m of g.pedidos.slice(1)) planos.set(m.id, { tipo: "oculta" });
    }
    const [primeiraResposta] = g.respostas;
    if (primeiraResposta) {
      const n = todas.length;
      planos.set(primeiraResposta.id, { tipo: "linha", chave: `linha:${primeiraResposta.id}`, html: htmlLinha({ ...comum, tipo: "bots", chave: `bots:${k}:respostas`, conteudo: `<span>${n} ${n === 1 ? "mensagem" : "mensagens"} com</span>${nomes.html}`, titulo: `${n} ${n === 1 ? "mensagem" : "mensagens"} com ${nomes.texto}` }) });
      for (const m of g.respostas.slice(1)) planos.set(m.id, { tipo: "oculta" });
    }
  }

  // ---- "Abriu a task" -------------------------------------------------------------------------------------------------
  const ultimaAbertura = [...mensagens].reverse().find((m) => {
    const t = m.payload?.kind === "trabalho_aberto" ? conhecidos.get(m.payload.trabalhoId) : undefined;
    return t !== undefined && aberto(t);
  });
  for (const m of mensagens) {
    if (m.payload?.kind !== "trabalho_aberto" || planos.has(m.id)) continue;
    const p = m.payload;
    const t = conhecidos.get(p.trabalhoId);
    const titulo = t?.titulo ?? p.titulo;
    const dono = t?.agenteId ?? donoDaConversa ?? "";
    // A pílula de memória entra embaixo da task que abriu sob pressão (#196): a mais recente que ainda está aberta.
    const memoria = m === ultimaAbertura ? pilulaMemoria(estado.pressao, lista.filter(aberto).length) : "";
    planos.set(m.id, {
      tipo: "linha",
      chave: `linha:${m.id}`,
      html: htmlLinha({ tipo: "task", chave: `task:${p.trabalhoId}`, agenteId: dono, conteudo: `<span class="linha-ic" aria-hidden="true">${ICONE.brilho}</span><span>Abriu a task</span><b>${esc(titulo)}</b>`, trabalhoId: p.trabalhoId, conversaId, mensagens: [m.id], titulo, extra: acoesDaAbertura(t, estado, conversaId) }) + memoria,
    });
  }

  // ---- execuções seguidas da mesma rotina numa linha só ---------------------------------------------------------------
  type Grupo = { primeira: Mensagem; unidades: Unidade[] };
  const gruposRotina: Grupo[] = [];
  let atual: Grupo | null = null;
  // Revisão W10 (2026-10-08): a linha entra no lugar da primeira mensagem ESCONDIDA da execução, nunca de uma à vista (um
  // card, um aviso) — essa continua desenhada como sempre.
  const ancora = (u: Unidade): Mensagem | undefined => u.mensagens.find((x) => planos.get(x.id)?.tipo === "oculta");
  for (const m of mensagens) {
    const u = unidadeDe.get(m.id);
    if (u && nadaParaVoce.has(u)) {
      if (ancora(u) !== m) continue;
      const anterior = atual?.unidades[atual.unidades.length - 1];
      const mesma = anterior && (anterior.rotinaId === null || u.rotinaId === null || anterior.rotinaId === u.rotinaId);
      if (atual && mesma) atual.unidades.push(u);
      else {
        atual = { primeira: m, unidades: [u] };
        gruposRotina.push(atual);
      }
      continue;
    }
    // Uma mensagem à vista (o balão da pessoa, uma fala, outra linha) separa as execuções; as escondidas, não.
    if (planos.get(m.id)?.tipo !== "oculta") atual = null;
  }
  for (const g of gruposRotina) {
    const n = g.unidades.length;
    const nome = g.unidades.map((u) => nomeDaRotina(estado, u)).find(Boolean) ?? "A rotina";
    const instantes = g.unidades.map((u) => Math.min(...u.mensagens.map((m) => m.criadoEm)));
    const ids = g.unidades.flatMap((u) => u.mensagens.filter((m) => planos.get(m.id)?.tipo === "oculta").map((m) => m.id));
    const unico = n === 1 ? g.unidades[0]?.trabalhoId ?? null : null;
    const conteudo = `<span class="linha-ic" aria-hidden="true">${ICONE.relogio}</span><span><b>${esc(nome)}</b> rodou ${n === 1 ? "1 vez" : `${n} vezes`} · ${esc(horariosDaRotina(instantes))} · nada para você</span>`;
    planos.set(g.primeira.id, { tipo: "linha", chave: `linha:${g.primeira.id}`, html: htmlLinha({ tipo: "rotina", chave: `rotina:${g.unidades[0]?.chave ?? g.primeira.id}`, agenteId: donoDaConversa ?? "", conteudo, trabalhoId: unico, conversaId, mensagens: ids, titulo: nome }) });
  }
  return planos;
}

/**
 * O trabalho de quem recebeu o pedido: o que o servidor pôs no handoff/peer_ask (`trabalhoId`) ou, sem ele, o único
 * trabalho `colega` do bot que recebeu. Mais de um candidato (ou nenhum): a linha abre a tela provisória.
 */
function trabalhoDoPedido(mensagens: readonly Mensagem[], para: readonly string[], lista: readonly TrabalhoDto[]): string | null {
  const doPayload = [...new Set(mensagens.flatMap((m) => (m.payload?.kind === "handoff" || m.payload?.kind === "peer_ask") && m.payload.trabalhoId ? [m.payload.trabalhoId] : []))];
  if (doPayload.length === 1) return doPayload[0] ?? null;
  if (doPayload.length > 1 || para.length !== 1) return null;
  const de = mensagens.find((m) => m.payload?.kind === "handoff")?.payload;
  const quemPediu = de?.kind === "handoff" ? de.de : null;
  const inicio = Math.min(...mensagens.map((m) => m.criadoEm));
  const candidatos = lista.filter((t) => t.origem === "colega" && t.agenteId === para[0] && (!quemPediu || t.pedidoPorAgenteId === quemPediu) && t.criadoEm >= inicio - 60_000);
  return candidatos.length === 1 ? candidatos[0]?.id ?? null : null;
}

/** "Migrar relatórios terminou · 39 min · US$ 0,88" — a linha que entra acima do resultado da task (K5). */
function linhaTerminou(t: TrabalhoDto, estado: Estado): string {
  const custo = t.custoUsd !== null ? ` · ${usd(t.custoUsd)}` : "";
  return `<div class="linha-centro-wrap"><span class="linha-centro estatica linha-terminou"><span class="linha-ok" aria-hidden="true">✓</span><b>${esc(t.titulo)}</b><span>terminou · ${esc(tempoDe(t, estado.agora))}${esc(custo)}</span></span></div>`;
}

/**
 * Os botões da fala que anunciou a task (#195), na própria linha "Abriu a task": "Fazer depois da <outra>" grava
 * `depois_de_trabalho_id` (só quando há outra task aberta do bot, mais antiga) e "Fazer aqui" cancela a task e manda o
 * pedido como turno da conversa. Só enquanto a task de origem `pessoa` ainda não terminou.
 */
function acoesDaAbertura(t: TrabalhoDto | undefined, estado: Estado, conversaId: string): string {
  if (!t || t.origem !== "pessoa" || (t.estado !== "na_fila" && t.estado !== "rodando")) return "";
  const outras = abertosDoBot(estado, t.agenteId, conversaId).filter((x) => x.id !== t.id && x.criadoEm < t.criadoEm);
  const antes = t.depoisDeTrabalhoId ? trabalhosConhecidos(estado, conversaId).find((x) => x.id === t.depoisDeTrabalhoId) : undefined;
  const depois = antes
    ? `<span class="linha-acao-nota">começa depois da ${esc(antes.titulo)}</span>`
    : outras.length
      ? botao("trabalho-depois", `Fazer depois da ${esc(outras[outras.length - 1]?.titulo ?? "")}`, { classe: "sm", id: t.id, dados: { depois: outras[outras.length - 1]?.id ?? "" } })
      : "";
  return `<div class="linha-acoes">${depois}${botao("trabalho-fazer-aqui", "Fazer aqui", { classe: "sm", id: t.id, titulo: "cancela a task e responde aqui na conversa" })}</div>`;
}
