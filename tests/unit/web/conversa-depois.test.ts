import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto } from "../../../web/lib/atividade.ts";
import { blocosAoVivo, blocosDoHistorico, renderCabecalhoConversa, renderMensagem, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderCardArtefato } from "../../../web/telas/card-artefato.ts";
import { renderTopoComposer } from "../../../web/telas/pergunta.ts";
import { acaoHumana, previaDoItem } from "../../../web/telas/sua-vez.ts";

/** O canvas "Uma conversa de verdade · depois" (2026-10-03), item a item. */

const C = "c1";
const AGORA = Date.parse("2026-10-03T14:45:00Z");
const msg = (id: string, autor: "pessoa" | "agente", criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autor === "pessoa" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" },
  kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, ...extra,
} as Mensagem);

const itemAprovacao = (id: string, argumentos: Record<string, unknown> = {}): SuaVezDto["itens"][number]["itensAprovacao"][number] => ({
  tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: "Atualizar metas", textoFinal: "Atualizar metas", destino: { conector: "googlesheets", ferramenta: "update_values", argumentos },
  selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null,
});

const pedido = (id: string, extra: { turnoId?: string | null; criadoEm?: string; tipo?: "aprovacao" | "pergunta"; itens?: ReturnType<typeof itemAprovacao>[] } = {}): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: C, turnoId: extra.turnoId ?? null, tipo: extra.tipo ?? "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-04T14:00:00Z", prazoExecucaoEm: null, frase: "Atualizar a planilha de metas com a receita de setembro", desfecho: null, vistaEm: null, criadoEm: extra.criadoEm ?? "2026-10-03T14:40:00Z", fioId: null },
  estadoColuna: "pendente", agenteNome: "Ada", aguardandoHaMs: 5 * 60_000, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], itensAprovacao: extra.itens ?? [itemAprovacao(`${id}-i`)], proposta: null, fio: null, rotinaParada: null,
});

const SHEETS = { slug: "googlesheets", nome: "Google Sheets", habilitado: true, ownerId: "p", catalogo: [{ nome: "update_values", descricao: "", schema: {}, readOnlyHint: false, grupo: "alterar" as const }] };

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = [], extra: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...extra,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    conectores: [SHEETS] as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

describe("1. o balão de quem escreve", () => {
  it("continua .message.you (o azul mora no CSS) e o chip de comando fica dentro do balão", () => {
    const html = renderMensagem(msg("m1", "pessoa", 1, { texto: "/uso agora" }), cenario([]).e);
    expect(html).toContain('class="message you');
    expect(html).toContain('class="chip-comando"');
  });
});

describe("2. a parte ao vivo é a Ada falando", () => {
  it("chat limpo (PR 7): o cartão ao vivo vira uma linha, 'Ada está trabalhando · ver etapas'; o cabeçalho 'ao vivo' sai", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Lendo o PR https://github.com/acme/loja/pull/481."), "Consultou GitHub");
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: "catcher", machineId: null, desde: AGORA - 60_000 } }, atividades: { [C]: { t1: { ...atividade, atual: "Abrindo https://github.com/acme/loja/pull/481 agora" } } } };
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["vivo:t1"]);
    const html = blocos[0]!.html;
    expect(html).not.toContain("ao vivo");
    expect(html).not.toContain("vivo-cab");
    expect(html).not.toContain("atividade-cartao");
    // A linha: o ponto que pulsa, "Ada está trabalhando" e "ver etapas", que abre o que o cartão mostrava.
    expect(html).toMatch(/<details class="atividade-linha" data-disclosure="atividade-t1"><summary><span class="atividade-pulso" aria-hidden="true"><\/span><span class="atividade-quem">Ada está trabalhando<\/span><span class="atividade-ver">ver etapas<\/span>/);
    // Recolhido, dentro do <details>: a linha "agora" (com o link como chip) e as etapas.
    const recolhido = html.slice(html.indexOf("</summary>"), html.indexOf("</details>"));
    expect(recolhido).toMatch(/<p class="atividade-agora">Abrindo <a [^>]*href="https:\/\/github\.com\/acme\/loja\/pull\/481"/);
    expect(recolhido).toContain("1 etapa · 1 ferramenta");
    // Sem relógio na linha: o corpo não muda quando o tempo anda.
    expect(blocosAoVivo(c, { ...e, agora: AGORA + 120_000 })[0]!.html).toBe(html);
  });

  it("chat limpo (PR 7): o balão em streaming fica, sem o cabeçalho com mascote, nome e 'ao vivo'", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Olhando") } } };
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["vivo:t1"]);
    expect(blocos[0]!.html).toContain('class="message bot streaming ao-vivo"');
    expect(blocos[0]!.html).not.toContain("ao vivo<");
    expect(blocos[0]!.html).not.toContain("<nod-mascote");
  });

  it("10. o streaming já sai formatado: negrito, lista e tabela enquanto o texto chega", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Fechei **setembro**:\n- Sul\n- Norte\n\n| Região | R$ |\n|---|---|\n| Sul | 98 |") } } };
    const corpo = blocosAoVivo(c, e).find((b) => b.chave === "vivo:t1")!.html;
    expect(corpo).toContain("<strong>setembro</strong>");
    expect(corpo).toContain('<ul class="md-lista"><li>Sul</li><li>Norte</li></ul>');
    expect(corpo).toContain('<div class="md-tabela">');
    expect(corpo).toContain('class="cursor"');
  });
});

describe("3. o pedido fica junto do turno que o pediu", () => {
  it("logo depois da última fala do turno; as mensagens seguintes vêm depois dele, e a seção do fim some", () => {
    const mensagens = [msg("m1", "pessoa", 1), msg("m2", "agente", 2, { turnoId: "t1" }), msg("m3", "pessoa", 3), msg("m4", "agente", 4, { turnoId: "t2" })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "t1" })]);
    const chaves = blocosDoHistorico(c, e).map((b) => b.chave);
    expect(chaves).toEqual(["sep:m1", "m1", "m2", "decisao:d1", "m3", "m4"]);
    expect(renderTimeline(c, e)).not.toContain("Preciso da sua decisão para continuar");
  });

  it("sem turno, fica depois da última mensagem anterior ao pedido; sem mensagem nenhuma, na seção do fim", () => {
    const mensagens = [msg("m1", "pessoa", Date.parse("2026-10-03T14:30:00Z")), msg("m2", "agente", Date.parse("2026-10-03T14:50:00Z"))];
    const { e, c } = cenario(mensagens, [pedido("d1")]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
    const vazio = cenario([], [pedido("d1")]);
    expect(renderTimeline(vazio.c, vazio.e)).toContain("Preciso da sua decisão para continuar");
  });

  // definido em 2026-10-07 (#191, chat limpo): o pedido de uma execução de rotina que virou linha fica logo depois da
  // linha (a chave do bloco é `linha:<primeira mensagem>`), e não volta para depois da fala anterior.
  it("o pedido de uma rotina recolhida numa linha fica depois da linha", () => {
    const rotina = (id: string, criadoEm: number) => msg(id, "agente", criadoEm, { turnoId: "tr1", origemTurno: "rotina", trabalhoId: "tb-r1", fimDoTurno: true });
    const mensagens = [msg("m1", "pessoa", 1, { origemTurno: null, trabalhoId: null, fimDoTurno: false }), rotina("r1", 2), msg("m3", "pessoa", 3, { origemTurno: null, trabalhoId: null, fimDoTurno: false })];
    const { e, c } = cenario(mensagens, [pedido("d1", { turnoId: "tr1" })]);
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "linha:r1", "decisao:d1", "m3"]);
  });

  it("com o turno ainda rodando, fica embaixo da mensagem que o disparou", () => {
    const { e, c } = cenario([msg("m1", "pessoa", 1), msg("m2", "pessoa", 2)], [pedido("d1", { turnoId: "t9" })], { turnosEmCurso: [{ id: "t9", estado: "despachando", desde: 1, mensagemId: "m1" }] as never });
    expect(blocosDoHistorico(c, e).map((b) => b.chave)).toEqual(["sep:m1", "m1", "decisao:d1", "m2"]);
  });
});

describe("4–6. o card da aprovação de um item", () => {
  it("quem pede, ONDE como chip, a prévia em tabela, Pode fazer e o prazo no rodapé; sem a tag de lista", () => {
    const valores = [["Sudeste", "R$ 210 mil"], ["Sul", "R$ 98 mil"], ["Total", "R$ 482 mil"]];
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [itemAprovacao("i1", { spreadsheetId: "abc", range: "Setembro!A1", values: valores })] })]);
    const html = renderTimeline(c, e);
    expect(html).toContain("<b>Ada precisa do seu ok</b>");
    expect(html).toContain("· há 5 min");
    expect(html).toContain('<span class="lk-chip aprov-app">');
    expect(html).toContain("<span>Google Sheets</span>");
    expect(html).toContain("O que vai ser enviado");
    expect(html).toContain("<td>R$ 482 mil</td>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).toContain('data-act="decidir-aprovacao"');
    expect(html).not.toContain("aprovação em lista");
    // 6: o botão diz a ação em português; o slug continua no "Ver detalhes".
    expect(html).toContain(">Sempre permitir editar no Google Sheets<");
    expect(html).toContain("<dd>googlesheets.update_values</dd>");
    // main.ts lê o texto final e o data-decisao.
    expect(html).toContain('data-item-texto="i1"');
    expect(html).toContain('data-decisao="d1"');
  });

  it("5. vencido com um item só diz 'aprovação', nunca 'aprovação em lista'", () => {
    const vencido = { ...pedido("d1"), estadoColuna: "vencido" as const, decisao: { ...pedido("d1").decisao, estado: "vencida" as const } };
    const { e, c } = cenario([], [vencido]);
    const html = renderTimeline(c, e);
    expect(html).toContain(">aprovação<");
    expect(html).not.toContain("aprovação em lista");
  });

  it("a prévia: campos de texto viram linhas rotuladas; objetos ficam só no 'Ver detalhes'", () => {
    const html = previaDoItem({ destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas", text: "Fechamos <setembro>", blocks: [{ a: 1 }] } } });
    expect(html).toContain("<dt>channel</dt><dd>#vendas</dd>");
    expect(html).toContain("Fechamos &lt;setembro&gt;");
    expect(html).not.toContain("blocks");
    expect(previaDoItem({ destino: { conector: "x", ferramenta: "y", argumentos: {} } })).toBe("");
  });

  it("a ação em português vem do grupo do catálogo; sem catálogo, o nome da ferramenta sem sublinhados", () => {
    expect(acaoHumana([SHEETS] as never, "googlesheets", "update_values")).toBe("editar no Google Sheets");
    expect(acaoHumana([], "slack", "send_message")).toBe("send message no slack");
  });
});

describe("revisão de 2026-10-03: o card da lista, o artefato e os recibos", () => {
  it("aprovação com vários itens usa o mesmo card: quem pede, o app uma vez só, linhas marcáveis e o prazo", () => {
    const slack = (id: string, texto: string) => ({ ...itemAprovacao(id), textoFinal: texto, destino: { conector: "slack", ferramenta: "send_message", argumentos: {} } });
    const { e, c } = cenario([msg("m1", "agente", 1, { turnoId: "t1" })], [pedido("d1", { turnoId: "t1", itens: [slack("i1", "Avisar o comercial"), slack("i2", "Parabenizar o Sudeste")] })]);
    const html = renderTimeline(c, e);
    expect(html).toContain("aprov-card");
    expect(html).toContain("<b>Ada precisa do seu ok</b>");
    expect(html).toContain('class="aprov-itens"');
    expect(html.match(/data-item="i[12]"/g)).toHaveLength(2);
    expect(html).not.toContain("no slack</small>");
    expect(html).toContain("Sem resposta, recusa automática em 23h");
    expect(html).not.toContain("aprovação em lista");
  });

  it("o artefato vem com o mascote, o nome e a hora do bot", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("m1", "agente", 1, { kind: "artefato", payload: { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" } as never }), e);
    expect(html).toContain('class="message bot com-artefato"');
    expect(html).toContain("<b>Ada</b>");
    expect(html).toContain('data-artefato="art"');
  });

  it("resultado da aprovação vira o cartão encolhido (chat limpo, PR 4): o pedido e o resultado; o detalhe por item fica recolhido", () => {
    const { e } = cenario([]);
    const resultado = (itens: { idx: number; desfecho: string; texto?: string }[], frase = "Atualizar a planilha de metas") => renderMensagem(msg("r", "pessoa", Date.parse("2026-10-03T14:44:00Z"), { kind: "resultado_aprovacao", texto: "Marlon aprovou 0 de 1; não enviado: … (falhou na execução).", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase, itens } as never }), e);
    const falhou = resultado([{ idx: 0, desfecho: "falhou_na_execucao", texto: "Atualizar metas" }]);
    expect(falhou).toContain('class="cartao-pergunta respondida cartao-encolhido"');
    expect(falhou).toContain(">Atualizar a planilha de metas</div>");
    expect(falhou).toContain('<span class="pq-rotulo">Aprovado · não saiu</span><svg class="ce-marca ce-falha"');
    expect(falhou).toContain("<summary>detalhes</summary>");
    expect(falhou).toContain("falhou ao executar");
    const feito = resultado([{ idx: 0, desfecho: "executado", texto: "Atualizar metas" }]);
    expect(feito).toMatch(/<span class="pq-rotulo">Aprovado por você · feito \d\d:\d\d<\/span><svg class="ce-marca ce-ok"/);
    expect(feito).not.toContain("<details");
    const varios = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(varios).toContain(">Aprovado por você · 2 de 3 feitas<");
    expect(varios).toContain("você tirou");
    const parcial = resultado([{ idx: 0, desfecho: "executado", texto: "a" }, { idx: 1, desfecho: "falhou_na_execucao", texto: "b" }, { idx: 2, desfecho: "executado", texto: "c" }]);
    expect(parcial).toContain(">Aprovado · 1 de 3 não saiu<");
    const recusado = resultado([{ idx: 0, desfecho: "retirado_pela_pessoa", texto: "a" }, { idx: 1, desfecho: "retirado_pela_pessoa", texto: "b" }], "Posso mandar estes 2 avisos?");
    expect(recusado).toContain(">Posso mandar estes 2 avisos?</div>");
    expect(recusado).toContain('<p class="pq-estado ce-resultado">Recusado por você</p>');
    expect(recusado).not.toContain("pq-escolhida");
    expect(recusado).not.toContain("<details");
  });

  it("'permitiu para sempre' antigo (sem payload) continua a linha 'Regra nova · sempre permitir editar no Google Sheets'", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já, para qualquer destino destas ferramentas, enquanto o bot não tiver lido conteúdo de fora na tarefa." }), e);
    expect(html).toContain("<b>Regra nova</b> · sempre permitir editar no Google Sheets");
    expect(html).toContain('class="recibo recibo-regra"');
    expect(html).not.toContain("cartao-encolhido");
  });

  it("a regra nova com payload (regra_permanente) encolhe: 'Sempre permitir editar no Google Sheets' · Regra nova, com o registro", () => {
    const { e } = cenario([]);
    const html = renderMensagem(msg("r", "pessoa", 1, { kind: "consentimento", texto: "Marlon permitiu para sempre: googlesheets.update_values. Vale já…", payload: { kind: "regra_permanente", decisaoId: "d1", turnoId: "t1", acoes: ["googlesheets.update_values"] } }), e);
    expect(html).toContain('data-cartao-encolhido="d1"');
    expect(html).toContain(">Sempre permitir editar no Google Sheets</div>");
    expect(html).toContain('<span class="pq-rotulo">Regra nova</span><svg class="ce-marca ce-regra"');
    expect(html).toContain("<summary>Ver registro de autorização</summary>");
    expect(html).toContain('data-anuncio="Regra nova: sempre permitir editar no Google Sheets"');
  });
});

describe("7. a linha da memória", () => {
  it("'Anotei uma preferência' com 'Ver na memória'; a linha antiga, sem acento, é lida na frase nova", () => {
    const { e } = cenario([]);
    const nova = renderMensagem(msg("m1", "agente", 1, { kind: "sistema", texto: "Anotei uma preferência: relatórios em reais" }), e);
    expect(nova).toContain("Anotei uma preferência: relatórios em reais");
    expect(nova).toContain('data-act="ir-memoria" data-id="a"');
    const antiga = renderMensagem(msg("m2", "agente", 1, { kind: "sistema", texto: "Anotei como preferencia: sem centavos" }), e);
    expect(antiga).toContain("Anotei uma preferência: sem centavos");
    expect(antiga).not.toContain("como preferencia");
  });
});

describe("8. o cabeçalho com uma regra só", () => {
  it("turno vivo e pedidos juntos: 'Trabalhando · 2 esperam você'; sem turno, 'Aguardando você'", () => {
    const { e } = cenario([], [pedido("d1"), pedido("d2")]);
    const vivo: Estado = { ...e, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
    expect(renderCabecalhoConversa(vivo, "a")).toContain("Trabalhando <span class=\"presenca-sep\" aria-hidden=\"true\">·</span> <b>2 esperam você</b>");
    expect(renderCabecalhoConversa(e, "a")).toContain(">Aguardando você<");
  });
});

describe("9. 'N coisas esperam você' acima do campo", () => {
  it("só os outros pedidos, cada um com a sua ação; a pergunta mora no cartão (plano \"pergunta com botões\", 2026-10-18)", () => {
    const pergunta = { ...pedido("q1", { tipo: "pergunta", criadoEm: "2026-10-03T14:30:00Z", itens: [] }), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const, frase: "Posso mandar o painel?", criadoEm: "2026-10-03T14:30:00Z" } };
    const { e } = cenario([], [pergunta, pedido("d1")]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toContain('<span class="espera-n">1</span>coisa espera você');
    expect(html).not.toContain("Posso mandar o painel?");
    expect(html).toContain('data-act="ver-decisao" data-id="d1"');
    expect(html).toContain("Google Sheets · recusa automática em 23h");
    // O seletor "Responder à pergunta | Outro assunto" e a faixa saíram.
    expect(html).not.toContain("Responder à pergunta");
    expect(html).not.toContain("está esperando sua resposta");
  });

  it("gate_rotina tem o mesmo nome da lista de rotinas: 'Ver aprovação' (re-revisão do #342, ajuste B)", () => {
    const pergunta = { ...pedido("q1"), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const } };
    const gate = { ...pedido("g1"), decisao: { ...pedido("g1").decisao, tipo: "gate_rotina" as const } };
    const { e } = cenario([], [pergunta, gate]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toMatch(/data-act="ver-decisao" data-id="g1"[^>]*>Ver aprovação</);
    expect(html).not.toContain(">Ver pedido<");
  });

  it("só pergunta, sem outro pedido: nada acima do campo", () => {
    const pergunta = { ...pedido("q1"), decisao: { ...pedido("q1").decisao, tipo: "pergunta" as const } };
    const { e } = cenario([], [pergunta]);
    const html = renderTopoComposer({ tipo: "resposta", alvo: pergunta as never, indice: 0, perguntas: [pergunta as never] }, e, C);
    expect(html).toBe("");
  });
});

describe("12. artefato: abrir em nova aba", () => {
  it("o botão vem antes de 'Tela cheia' e 'Baixar .html'", () => {
    const m = msg("m1", "agente", 1, { kind: "artefato" });
    const html = renderCardArtefato(m, { kind: "artefato", artefatoId: "art", versao: 1, titulo: "Painel" }, 1);
    const ordem = ["artefato-nova-aba", "artefato-tela-cheia", "artefato-baixar"].map((a) => html.indexOf(`data-act="${a}"`));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain("Abrir em nova aba");
  });
});
