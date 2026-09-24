import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { estadoDaPergunta, iconeBalao, inicioDaPergunta, mensagemDaPergunta, modoDoComposer, MOTIVO_SEM_ANEXO, perguntasAbertas, type ItemPergunta, type ModoComposer } from "../lib/perguntas.ts";
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
  return `<div class="faixa-pergunta"><span class="fp-ic">${iconeBalao(15)}</span><span class="fp-txt"><b>${esc(item.agenteNome)}</b> está esperando sua resposta · ${esc(haQuanto(ha))} · vence ${esc(emQuanto(vence))}</span><span class="fp-acoes">${ver}${deixar}</span></div>`;
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

/** Acima do campo: a faixa, os dois modos ("Responder à pergunta" | "Outro assunto") e a citação. */
export function renderTopoComposer(modo: ModoComposer, estado: Estado): string {
  if (modo.tipo === "normal") return "";
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
export function aparenciaDoComposer(modo: ModoComposer, estado: Estado, padrao: { placeholder: string; nota: string }): AparenciaComposer {
  const topo = renderTopoComposer(modo, estado);
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
