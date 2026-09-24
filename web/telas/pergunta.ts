import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { FioDaPergunta } from "../../src/contracts/pedido.ts";
import type { Estado } from "../estado/reducer.ts";
import { estadoDaPergunta, fioLendo, fiosDaConversa, iconeBalao, inicioDaPergunta, mensagemDaPergunta, modoDoComposer, MOTIVO_SEM_ANEXO, perguntasAbertas, rodadaEscrita, type ItemPergunta, type ModoComposer } from "../lib/perguntas.ts";
import { emQuanto, haQuanto } from "../lib/relogio.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { rotuloVencido } from "./sua-vez.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24; A + B com citação automática,
 * a escolha do dono): a pergunta é o balão do agente, sem card nem segunda caixa de texto; a faixa
 * acima do campo diz quem espera; o campo responde; respostas prontas são botões de um toque.
 */

function nomeDoAgente(estado: Estado, id: string): string | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id)?.nome;
}

function mensagensDe(estado: Estado, conversaId: string): readonly Mensagem[] {
  return estado.conversas[conversaId]?.mensagens ?? [];
}

/** Com duas ou mais abertas, o balão que o campo está citando ganha realce discreto (o "1 de 2" aponta para ele). */
export function perguntaCitada(estado: Estado, conversaId: string, decisaoId: string): boolean {
  const modo = modoDoComposer(estado, conversaId);
  return modo.tipo === "resposta" && modo.perguntas.length > 1 && modo.alvo.decisao.id === decisaoId;
}

/**
 * Debaixo do balão da pergunta: onde ela está e, aberta, as respostas prontas. "Parei aqui até você
 * responder" é a parada de E5.2 dita pelo agente (ele não tenta de novo); o molde da fila não aparece.
 * Com duas ou mais abertas, a que o campo NÃO está citando ganha "Responder a esta".
 */
export function rodapeDaPergunta(m: Mensagem, estado: Estado): string {
  if (m.payload?.kind !== "pedido_a_pessoa") return "";
  const p = m.payload;
  const situacao = estadoDaPergunta(estado, mensagensDe(estado, m.conversaId), p.decisaoId);
  switch (situacao.tipo) {
    case "aberta": {
      const outra = perguntasAbertas(estado, m.conversaId).length > 1 && !perguntaCitada(estado, m.conversaId, p.decisaoId) ? botao("composer-responder", "Responder a esta", { classe: "link sm", id: p.decisaoId }) : "";
      const opcoes = p.opcoes?.length
        ? `<div class="pergunta-opcoes" role="group" aria-label="Respostas prontas">${p.opcoes.map((o) => botao("responder-opcao", esc(o), { classe: "opcao", id: p.decisaoId, dados: { texto: o } })).join("")}</div><p class="pergunta-ou">ou responda com suas palavras aí embaixo</p>`
        : "";
      return `<p class="pergunta-estado">Parei aqui até você responder${outra}</p>${opcoes}`;
    }
    case "respondida": {
      const quem = situacao.resposta.autoria.autor_id === estado.sessao?.pessoaId ? "Respondida por você" : "Respondida";
      return `<p class="pergunta-estado respondida"><span aria-hidden="true">✓</span>${quem} · ${esc(hora(situacao.resposta.criadoEm))}</p>`;
    }
    case "vencida": {
      // ADR-007: vencida continua visível e reabrível — agora no próprio balão, não num card à parte.
      const d = situacao.item.decisao;
      const reabrir = d.estado === "vencida" ? botao("reabrir", "Reabrir", { classe: "link sm", id: d.id }) : "";
      return `<p class="pergunta-estado vencida">Sem resposta · ${esc(rotuloVencido(d, estado.agora))}${reabrir}</p>`;
    }
    case "encerrada":
      return "";
  }
}

/** Em cima da mensagem que respondeu a uma pergunta: a pessoa vê a qual pergunta ela se liga. */
export function rotuloDaResposta(m: Mensagem): string {
  if (m.payload?.kind !== "resposta_a_pedido") return "";
  return `<div class="resposta-a"><span aria-hidden="true">↩</span> respondendo à pergunta das ${esc(hora(m.payload.perguntaEm))}</div>`;
}

/** "{agente} retomou com a sua resposta": derivada do payload, sem gravar outra linha na conversa. */
export function linhaDaRetomada(m: Mensagem, estado: Estado): string {
  if (m.payload?.kind !== "resposta_a_pedido" || !m.payload.retomada) return "";
  const nome = nomeDoAgente(estado, m.payload.agenteId) ?? "O agente";
  const resposta = m.autoria.autor_id === estado.sessao?.pessoaId ? "a sua resposta" : "a resposta";
  return `<div class="msg-sistema msg-retomou">${esc(nome)} retomou com ${resposta}</div>`;
}

/** O relógio da faixa, interpolado de instantes absolutos (ADR-007); sem tick ainda, usa o da fila. */
function relogio(item: ItemPergunta, agora: number): { ha: number; vence: number } {
  if (!agora) return { ha: item.aguardandoHaMs, vence: item.recusaAutomaticaEmMs };
  return { ha: Math.max(0, agora - Date.parse(item.decisao.criadoEm)), vence: Date.parse(item.decisao.prazoDecisaoEm) - agora };
}

/**
 * A faixa logo acima do campo, enquanto a pergunta está aberta: quem espera, há quanto e até quando;
 * "Ver pergunta" leva ao balão e "Deixar pra lá" fecha sem responder (POST decisoes/:id/dispensar, #46:
 * dispensar não é responder, nada é retomado). Pergunta de antes desta mudança não tem balão ligado:
 * aí não há o que mostrar e o "Ver pergunta" não aparece.
 */
export function renderFaixaPergunta(item: ItemPergunta, estado: Estado): string {
  const d = item.decisao;
  const { ha, vence } = relogio(item, estado.agora);
  const ver = mensagemDaPergunta(mensagensDe(estado, d.conversaId), d.id) ? botao("ver-pergunta", "Ver pergunta", { classe: "link sm", id: d.id }) : "";
  const deixar = botao("dispensar", "Deixar pra lá", { classe: "link sm", id: d.id, titulo: "Fecha a pergunta sem responder; nada é retomado" });
  // definido em 2026-09-24 (fio da pergunta): da 2ª rodada em diante a faixa diz a rodada no lugar do
  // "há quanto" — o relógio de cada rodada recomeça, e "há 2 min" esconderia que a conversa já vem de antes.
  const rodada = item.fio?.rodada ?? 1;
  const texto = rodada > 1
    ? `<b>${esc(item.agenteNome)}</b> ainda está esperando sua resposta · ${esc(rodadaEscrita(rodada))} · vence ${esc(emQuanto(vence))}`
    : `<b>${esc(item.agenteNome)}</b> está esperando sua resposta · ${esc(haQuanto(ha))} · vence ${esc(emQuanto(vence))}`;
  return `<div class="faixa-pergunta"><span class="fp-ic">${iconeBalao(15)}</span><span class="fp-txt">${texto}</span><span class="fp-acoes">${ver}${deixar}</span></div>`;
}

/**
 * definido em 2026-09-24 (fio da pergunta): respondida, a pergunta continua ABERTA enquanto o agente lê
 * — ele pode seguir ou perguntar de novo. A faixa fica, neutra e sem ações (não há o que responder), e
 * o campo volta ao modo normal.
 */
export function renderFaixaLendo(fio: FioDaPergunta, estado: Estado): string {
  const nome = nomeDoAgente(estado, fio.agenteId) ?? "O agente";
  return `<div class="faixa-pergunta faixa-lendo" role="status"><span class="fp-ic">${iconeBalao(15)}</span><span class="fp-txt">Pergunta aberta · <b>${esc(nome)}</b> está lendo sua mensagem</span></div>`;
}

function segmento(act: string, rotulo: string, ligado: boolean): string {
  return `<button type="button" class="seg" data-act="${act}" aria-pressed="${ligado ? "true" : "false"}">${rotulo}</button>`;
}

/** Com duas ou mais abertas, o campo cita qual está respondendo (a mais antiga, salvo escolha) e em que posição. */
function renderCitacao(modo: Extract<ModoComposer, { tipo: "resposta" }>, estado: Estado): string {
  const d = modo.alvo.decisao;
  const texto = mensagemDaPergunta(mensagensDe(estado, d.conversaId), d.id)?.texto ?? d.frase;
  const fechar = botao("composer-outro", "×", { classe: "cp-fechar", titulo: "Mandar como mensagem comum (Esc)", aria: "Cancelar a resposta e mandar como mensagem comum" });
  return `<div class="citacao-pergunta"><span class="cp-txt">Respondendo à <b>${esc(modo.alvo.agenteNome)}</b> · “${esc(inicioDaPergunta(texto))}” · ${modo.indice + 1} de ${modo.perguntas.length}</span>${fechar}</div>`;
}

/**
 * Acima do campo: a faixa, os dois modos ("Responder à pergunta" | "Outro assunto") e a citação. Sem
 * pergunta esperando, só a faixa neutra do fio em que o agente está lendo (`conversaId` a localiza).
 */
export function renderTopoComposer(modo: ModoComposer, estado: Estado, conversaId?: string): string {
  if (modo.tipo === "normal") {
    const lendo = conversaId ? fioLendo(estado, conversaId) : undefined;
    return lendo ? renderFaixaLendo(lendo, estado) : "";
  }
  const alvo = modo.tipo === "resposta" ? modo.alvo : modo.perguntas[0];
  if (!alvo) return "";
  const modos = `<div class="modo-envio" role="group" aria-label="O que a próxima mensagem faz">${segmento("composer-responder", "Responder à pergunta", modo.tipo === "resposta")}${segmento("composer-outro", "Outro assunto", modo.tipo === "outro")}</div>`;
  const citacao = modo.tipo === "resposta" && modo.perguntas.length > 1 ? renderCitacao(modo, estado) : "";
  return `${renderFaixaPergunta(alvo, estado)}<div class="composer-modo">${modos}${citacao}</div>`;
}

export type AparenciaComposer = {
  /** HTML da região acima da caixa (vazio sem pergunta aberta). */
  topo: string;
  /** Borda realçada: a próxima mensagem responde. */
  resposta: boolean;
  placeholder: string;
  nota: string;
  /** Com motivo, o clipe fica desligado e o motivo vira a dica dele; null = clipe como sempre. */
  anexoBloqueado: string | null;
};

/**
 * Tudo que o modo muda no campo, calculado de uma vez para o main aplicar sem regravar o textarea
 * (web/lib/regioes.ts). Anexos (ADR-045) não cabem na resposta: a rota só leva texto, então o clipe
 * desliga com o motivo à vista em vez de o arquivo sumir.
 */
export function aparenciaDoComposer(modo: ModoComposer, estado: Estado, padrao: { placeholder: string; nota: string }, conversaId?: string): AparenciaComposer {
  const topo = renderTopoComposer(modo, estado, conversaId);
  if (modo.tipo !== "resposta") return { topo, resposta: false, placeholder: padrao.placeholder, nota: padrao.nota, anexoBloqueado: null };
  const nome = modo.alvo.agenteNome;
  return {
    topo,
    resposta: true,
    placeholder: `Responda à ${nome}…`,
    nota: `Sua próxima mensagem responde à pergunta, e ${nome} continua de onde parou.`,
    anexoBloqueado: MOTIVO_SEM_ANEXO,
  };
}

/** Uma linha já desenhada da conversa: o id da mensagem, se é linha de sistema (recolhível) e o HTML. */
export type LinhaDaConversa = { id: string; sistema: boolean; html: string };

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** "Pergunta aberta · 4 mensagens · 2ª rodada": o cabeçalho do trilho, uma vez por fio. */
function cabecalhoDoFio(fio: FioDaPergunta): string {
  return `<div class="fio-cab"><span class="fio-ic">${iconeBalao(13)}</span>Pergunta aberta · ${esc(plural(fio.mensagens.length, "mensagem", "mensagens"))} · ${esc(rodadaEscrita(fio.rodada))}</div>`;
}

/**
 * Resolvida, o fio inteiro vira um <details> verde — nada é apagado, cada mensagem continua lá dentro —
 * e embaixo fica a linha "{agente} seguiu com a sua resposta", derivada, sem gravar outra linha.
 */
function renderFioResolvido(fio: FioDaPergunta, interno: string, estado: Estado, conversaId: string): string {
  const mensagens = mensagensDe(estado, conversaId);
  const primeira = mensagemDaPergunta(mensagens, fio.decisoes[0] ?? "") ?? mensagens.find((m) => m.id === fio.mensagens[0]);
  const ultima = [...mensagens].reverse().find((m) => m.payload?.kind === "resposta_a_pedido" && fio.decisoes.includes(m.payload.decisaoId));
  const resposta = !ultima || ultima.autoria.autor_id === estado.sessao?.pessoaId ? "a sua resposta" : "a resposta";
  const nome = nomeDoAgente(estado, fio.agenteId) ?? "O agente";
  const inicio = primeira ? ` · “${esc(inicioDaPergunta(primeira.texto))}”` : "";
  return `<details class="fio-resolvido" data-fio="${esc(fio.id)}" data-disclosure="fio-${esc(fio.id)}"><summary><span class="fio-ok" aria-hidden="true">✓</span><span class="fio-resumo"><b>Pergunta resolvida</b>${inicio} · ${esc(plural(fio.mensagens.length, "mensagem", "mensagens"))}</span><span class="fio-ver">ver conversa</span></summary><div class="fio-corpo">${interno}</div></details><div class="msg-sistema msg-seguiu">${esc(nome)} seguiu com ${resposta}</div>`;
}

/**
 * O fio na conversa (definido em 2026-09-24, emenda da ADR-045). Aberto — esperando você ou lendo sua
 * mensagem — as mensagens do fio ganham um trilho azul fino à esquerda com o cabeçalho "Pergunta aberta
 * · N mensagens · Xª rodada"; a pergunta que acabou de chegar, sozinha, é só o balão (ainda não há fio a
 * mostrar). Resolvido, o fio inteiro recolhe num <details> verde no lugar da primeira mensagem dele.
 * Deixado pra lá ou vencido, as mensagens seguem como estão: o balão já diz o que houve. Uma mensagem
 * de "Outro assunto" no meio do fio aberto quebra o trilho em dois trechos; o cabeçalho sai no primeiro.
 */
export function desenharFios(linhas: readonly LinhaDaConversa[], estado: Estado, conversaId: string): LinhaDaConversa[] {
  const fioDe = new Map<string, FioDaPergunta>();
  for (const fio of fiosDaConversa(estado, conversaId)) {
    const aberto = fio.estado === "esperando_voce" || fio.estado === "lendo_sua_mensagem";
    if ((aberto && fio.mensagens.length > 1) || fio.estado === "resolvida") for (const id of fio.mensagens) fioDe.set(id, fio);
  }
  if (fioDe.size === 0) return [...linhas];
  const saida: LinhaDaConversa[] = [];
  const mostrados = new Set<string>();
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    const fio = linha ? fioDe.get(linha.id) : undefined;
    if (!linha || !fio) {
      if (linha) saida.push(linha);
      i++;
      continue;
    }
    if (fio.estado === "resolvida") {
      if (!mostrados.has(fio.id)) saida.push({ id: linha.id, sistema: false, html: renderFioResolvido(fio, linhas.filter((l) => fioDe.get(l.id) === fio).map((l) => l.html).join(""), estado, conversaId) });
      mostrados.add(fio.id);
      i++;
      continue;
    }
    let fim = i;
    while (fim < linhas.length && fioDe.get(linhas[fim]?.id ?? "") === fio) fim++;
    const cab = mostrados.has(fio.id) ? "" : cabecalhoDoFio(fio);
    mostrados.add(fio.id);
    saida.push({ id: linha.id, sistema: false, html: `<section class="fio-aberto" data-fio="${esc(fio.id)}" aria-label="Pergunta aberta">${cab}${linhas.slice(i, fim).map((l) => l.html).join("")}</section>` });
    i = fim;
  }
  return saida;
}
