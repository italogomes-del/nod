import { renderAnexosDaMensagem, type Aceita } from "../lib/anexos.ts";
import type { FrotaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Decisao } from "../../src/contracts/decisao.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ConversaEstado, Estado, TurnoVivo } from "../estado/reducer.ts";
import { assinatura } from "../lib/assinatura.ts";
import { botao, dataHora, esc, hora, iconeAgente, paragrafos } from "../lib/render.ts";
import { linhaAtual, resumoEtapa, type AtividadeTurno } from "../lib/atividade.ts";
import { duracaoCurta, haQuanto } from "../lib/relogio.ts";
import { textoFormatado } from "../lib/texto-formatado.ts";
import { estadoMascoteNaConversa } from "../lib/mascote.ts";
import { renderFaixaParada } from "./faixa-parada.ts";
import { desenharFios, linhaDaRetomada, perguntaCitada, rodapeDaPergunta, rotuloDaResposta, type LinhaDaConversa } from "./pergunta.ts";
import { linhaNaoRodaram } from "../lib/execucao.ts";
import { acoesComAcesso, linhasPrecisa } from "./rotina-precisa.ts";
import { detalheAcesso, idsGemeas, marcaGemeas, marcaRotinaParada, renderDecisoesDaConversa, rotulosAcesso } from "./sua-vez.ts";
import { renderCardPasta, renderPastaAberta } from "./card-pasta.ts";

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

/** Badge de executor (plano): 'catcher' ou 'rodou em <máquina>' — dado tipado da autoria, nunca texto. */
export function badgeExecutor(m: Pick<Mensagem, "autoria">): string {
  if (m.autoria.autor_tipo !== "agente") return "";
  if (m.autoria.executor === "catcher") return `<span class="tag tag-catcher" title="executor catcher: sem CLI, sem custo">catcher</span>`;
  const maquina = m.autoria.machine_id ? m.autoria.machine_id.slice(0, 8) : "esta máquina";
  return `<span class="tag tag-cinza" title="harness no computador conectado">rodou em ${esc(maquina)}</span>`;
}

/**
 * Ações que aparecem no hover da mensagem (ADR-042). A classe `.msg-actions` já existia em
 * estilos.css desde a folha original, sem nenhum render — este é o primeiro botão a usá-la.
 * Fica dentro de `.bubble-wrap`, não de `.message`, e o CSS o põe na margem LATERAL do balão: o
 * `top: -16px` da regra original cobria o nome e a hora em `.msg-autor`.
 */
function acoesDaMensagem(m: Mensagem): string {
  // definido em 2026-09-21: besouro visto de cima — antenas, corpo oval e três pares de pernas em
  // DIAGONAL, centrado em (12,12). Duas tentativas anteriores falharam por motivos opostos: a
  // primeira tinha 10 subpaths e virava borrão a 15px; a segunda, simplificada demais (arco solto
  // por cabeça e pernas horizontais coladas), lia como cadeado. A diagonal é o que faz virar perna.
  const bug = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M9.5 4 11 6.5m3.5-2.5L13 6.5m-1 0a5 5 0 015 5v2a5 5 0 01-10 0v-2a5 5 0 015-5zm0 2.5v11M7 10 4.5 8.5M7 13.5H4m3 3.5L4.5 18.5M17 10l2.5-1.5M17 13.5h3m-3 3.5 2.5 1.5"/></svg>`;
  return `<div class="msg-actions">${botao("relatar-mensagem", bug, { id: m.id, titulo: "Relatar comportamento indesejado", aria: "Relatar comportamento indesejado" })}</div>`;
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
  if (p?.kind === "pasta_aberta") return renderPastaAberta(p, estado, agenteDe(estado, p.agenteId));
  if (m.kind === "sistema") return `<div class="msg-sistema">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "handoff") {
    // definido em 2026-09-24 (ADR-047): a tarefa delegada assina "Taga · por você" — autoria composta (ADR-023).
    const de = m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agenteDe(estado, p.de)?.nome ?? "agente";
    const para = agenteDe(estado, p.para)?.nome ?? "agente";
    const alvo = agenteDe(estado, p.para);
    return `<div class="msg-handoff"><div class="handoff-titulo">↗ <b>${esc(de)} → ${esc(para)}</b><span>${p.tarefaId ? (m.autoria.sob_procuracao_de ? "tarefa delegada" : "pedido de colaboração") : "passou a vez"}</span></div><p>${esc(p.motivo)}</p>${alvo ? botao("abrir-conversa", "Ver conversa de " + esc(para), { classe: "link", dados: { conversa: alvo.conversaId, agente: alvo.id } }) : ""}</div>`;
  }
  if (p?.kind === "passe") return `<div class="msg-passe">⏭ ${paragrafos(m.texto)} <span class="tag tag-cinza">${esc(p.motivo.replaceAll("_", " "))}</span></div>`;
  if (p?.kind === "consentimento") {
    // definido em 2026-09-24 (ADR-044): um consentimento cobre um LOTE; as mensagens anteriores têm uma capacidade só.
    const caps = "capacidades" in p ? p.capacidades : [p.capacidade];
    return `<div class="msg-consentimento"><b>Acesso permitido · ${esc(p.slug)}</b><div>${caps.length === 1 ? esc(caps[0] ?? "") : `${caps.length} ações`}</div><details data-disclosure="consentimento-${esc(m.id)}"><summary>Ver registro de autorização</summary>${paragrafos(m.texto)}</details></div>`;
  }
  if (p?.kind === "rotina_execucao") return `<div class="msg-rotina msg-rotina-${esc(p.desfecho)}">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "resultado_aprovacao") return `<div class="msg-resultado">${paragrafos(m.texto)}</div>`;
  if (p?.kind === "negacao") return `<div class="negacao negacao-${esc(p.classe)}">${paragrafos(m.texto)}${p.terminal ? ' <span class="tag tag-ambar">terminal</span>' : ""}</div>`;
  if (p?.kind === "parada") return `<div class="msg-parada">■ ${paragrafos(m.texto)}</div>`;
  if (p?.kind === "peer_ask") return `<div class="msg-peer"><div class="handoff-titulo">↙ <b>${p.falhou ? "Tarefa não concluída por" : p.delegada ? "Resultado de" : "Resposta de"} ${esc(p.nome)}</b></div><div>${textoFormatado(m.texto)}</div><small class="mudo">Contribuição de outro bot · confira as fontes</small></div>`;
  const naoConfiavel = m.confianca === "nao_confiavel" ? ' <span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "";
  return `<div class="msg-texto">${paragrafos(m.texto)}${naoConfiavel}${m.parcial ? ' <span class="tag tag-cinza">parcial</span>' : ""}</div>`;
}

/**
 * Uma mensagem. Texto vira BALÃO (protótipo private-agents-minimal): você à direita (preto), o bot à
 * esquerda (cinza). Os demais kinds (sistema, handoff, negação, rotina…) seguem como linhas discretas.
 * `mostrarAutor` liga o nome do bot dentro do balão — útil em salas com vários agentes.
 */
/** ADR-046: arquivos que a pessoa mandou, acima do balão. URL escopada pelo tenant da sessão. */
function anexosDe(m: Mensagem, estado: Estado): string {
  const tenant = estado.sessao?.tenantId;
  if (!m.anexos?.length || !tenant) return "";
  return renderAnexosDaMensagem(m.anexos, (id) => `/api/t/${encodeURIComponent(tenant)}/conversas/${encodeURIComponent(m.conversaId)}/anexos/${encodeURIComponent(id)}`);
}

type SituacaoFila = { tipo: "na_fila"; texto: string } | { tipo: "cancelando" } | { tipo: "cancelada" };

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
  return `<div class="fila-chip"><span class="fila-relogio" aria-hidden="true"></span>${esc(s.texto)}${botao("cancelar-turno", "Cancelar", { classe: "link perigo", id: turnoId, aria: "Cancelar esta mensagem da fila" })}</div>`;
}

export function renderMensagem(m: Mensagem, estado: Estado, _mostrarAutor = false): string {
  // Kinds não-texto (parada, sistema, negação) também se relatam — são JUSTAMENTE os que a categoria
  // 'travou_ou_parou' descreve, e o caso de uso já trata mensagem sem turno (definido em 2026-09-21).
  if (m.kind !== "texto") return `<div class="msg-linha" data-mensagem="${esc(m.id)}">${corpoMensagem(m, estado)}${acoesDaMensagem(m)}</div>`;
  const ehPessoa = m.autoria.autor_tipo === "pessoa";
  const agente = ehPessoa ? undefined : agenteDe(estado, m.autoria.autor_id);
  // Autoria composta (ADR-023) aparece inteira: o pedido delegado é "Taga · por você" (ADR-047).
  const autor = ehPessoa ? "Você" : m.autoria.sob_procuracao_de ? assinatura(m.autoria, nomesDe(estado)) : agente?.nome ?? assinatura(m.autoria, nomesDe(estado));
  const sender = `<div class="msg-autor"><b>${esc(autor)}</b><time>${hora(m.criadoEm)}</time></div>`;
  const delegacao = m.payload?.kind === "peer_pedido" ? m.payload.delegacao : undefined;
  const contextoDelegado = delegacao ? `<div class="msg-contexto-delegado"><small class="mudo">Contexto de ${esc(agente?.nome ?? "outro bot")} · não é instrução da pessoa</small><p>${esc(delegacao.tarefa)}</p>${delegacao.contexto ? `<p>${esc(delegacao.contexto)}</p>` : ""}</div>` : "";
  const tags = ehPessoa || m.payload?.kind === "peer_pedido" || m.payload?.kind === "boas_vindas"
    ? ""
    : [badgeExecutor(m), m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="conteúdo de conector ou de outro bot">não confiável</span>' : "", m.parcial ? '<span class="tag tag-cinza">parcial</span>' : ""].filter(Boolean).join("");
  const metaTags = tags ? `<div class="meta-tags">${tags}</div>` : "";
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta de pedir_a_pessoa é esta fala, desenhada como
  // pergunta; a mensagem que a respondeu leva o rótulo, e a retomada vira uma linha logo depois.
  const pergunta = !ehPessoa && m.payload?.kind === "pedido_a_pessoa" ? m.payload : null;
  const resposta = ehPessoa && m.payload?.kind === "resposta_a_pedido" ? m.payload : null;
  const fila = situacaoNaFila(m, estado);
  // "respondendo", não "resposta": `.resposta` já é o campo do card de Retomar (estilos.css).
  const classes = `message ${ehPessoa ? "you" : "bot"}${pergunta ? ` pergunta${perguntaCitada(estado, m.conversaId, pergunta.decisaoId) ? " pergunta-citada" : ""}` : ""}${resposta ? " respondendo" : ""}${fila ? ` fila-${fila.tipo}` : ""}`;
  return `<article class="${classes}" data-mensagem="${esc(m.id)}"${pergunta ? ` data-pergunta="${esc(pergunta.decisaoId)}"` : ""}>
    ${!ehPessoa && agente ? iconeAgente(agente, "md") : ""}<div class="bubble-wrap">${acoesDaMensagem(m)}${sender}${resposta ? rotuloDaResposta(m) : ""}${anexosDe(m, estado)}${ehPessoa && m.texto.trim() === "" && m.anexos?.length ? "" : `<div class="bubble">${ehPessoa ? paragrafos(m.texto) : textoFormatado(m.texto)}${metaTags}</div>`}${contextoDelegado}${pergunta ? rodapeDaPergunta(m, estado) : ""}${fila ? renderSituacaoFila(fila, fila.turnoId) : ""}</div>
  </article>${resposta ? linhaDaRetomada(m, estado) : ""}`;
}

function renderProposta(p: Proposta, estado: Estado): string {
  const a = agenteDe(estado, p.agenteId);
  if (p.payload.kind === "acesso" && p.payload.conectar) {
    const slug = p.payload.conector;
    const conectado = estado.conectores.some((c) => c.slug === slug && c.habilitado);
    const nome = estado.marketplace.find((a) => a.slug === slug)?.nome ?? p.payload.conector;
    return `<section class="connection-card"><span class="app-logo app-${esc(p.payload.conector)}">${esc(nome.slice(0, 1).toUpperCase())}</span><div><b>${conectado ? `${esc(nome)} conectado` : `Conecte o ${esc(nome)}`}</b><p>${conectado ? "Tudo pronto para continuar com seu bot." : "Para seguir com essa tarefa, preciso de acesso a este app."}</p>${conectado ? botao("retomar-conexao", "Continuar tarefa", { classe: "pri", id: p.id, dados: { slug: p.payload.conector, nivel: p.payload.nivel } }) : botao("abrir-conexao", "Conectar", { classe: "pri", id: p.payload.conector })}${botao("recusar-proposta", "Agora não", { classe: "link", id: p.id })}</div></section>`;
  }
  // definido em 2026-09-18: a pasta já vem descoberta, então autorizar é um clique — a pessoa não
  // navega em menu nem digita caminho. Sem candidatas, o mesmo card abre a escolha manual.
  if (p.payload.kind === "pasta") return renderCardPasta(p, p.payload, estado, a);
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
    <div class="ttl">${p.payload.kind === "perfil" ? "Perfil" : p.payload.kind === "rotina" ? "Rotina" : p.payload.kind === "rotina_atualizacao" ? "Mudança de rotina" : p.payload.kind === "rotina_exclusao" ? "Excluir rotina" : "Acesso a conector"}${rotinaParada}${marcaGemeas(aberto)}</div>
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
 * Cartão de atividade (definido em 2026-09-24): o turno que já chamou ferramenta deixa de ser balão.
 * Mostra o que o agente está fazendo agora numa linha, há quanto tempo e as etapas recolhidas.
 */
function renderCartaoAtividade(t: TurnoVivo, a: AtividadeTurno, estado: Estado, nome: string): string {
  const visiveis = a.etapas.slice(-ETAPAS_VISIVEIS);
  const anteriores = a.totalEtapas - visiveis.length;
  const etapas = visiveis.map((e) => `<li title="${esc(e.texto)}"><span class="atividade-ok" aria-hidden="true">✓</span><span>${esc(resumoEtapa(e.texto))}</span><small>${e.ferramentas === 1 ? "1 ferramenta" : `${e.ferramentas} ferramentas`}</small></li>`).join("");
  return `<article class="message bot atividade" data-turno="${esc(t.turnoId)}"><div class="bubble-wrap"><section class="atividade-cartao" aria-label="Atividade de ${esc(nome)}">
    <div class="atividade-cab"><span class="atividade-pulso" aria-hidden="true"></span><b>${esc(nome)} está trabalhando</b><span>· ${esc(duracaoCurta(estado.agora - t.desde))}</span></div>
    <p class="atividade-agora">${esc(linhaAtual(a))}</p>
    <details data-disclosure="atividade-${esc(t.turnoId)}"><summary><span class="atividade-seta" aria-hidden="true">›</span><span>${a.totalEtapas === 1 ? "1 etapa" : `${a.totalEtapas} etapas`} · ${a.ferramentas === 1 ? "1 ferramenta" : `${a.ferramentas} ferramentas`}</span><span class="atividade-ver">Ver etapas</span><span class="atividade-recolher">Recolher</span></summary>
      <ol>${anteriores > 0 ? `<li class="atividade-anteriores">+ ${anteriores} ${anteriores === 1 ? "etapa anterior" : "etapas anteriores"}</li>` : ""}${etapas}</ol>
    </details>
  </section></div></article>`;
}

function renderTurnoVivo(t: TurnoVivo, c: ConversaEstado, estado: Estado): string {
  const atividade = c.atividades[t.turnoId];
  if (atividade && atividade.ferramentas > 0) {
    const nome = c.conversa.agenteId ? agenteDe(estado, c.conversa.agenteId)?.nome ?? "O agente" : "O agente";
    return renderCartaoAtividade(t, atividade, estado, nome);
  }
  if (atividade?.atual) {
    return `<article class="message bot streaming" data-turno="${esc(t.turnoId)}"><div class="bubble-wrap"><div class="bubble">${paragrafos(atividade.atual)}<span class="cursor">▍</span></div></div></article>`;
  }
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
  const pedacos = mensagens.map((m) => {
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
      return `<details data-disclosure="${esc(k + id)}"><summary>${a ? iconeAgente(a, "sm") : ""}<b>${esc(a?.nome ?? "Outro bot")}</b><small>${trocas.length} mensagens</small></summary><div class="collaboration-messages">${trocas.map((x) => `<div><small>${x.payload?.kind === "handoff" ? (x.autoria.sob_procuracao_de ? `Tarefa · ${esc(assinatura(x.autoria, nomesDe(estado)))}` : "Pedido") : x.payload?.kind === "peer_ask" && x.payload.falhou ? "Não concluída" : x.payload?.kind === "peer_ask" && x.payload.delegada ? "Resultado" : "Resposta"} · ${hora(x.criadoEm)}</small>${textoFormatado(x.payload?.kind === "handoff" ? x.payload.motivo : x.texto)}</div>`).join("")}${a ? botao("abrir-conversa", `Conversar com ${esc(a.nome)}`, { classe: "link", dados: { conversa: a.conversaId, agente: a.id } }) : ""}</div></details>`;
    }).join("")}</div></details>`;
  });
  // definido em 2026-09-24 (fio da pergunta): o fio aberto ganha o trilho e o resolvido recolhe, antes de
  // recolher os avisos — o <details> do fio não é linha de sistema.
  const linhas: LinhaDaConversa[] = mensagens.map((m, i) => ({ id: m.id, sistema: linhaDeSistema(m), html: pedacos[i] ?? "" }));
  const conversaId = mensagens[0]?.conversaId;
  return recolherAvisos(conversaId ? desenharFios(linhas, estado, conversaId) : linhas);
}

/** definido em 2026-09-24: a partir de quantas linhas de sistema SEGUIDAS a conversa as recolhe. */
const AVISOS_PARA_RECOLHER = 3;

/**
 * Linha de sistema recolhível: aviso, vencimento, execução de rotina. O cartão do computador fora do ar e o
 * registro da pasta aberta (definido em 2026-09-25) têm botões e ficam à vista.
 */
function linhaDeSistema(m: Mensagem): boolean {
  return (m.kind === "sistema" && m.payload?.kind !== "computador_fora_do_ar" && m.payload?.kind !== "pasta_aberta") || m.kind === "rotina_execucao";
}

/**
 * definido em 2026-09-24: três ou mais linhas de sistema seguidas viram UM <details> "N avisos do
 * sistema · ver" — cada queda e cada vencimento escrevem a sua linha (redacao.ts), e em sequência
 * elas empurravam a conversa para longe. Nada é apagado: cada linha continua lá dentro, com o seu
 * "relatar". Cada `linha` leva o HTML já renderizado da mensagem (ou do fio que a recolheu).
 */
function recolherAvisos(linhas: readonly LinhaDaConversa[]): string {
  const saida: string[] = [];
  let i = 0;
  while (i < linhas.length) {
    let fim = i;
    while (linhas[fim]?.sistema) fim++;
    if (fim - i >= AVISOS_PARA_RECOLHER) {
      saida.push(`<details class="avisos-sistema" data-disclosure="avisos-${esc(linhas[i]?.id ?? "")}"><summary>${fim - i} avisos do sistema · ver</summary>${linhas.slice(i, fim).map((l) => l.html).join("")}</details>`);
      i = fim;
    } else if (fim > i) {
      saida.push(...linhas.slice(i, fim).map((l) => l.html));
      i = fim;
    } else {
      saida.push(linhas[i]?.html ?? "");
      i++;
    }
  }
  return saida.join("");
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
  // definido em 2026-09-24: a proposta de um pedido dobrado no "×N" não vira card próprio — sem a
  // decisão aberta ela cairia no card de revisão; o card do grupo (o mais antigo) decide por todas.
  const gemeas = idsGemeas(estado);
  const propostas = c.propostas.filter((p) => !comDecisaoVencida(p, estado) && !gemeas.has(p.id));
  const sep = primeira ? `<div class="time-sep">${esc(dataHora(primeira.criadoEm))}</div>` : "";
  return `<div class="timeline">
    ${sep}
    ${renderMensagensAgrupadas(c.mensagens, estado, sala)}
    ${acolhimento}
    ${propostas.map((p) => renderProposta(p, estado)).join("")}
    ${renderDecisoesDaConversa(estado, c.conversa.id, new Set(propostas.map((p) => p.id)))}
    ${vivos.map((t) => renderTurnoVivo(t, c, estado)).join("")}
    ${renderFaixaParada(estado.faixaParada)}
  </div>`;
}

const PAINEL = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M12.5 3.5v13"/></svg>';

/**
 * Cabeçalho da conversa própria: só quem é o bot e o botão do painel. definido em 2026-09-24 (revisão da
 * interface): a barra de ações (Computador, Pasta, Inteligência, Perfil, Memória, •••) competia com o
 * chat; o que é do bot mora no painel (web/telas/detalhes.ts) e o ••• no clique direito da sidebar.
 * Parar só aparece enquanto há turno vivo, que é quando ele serve.
 */
export function renderCabecalhoConversa(estado: Estado, agenteId: string): string {
  const a = agenteDe(estado, agenteId);
  const nome = a?.nome ?? "agente";
  const vivo = Object.values(estado.turnosVivos).find((v) => v.conversaId === a?.conversaId);
  const pendente = estado.suaVez?.itens.some((item) => item.decisao.conversaId === a?.conversaId && item.estadoColuna !== "vencido");
  return `<div class="cab-esq">${a ? iconeAgente(a, "lg", estadoMascoteNaConversa(estado, a.conversaId)) : ""}<div class="cab-identidade"><div><span class="nome">${esc(nome)}</span><span class="presenca ${vivo ? "ativa" : ""}">${pendente ? "Aguardando você" : vivo ? "Trabalhando" : estado.executor?.atual === "catcher" ? "Simulação" : "Disponível"}</span></div><p>${esc(a?.titulo || "Seu bot")}</p></div></div>
    <div class="cab-acoes">
      ${vivo ? botao("parar-conversa", "Parar", { classe: "perigo", titulo: "interrompe agora o que está rodando nesta conversa" }) : ""}
      <button type="button" class="bt toggle-detalhes" data-act="alternar-detalhes" aria-label="Mostrar ou esconder o painel do bot" title="Painel do bot">${PAINEL}</button>
    </div>`;
}

const CLIPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>';

/**
 * Composer criado UMA vez por conversa (main.ts não o regrava): textarea + enviar. Com `anexos`
 * (ADR-046, só conversa própria) ganha o clipe, a fila de arquivos e o input escondido; a fila é
 * preenchida por web/lib/anexos.ts direto no DOM, porque o composer não se regrava.
 *
 * definido em 2026-09-24 (emenda da ADR-045): `composer-pergunta` recebe a faixa, os modos e a citação
 * quando há pergunta aberta (web/telas/pergunta.ts), e `data-padrao` / `data-titulo` guardam a dica e
 * a dica do clipe de sempre, para o main voltar a elas quando o campo sai do modo resposta.
 */
export function htmlComposer(placeholder: string, sugestoes: readonly string[] = [], opcoes: { anexos?: Aceita } = {}): string {
  const lista = sugestoes.length ? `<div class="autocomplete" id="autocomplete" hidden></div>` : "";
  const aceita = opcoes.anexos;
  const accept = aceita === "sem_pdf" ? "image/*,.txt,.md,.csv,.json" : "image/*,application/pdf,.pdf,.txt,.md,.csv,.json";
  const tituloClipe = aceita === "sem_pdf" ? "Este agente roda no Codex: lê imagens e texto, não PDF" : "";
  const anexar = aceita
    ? `<div class="anexos-fila" id="composer-anexos" hidden></div><button type="button" class="clipe" data-act="anexar" aria-label="Anexar arquivo"${tituloClipe ? ` title="${esc(tituloClipe)}" data-titulo="${esc(tituloClipe)}"` : ""}>${CLIPE}</button><input type="file" id="composer-arquivos" multiple accept="${accept}" hidden data-aceita="${aceita}" />`
    : "";
  const resumo = aceita ? `<span class="anexos-resumo" id="composer-resumo"></span>` : "";
  const dica = aceita ? " · arraste ou cole imagens e PDFs" : sugestoes.length ? " · @ menciona um bot" : "";
  const nota = `Enter envia · Shift+Enter quebra linha${dica}`;
  return `<div class="composer"><div class="composer-pergunta" id="composer-pergunta"></div><div class="box${aceita ? " com-anexos" : ""}">${lista}${anexar}<textarea id="composer-texto" rows="1" placeholder="${esc(placeholder)}" data-sugestoes="${esc(JSON.stringify(sugestoes))}"></textarea>${resumo}<button class="send" data-act="enviar" aria-label="Enviar">➤</button></div>
  <p class="nota" id="composer-nota" data-padrao="${esc(nota)}">${esc(nota)}</p></div>`;
}
