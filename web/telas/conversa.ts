import { renderAnexosDaMensagem, type Aceita } from "../lib/anexos.ts";
import type { FrotaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Decisao } from "../../src/contracts/decisao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { TipoAnexo } from "../../src/contracts/anexo.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { TarefaDoBot } from "../../src/contracts/turno.ts";
import type { ConversaEstado, Estado, TurnoVivo } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, dataHora, esc, hora, iconeAgente, paragrafos } from "../lib/render.ts";
import { maquinaDoBot } from "./maquinas.ts";
import { outraMaquinaDestaVez } from "../lib/rodar-desta-vez.ts";
import { acordandoNaFila } from "../lib/maquina-nuvem.ts";
import { linhaAtual, resumoEtapa, type AtividadeTurno, type VigiaDaAtividade } from "../lib/atividade.ts";
import { linhaDaFila } from "../lib/fila-do-pedido.ts";
import { haQuanto } from "../lib/relogio.ts";
import { soLinks, textoFormatado } from "../lib/texto-formatado.ts";
import { estadoMascoteNaConversa, mascoteAnimado, turnosVivosDaConversa } from "../lib/mascote.ts";
import { renderFaixaParada } from "./faixa-parada.ts";
import { htmlCartaoTela, motivoDoPedidoDeTela } from "../lib/computador.ts";
import { cartaoDaPergunta, desenharFios, linhaDaRetomada, respostaPorOpcao, rotuloDaResposta, tempoDasLinhas, type LinhaDaConversa } from "./pergunta.ts";
import { comDivisores, type TempoDoBloco } from "./divisores-de-data.ts";
import { linhaNaoRodaram } from "../lib/execucao.ts";
import { chaveDoItem, estadoDaPergunta } from "../lib/perguntas.ts";
import { acoesComAcesso, linhasPrecisa } from "./rotina-precisa.ts";
import { renderCardAcesso } from "./card-acesso.ts";
import { acaoHumana, detalheAcesso, idsGemeas, marcaGemeas, marcaRotinaParada, pedidosAncoraveis, renderDecisaoAncorada, renderDecisoesDaConversa, rotulosAcesso } from "./sua-vez.ts";
import { renderCardPasta } from "./card-pasta.ts";
import { dadosDoEncolhido, pedidoDoRecibo, renderCartaoEncolhido, turnoDoEncolhido } from "./cartao-encolhido.ts";
import { renderCardLote } from "./card-lote.ts";
import { idsNoPerfil, renderCardPerfil } from "./card-perfil.ts";
import { renderCardArtefato } from "./card-artefato.ts";
import { faixaDaMensagem } from "./modo-dev.ts";
import { HTML_CHIP_MODO } from "./aprovacoes.ts";
import { HTML_SELETOR_IA } from "./seletor-ia.ts";
import { avisoDeEstado } from "../lib/aviso-estado.ts";
import { inventarioEmUso } from "./frota.ts";
import { avisoContaSemAcesso, avisoHarnessFora, avisoModeloRecusado, ehIa, inventarioDaIa, cartaoTrocaDeIa, linhaContaSeguiu, linhaContaTrocada, linhaIaTrocada, linhaLimiteSemOutra, prontaDepois, PROVEDOR_DA_IA, type IdIa } from "./ia-fora.ts";
import { escolhaEfetiva, iasDaTela, inteligenciaDoBot } from "./inteligencia.ts";
import { htmlBotaoDitado, htmlPilulaDitado } from "./ditado.ts";
import { renderLinhaLigacao } from "./ligacao.ts";
import { conversaLimpa, htmlTroca, juntarTrocas, planejarLinhas, type PlanoMensagem } from "./linhas-do-chat.ts";
import { trabalhosConhecidos } from "../lib/trabalhos.ts";
import { TEXTO_FALHA_LEITURA } from "../lib/ouvir.ts";
import { acoesDaFala, chipsDeReacao, citacaoAcimaDoBalao } from "./acoes-da-fala.ts";
import { ancorasDoProgresso, comProgressoNaFala, marcadorDoProgresso } from "./progresso-na-fala.ts";

/** id → nome (agentes da frota + a pessoa da sessão); id desconhecido cai no genérico, nunca no uuid. */
export function nomesDe(estado: Estado): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const a of estado.frota?.agentes ?? []) mapa[a.id] = a.nome;
  if (estado.sessao) mapa[estado.sessao.pessoaId] = "você";
  return mapa;
}

function agenteDe(estado: Estado, id: string): FrotaDto["agentes"][number] | undefined {
  return [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
}

/** A maior versão do artefato entre as mensagens carregadas da conversa: as anteriores ficam recolhidas. */
function versaoMaisRecente(estado: Estado, conversaId: string, artefatoId: string, piso: number): number {
  let n = piso;
  for (const m of estado.conversas[conversaId]?.mensagens ?? []) if (m.payload?.kind === "artefato" && m.payload.artefatoId === artefatoId && m.payload.versao > n) n = m.payload.versao;
  return n;
}

/**
 * Ouvir uma resposta (NOD-106): só em fala de texto terminada de bot PRÓPRIO, fora de sala, sem artefato, e com a
 * disponibilidade dizendo `ouvir: true` (ausente ou false = o botão nem é desenhado). "Próprio" é a mesma regra que
 * busca a disponibilidade (reducer.ts, `disponibilidade:`): `ownerId === sessao.pessoaId`.
 */
export function podeOuvir(m: Mensagem, estado: Estado, sala: boolean): boolean {
  if (sala || m.kind !== "texto" || m.parcial || m.payload?.kind === "artefato") return false;
  if (m.autoria.autor_tipo !== "agente") return false;
  const pessoaId = estado.sessao?.pessoaId;
  if (!pessoaId || !estado.frota?.agentes.some((a) => a.id === m.autoria.autor_id && a.ownerId === pessoaId && !a.excluidoEm)) return false;
  return estado.disponibilidadeLigacao[m.autoria.autor_id]?.ouvir === true;
}

const IC_OUVIR = {
  ouvir: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/></svg>',
  carregando: '<svg aria-hidden="true" class="ouvir-spin" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2a6 6 0 106 6"/></svg>',
  tocando: '<svg aria-hidden="true" class="ouvir-barras" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="2" y="3" width="2.4" height="10" rx="1.2"/><rect x="6.8" y="3" width="2.4" height="10" rx="1.2"/><rect x="11.6" y="3" width="2.4" height="10" rx="1.2"/></svg><svg aria-hidden="true" class="ouvir-parar" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><path d="M8 4.9v.1"/></svg>',
} as const;

/**
 * O botão Ouvir (protótipo do Gil, 16/10). HTML à mão porque `botao()` não tem aria-busy, aria-disabled nem
 * aria-describedby. Ocioso: alto-falante. Carregando/tocando: pílula "Parar" (o ícone diz o estado, a palavra a ação),
 * `aria-busy` só no carregando. Ligação viva: `aria-disabled` (continua focável e mostra o motivo), NUNCA `disabled`.
 * Nunca `aria-pressed`: o rótulo já muda, e os dois juntos fazem o leitor dizer "Parar de ouvir, pressionado".
 */
function botaoOuvir(m: Mensagem, estado: Estado): string {
  const id = esc(m.id);
  const ativa = estado.leitura?.mensagemId === m.id ? estado.leitura : null;
  if (ativa) {
    const carregando = ativa.fase === "carregando";
    return `<button type="button" class="bt ouvir-ativo ouvir-${ativa.fase}" data-act="ouvir-mensagem" data-id="${id}" aria-label="Parar de ouvir" title="Parar de ouvir"${carregando ? ' aria-busy="true"' : ""}>${carregando ? IC_OUVIR.carregando : IC_OUVIR.tocando}<span>Parar</span></button>`;
  }
  if (estado.ligacaoViva) {
    const dica = `dica-ouvir-${id}`;
    return `<span class="ouvir-wrap"><button type="button" class="bt" data-act="ouvir-mensagem" data-id="${id}" aria-label="Ouvir a resposta" aria-disabled="true" aria-describedby="${dica}">${IC_OUVIR.ouvir}</button><span class="ouvir-dica" id="${dica}" role="tooltip">Desligue a ligação para ouvir</span></span>`;
  }
  return `<button type="button" class="bt" data-act="ouvir-mensagem" data-id="${id}" aria-label="Ouvir a resposta" title="Ouvir a resposta">${IC_OUVIR.ouvir}</button>`;
}

/** "Não deu para ouvir agora." embaixo do balão que falhou antes do primeiro som (sai em 6 s ou no próximo clique). */
function avisoDeLeitura(m: Mensagem, estado: Estado): string {
  return estado.falhaLeitura?.mensagemId === m.id ? `<div class="msg-aviso" role="status">${IC_OUVIR.info}${TEXTO_FALHA_LEITURA}</div>` : "";
}

// Ações na fala (ADR-042; desde 2026-10-18, ADR-113): reagir, responder, reportar e ⋯ moram em ./acoes-da-fala.ts.

/**
 * NOD-106: o Ouvir entra na barra de ações da fala (ADR-113), ANTES das outras (a ação mais comum primeiro); com a
 * leitura ativa, a barra mostra só a pílula "Parar", para ela não pular.
 */
function acoesDaMensagem(m: Mensagem, estado: Estado, sala: boolean): string {
  const ouvir = podeOuvir(m, estado, sala) ? botaoOuvir(m, estado) : "";
  if (ouvir !== "" && estado.leitura?.mensagemId === m.id) return `<div class="msg-actions" role="group" aria-label="Ações da mensagem">${ouvir}</div>`;
  return acoesDaFala(m, estado, ouvir);
}

// ---------------------------------------------------------------- recibos das decisões

/**
 * Recibos (definido em 2026-10-03, revisão da conversa "depois"): depois de decidir, a conversa ganhava parágrafos
 * soltos — "Marlon aprovou 0 de 3; não enviado: … (falhou na execução)", "Marlon permitiu para sempre:
 * googlesheets.update_values. Vale já…". Agora cada um é UMA linha: quem decidiu, o quê e como terminou, com o
 * detalhe por item recolhido. O texto redigido continua gravado (e no title) para quem lê a conversa crua.
 * revisto em 2026-10-18 (chat limpo, PR 4): o recibo com payload vira o cartão encolhido, no lugar do pedido
 * (web/telas/cartao-encolhido.ts). Ficam aqui as linhas sem cartão: o recibo automático sem payload e o "permitiu para
 * sempre" de antes de 18/10, sem payload.
 */
const IC_RECIBO = {
  ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 8.5 2.5 2.5L12 5.5"/></svg>',
  regra: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7.5" width="9" height="6" rx="1.5"/><path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 4.9-.7"/></svg>',
} as const;

function quemDecidiu(m: Mensagem, estado: Estado): string {
  if (m.autoria.autor_id === estado.sessao?.pessoaId) return "Você";
  const nome = nomesDe(estado)[m.autoria.autor_id];
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : "Alguém";
}

/** Resultado sem payload (o que uma regra aprovou sozinha, itens-na-maquina.ts): a mesma linha, com o texto inteiro. */
function reciboSemDetalhe(m: Mensagem): string {
  return `<div class="recibo recibo-ok" title="${esc(m.texto)}"><span class="recibo-ic">${IC_RECIBO.ok}</span><span class="recibo-txt">${esc(m.texto)}</span></div>`;
}

/** "{pessoa} permitiu para sempre: a.b, c.d. Vale já…" (redacao.ts permissao-permanente) vira "Regra nova · sempre permitir editar no Google Sheets". Só as antigas: desde 2026-10-18 a regra tem payload (`regra_permanente`) e encolhe. */
const PERMITIU = /^(.+?) permitiu para sempre: (.+?)\. Vale já/;

function reciboDaRegra(m: Mensagem, estado: Estado): string | null {
  const achado = PERMITIU.exec(m.texto);
  if (!achado) return null;
  const acoes = (achado[2] ?? "").split(", ").map((n) => {
    const ponto = n.indexOf(".");
    return ponto > 0 ? acaoHumana(estado.conectores, n.slice(0, ponto), n.slice(ponto + 1)) : n;
  });
  const quem = quemDecidiu(m, estado);
  return `<div class="recibo recibo-regra" title="${esc(m.texto)}"><span class="recibo-ic">${IC_RECIBO.regra}</span><span class="recibo-txt"><b>${quem === "Você" ? "Regra nova" : `Regra nova de ${esc(quem)}`}</b> · sempre permitir ${esc(acoes.join(" e "))}</span></div>`;
}

/**
 * "Anotei uma preferência: …" com o caminho para a memória (definido em 2026-10-03, canvas "Uma conversa de verdade ·
 * depois"): ver o que o bot aprendeu dá confiança no que ele vai lembrar. A linha é `sistema` sem payload
 * (src/use-cases/lembrar.ts), então se reconhece pelo começo do texto; as gravadas antes de 2026-10-03 diziam o enum
 * cru ("Anotei como preferencia") e são lidas na frase nova.
 */
const ANOTEI = /^Anotei (?:como (preferencia|fato|resumo)|(uma preferência|um fato|um resumo)): /;
const TIPO_ANTIGO: Record<string, string> = { preferencia: "uma preferência", fato: "um fato", resumo: "um resumo" };

function linhaDaMemoria(m: Mensagem, estado: Estado): string | null {
  const achado = ANOTEI.exec(m.texto);
  if (!achado) return null;
  const tipo = achado[2] ?? TIPO_ANTIGO[achado[1] ?? ""] ?? "";
  const agenteId = m.autoria.autor_tipo === "agente" ? m.autoria.autor_id : undefined;
  const agente = agenteId ? agenteDe(estado, agenteId) : undefined;
  const ver = agente ? ` ${botao("ir-memoria", "Ver na memória", { classe: "link sm", id: agente.id })}` : "";
  return `<div class="msg-sistema msg-memoria">${paragrafos(`Anotei ${tipo}: ${m.texto.slice(achado[0].length)}`)}${ver}</div>`;
}

function corpoMensagem(m: Mensagem, estado: Estado): string {
  const p = m.payload;
  if (p?.kind === "computador_fora_do_ar") {
    // definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO vira cartão de estado, com a hora local e
    // as duas saídas; depois que o computador volta, o cartão fica como registro, sem botões.
    const bot = agenteDe(estado, p.agenteId);
    const aindaFora = Boolean(bot?.computadorForaDoAr);
    const dono = bot?.ownerId === estado.sessao?.pessoaId;
    const acoes = aindaFora && dono ? `<div class="mcf-acoes">${botao("religar-computador", "Tentar de novo", { id: p.agenteId, classe: "pri sm" })}${botao("abrir-computador", "Abrir computador", { id: p.agenteId, classe: "sm" })}</div>` : bot && !aindaFora ? '<p class="mudo sm">O computador voltou a responder.</p>' : "";
    return `<div class="msg-computador-fora" role="status"><div class="mcf-titulo"><b>Computador do bot fora do ar</b><span class="mudo">desde ${esc(dataHora(p.desde))}</span></div><p>${paragrafos(m.texto)}</p>${acoes}</div>`;
  }
  // definido em 2026-09-28 (ADR-051): o card do artefato; o iframe entra depois do render (telas/artefatos-vivos.ts).
  if (p?.kind === "artefato") return renderCardArtefato(m, p, versaoMaisRecente(estado, m.conversaId, p.artefatoId, p.versao));
  // definido em 2026-10-04 (ADR-075): a linha "Chat de voz · mm:ss"; a ligação aberta nesta página oferece voltar a ela.
  if (p?.kind === "ligacao") return renderLinhaLigacao(m, p, estado.ligacaoViva?.local === true && estado.ligacaoViva.ligacaoId === p.ligacaoId);
  if (m.kind === "sistema") return linhaDeIa(m, estado) ?? linhaDaMemoria(m, estado) ?? linhaDoTurnoPreso(m, estado) ?? `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "handoff") {
    // definido em 2026-09-24 (ADR-047): a tarefa delegada assina "Taga · por você" — autoria composta (ADR-023).
    const de = m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agenteDe(estado, p.de)?.nome ?? "agente";
    const para = agenteDe(estado, p.para)?.nome ?? "agente";
    const alvo = agenteDe(estado, p.para);
    return `<div class="msg-handoff"><div class="handoff-titulo">↗ <b>${esc(de)} → ${esc(para)}</b><span>${p.tarefaId ? "pedido a colega" : "passou a vez"}</span></div><p>${esc(p.motivo)}</p>${p.fila ? `<small class="mudo handoff-fila" role="status">${esc(linhaDaFila(p.fila))}</small>` : ""}${alvo ? botao("abrir-conversa", "Ver conversa de " + esc(para), { classe: "link", dados: { conversa: alvo.conversaId, agente: alvo.id } }) : ""}</div>`;
  }
  if (p?.kind === "passe") return `<div class="msg-passe">⏭ ${paragrafos(m.texto)} <span class="tag tag-cinza">${esc(p.motivo.replaceAll("_", " "))}</span></div>`;
  if (p?.kind === "consentimento") {
    // definido em 2026-09-24 (ADR-044): um consentimento cobre um LOTE; as mensagens anteriores têm uma capacidade só.
    const caps = "capacidades" in p ? p.capacidades : [p.capacidade];
    return `<div class="msg-consentimento"><b>Acesso permitido · ${esc(p.slug)}</b><div>${caps.length === 1 ? esc(caps[0] ?? "") : `${caps.length} ações`}</div><details data-disclosure="consentimento-${esc(m.id)}"><summary>Ver registro de autorização</summary>${paragrafos(m.texto)}</details></div>`;
  }
  if (p?.kind === "rotina_execucao") return `<div class="msg-rotina msg-rotina-${esc(p.desfecho)}">${paragrafos(m.texto)}</div>`;
  if (m.kind === "resultado_aprovacao") return reciboSemDetalhe(m);
  if (m.kind === "consentimento" && !p) return reciboDaRegra(m, estado) ?? `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "negacao" && p.classe === "plano_ausente") return avisoSemExecutor(m, estado);
  if (p?.kind === "negacao") return `<div class="negacao negacao-${esc(p.classe)}">${paragrafos(m.texto)}${p.terminal ? ' <span class="tag tag-ambar">terminal</span>' : ""}</div>`;
  if (p?.kind === "parada") return `<div class="msg-parada">■ ${paragrafos(m.texto)}</div>`;
  // definido em 2026-10-08 (protótipo "Nod — tempo da task", aprovado): o colega que não terminou vira UMA linha discreta;
  // o motivo e o atalho para a task dele ficam atrás de "detalhes".
  if (p?.kind === "peer_ask" && p.falhou) {
    const motivo = m.texto.replace(/^[\s\S]*?não concluiu:\s*/, "");
    const link = p.trabalhoId ? `<button type="button" class="pf-link" data-act="abrir-trabalho" data-id="${esc(p.trabalhoId)}">Ver a task do ${esc(p.nome)}</button>` : "";
    return `<div class="msg-peer-falhou"><details data-disclosure="peer-falhou-${esc(m.id)}"><summary><span>${esc(p.nome)} não conseguiu terminar o pedido</span><span class="pf-detalhes">detalhes</span></summary><div class="pf-corpo"><span>${esc(motivo)}</span>${link}</div></details></div>`;
  }
  if (p?.kind === "peer_ask") return `<div class="msg-peer"><div class="handoff-titulo">↙ <b>${p.falhou ? "Não concluído por" : "Resposta de"} ${esc(p.nome)}</b></div><div>${textoFormatado(m.texto, { chave: m.id })}</div><small class="mudo">Contribuição de outro bot · confira as fontes</small></div>`;
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "";
  return `<div class="msg-texto">${paragrafos(m.texto)}${naoConfiavel}${m.parcial ? ' <span class="tag tag-cinza">parcial</span>' : ""}</div>`;
}

/**
 * NOD-314 (definido em 2026-10-20): o pedido tirado da fila porque a máquina do bot ficou 24 h sem contato. Com outra
 * máquina conectada e com IA pronta, um único "Rodar em <outra> desta vez" refaz aquele turno lá, uma vez (o mesmo
 * `rodar-desta-vez` da nota, com o turno da linha); sem outra viva, só o texto.
 */
export function linhaDoTurnoPreso(m: Mensagem, estado: Pick<Estado, "maquinas" | "contasIa" | "agora" | "conversas" | "trabalhoDetalhe"> & Partial<Pick<Estado, "turnosRefeitos">>): string | null {
  const p = m.payload;
  if (p?.kind !== "turno_preso") return null;
  // QA do NOD-314: só a máquina em que o servidor aceita refazer (com conta pronta) e só até refazer — o refazer deixa uma
  // linha de sistema do MESMO turno depois desta ("Rodando em <máquina> desta vez"); com ela, o atalho some.
  // QA do NOD-314 (achado 2): com o turno fixado numa IA, só a máquina com conta DELA (o servidor recusa as outras).
  const outra = outraMaquinaDestaVez(estado, p.maquinaId, p.ia);
  const botao = outra && m.turnoId && !turnoPresoJaRefeito(m, estado)
    ? ` <button type="button" class="linha-link" data-act="rodar-desta-vez" data-conversa="${esc(m.conversaId)}" data-maquina="${esc(outra.id)}" data-turno="${esc(m.turnoId)}">Rodar em ${esc(outra.nome)} desta vez</button>`
    : "";
  return `<div class="msg-sistema">${paragrafos(m.texto)}${botao}</div>`;
}

/** QA do NOD-314: o turno da linha já foi refeito? Há outra linha de sistema do mesmo turno, depois desta. */
function turnoPresoJaRefeito(m: Mensagem, estado: Pick<Estado, "conversas" | "trabalhoDetalhe"> & Partial<Pick<Estado, "turnosRefeitos">>): boolean {
  // O servidor já disse "ja_refeito" a um clique nesta sessão (a linha do refazer pode ser antiga, da Atividade): some.
  if (m.turnoId && estado.turnosRefeitos?.includes(m.turnoId)) return true;
  const vistas = [...(estado.conversas[m.conversaId]?.mensagens ?? []), ...Object.values(estado.trabalhoDetalhe).flatMap((d) => d.mensagens)];
  return vistas.some((x) => x.id !== m.id && x.turnoId === m.turnoId && x.kind === "sistema" && x.criadoEm >= m.criadoEm);
}

/**
 * As linhas de IA do plano das IAs (2026-10-10): a troca de IA (tela 3) e o limite sem outra IA pronta (tela 4). Leem o
 * bot que falou (o modelo dele na IA que assumiu; se está em "Uma IA só") e o estado das IAs (do Mac ou do servidor).
 */
function linhaDeIa(m: Mensagem, estado: Estado): string | null {
  const p = m.payload;
  if (p?.kind === "conta_trocada") return linhaContaTrocada(m);
  if (p?.kind === "conta_seguiu" || p?.kind === "conta_escolhida") return linhaContaSeguiu(m);
  // ADR-108 (R4/R6): o aviso de troca de IA do bot (o bot vem do payload: a linha pode ter nascido do despacho).
  if (p?.kind === "troca_de_ia") return cartaoTrocaDeIa(m, { nomeDoBot: agenteDe(estado, p.agenteId)?.nome ?? null, agora: estado.agora });
  if (p?.kind !== "ia_trocada" && p?.kind !== "limite_do_plano") return null;
  const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
  const ias = iasDaTela(estado);
  if (p.kind === "ia_trocada") {
    const ia = ias.find((i) => i.id === p.para);
    return linhaIaTrocada(m, { modelo: ia && bot ? ia.modelos.find((x) => x.id === escolhaEfetiva(ia, inteligenciaDoBot(bot).escolhas).modelo)?.nome ?? null : null });
  }
  return linhaLimiteSemOutra(m, { nomeDoBot: bot?.nome ?? null, agenteId: bot?.id ?? null, agora: estado.agora, ui: estado.iasMac, ias, fixa: bot ? inteligenciaDoBot(bot).modo === "fixa" : false, contasIa: estado.contasIa });
}

/**
 * NOD-220 (revisão do #303): a fonte ÚNICA de "de que IA o aviso depende" — decide se ela ainda está fora, se o aviso a
 * nomeia e o nome no "já voltou". Em ordem:
 * - bot fixado (NOD-171/NOD-213): a IA DELE, mesmo que a negação tenha nomeado outra (ele não roda em outra);
 * - payload `ia` (o harness do turno que recusou, gravado desde a NOD-220): essa IA, nomeada no aviso. Valor fora do
 *   catálogo da web (IA nova, dado torto): nada se infere — segue fora, sem nome;
 * - negação antiga ou do executor (sem `ia`) com IA no `nome`: a sonda dessa IA ("codex-cli" só vem do harness; "claude-cli"
 *   é o motor local ou o harness, e os dois são a sonda do Claude Code), sem nomear no aviso — o de sempre fica legível;
 * - "catcher": a sonda do próprio catcher (o executor que faltou), nunca a de uma IA;
 * - "ia" ou desconhecido: nenhuma — nunca "já voltou".
 */
type AlvoDoAviso = { ia: IdIa; nomeia: boolean } | { motor: "catcher" };
function alvoDoAviso(negacao: { nome: string; ia?: unknown } | null, fixado: IdIa | null): AlvoDoAviso | null {
  if (fixado) return { ia: fixado, nomeia: true };
  if (!negacao) return null;
  if (negacao.ia !== undefined) return ehIa(negacao.ia) ? { ia: negacao.ia, nomeia: true } : null;
  if (ehIa(negacao.nome)) return { ia: negacao.nome, nomeia: false };
  return negacao.nome === "catcher" ? { motor: "catcher" } : null;
}

/** A IA que a negação diz ter recusado: `ia` (valor fora do catálogo: nenhuma); sem `ia`, o `nome` quando é IA. */
function iaQueRecusou(negacao: { nome: string; ia?: unknown } | null): IdIa | null {
  if (!negacao) return null;
  const ia = negacao.ia !== undefined ? negacao.ia : negacao.nome;
  return ehIa(ia) ? ia : null;
}

/** A sonda do alvo. Sem o catálogo das IAs (servidor anterior à NOD-171), a do Claude Code é a do motor local. */
function sondaDoAlvo(estado: Estado, alvo: AlvoDoAviso): Inventario | null {
  const doMotor = (id: string): Inventario | null => estado.executor ? estado.executor.opcoes.find((o) => o.id === id)?.inventario ?? null : id === "claude-cli" ? estado.inventario : null;
  if ("motor" in alvo) return doMotor(alvo.motor);
  return estado.executor?.harnesses ? inventarioDaIa(estado, alvo.ia) : alvo.ia === "claude-cli" ? doMotor("claude-cli") : null;
}

/** NOD-285: o nome do tipo de arquivo como a pessoa lê (o mesmo da frase do servidor, src/domain/harness.ts). */
const NOME_DO_TIPO_DE_ANEXO: Readonly<Record<TipoAnexo, string>> = { pdf: "PDF", imagem: "imagem", texto: "arquivo de texto" };

/**
 * Executor indisponível (ADR-029, classe plano_ausente) como aviso de ERRO do design system (definido em 2026-10-04):
 * o trabalho não começou. A frase da redação fica atrás de "Detalhes técnicos" (traz o motivo cru e a hora);
 * na frente, o que aconteceu em palavras e o próximo passo: "Conectar IA" enquanto a IA continua fora, e "mande de
 * novo" quando ela já voltou (a mensagem perdida não é reenviada sozinha).
 */
function avisoSemExecutor(m: Mensagem, estado: Estado): string {
  const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
  const nome = bot?.nome;
  const negacao = m.payload?.kind === "negacao" ? m.payload : null;
  // NOD-171/NOD-213: o bot FIXADO numa IA depende do inventário DELA, não do motor em uso. Quem diz se o bot está fixado
  // (e em qual IA) é a `inteligencia` que o servidor calcula pelo domínio (iaDoModelo): um bot com modelo GPT é do Codex,
  // nunca do Claude Code. A regra não se repete aqui.
  const intel = bot ? inteligenciaDoBot(bot) : null;
  const fixado = intel?.modo === "fixa" && intel.fixa && ehIa(intel.fixa) ? intel.fixa : null;
  const alvo = alvoDoAviso(negacao, fixado);
  // NOD-213/NOD-220: "já voltou" só com a sonda DO ALVO pronta e mais nova que a negação; sem alvo, nunca.
  const aindaFora = !alvo || !prontaDepois(sondaDoAlvo(estado, alvo), m.criadoEm);
  const iaDoAlvo = alvo && "ia" in alvo ? alvo.ia : null;
  // A IA da causa e do modelo recusado: a que recusou (`ia`; nas antigas, o `nome`); sem ela, a do bot fixado.
  const iaDoAviso = iaQueRecusou(negacao) ?? fixado;
  const noApp = "nodDesktop" in globalThis;
  const detalhes = `<details class="aviso-estado-detalhes" data-disclosure="negacao-${esc(m.id)}"><summary>Detalhes técnicos</summary>${paragrafos(m.texto)}</details>`;
  // NOD-285 (revisão do Gil no #345): a IA está pronta e só não lê o arquivo. Nem "nenhuma IA pronta", nem "já voltou",
  // nem "fica guardada": mandar de novo dá a mesma negação enquanto não houver uma IA que leia o arquivo.
  if (negacao?.anexo) {
    const tipo = NOME_DO_TIPO_DE_ANEXO[negacao.anexo];
    // Quem lê o tipo sai das capacidades do catálogo (ADR-083), nunca do id da IA.
    const leem = (estado.executor?.harnesses?.opcoes ?? []).filter((h) => h.integrado && h.capacidades.anexos.includes(negacao.anexo!)).map((h) => h.nome);
    const passo = leem.length > 0 ? `Deixe o ${leem.join(" ou o ")} pronto e mande o arquivo de novo, ou cole o conteúdo como texto.` : "Cole o conteúdo como texto.";
    return avisoDeEstado({
      tom: "erro",
      titulo: "Nenhum trabalho começou.",
      texto: `${nome ?? "O bot"} não consegue ler ${tipo} com as IAs prontas agora. ${passo}`,
      extra: detalhes,
      acao: botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } }),
    });
  }
  // definido em 2026-10-05: a IA estava logada e a conta não serviu — aviso próprio, com a causa e os botões (ia-fora.ts).
  // Esse aviso não diz que a IA "voltou": diz que JÁ HÁ UMA IA PRONTA. No Automático (sem IA fixada) o bot pega a IA em
  // uso, então vale a sonda dela, mais nova que a negação (NOD-213); o bot fixado segue a regra da IA dele.
  if (negacao?.causa && iaDoAviso) return avisoContaSemAcesso(m, estado, { nomeDoBot: nome ?? "O bot", ia: iaDoAviso, causa: negacao.causa, aindaFora: fixado ? aindaFora : !prontaDepois(inventarioEmUso(estado), m.criadoEm), noApp });
  // NOD-171: a IA está pronta e recusou o modelo do agente; esperar não resolve.
  if (negacao?.modelo && iaDoAviso) return avisoModeloRecusado(m, { nomeDoBot: nome ?? null, agenteId: bot?.id ?? null, ia: iaDoAviso, modelo: negacao.modelo });
  // NOD-171/NOD-220: a IA do alvo, nomeável e ainda fora — o aviso diz QUAL e o estado dela (desatualizada, sem login, no
  // limite, fora, ou só "indisponível" quando o catálogo não explica).
  if (aindaFora && alvo && "ia" in alvo && alvo.nomeia) return avisoHarnessFora(m, estado, { nomeDoBot: nome ?? null, agenteId: bot?.id ?? null, ia: alvo.ia, noApp });
  const voltou = iaDoAlvo ? `O ${PROVEDOR_DA_IA[iaDoAlvo].cli} já voltou` : "Ela já voltou";
  return avisoDeEstado({
    tom: "erro",
    titulo: "Nenhum trabalho começou.",
    texto: aindaFora
      ? `${nome ?? "O bot"} não pôde começar: nenhuma IA está pronta agora. Sua mensagem fica guardada: quando a IA voltar, ${nome ?? "o bot"} responde sozinho.`
      : `${nome ?? "O bot"} não pôde começar porque a sua conta de IA estava desconectada. ${voltou}: se a resposta não chegou, mande a mensagem de novo.`,
    extra: detalhes,
    acao: aindaFora ? botao("secao-espaco", "Conectar IA", { classe: "pri sm", dados: { secao: "conexao" } }) : undefined,
  });
}

/**
 * Uma mensagem. Texto vira BALÃO (protótipo private-agents-minimal): você à direita (preto), o bot à
 * esquerda (cinza). Os demais kinds (sistema, handoff, negação, rotina…) seguem como linhas discretas.
 * `mostrarAutor` liga o nome do bot dentro do balão — útil em salas com vários agentes.
 */
/** A rota de anexos da conversa (ADR-046), escopada pelo tenant da sessão. */
function urlDoAnexo(tenant: string, m: Mensagem, id: string): string {
  return `/api/t/${encodeURIComponent(tenant)}/conversas/${encodeURIComponent(m.conversaId)}/anexos/${encodeURIComponent(id)}`;
}

/**
 * NOD-56: a fala do bot só ganha anexo de imagem pela captura da tela ao fim do turno (NOD-200, `assentar-turno.ts`).
 * Ela sai de `msg-anexos` (acima do balão, à direita, desenhado para a pessoa) e vira o rodapé do balão.
 */
const ehCaptura = (m: Mensagem, mime: string): boolean => m.autoria.autor_tipo !== "pessoa" && mime.startsWith("image/");

/** ADR-046: arquivos que a pessoa mandou, acima do balão. A captura do bot não entra aqui (NOD-56). */
function anexosDe(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  const anexos = (m.anexos ?? []).filter((a) => !ehCaptura(m, a.mime));
  if (!anexos.length || !tenant) return "";
  return renderAnexosDaMensagem(anexos, (id) => urlDoAnexo(tenant, m, id));
}

/** NOD-56: o conteúdo do <dialog> da captura ampliada (`captura-ampliada.ts`); puro, para o teste sem DOM. */
export function htmlCapturaAmpliada(src: string, legenda: string): string {
  return `<div class="captura-ampliada-corpo"><img src="${esc(src)}" alt="${esc(legenda)}" /><div class="captura-ampliada-rodape"><span>${esc(legenda)}</span><a href="${esc(src)}" target="_blank" rel="noopener">Abrir em nova aba</a><button type="button" class="bt sm" data-captura="fechar">Fechar</button></div></div>`;
}

/**
 * NOD-56 (protótipo do Gil, 2026-10-05): a tela do computador ao fim do turno, como miniatura de 240×150 abaixo do
 * balão do bot, com a legenda neutra. Clicar amplia num <dialog> (`ampliar-captura`). Mais de uma imagem (não acontece
 * hoje): só a primeira. Sem captura, nada — o balão fica igual.
 */
export function capturaDoTurno(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  const captura = m.anexos?.find((a) => ehCaptura(m, a.mime));
  if (!captura || !tenant) return "";
  const url = esc(urlDoAnexo(tenant, m, captura.id));
  const legenda = `Tela do computador ao fim do turno · ${hora(m.criadoEm)}`;
  // Protótipo (Gil): o alt e a ampliação nomeiam o bot; sem nome conhecido, "do bot".
  const nome = agenteDe(estado, m.autoria.autor_id)?.nome;
  const deQuem = nome ? `de ${nome}` : "do bot";
  const legendaAmpliada = `Tela do computador ${deQuem} ao fim do turno · ${hora(m.criadoEm)}`;
  return `<figure class="msg-captura"><button type="button" class="msg-captura-bt" data-act="ampliar-captura" data-src="${url}" data-legenda="${esc(legendaAmpliada)}" aria-label="Ampliar tela do computador ao fim do turno" aria-haspopup="dialog"><img src="${url}" alt="${esc(`Tela do computador ${deQuem} ao fim do turno`)}" loading="lazy" width="240" height="150" /></button><figcaption>${esc(legenda)}</figcaption></figure>`;
}

/**
 * `destaVez` (ADR-090, protótipo "Nod — Motor na VM", tela 4c): a máquina do bot está sem contato e há outra conectada —
 * a própria linha da fila oferece "Rodar em <outra> desta vez", sem faixa por cima da conversa.
 */
type SituacaoFila = { tipo: "na_fila"; texto: string; destaVez?: { conversaId: string; maquinaId: string; nome: string } } | { tipo: "cancelando" } | { tipo: "cancelada" };

/**
 * Onde a mensagem da pessoa está na fila (definido em 2026-09-24): o turno que ela disparou ainda
 * espera, está nos 5 s do Desfazer, ou foi cancelado antes de rodar. null = seguiu o fluxo normal.
 */
export function situacaoNaFila(m: Mensagem, estado: Estado): (SituacaoFila & { turnoId: string }) | null {
  if (m.autoria.autor_tipo !== "pessoa") return null;
  const c = estado.conversas[m.conversaId];
  if (!c) return null;
  const cancelado = c.turnosCancelados.find((t) => t.mensagemId === m.id);
  if (cancelado) return { tipo: "cancelada", turnoId: cancelado.id };
  const emCurso = c.turnosEmCurso.find((t) => t.mensagemId === m.id);
  if (!emCurso) return null;
  if (emCurso.id in estado.cancelando) return { tipo: "cancelando", turnoId: emCurso.id };
  // O estado VIVO manda: o frame turno.iniciado 'despachado' tira o chip antes do REST reler a conversa.
  if (estado.turnosVivos[emCurso.id]?.estado !== "na_fila") return null;
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const nome = agente?.nome ?? "o agente";
  // ADR-090: o bot trabalha numa máquina que está sem contato — a fila espera por ela, e a linha diz isso.
  // QA do NOD-314: o turno que a pessoa mandou "desta vez" para outra máquina espera ESSA máquina, não a do bot.
  const destaVez = emCurso.maquinaDestaVez ? (estado.maquinas?.maquinas ?? []).find((x) => x.id === emCurso.maquinaDestaVez) ?? null : null;
  const doBot = destaVez ?? (agente ? maquinaDoBot(estado, agente) : null);
  // Revisão do PR: conectada mas sem nenhuma IA pronta (o login ainda não foi feito nela) também segura a fila.
  // ADR-121 (NOD-92): a máquina na nuvem está acordando para o trabalho (ou dorme e vai acordar). A espera é curta e rodar
  // em outra duplicaria o trabalho: nada de "Rodar em X desta vez", que só volta na falha (`falhou_ao_acordar`).
  const doTrabalho = (estado.trabalhos?.trabalhos ?? []).find((t) => t.conversaId === c.conversa.id && t.maquina?.acordando)?.maquina ?? null;
  if (acordandoNaFila(doBot, doTrabalho)) return { tipo: "na_fila", turnoId: emCurso.id, texto: `Acordando ${doTrabalho?.nome ?? doBot?.nome ?? "a máquina"}… · costuma levar 1 a 2 min` };
  const semIa = !!doBot && doBot.conectada && !Object.values(doBot.ias).includes("pronto");
  if (doBot && semIa) return { tipo: "na_fila", turnoId: emCurso.id, texto: `Na fila · ${doBot.nome} está sem IA pronta (no terminal dela: nod-motor entrar claude ou codex)` };
  if (doBot && !doBot.conectada) {
    const outra = (estado.maquinas?.maquinas ?? []).find((m) => m.conectada && m.id !== doBot.id && Object.values(m.ias).includes("pronto"));
    return { tipo: "na_fila", turnoId: emCurso.id, texto: `Na fila · ${doBot.nome} não responde${doBot.ultimoUsoEm ? ` desde ${hora(doBot.ultimoUsoEm)}` : ""}`, ...(outra ? { destaVez: { conversaId: c.conversa.id, maquinaId: outra.id, nome: outra.nome } } : {}) };
  }
  const outra = c.turnosPendentes.find((p) => p.id === emCurso.id && p.conversaId !== c.conversa.id);
  if (outra) {
    const la = estado.frota?.agentes.find((a) => a.conversaId === outra.conversaId);
    return { tipo: "na_fila", turnoId: emCurso.id, texto: `Na fila · ${nome} está respondendo em ${la ? `#${la.nome}` : "outra conversa"}` };
  }
  const naFila = Object.values(estado.turnosVivos).filter((t) => t.conversaId === c.conversa.id && t.estado === "na_fila" && !(t.turnoId in estado.cancelando)).length;
  return { tipo: "na_fila", turnoId: emCurso.id, texto: naFila > 1 ? `Na fila · ${nome} lê junto com as outras quando terminar` : `Na fila · ${nome} lê quando terminar o turno atual` };
}

function renderSituacaoFila(s: SituacaoFila, turnoId: string): string {
  if (s.tipo === "cancelada") return `<div class="fila-chip cancelada">Cancelada · não rodou</div>`;
  if (s.tipo === "cancelando") return `<div class="fila-chip">Cancelando…${botao("desfazer-cancelamento", "Desfazer", { classe: "link", id: turnoId })}</div>`;
  const destaVez = s.destaVez ? botao("rodar-desta-vez", `Rodar em ${esc(s.destaVez.nome)} desta vez`, { classe: "link", dados: { conversa: s.destaVez.conversaId, maquina: s.destaVez.maquinaId } }) : "";
  return `<div class="fila-chip"><span class="fila-relogio" aria-hidden="true"></span>${esc(s.texto)}${destaVez}${botao("cancelar-turno", "Cancelar", { classe: "link perigo", id: turnoId, aria: "Cancelar esta mensagem da fila" })}</div>`;
}

/** "/review 420" na mensagem da pessoa: o comando vira chip e o resto segue como texto (canvas "Comandos /", C4). */
export function comChipDeComando(texto: string): string {
  const m = /^\/([\w.:-]+)(\s[\s\S]*)?$/.exec(texto.trim());
  if (!m) return paragrafos(texto);
  const resto = (m[2] ?? "").trim();
  return `<span class="chip-comando">/${esc(m[1]!)}</span>${resto ? ` ${paragrafos(resto)}` : ""}`;
}

/**
 * `etiqueta` (definido em 2026-10-07, #191/#195): a fala que chega de uma rotina ou de uma task leva "da rotina …" /
 * "da task …" ao lado do nome — é balão porque é para a pessoa, mas não é resposta à última mensagem dela.
 * `progresso` (chat limpo, PR 7): o marcador do bloco de progresso das frentes que esta fala abriu (./progresso-na-fala.ts).
 * Na fala do bot ele fica dentro do balão, depois do texto (protótipo "4"); no balão da pessoa (a frente da rede), embaixo
 * dele. Nos dois, antes das reações: o progresso é conteúdo da fala; a reação é sobre ela (decisão 20 do plano).
 * `diagramas` (NOD-328): só a timeline de conversa e sala liga; Trabalhos reaproveita esta função e fica com o card.
 */
export function renderMensagem(m: Mensagem, estado: Estado, sala = false, opcoes: { etiqueta?: string; progresso?: string; diagramas?: boolean } = {}): string {
  // Kinds não-texto (parada, sistema, negação) também se relatam — são JUSTAMENTE os que a categoria
  // 'travou_ou_parou' descreve, e o caso de uso já trata mensagem sem turno (definido em 2026-09-21).
  // definido em 2026-10-03: o artefato é uma fala do bot — mascote, nome e hora em volta do card, como os balões; solto
  // na margem ele parecia de ninguém.
  if (m.payload?.kind === "artefato") {
    const bot = m.autoria.autor_tipo === "agente" ? agenteDe(estado, m.autoria.autor_id) : undefined;
    return `<article class="message bot com-artefato" data-mensagem="${esc(m.id)}">${bot ? iconeAgente(bot, "md") : ""}<div class="bubble-wrap">${acoesDaMensagem(m, estado, sala)}<div class="msg-autor"><b>${esc(bot?.nome ?? assinatura(m.autoria, nomesDe(estado)))}</b><time>${hora(m.criadoEm)}</time></div>${corpoMensagem(m, estado)}${chipsDeReacao(m, estado)}${faixaDaMensagem(m, estado)}</div></article>`;
  }
  if (m.kind !== "texto") {
    // Chat limpo (PR 4): o recibo da decisão é o cartão do pedido, encolhido com o resultado — alinhado às falas do bot,
    // como o cartão aberto estava, e não no centro como as linhas.
    const encolhido = dadosDoEncolhido(m, estado);
    return `<div class="msg-linha${encolhido ? " msg-encolhido" : ""}" data-mensagem="${esc(m.id)}">${encolhido ? renderCartaoEncolhido(encolhido, m.id) : corpoMensagem(m, estado)}${acoesDaMensagem(m, estado, sala)}${faixaDaMensagem(m, estado)}</div>`;
  }
  const ehPessoa = m.autoria.autor_tipo === "pessoa";
  const agente = ehPessoa ? undefined : agenteDe(estado, m.autoria.autor_id);
  // Autoria composta (ADR-023) aparece inteira: o pedido de colega é "Taga · por você" (ADR-047/058). O bloco de
  // contexto só existe em pedido antigo (delegar_tarefa); o de pedir_a_bot já traz o contexto no próprio texto.
  const autor = ehPessoa ? "Você" : m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agente?.nome ?? assinatura(m.autoria, nomesDe(estado));
  const etiqueta = opcoes.etiqueta ? `<span class="etiqueta-origem">${esc(opcoes.etiqueta)}</span>` : "";
  const sender = `<div class="msg-autor"><b>${esc(autor)}</b><time>${hora(m.criadoEm)}</time>${etiqueta}</div>`;
  const delegacao = m.payload?.kind === "peer_pedido" ? m.payload.delegacao : undefined;
  const contextoDelegado = delegacao ? `<div class="msg-contexto-delegado"><small class="mudo">Contexto de ${esc(agente?.nome ?? (m.payload?.kind === "peer_pedido" ? m.payload.nome : undefined) ?? "um colega")} · não é instrução da pessoa</small><p>${esc(delegacao.tarefa)}</p>${delegacao.contexto ? `<p>${esc(delegacao.contexto)}</p>` : ""}</div>` : "";
  // Chat limpo (PR 6, 2026-10-18; plano, Parte 5): "rodou em <máquina>" e "catcher" saíram do balão e moram na faixa do
  // modo dev e no Raio-X (`ondeRodou`, ./modo-dev.ts); "não confiável" e "parcial" ficam, porque dizem algo do texto.
  const tags = ehPessoa || m.payload?.kind === "peer_pedido" || m.payload?.kind === "boas_vindas"
    ? ""
    : [m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "", m.parcial ? '<span class="tag tag-cinza">parcial</span>' : ""].filter(Boolean).join("");
  const metaTags = tags ? `<div class="meta-tags">${tags}</div>` : "";
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta de pedir_a_pessoa é esta fala; a mensagem que a respondeu
  // leva o rótulo, e a retomada vira uma linha logo depois. revisto em 2026-10-18 (plano "pergunta com botões", Parte 2):
  // a fala vira o cartão da pergunta no lugar do balão (o texto não sai duas vezes), e a resposta que foi uma das opções
  // não sai como balão — o cartão já mostra a escolhida com ✓ (tela "Depois de responder").
  const pergunta = !ehPessoa && m.payload?.kind === "pedido_a_pessoa" ? m.payload : null;
  const resposta = ehPessoa && m.payload?.kind === "resposta_a_pedido" ? m.payload : null;
  if (resposta && respostaPorOpcao(m, estado)) return "";
  const fila = situacaoNaFila(m, estado);
  // "respondendo", não "resposta": `.resposta` já é o campo do card de Retomar (estilos.css).
  // definido em 2026-10-16: computador_pedir_ajuda não pede senha no balão — vira o cartão "Abrir computador" no lugar
  // do cartão da pergunta.
  const motivoTela = pergunta ? motivoDoPedidoDeTela(m.texto) : null;
  const telaAberta = motivoTela !== null && pergunta ? estadoDaPergunta(estado, estado.conversas[m.conversaId]?.mensagens ?? [], pergunta.decisaoId).tipo === "aberta" : false;
  const ouvivel = podeOuvir(m, estado, sala);
  const lendo = estado.leitura?.mensagemId === m.id && ouvivel;
  const classes = `message ${ehPessoa ? "you" : "bot"}${ouvivel ? " ouvivel" : ""}${lendo ? " lendo" : ""}${pergunta ? " pergunta" : ""}${motivoTela !== null ? " com-tela" : ""}${resposta ? " respondendo" : ""}${fila ? ` fila-${fila.tipo}` : ""}`;
  // O progresso vai dentro do balão do bot; no da pessoa (a rede) e no cartão da pergunta (o turno que abriu frentes e
  // terminou perguntando), embaixo dele — o cartão não tem onde recebê-lo, e sem isso o bloco sumia (revisão do PR 398).
  const progressoDentro = !ehPessoa && !pergunta ? (opcoes.progresso ?? "") : "";
  const progressoFora = ehPessoa || pergunta ? (opcoes.progresso ?? "") : "";
  const balao = motivoTela !== null ? htmlCartaoTela(motivoTela, agente?.id ?? "", telaAberta, agente?.nome, pergunta?.decisaoId) : pergunta ? cartaoDaPergunta(m, estado) : ehPessoa && m.texto.trim() === "" && m.anexos?.length ? "" : `<div class="bubble${progressoDentro ? " com-progresso" : ""}">${ehPessoa ? comChipDeComando(m.texto) : textoFormatado(m.texto, { chave: m.id, diagramas: opcoes.diagramas === true })}${metaTags}${progressoDentro}</div>`;
  return `<article class="${classes}" data-mensagem="${esc(m.id)}"${pergunta ? ` data-pergunta="${esc(pergunta.decisaoId)}"` : ""}>
    ${!ehPessoa && agente ? iconeAgente(agente, "md") : ""}<div class="bubble-wrap">${acoesDaMensagem(m, estado, sala)}${sender}${resposta ? rotuloDaResposta(m) : ""}${ehPessoa ? citacaoAcimaDoBalao(m) : ""}${anexosDe(m, estado)}${balao}${progressoFora}${ehPessoa ? "" : avisoDeLeitura(m, estado)}${ehPessoa ? "" : capturaDoTurno(m, estado)}${contextoDelegado}${chipsDeReacao(m, estado)}${fila ? renderSituacaoFila(fila, fila.turnoId) : ""}${faixaDaMensagem(m, estado)}</div>
  </article>${resposta ? linhaDaRetomada(m, estado) : ""}`;
}

function renderProposta(p: Proposta, estado: Estado, propostas: readonly Proposta[]): string {
  const a = agenteDe(estado, p.agenteId);
  // definido em 2026-09-28 (ADR-050): o perfil que traz rotinas é um card só, com as rotinas dentro.
  const cardPerfil = renderCardPerfil(p, propostas, estado, a);
  if (cardPerfil !== null) return cardPerfil;
  // definido em 2026-09-25 (jornadas de conexão): conectar e permitir no mesmo card (card-acesso.ts).
  const cardAcesso = renderCardAcesso(p, itemAbertoDoCard(p, estado), estado);
  if (cardAcesso !== null) return cardAcesso;
  // definido em 2026-09-18: a pasta já vem descoberta, então autorizar é um clique — a pessoa não
  // navega em menu nem digita caminho. Sem candidatas, o mesmo card abre a escolha manual.
  if (p.payload.kind === "pasta") return renderCardPasta(p, p.payload, estado, a);
  // definido em 2026-10-07 (ADR-082): as mudanças em vários bots que o Nod pediu de uma vez — um card, uma linha por ação.
  if (p.payload.kind === "lote_bots") return renderCardLote(p, p.payload, p.estado === "pendente" && decisaoAbertaDoCard(p, estado) !== null);
  let itens = "";
  if (p.payload.kind === "perfil") {
    const c = p.payload;
    itens = [c.nome ? `<div class="it"><b>nome</b>${esc(c.nome)}</div>` : "", c.titulo ? `<div class="it"><b>título</b>${esc(c.titulo)}</div>` : "", c.descricao ? `<div class="it"><b>descrição</b>${esc(c.descricao)}</div>` : ""].join("");
  } else if (p.payload.kind === "rotina") {
    const c = p.payload;
    itens = `<div class="it"><b>quando</b>${esc(c.resumo)} · próxima execução ${esc(dataHora(c.proximaExecucao, c.fusoIana))} (${esc(c.fusoIana)})</div><div class="it"><b>instrução</b>${esc(c.instrucao)}</div><div class="it"><b>fonte</b>${esc(c.fonte)}</div><div class="it"><b>entregável</b>${esc(c.entregavel)}</div><div class="it"><b>limites de aprovação</b>${esc(c.limitesAprovacao)}</div><div class="it"><b>sem dado</b>${esc(c.politicaSemDado)}</div>${linhasPrecisa(p, estado)}`;
  } else if (p.payload.kind === "rotina_atualizacao") {
    const c = p.payload;
    // de→para: a pessoa confirma sem precisar abrir outra tela para lembrar como era.
    itens = `<div class="it"><b>quando</b>${esc(c.antes.resumo)} → ${esc(c.resumo)} · próxima execução ${esc(dataHora(c.proximaExecucao, c.fusoIana ?? ""))}</div><div class="it"><b>instrução</b>${c.instrucao && c.instrucao !== c.antes.instrucao ? `${esc(c.antes.instrucao)} → ${esc(c.instrucao)}` : esc(c.antes.instrucao)}</div>${linhasPrecisa(p, estado)}`;
  } else if (p.payload.kind === "bot") {
    // definido em 2026-10-04 (ADR-077): o bot que a Nina propõe no onboarding — nome e o que faz; nasce pela decisão.
    const c = p.payload;
    itens = `<div class="it"><b>nome</b>${esc(c.nome)}</div><div class="it"><b>o que faz</b>${esc(c.descricao)}</div>`;
  } else if (p.payload.kind === "rotina_exclusao") {
    const c = p.payload;
    itens = `<div class="it"><b>quando</b>${esc(c.resumo)}</div><div class="it"><b>instrução</b>${esc(c.instrucao)}</div><div class="it">Depois de excluída, nada mais é disparado por ela. Para só interromper por um tempo, peça para pausar.</div>`;
  } else {
    const c = p.payload;
    const decisao = decisaoAbertaDoCard(p, estado);
    // definido em 2026-09-24 (ADR-044): com a decisão de mesmo id aberta, o card é a frase do domínio e
    // um botão; os nomes técnicos vão para o <details>. Sem ela (pedido anterior), o card de revisão.
    // Pedido de rotina (emenda de 2026-09-24): as janelas que não rodaram enquanto o card espera.
    itens = decisao
      ? `<div class="it">${esc(decisao.frase)}${linhaNaoRodaram(itemAbertoDoCard(p, estado)?.rotinaParada ?? null, estado.agora)}</div>${detalheAcesso(p)}`
      : `<div class="it"><b>conector</b>${esc(c.conector)}</div><div class="it"><b>capacidades</b>${esc(c.capacidades.join(", "))} (${esc(c.nivel)})</div><div class="it"><b>não pedido</b>${esc(c.naoPedido.join(", ") || "—")}</div><div class="it">Revise o pedido. A autorização final aparecerá aqui na conversa.</div>`;
  }
  const aberto = itemAbertoDoCard(p, estado);
  const rotinaParada = p.payload.kind === "acesso" && aberto ? marcaRotinaParada(p, aberto.rotinaParada, estado.agora) : "";
  const comAcesso = acoesDaRotinaComAcesso(p, estado);
  return `<div class="card-prop" data-proposta="${esc(p.id)}">
    <div class="hd">${esc(a?.nome ?? "o agente")} propõe · nada vale antes de você confirmar</div>
    <div class="ttl">${p.payload.kind === "perfil" ? "Perfil" : p.payload.kind === "bot" ? "Novo bot" : p.payload.kind === "rotina" ? "Rotina" : p.payload.kind === "rotina_atualizacao" ? "Mudança de rotina" : p.payload.kind === "rotina_exclusao" ? "Excluir rotina" : "Acesso a conector"}${rotinaParada}${marcaGemeas(aberto)}</div>
    ${itens}
    <div class="ft">${comAcesso?.botoes ?? acoesProposta(p, estado)}</div>${comAcesso?.ajuda ?? ""}
  </div>`;
}

/** O item de mesmo id ainda aberto em "Sua vez" (pedir-acesso.ts cria proposta e decisão juntas). */
function itemAbertoDoCard(p: Proposta, estado: Estado): SuaVezDto["itens"][number] | undefined {
  return estado.suaVez?.itens.find((i) => i.decisao.id === p.id && i.estadoColuna !== "vencido");
}

/** A decisão de mesmo id ainda aberta em "Sua vez" (pedir-acesso.ts cria as duas juntas). */
function decisaoAbertaDoCard(p: Proposta, estado: Estado): Decisao | null {
  return itemAbertoDoCard(p, estado)?.decisao ?? null;
}

/** definido em 2026-09-22: mudar/excluir rotina existente se aplica pela DECISÃO (id === proposta.id),
 *  não por POST propostas/:id/confirmar, que recusa esses kinds (confirmar-proposta.ts). Mesmos
 *  botões e verbos de "Sua vez", para o chat não oferecer um Confirmar que sempre falha.
 *  definido em 2026-09-24 (ADR-044): acesso também — um clique concede e continua. "Revisar acesso"
 *  fica só para o pedido anterior, cuja decisão ainda não existe. */
function acoesProposta(p: Proposta, estado: Estado): string {
  if (p.payload.kind === "bot") return `${botao("decidir-proposta", "Criar bot", { classe: "pri", id: p.id })}${botao("recusar-decisao", "Deixar de lado", { id: p.id })}`;
  if (p.payload.kind === "rotina_atualizacao") return `${botao("decidir-proposta", "Aplicar mudança", { classe: "pri", id: p.id })}${botao("recusar-decisao", "Manter como está", { id: p.id })}`;
  if (p.payload.kind === "rotina_exclusao") return `${botao("decidir-proposta", "Excluir rotina", { classe: "pri", id: p.id })}${botao("recusar-decisao", "Manter rotina", { id: p.id })}`;
  if (p.payload.kind === "acesso" && decisaoAbertaDoCard(p, estado)) {
    const r = rotulosAcesso(p);
    return `${botao("decidir-proposta", r.permitir, { classe: "pri", id: p.id })}${botao("recusar-decisao", r.recusar, { id: p.id })}`;
  }
  return `${botao("confirmar-proposta", p.payload.kind === "acesso" ? "Revisar acesso" : "Confirmar", { classe: "pri", id: p.id })}${botao("recusar-proposta", "Deixar de lado", { id: p.id })}`;
}

/**
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a rotina que declara acessos
 * nasce pelo mesmo confirmar de sempre, com o botão que diz que libera junto; a mudança de rotina que traz
 * acessos, pela decisão (como acoesProposta). null = não declara: os botões de sempre.
 */
function acoesDaRotinaComAcesso(p: Proposta, estado: Estado): { botoes: string; ajuda: string } | null {
  if (p.payload.kind === "rotina") return acoesComAcesso(p, estado, { confirmar: "confirmar-proposta", recusar: "recusar-proposta", rotuloRecusar: "Deixar de lado" });
  if (p.payload.kind === "rotina_atualizacao") return acoesComAcesso(p, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Manter como está" });
  return null;
}

/** A proposta de rotina existente continua 'pendente' quando a decisão dela vence (o varredor só
 *  vence decisões). Os botões do card dariam estado_invalido; sai o card e fica a decisão vencida,
 *  em cinza e com Reabrir, como em "Sua vez". Reaberta, o card volta com os botões funcionando.
 *  Pedido de acesso idem desde 2026-09-24 (ADR-044): também nasce com a decisão de mesmo id. */
function comDecisaoVencida(p: Proposta, estado: Estado): boolean {
  if (p.payload.kind !== "rotina_atualizacao" && p.payload.kind !== "rotina_exclusao" && p.payload.kind !== "acesso") return false;
  return estado.suaVez?.itens.some((i) => i.decisao.id === p.id && i.estadoColuna === "vencido") ?? false;
}

/** Etapas mostradas no cartão aberto; as anteriores viram "+N anteriores" (sem rolagem interna, que o re-render perderia). */
const ETAPAS_VISIVEIS = 20;

/**
 * O turno que já chamou ferramenta vira UMA linha (revisto em 2026-10-18, chat limpo, PR 7; plano, Parte 4 · 4b; protótipo
 * "Conversa típica"): "Clarice está trabalhando · ver etapas", com o ponto que pulsa. "ver etapas" abre o que o cartão
 * grande mostrava (definido em 2026-09-24): o que ele está fazendo agora, a lista de tarefas do bot e as etapas feitas.
 * O vigia fica à vista, fora do recolhido, porque pede ação (o Parar). Sem relógio na linha: a presença do cabeçalho já diz
 * "Trabalhando", e o corpo não precisa mudar a cada segundo.
 */
function renderLinhaAtividade(t: TurnoVivo, a: AtividadeTurno, estado: Estado, nome: string, parar: string): string {
  const mudo = minutosSemNovidade(a, estado.agora);
  const visiveis = a.etapas.slice(-ETAPAS_VISIVEIS);
  const anteriores = a.totalEtapas - visiveis.length;
  const etapas = visiveis.map((e) => `<li title="${esc(e.texto)}"><span class="atividade-ok" aria-hidden="true">✓</span><span>${esc(resumoEtapa(e.texto))}</span><small>${e.ferramentas === 1 ? "1 ferramenta" : `${e.ferramentas} ferramentas`}</small></li>`).join("");
  const contagem = `${a.totalEtapas === 1 ? "1 etapa" : `${a.totalEtapas} etapas`} · ${a.ferramentas === 1 ? "1 ferramenta" : `${a.ferramentas} ferramentas`}`;
  return `<article class="message bot atividade ao-vivo" data-turno="${esc(t.turnoId)}"><div class="bubble-wrap">
    <details class="atividade-linha" data-disclosure="atividade-${esc(t.turnoId)}"><summary><span class="atividade-pulso${mudo !== null ? " parado" : ""}" aria-hidden="true"></span><span class="atividade-quem">${esc(nome)} está trabalhando</span><span class="atividade-ver">ver etapas</span><span class="atividade-recolher">ocultar etapas</span></summary>
      <div class="atividade-etapas" aria-label="Atividade de ${esc(nome)}" role="group">
        <p class="atividade-agora">${soLinks(linhaAtual(a))}</p>
        ${renderTarefasDoBot(a.tarefas)}
        <p class="atividade-conta">${contagem}</p>
        <ol>${anteriores > 0 ? `<li class="atividade-anteriores">+ ${anteriores} ${anteriores === 1 ? "etapa anterior" : "etapas anteriores"}</li>` : ""}${etapas}</ol>
      </div>
    </details>
    ${renderAvisoDoVigia(a, estado.agora, parar)}
  </div></article>`;
}

/**
 * O vigia do turno na tela (definido em 2026-10-05, NOD-73; protótipo do Gil): só aviso — quem decide parar é a
 * pessoa, com o Parar que já existe. Minutos sem novidade contados pelo relógio da tela a partir de `mudoDesde`;
 * null = sem aviso de silêncio.
 */
export function minutosSemNovidade(a: AtividadeTurno | undefined, agora: number): number | null {
  const desde = a?.vigia?.mudoDesde;
  return desde === null || desde === undefined ? null : Math.max(1, Math.floor((agora - desde) / 60_000));
}

function esperaDoVigia(v: VigiaDaAtividade): string {
  if (v.aberta) return `Esperando <b>${esc(v.aberta)}</b> terminar.`;
  if (v.emFundo > 0) return `Esperando ${v.emFundo === 1 ? "1 comando" : `${v.emFundo} comandos`} em segundo plano.`;
  return "O bot não responde.";
}

/** Um bloco só, em âmbar (relógio no silêncio, setas em círculo na repetição; nunca o triângulo de erro), com um Parar: o silêncio e a repetição (só o maior limiar, numa linha que se atualiza). */
export function renderAvisoDoVigia(a: AtividadeTurno, agora: number, parar: string): string {
  const v = a.vigia;
  const mudo = minutosSemNovidade(a, agora);
  if (!v || (mudo === null && !v.repeticao)) return "";
  const linhas = [
    mudo !== null ? `<p><b><span class="vigia-ic" aria-hidden="true">${ICONE.relogioMini}</span>Sem novidade há ${mudo} min</b><span>${esperaDoVigia(v)} Se parecer travado, use Parar.</span></p>` : "",
    v.repeticao ? `<p><b><span class="vigia-ic" aria-hidden="true">${ICONE.proxima}</span>Repetiu a mesma ação ${v.repeticao.vezes} vezes</b><span>Em <b>${esc(v.repeticao.rotulo)}</b>. Pode estar andando em círculo.</span></p>` : "",
  ].join("");
  return `<div class="atividade-vigia" role="status">${linhas}${parar}</div>`;
}

/** O Parar do aviso: a mesma ação do Parar do campo (conversa) ou da sala, em âmbar — é aviso, não erro (protótipo do Gil). */
function pararDoVigia(c: ConversaEstado): string {
  const salaId = c.conversa.salaId;
  return salaId
    ? botao("parar-sala", "Parar", { classe: "aviso", id: salaId, titulo: "interrompe todos os turnos desta sala" })
    : botao("parar-conversa", "Parar", { classe: "aviso", titulo: "interrompe agora o que está rodando nesta conversa" });
}

/** A lista de tarefas do bot (definido em 2026-09-28): a checklist que o terminal mostra, dentro do cartão. */
const MARCA_TAREFA: Record<TarefaDoBot["estado"], { simbolo: string; rotulo: string }> = {
  feita: { simbolo: "✓", rotulo: "feita" },
  andamento: { simbolo: "●", rotulo: "em andamento" },
  pendente: { simbolo: "○", rotulo: "a fazer" },
};

export function renderTarefasDoBot(tarefas: readonly TarefaDoBot[]): string {
  if (tarefas.length === 0) return "";
  const feitas = tarefas.filter((t) => t.estado === "feita").length;
  const itens = tarefas.map((t) => `<li class="tarefa-${t.estado}"><span class="tarefa-marca" aria-hidden="true">${MARCA_TAREFA[t.estado].simbolo}</span><span>${esc(t.titulo)}</span><span class="sr-only">(${MARCA_TAREFA[t.estado].rotulo})</span></li>`).join("");
  return `<section class="atividade-tarefas" aria-label="Tarefas: ${feitas} de ${tarefas.length} feitas"><div class="atividade-tarefas-cab">Tarefas · ${feitas} de ${tarefas.length}</div><ol>${itens}</ol></section>`;
}

/**
 * Um turno vivo na parte ao vivo da timeline (definido em 2026-09-30): cada turno é um bloco, e só o bloco do turno
 * que escreveu é regravado. medido em 2026-09-30: acrescentar só o pedaço novo ao balão (em vez de regravá-lo) deixou
 * o turno pesado PIOR — o Chrome refaz o layout do parágrafo inteiro de qualquer jeito, e cada layout ficou mais caro
 * com os nós pequenos acrescentados (2,2 → 2,9 s de layout, 55 → 44 quadros/s; scripts/carga-tela).
 * revisto em 2026-10-18 (chat limpo, PR 7): sem o cabeçalho "● ao vivo" (mascote, nome, hora) que morava num bloco à parte;
 * o turno com ferramenta é a linha "… está trabalhando · ver etapas" e o sem ferramenta, o balão em streaming.
 */
function blocosDoTurnoVivo(t: TurnoVivo, c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const chave = `vivo:${t.turnoId}`;
  const atividade = estado.atividades[c.conversa.id]?.[t.turnoId];
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const nome = agente?.nome ?? "O agente";
  if (atividade && atividade.ferramentas > 0) {
    return [{ chave, html: renderLinhaAtividade(t, atividade, estado, nome, pararDoVigia(c)) }];
  }
  // NOD-73: sem cartão, o aviso de silêncio vira uma linha só, com o Parar.
  const mudo = t.estado === "rodando" ? minutosSemNovidade(atividade, estado.agora) : null;
  const linhaMuda = mudo !== null ? `<div class="msg-sistema vigia-linha" role="status">sem novidade há ${mudo} min · o bot não responde · ${pararDoVigia(c)}</div>` : "";
  if (atividade?.atual) {
    // definido em 2026-10-03: o texto ao vivo já sai formatado (negrito, listas, tabelas, chips), em vez de cru até o
    // fim do turno — o salto da troca pelo balão final some. A memória por chave guarda o último pedaço formatado.
    return [{ chave, html: `<article class="message bot streaming ao-vivo" data-turno="${esc(t.turnoId)}"><div class="bubble-wrap"><div class="bubble">${comCursor(textoFormatado(atividade.atual, { chave, aoVivo: true }))}</div></div></article>${linhaMuda}` }];
  }
  return [{ chave, html: linhaDoTurnoVivo(t, c, estado) + linhaMuda }];
}

/** O cursor do streaming fica na mesma linha do último texto, mesmo quando ele termina num parágrafo, item ou título. */
function comCursor(html: string): string {
  const cursor = '<span class="cursor">▍</span>';
  const fim = /(<\/(?:p|li)>(?:<\/[uo]l>)?)$/.exec(html);
  return fim ? `${html.slice(0, fim.index)}${cursor}${fim[1]}` : `${html}${cursor}`;
}

function linhaDoTurnoVivo(t: TurnoVivo, c: ConversaEstado, estado: Estado): string {
  // A mensagem que disparou o turno já mostra "Na fila" com Cancelar embaixo dela: não repete a linha.
  const origem = c.turnosEmCurso.find((e) => e.id === t.turnoId)?.mensagemId;
  if (t.estado === "na_fila" && origem && c.mensagens.some((m) => m.id === origem)) return "";
  const pendente = c.turnosPendentes.find((p) => p.id === t.turnoId);
  if (pendente && pendente.conversaId !== c.conversa.id) {
    const outra = estado.frota?.agentes.find((a) => a.conversaId === pendente.conversaId);
    return `<div class="msg-sistema">na fila — o agente está respondendo em ${esc(outra ? `#${outra.nome}` : "outra conversa")} (${haQuanto(estado.agora - t.desde)})</div>`;
  }
  return `<div class="msg-sistema">${[t.estado === "rodando" ? "trabalhando" : "na fila", t.executor ?? "", haQuanto(estado.agora - t.desde)].filter(Boolean).map(esc).join(" · ")}</div>`;
}

/** definido em 2026-09-17: uma linha por turno remetente; respostas se ligam pelo tarefaId, não pelo texto. */
export function renderMensagensAgrupadas(mensagens: Mensagem[], estado: Estado, sala = false): string {
  return blocosDasMensagens(mensagens, estado, sala).map((b) => b.html).join("");
}

/**
 * Um pedaço do histórico com chave estável (definido em 2026-09-30): a mensagem (o id dela), o fio e os avisos
 * recolhidos (o id da primeira), cada proposta e as decisões. main.ts troca só os pedaços cujo HTML mudou, e a
 * mensagem nova entra sem regravar as outras 199 (web/lib/regioes.ts `regiaoPorBlocos`).
 */
/**
 * `inicio` (QA do PR 4): na troca agrupada, o id da mensagem em que ela entrou (ver `blocoDaLinha`). `tempo` (chat limpo,
 * PR 6): o que os divisores de data precisam do bloco; o bloco sem ele não abre bloco de horário.
 */
export type BlocoDaTimeline = { chave: string; html: string; inicio?: string; tempo?: TempoDoBloco };

/**
 * As mensagens em blocos (revisto em 2026-10-07, #191, chat limpo): `planejarLinhas` (web/telas/linhas-do-chat.ts) diz
 * o que vira linha centralizada, o que vira balão com etiqueta e o que some para dentro de uma linha ou da tela da task;
 * o resto é desenhado como sempre. O pedido a colega de quem pede, que era um `<details class="collaboration">`, agora é
 * linha também ("Enviou mensagem para…", "N mensagens com…").
 */
function blocosDasMensagens(mensagens: Mensagem[], estado: Estado, sala: boolean): BlocoDaTimeline[] {
  const planos = planejarLinhas(mensagens, estado);
  // definido em 2026-09-29 (0039, canvas "Não lidos"): a linha "Novas" entra acima da primeira não lida de quando a
  // pessoa abriu a conversa (ou voltou para a janela com outras novas, emenda de 2026-10-05), e fica até ela sair. Se a
  // primeira não lida sumiu para dentro de uma linha, a linha "Novas" fica sozinha no lugar dela.
  const novas = mensagens[0] ? estado.novasDesde[mensagens[0].conversaId] : undefined;
  // definido em 2026-09-24 (fio da pergunta): o fio aberto ganha o trilho e o resolvido recolhe, antes de
  // recolher os avisos — o <details> do fio não é linha de sistema.
  // Chat limpo (PR 7; plano, Parte 4 · 4b): a fala que abriu frentes leva o marcador do bloco de progresso, trocado pelo
  // bloco com o estado de agora fora da lembrança do histórico (`comProgressoNaFala`). Só na conversa limpa: lá as linhas
  // "Começou N frentes" saíram do chat; na sala e no servidor de antes elas continuam.
  const ancoras = !sala && conversaLimpa(mensagens) ? ancorasDoProgresso(mensagens, (m) => planos.get(m.id)?.tipo === undefined || planos.get(m.id)?.tipo === "balao") : new Map<string, string[]>();
  const progressoDe = (id: string): string | undefined => ancoras.get(id)?.map(marcadorDoProgresso).join("");
  const linhas: LinhaDaConversa[] = mensagens.map((m) => {
    const plano = planos.get(m.id);
    const progresso = progressoDe(m.id);
    const html = !plano
      ? renderMensagem(m, estado, sala, { diagramas: true, ...(progresso ? { progresso } : {}) })
      : plano.tipo === "oculta"
        ? ""
        : plano.tipo === "linha"
          ? plano.html
          : plano.tipo === "troca"
            ? htmlTroca(plano, estado)
            : (plano.antes ?? "") + renderMensagem(m, estado, sala, { etiqueta: plano.etiqueta, diagramas: true, ...(progresso ? { progresso } : {}) });
    // Chat limpo (PR 6): o instante que a linha mostra, para os divisores de data. A troca vai da primeira à última mensagem
    // dela; a mensagem que sumiu (só sobra, talvez, a linha "Novas") não abre bloco.
    const tempo = html === "" ? { em: null } : plano?.tipo === "troca" ? { em: plano.mensagens[0]?.em ?? m.criadoEm, ate: plano.mensagens.at(-1)?.em ?? m.criadoEm, instantes: plano.mensagens.map((x) => x.em) } : { em: m.criadoEm };
    return { id: m.id, sistema: !plano && linhaDeSistema(m), html: (novas?.mensagemId === m.id ? linhaNovas(novas) : "") + html, ...tempo, ...(plano?.tipo === "linha" || plano?.tipo === "troca" ? { chave: plano.tipo === "troca" ? `troca:${plano.chave}` : plano.chave } : {}) };
  });
  const conversaId = mensagens[0]?.conversaId;
  const ordenadas = linhaDepoisDaFala(linhas, mensagens, planos);
  // Chat limpo (PR 3): trocas vizinhas na ordem da tela juntam numa linha ("Conversou com Ada e Tarsila · 6 mensagens").
  const desenhadas = juntarTrocas((conversaId ? desenharFios(ordenadas, estado, conversaId) : ordenadas).filter((l) => l.html !== ""), planos, estado);
  // Chat limpo (ADR-114): sem aviso genérico no chat, não sobra o que recolher — o que fica pede a pessoa e fica à vista.
  // A sala e o servidor de antes (sem `destino`) continuam recolhendo.
  return conversaLimpa(mensagens) ? desenhadas.map(blocoDaLinha) : recolherAvisos(desenhadas);
}

/**
 * O bloco de uma linha: a chave, o tempo dela (os divisores de data, PR 6) e, na troca agrupada (chat limpo, PR 3), o id
 * da mensagem em que ela entrou. A chave da troca é `troca:<turno ou pedido>` e não diz a posição; sem `inicio`, o pedido
 * cuja âncora caía dentro da troca ia para antes dela (QA do PR 4, 2026-10-18: o cartão do Ze aparecia acima de
 * "Conversou com Leo").
 */
function blocoDaLinha(l: LinhaDaConversa): BlocoDaTimeline {
  return { chave: l.chave ?? l.id, html: l.html, ...(l.chave?.startsWith("troca:") ? { inicio: l.id } : {}), tempo: tempoDoBloco(l.id, l) };
}

function tempoDoBloco(id: string, t: { em: number | null; ate?: number; instantes?: readonly number[] }): TempoDoBloco {
  return t.em === null ? { id, em: null } : { id, em: t.em, ate: t.ate ?? t.em, ...(t.instantes ? { instantes: t.instantes } : {}) };
}

/**
 * definido em 2026-10-08 (QA do épico #188, pranchas K1 e B1 aprovadas): a linha que o turno grava no meio dele — "Abriu
 * a task …" (trabalho_aberto) e "Enviou mensagem para …" (handoff) — entra DEPOIS da fala com que o bot a anunciou ("Abri
 * uma task para isso…"), não antes. A linha nasce na hora da ferramenta e a fala no fim do turno, então pela ordem de
 * criação ela vinha em cima. Só desce até a última fala do bot do MESMO turno que ainda está à vista; sem fala, fica.
 * revisto em 2026-10-18 (chat limpo, PR 3): a troca que começa num handoff desce do mesmo jeito ("Pedi aos dois." e, logo
 * abaixo, "Conversou com Ze 1 e Nina", como no protótipo 2C).
 */
function linhaDepoisDaFala(linhas: readonly LinhaDaConversa[], mensagens: readonly Mensagem[], planos: ReadonlyMap<string, PlanoMensagem>): LinhaDaConversa[] {
  const destino = new Map<number, number>();
  mensagens.forEach((m, i) => {
    const k = m.payload?.kind;
    const tipo = planos.get(m.id)?.tipo;
    if (!m.turnoId || (tipo !== "linha" && tipo !== "troca") || (k !== "trabalho_aberto" && k !== "frentes_abertas" && k !== "recado_a_frente" && k !== "handoff")) return;
    let alvo = -1;
    for (let j = i + 1; j < mensagens.length; j++) {
      const x = mensagens[j];
      if (x?.turnoId === m.turnoId && x.kind === "texto" && x.autoria.autor_tipo === "agente" && (linhas[j]?.html ?? "") !== "") alvo = j;
    }
    if (alvo !== -1) destino.set(i, alvo);
  });
  if (destino.size === 0) return [...linhas];
  const saida: LinhaDaConversa[] = [];
  linhas.forEach((l, j) => {
    if (!destino.has(j)) saida.push(l);
    for (const [i, alvo] of destino) if (alvo === j && linhas[i]) saida.push(linhas[i]);
  });
  return saida;
}

/** Os data-* são da pílula da base (web/lib/rolagem.ts): ela sabe qual linha a pessoa já viu e o que dizer. */
function linhaNovas(novas: { mensagemId: string; em: number; total: number }): string {
  return `<div class="linha-novas" role="separator" aria-label="Mensagens novas" data-novas="${esc(novas.mensagemId)}" data-total="${novas.total}" data-desde="${novas.em}"><span>Novas · desde ${esc(hora(novas.em))}</span></div>`;
}

/** definido em 2026-09-24: a partir de quantas linhas de sistema SEGUIDAS a conversa as recolhe. */
const AVISOS_PARA_RECOLHER = 3;

/**
 * Linha de sistema recolhível: aviso, vencimento, execução de rotina. O cartão do computador fora do ar e o
 * registro da pasta aberta (definido em 2026-09-25) têm botões e ficam à vista; a linha "Chat de voz" (2026-10-04) também,
 * e o cartão encolhido da proposta (2026-10-18, chat limpo PR 4).
 * definido em 2026-10-16 (ADR-108, QA do PR 2): o aviso de troca de IA ainda sem decisão pede uma escolha — fica à vista.
 */
function linhaDeSistema(m: Mensagem): boolean {
  if (m.kind === "sistema" && m.payload?.kind === "troca_de_ia" && !m.payload.decisao) return false;
  return (m.kind === "sistema" && m.payload?.kind !== "computador_fora_do_ar" && m.payload?.kind !== "pasta_aberta" && m.payload?.kind !== "proposta_decidida" && m.payload?.kind !== "ligacao") || m.kind === "rotina_execucao";
}

/**
 * definido em 2026-09-24: três ou mais linhas de sistema seguidas viram UM <details> "N avisos do
 * sistema · ver" — cada queda e cada vencimento escrevem a sua linha (redacao.ts), e em sequência
 * elas empurravam a conversa para longe. Nada é apagado: cada linha continua lá dentro, com o seu
 * "relatar". Cada `linha` leva o HTML já renderizado da mensagem (ou do fio que a recolheu).
 */
function recolherAvisos(linhas: readonly LinhaDaConversa[]): BlocoDaTimeline[] {
  const saida: BlocoDaTimeline[] = [];
  let i = 0;
  while (i < linhas.length) {
    let fim = i;
    while (linhas[fim]?.sistema) fim++;
    if (fim - i >= AVISOS_PARA_RECOLHER) {
      const id = linhas[i]?.id ?? "";
      saida.push({ chave: `avisos-${id}`, html: `<details class="avisos-sistema" data-disclosure="avisos-${esc(id)}"><summary>${fim - i} avisos do sistema · ver</summary>${linhas.slice(i, fim).map((l) => l.html).join("")}</details>`, tempo: tempoDoBloco(id, tempoDasLinhas(linhas.slice(i, fim))) });
      i = fim;
    } else if (fim > i) {
      saida.push(...linhas.slice(i, fim).map(blocoDaLinha));
      i = fim;
    } else {
      const l = linhas[i];
      if (l) saida.push(blocoDaLinha(l));
      i++;
    }
  }
  return saida;
}

export function renderTimeline(c: ConversaEstado | null, estado: Estado): string {
  if (!c) return `<div class="mudo">carregando conversa…</div>`;
  return `<div class="timeline">${renderHistoricoDaTimeline(c, estado)}${renderAoVivoDaTimeline(c, estado)}</div>`;
}

/**
 * A timeline em duas partes (definido em 2026-09-30): o HISTÓRICO (mensagens, cards, decisões) e o que está
 * AO VIVO (turnos rodando e a faixa de parada). O streaming só muda a segunda: main.ts a regrava sozinha a
 * cada quadro e só refaz o histórico quando o que ele lê muda (web/lib/lembrar.ts).
 */
export function renderAoVivoDaTimeline(c: ConversaEstado, estado: Estado): string {
  return blocosAoVivo(c, estado).map((b) => b.html).join("");
}

/**
 * Os turnos do bot que são de um trabalho (ADR-083): o ao vivo deles mora na tela da task, nunca no chat. O frame
 * `turno.iniciado` pode dizer (`trabalhoId`); a conversa relida diz pelo `turnosEmCurso`; a lista, pelo `turnoVivoId`.
 */
export function turnosDeTrabalho(c: ConversaEstado, estado: Estado): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const t of c.turnosEmCurso) if (t.trabalhoId) ids.add(t.id);
  for (const t of trabalhosConhecidos(estado, c.conversa.id)) if (t.turnoVivoId) ids.add(t.turnoVivoId);
  for (const t of Object.values(estado.turnosVivos)) if (t.trabalhoId) ids.add(t.turnoId);
  return ids;
}

/** Os turnos vivos da conversa e a faixa de parada, em blocos (um por turno). */
export function blocosAoVivo(c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const deTrabalho = turnosDeTrabalho(c, estado);
  // NOD-216: a mesma fonte do mascote (turnosVivosDaConversa), mais o que a conversa relida diz ser de trabalho.
  const vivos = turnosVivosDaConversa(estado, c.conversa.id).filter((t) => !deTrabalho.has(t.turnoId));
  const blocos: BlocoDaTimeline[] = [...vivos.flatMap((t) => blocosDoTurnoVivo(t, c, estado)), { chave: "faixa", html: renderFaixaParada(estado.faixaParada) }];
  return blocos.filter((b) => b.html !== "");
}

export function renderHistoricoDaTimeline(c: ConversaEstado, estado: Estado): string {
  return comProgressoNaFala(blocosDoHistorico(c, estado), c, estado).map((b) => b.html).join("");
}

export function blocosDoHistorico(c: ConversaEstado, estado: Estado): BlocoDaTimeline[] {
  const sala = c.conversa.tipo === "sala";
  const agente = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId) : undefined;
  const acolhimento = agente && !agente.confirmado && c.mensagens.some((m) => m.payload?.kind === "boas_vindas") && !c.mensagens.some((m) => m.kind === "texto" && m.autoria.autor_tipo === "pessoa") ? `<section class="welcome-options"><h2>Por onde começamos?</h2><p>Escolha uma ideia ou escreva no chat.</p>${[
    ["Tarefas do dia a dia", "Lembretes, organização e acompanhamento", "Quero ajuda com tarefas do dia a dia: lembretes e organização."],
    ["Trabalho e projetos", "Prioridades, equipe, Slack e código", "Quero ajuda com meu trabalho e projetos."],
    ["Pesquisa e ideias", "Explorar assuntos e encontrar respostas", "Quero ajuda com pesquisa e desenvolvimento de ideias."],
    ["Ainda não sei", "Vamos descobrir juntos", "Ainda não sei. Me ajude a descobrir como você pode ser útil."],
  ].map(([titulo, descricao, texto], i) => botao("escolher-missao", `<span class="option-key">${String.fromCharCode(65 + i)}</span><span><b>${titulo}</b><small>${descricao}</small></span><span>↗</span>`, { classe: "welcome-option", dados: { texto: texto ?? "" } })).join("")}</section>` : "";
  // definido em 2026-09-24: a proposta de um pedido dobrado no "×N" não vira card próprio — sem a
  // decisão aberta ela cairia no card de revisão; o card do grupo (o mais antigo) decide por todas.
  const gemeas = idsGemeas(estado);
  // As rotinas que vêm com um perfil (ADR-050) aparecem dentro do card dele, não soltas.
  const noPerfil = idsNoPerfil(c.propostas);
  const propostas = c.propostas.filter((p) => !comDecisaoVencida(p, estado) && !gemeas.has(p.id) && !noPerfil.has(p.id));
  // Chat limpo (PR 4): o pedido que já tem o recibo na conversa é o cartão encolhido; o aberto de mesmo id não sai de novo
  // (a fila "Sua vez" e as propostas são relidas um instante depois do frame da mensagem, e por esse instante os dois
  // estariam na tela).
  const decididos = new Set(c.mensagens.map(pedidoDoRecibo).filter((id): id is string => id !== null));
  const abertas = propostas.filter((p) => !decididos.has(p.id));
  const idsDasPropostas = new Set([...abertas.map((p) => p.id), ...decididos]);
  const { blocos, ancoradas } = comPedidosAncorados(comEncolhidosNaAncora(blocosDasMensagens(c.mensagens, estado, sala), c), c, estado, idsDasPropostas);
  return [
    // Chat limpo (PR 6; plano, Parte 5): o divisor do topo e um a cada pausa de 30 min ou troca de dia entre itens à vista,
    // calculados depois de esconder o que foi para a Atividade, juntar as trocas e encolher os cartões. Vale também na sala
    // e na conversa do servidor de antes: lá nada some, e o divisor só marca as pausas. "Hoje" e "Ontem" leem o relógio
    // direto, como `textoFormatado`: o histórico é lembrado com o dia de extra (main.ts, `partesDaTimeline`), e ler
    // `estado.agora` o refaria inteiro a cada tick de 15 s.
    ...comDivisores(blocos, Date.now()),
    { chave: "acolhimento", html: acolhimento },
    ...abertas.map((p) => ({ chave: `proposta:${p.id}`, html: renderProposta(p, estado, c.propostas) })),
    { chave: "decisoes", html: renderDecisoesDaConversa(estado, c.conversa.id, idsDasPropostas, ancoradas) },
    // revisto em 2026-10-06 (pedido do Marlon): sai a oferta de liberar apps recém-conectados (card-liberar.ts, PR #141).
    // Ela aparecia sozinha em bot novo e a cada reconexão do Mac, porque valia para todo bot sem acesso por 24 h depois de
    // qualquer verificação. O card de acesso nasce quando o bot pede (pedir_acesso), logo abaixo da fala dele.
  ].filter((b) => b.html !== "");
}

/**
 * A mensagem embaixo da qual o pedido fica (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"): a
 * última fala do turno que pediu (`Mensagem.turnoId`); com o turno ainda rodando, a mensagem que o disparou
 * (`turnosEmCurso`); sem turno, a última mensagem anterior ao pedido. Sem nenhuma, o pedido fica na seção do fim.
 */
function ancoraDoPedido(d: { turnoId: string | null; criadoEm: string }, c: ConversaEstado): string | undefined {
  // O recibo de outro pedido do mesmo turno (chat limpo, PR 4) não é âncora: ele já é o cartão encolhido, que fica na fala.
  const doTurno = d.turnoId ? c.mensagens.filter((m) => m.turnoId === d.turnoId && pedidoDoRecibo(m) === null).at(-1)?.id : undefined;
  if (doTurno) return doTurno;
  const origem = d.turnoId ? c.turnosEmCurso.find((t) => t.id === d.turnoId)?.mensagemId : undefined;
  if (origem && c.mensagens.some((m) => m.id === origem)) return origem;
  const criado = Date.parse(d.criadoEm);
  return c.mensagens.filter((m) => m.criadoEm <= criado).at(-1)?.id;
}

/** Prefixo da chave do cartão encolhido que saiu da posição do recibo para a âncora do pedido. */
const ENCOLHIDO = "encolhido:";

/**
 * O cartão encolhido fica na âncora do pedido (definido em 2026-10-18, chat limpo, PR 4; plano, Parte 3 · 3A): a última
 * mensagem do turno que pediu ANTES do recibo — a mesma de quando o cartão estava aberto (`ancoraDoPedido`). O turno pode
 * seguir depois da decisão ("Enviado."), e essa fala vem depois do cartão, como no protótipo. Sem turno (recibo antigo,
 * consentimento sem pedido) ou com a âncora fora da janela, o cartão encolhe na posição do próprio recibo. A mecânica é a
 * de `comPedidosAncorados`: a âncora que caiu num bloco recolhido leva o cartão para depois do bloco. O recibo que foi
 * parar dentro de um bloco agrupado (a sala, que recolhe avisos) fica onde está.
 */
function comEncolhidosNaAncora(blocos: BlocoDaTimeline[], c: ConversaEstado): BlocoDaTimeline[] {
  const alvos = new Map<string, number>();
  c.mensagens.forEach((m, i) => {
    const turno = turnoDoEncolhido(m);
    if (!turno || pedidoDoRecibo(m) === null) return;
    for (let j = i - 1; j >= 0; j--) {
      const x = c.mensagens[j];
      if (x?.turnoId === turno && pedidoDoRecibo(x) === null) {
        alvos.set(m.id, j);
        return;
      }
    }
  });
  if (alvos.size === 0) return blocos;
  const posicao = new Map(c.mensagens.map((m, i) => [m.id, i]));
  const inicioDe = blocos.map((b) => (alvos.has(b.chave) ? undefined : posicao.get(inicioDoBloco(b))));
  const depoisDe = new Map<number, BlocoDaTimeline[]>();
  const movidos = new Set<string>();
  for (const b of blocos) {
    const alvo = alvos.get(b.chave);
    if (alvo === undefined) continue;
    let indice = -1;
    inicioDe.forEach((inicio, i) => { if (inicio !== undefined && inicio <= alvo) indice = i; });
    // Sem bloco antes da âncora: o cartão fica onde o recibo está.
    if (indice < 0) continue;
    movidos.add(b.chave);
    depoisDe.set(indice, [...(depoisDe.get(indice) ?? []), { chave: `${ENCOLHIDO}${b.chave}`, html: b.html }]);
  }
  return blocos.flatMap((b, i) => [...(movidos.has(b.chave) ? [] : [b]), ...(depoisDe.get(i) ?? [])]);
}

/**
 * O id da primeira mensagem do bloco: o `inicio` da troca agrupada (PR 3) ou, pela chave, `avisos-<id>` e, desde
 * 2026-10-07 (#191), `linha:<id>`.
 */
function inicioDoBloco({ chave, inicio }: BlocoDaTimeline): string {
  if (inicio) return inicio;
  return chave.startsWith("avisos-") ? chave.slice("avisos-".length) : chave.startsWith("linha:") ? chave.slice("linha:".length) : chave;
}

/**
 * Põe cada pedido aberto logo depois do bloco que contém a sua âncora. Os blocos já vêm com fios e avisos
 * recolhidos: a chave de um bloco é o id da primeira mensagem dele (ou `avisos-<id>`), então a âncora que caiu dentro
 * de um grupo recolhido fica depois do grupo — nunca some.
 */
function comPedidosAncorados(blocos: BlocoDaTimeline[], c: ConversaEstado, estado: Estado, propostas: ReadonlySet<string>): { blocos: BlocoDaTimeline[]; ancoradas: ReadonlySet<string> } {
  const pedidos = pedidosAncoraveis(estado, c.conversa.id, propostas);
  if (pedidos.length === 0) return { blocos, ancoradas: new Set() };
  const posicao = new Map(c.mensagens.map((m, i) => [m.id, i]));
  const inicioDe = blocos.map((b) => posicao.get(inicioDoBloco(b)));
  const depoisDe = new Map<number, typeof pedidos>();
  for (const item of pedidos) {
    const ancora = ancoraDoPedido(item.decisao, c);
    const alvo = ancora === undefined ? undefined : posicao.get(ancora);
    if (alvo === undefined) continue;
    let bloco = -1;
    inicioDe.forEach((inicio, i) => { if (inicio !== undefined && inicio <= alvo) bloco = i; });
    if (bloco < 0) continue;
    // O cartão já encolhido na mesma âncora (chat limpo, PR 4) vem antes: foi pedido antes do que ainda está aberto.
    while (blocos[bloco + 1]?.chave.startsWith(ENCOLHIDO)) bloco++;
    depoisDe.set(bloco, [...(depoisDe.get(bloco) ?? []), item]);
  }
  const ancoradas = new Set([...depoisDe.values()].flat().map((i) => i.decisao.id));
  const saida = blocos.flatMap((b, i) => [b, ...(depoisDe.get(i) ?? []).map((item) => ({ chave: `decisao:${item.decisao.id}`, html: renderDecisaoAncorada(item, estado) }))]);
  return { blocos: saida, ancoradas };
}

/**
 * O cabeçalho da conversa própria é uma pílula flutuante (definido em 2026-10-16, plano "tela limpa", T1; protótipo A1/A2
 * do canvas "limite e troca"): mascote, nome e o ponto de presença, centrada sobre o chat. O clique alterna o painel do
 * bot (`alternar-detalhes`). A presença inteira ("Trabalhando · 2 esperam você", "sem novidade há N min") vai no
 * `title`/`aria-label` e num subtítulo curto embaixo da pílula, só quando não é "Disponível" — e o CSS só o mostra no
 * hover/foco da pílula (em repouso ele colidia com a pílula "Novas", revisão do PR 1).
 *
 * O HTML não depende do painel (revisão do PR 1, 2026-10-16): o rótulo é fixo ("Painel de <nome> · <presença>") e o
 * `aria-expanded` é posto pelo main depois de desenhar (`marcarPainelNaPilula`), que também o acompanha quando a
 * largura da janela troca o painel de lado ou de sobreposto.
 *
 * O que morava no topo saiu (definido em 2026-10-16, decisões E11 e T2 do plano): MODO DEV, "Hoje com" e "Linhas
 * abertas" e o Ligar foram para a gaveta (web/telas/detalhes.ts); o Parar foi para o campo, ao lado do Enviar
 * (`botoesDoCampo`).
 */
export function renderCabecalhoConversa(estado: Estado, agenteId: string): string {
  const a = agenteDe(estado, agenteId);
  const nome = a?.nome ?? "agente";
  const { html, ativa } = presencaDoBot(estado, agenteId);
  const texto = html.replace(/<[^>]+>/g, "");
  const disponivel = texto === "Disponível";
  const rotulo = `${nome} · ${texto}`;
  const sub = disponivel ? "" : `<span class="pilula-sub" aria-hidden="true">${html}</span>`;
  return `<button type="button" class="pilula-bot" data-act="alternar-detalhes" aria-controls="detalhes" aria-label="${esc(`Painel de ${rotulo}`)}" title="${esc(rotulo)}">${a ? iconeAgente(a, "sm", estadoMascoteNaConversa(estado, a.conversaId)) : ""}<span class="pilula-nome">${esc(nome)}</span><span class="presenca${ativa ? " ativa" : ""}" aria-hidden="true"></span><span class="pilula-seta" aria-hidden="true">›</span></button>${sub}`;
}

/**
 * A presença do bot na conversa, em HTML curto (os separadores e a contagem em negrito) e se o ponto fica verde.
 * NOD-216: lê a mesma fonte do mascote da barra (turnosVivosDaConversa + estadoMascoteNaConversa). Antes qualquer turno
 * vivo da conversa — na fila há horas, ou de uma task — dizia "Trabalhando".
 */
function presencaDoBot(estado: Estado, agenteId: string): { html: string; ativa: boolean } {
  const a = agenteDe(estado, agenteId);
  const vivos = a?.conversaId ? turnosVivosDaConversa(estado, a.conversaId) : [];
  const rodando = vivos.find((v) => v.estado === "rodando");
  const mascote = a ? estadoMascoteNaConversa(estado, a.conversaId) : "disponivel";
  // NOD-73: "Trabalhando · sem novidade há N min" quando o vigia avisou silêncio.
  const mudo = rodando && a?.conversaId ? minutosSemNovidade(estado.atividades[a.conversaId]?.[rodando.turnoId], estado.agora) : null;
  const emLigacao = estado.ligacaoViva?.agenteId === agenteId;
  // definido em 2026-10-03 (canvas "Uma conversa de verdade · depois"): uma regra só para o mascote e o rótulo. O
  // mascote já dava prioridade a "trabalhando" e o rótulo a "Aguardando você", e o cabeçalho se contradizia; agora o
  // turno vivo vence nos dois e o que espera a pessoa entra junto, contado por fio ("Trabalhando · 2 esperam você").
  const esperam = new Set((estado.suaVez?.itens ?? []).filter((item) => item.decisao.conversaId === a?.conversaId && item.estadoColuna !== "vencido").map(chaveDoItem)).size;
  const sep = ` <span class="presenca-sep" aria-hidden="true">·</span> `;
  const comEsperam = esperam ? `${sep}<b>${esperam} ${esperam === 1 ? "espera" : "esperam"} você</b>` : "";
  const html = emLigacao
    ? "Em ligação"
    : mascote === "trabalhando"
    ? `Trabalhando${mudo !== null ? `${sep}sem novidade há ${mudo} min` : ""}${comEsperam}`
    : mascote === "pensando"
    ? `Pensando${comEsperam}`
    : esperam ? "Aguardando você" : mascote === "na_fila" ? "Na fila" : estado.executor?.atual === "catcher" ? "Simulação" : "Disponível";
  return { html, ativa: mascoteAnimado(mascote) || emLigacao };
}

/**
 * O bot da conversa está trabalhando (definido em 2026-10-16, decisão E11 do plano "tela limpa"): há turno vivo da
 * conversa. O turno do cérebro da ligação não entra (turnosVivos já o ignora). É o `trabalhando` de `botoesDoCampo`.
 * revisto em 2026-10-22 (NOD-311): task aberta não conta — o Parar do campo não para as frentes (o turno delas já fica
 * fora de turnosVivosDaConversa); com só frentes rodando, o Parar some do campo e fica o da pílula.
 */
export function mostraPararNoCampo(estado: Estado, agenteId: string): boolean {
  const a = agenteDe(estado, agenteId);
  if (!a?.conversaId) return false;
  return turnosVivosDaConversa(estado, a.conversaId).length > 0;
}

/**
 * Quais botões o campo mostra (revisão do PR 1, 2026-10-16): o Parar fica SEMPRE alcançável enquanto o bot trabalha —
 * antes ele trocava de lugar com o Enviar e sumia assim que havia rascunho ou anexo. Agora é um botão secundário ao lado
 * do Enviar: com o bot trabalhando e o campo vazio, só o Parar; com texto, anexo ou o ditado gravando (o Enviar para e
 * manda), os dois. Sem trabalho, só o Enviar.
 */
export function botoesDoCampo(p: { trabalhando: boolean; temConteudo: boolean; ditando: boolean }): { enviar: boolean; parar: boolean } {
  return { enviar: !p.trabalhando || p.temConteudo || p.ditando, parar: p.trabalhando };
}

/** O título do Parar do campo (revisto em 2026-10-22, NOD-311): ele para só a conversa, nunca as tasks. */
export function tituloDoParar(_estado: Estado, _agenteId: string): string {
  return "Parar o que está rodando nesta conversa";
}

/** O nome que o leitor de tela ouve no Parar do campo. */
export const rotuloDoParar = (nome: string | undefined): string => (nome ? `Parar ${nome}` : "Parar");

const QUADRADO = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>';

const CLIPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>';

/**
 * Composer criado UMA vez por conversa (main.ts não o regrava): textarea + enviar. Com `anexos`
 * (ADR-046, só conversa própria) ganha o clipe, a fila de arquivos e o input escondido; a fila é
 * preenchida por web/lib/anexos.ts direto no DOM, porque o composer não se regrava.
 *
 * definido em 2026-09-24 (emenda da ADR-045): `composer-pergunta` recebe o que fica acima do campo (web/telas/pergunta.ts:
 * desde 2026-10-18, a caixa "Respondendo" com duas ou mais perguntas abertas e os outros pedidos), e `data-padrao` /
 * `data-titulo` guardam a dica e a dica do clipe de sempre.
 *
 * definido em 2026-10-11 (ADR-095): o 🎤 do ditado e a pílula da gravação entram em todo composer, escondidos; quem os
 * mostra é web/telas/ditado.ts, quando o servidor diz que o ditado está disponível.
 *
 * definido em 2026-10-16 (plano "tela limpa", T5/T6/E11): sai a dica "Enter envia · Shift+Enter…" — a nota nasce vazia
 * e só mostra a do modo resposta; na conversa própria (`aprovacao`) entram o seletor de IA (web/telas/seletor-ia.ts),
 * entre o texto e o microfone, e o Parar (secundário, redondo, escondido) logo antes do Enviar — o Enviar continua na
 * ponta, onde a pessoa o procura; o main mostra cada um pelo `botoesDoCampo`. `bot` dá o nome do Parar ("Parar Eng 1").
 */
export function htmlComposer(placeholder: string, sugestoes: readonly string[] = [], opcoes: { anexos?: Aceita; comandos?: boolean; aprovacao?: boolean; bot?: string } = {}): string {
  const lista = sugestoes.length ? `<div class="autocomplete" id="autocomplete" hidden></div>` : "";
  const aceita = opcoes.anexos;
  const accept = aceita === "sem_pdf" ? "image/*,.txt,.md,.csv,.json" : "image/*,application/pdf,.pdf,.txt,.md,.csv,.json";
  const tituloClipe = aceita === "sem_pdf" ? "Este agente roda no Codex: lê imagens e texto, não PDF" : "";
  const anexar = aceita
    ? `<div class="anexos-fila" id="composer-anexos" hidden></div><button type="button" class="clipe" data-act="anexar" aria-label="Anexar arquivo"${tituloClipe ? ` title="${esc(tituloClipe)}" data-titulo="${esc(tituloClipe)}"` : ""}>${CLIPE}</button><input type="file" id="composer-arquivos" multiple accept="${accept}" hidden data-aceita="${aceita}" />`
    : "";
  const resumo = aceita ? `<span class="anexos-resumo" id="composer-resumo"></span>` : "";
  // O "/" (definido em 2026-09-28): a lista abre acima do campo; a dica diz o que o comando escrito faz.
  const barra = opcoes.comandos ? '<div class="barra-lista" id="barra-lista" role="listbox" aria-label="Comandos" hidden></div><div class="barra-dica" id="barra-dica" hidden></div>' : "";
  // ADR-059: o botão do modo de aprovação (só na conversa própria); main.ts troca o miolo. A faixa acima do campo saiu
  // em 2026-10-18 (Fase 4, PR 2).
  const chip = opcoes.aprovacao ? HTML_CHIP_MODO : "";
  const seletor = opcoes.aprovacao ? HTML_SELETOR_IA : "";
  const parar = opcoes.aprovacao ? `<button type="button" class="parar-envio" data-act="parar-conversa" aria-label="${esc(rotuloDoParar(opcoes.bot))}" title="Parar o que está rodando nesta conversa" hidden>${QUADRADO}</button>` : "";
  return `<div class="composer"><div class="composer-pergunta" id="composer-pergunta"></div>${barra}<div class="box${aceita ? " com-anexos" : ""}${chip ? " com-modo" : ""}">${lista}${anexar}${chip}<textarea id="composer-texto" rows="1" placeholder="${esc(placeholder)}" data-sugestoes="${esc(JSON.stringify(sugestoes))}"></textarea>${resumo}${seletor}${htmlPilulaDitado()}${htmlBotaoDitado()}${parar}<button class="send" data-act="enviar" aria-label="Enviar">➤</button></div>
  <p class="nota" id="composer-nota" data-padrao=""></p></div>`;
}
