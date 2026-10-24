import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto, comVigia } from "../../../web/lib/atividade.ts";
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

/** As falas paradas de um turno na conversa (a chave é por fala, revisão 4 do #508). */
const paradas = (e: Estado, turnoId: string) => Object.values(e.falasSaindo?.[C] ?? {}).filter((s) => s.turno.turnoId === turnoId);

describe("1. o balão de quem escreve", () => {
  it("continua .message.you (o azul mora no CSS) e o chip de comando fica dentro do balão", () => {
    const html = renderMensagem(msg("m1", "pessoa", 1, { texto: "/uso agora" }), cenario([]).e);
    expect(html).toContain('class="message you');
    expect(html).toContain('class="chip-comando"');
  });
});

describe("2. a parte ao vivo é a Ada falando", () => {
  it("NOD-348: com ferramenta, a fala viva da Ada — mascote, nome, 'Usando GitHub · ‹tempo›' e o 'ver etapas' discreto", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Lendo o PR https://github.com/acme/loja/pull/481."), "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: "catcher", machineId: null, desde: AGORA - 60_000 } }, atividades: { [C]: { t1: atividade } } };
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["vivo:t1"]);
    const html = blocos[0]!.html;
    expect(html).toMatch(/^<article class="message bot fala-viva ao-vivo com-texto" data-turno="t1" data-morfar><nod-mascote [^>]*data-parte="mascote"/);
    expect(html).toContain('state="orbit"');
    expect(html).toContain('<div class="msg-autor" data-parte="nome"><b>Ada</b></div>');
    expect(html).toContain('<span class="fala-viva-estado">Usando GitHub</span>');
    expect(html).toContain(`data-desde="${AGORA - 60_000}"`);
    // Sem o nome da IA, sem "digitando", sem cursor, sem a linha antiga e sem o ponto que pulsa.
    for (const fora of ["catcher", "Claude", "digitando", 'class="cursor"', "está trabalhando", "atividade-pulso", "trabalhando ·"]) expect(html).not.toContain(fora);
    // QA 2 do #508: a narração de antes da ferramenta fica no balão (a fala gravada a tem); o estado diz a ferramenta.
    expect(html).toContain('<div class="bubble" data-parte="balao">');
    expect(blocos[0]!.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "balao", "etapas", "viva"]);
    const recolhido = html.slice(html.indexOf("</summary>"), html.indexOf("</details>"));
    expect(recolhido).toContain("Lendo o PR");
    expect(html).toContain('<details class="fala-viva-etapas" data-parte="etapas" data-disclosure="atividade-t1"><summary><span class="fala-viva-ver">ver etapas</span>');
    expect(recolhido).toContain("1 etapa · 1 ferramenta");
    // O tempo é escrito pelo relógio da tela: o HTML não muda quando o tempo anda.
    expect(blocosAoVivo(c, { ...e, agora: AGORA + 120_000 })[0]!.html).toBe(html);
    // O morph sabe as partes e o que copiar para o mascote.
    expect(blocos[0]!.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "balao", "etapas", "viva"]);
    expect(blocos[0]!.morfar?.mascote).toMatchObject({ state: "orbit", "aria-label": "Ada · usando GitHub" });
    // Revisão 2 do #508: a narração entre ferramentas (e a resposta final de um turno com ferramenta) fica num balão, à
    // vista, com "Escrevendo" no rodapé e o "ver etapas" entre os dois — não escondida no recolhido.
    const narrando = blocosAoVivo(c, { ...e, atividades: { [C]: { t1: { ...atividade, atual: "Abrindo https://github.com/acme/loja/pull/481 agora" } } } })[0]!;
    expect(narrando.html).toContain('<span class="fala-viva-estado">Escrevendo</span>');
    expect(narrando.html).toContain('state="idle"');
    expect(narrando.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "balao", "etapas", "viva"]);
    expect(narrando.html).toMatch(/<div class="bubble" data-parte="balao">.*Abrindo <a [^>]*href="https:\/\/github\.com\/acme\/loja\/pull\/481"/s);
    expect(narrando.html).toContain('class="fala-viva-linha rodape"');
  });

  it("revisão do #508: o nome do bot com $&, $` e $' não abre atributo no mascote (replace com função)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    for (const nome of ['Ada$&" onmouseover="x', "Ada$`", "Ada$'"]) {
      const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome, cor: "blue", forma: "square", conversaId: C }] } as never, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
      const mascote = /<nod-mascote [^>]*>/.exec(blocosAoVivo(c, e)[0]!.html)![0];
      expect(mascote).not.toMatch(/ onmouseover="/);
      expect(mascote.match(/ aria-label="/g)).toHaveLength(1);
      expect(mascote.match(/ title="/g)).toHaveLength(1);
      // Cada atributo do mascote aparece uma vez só: nada foi aberto pelo nome.
      const nomes = [...mascote.matchAll(/ ([\w-]+)=("[^"]*")/g)].map((m) => m[1]);
      expect(new Set(nomes).size).toBe(nomes.length);
    }
  });

  it("revisão do #508: cada data-parte do HTML é uma parte do morph, na mesma ordem (senão o morph cai na recriação)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { t1: { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA - 5 * 60_000 } };
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    for (const a of [undefined, comTexto(ATIVIDADE_VAZIA, "Olá"), mudo]) {
      const e: Estado = { ...base, turnosVivos: vivo, atividades: a ? { [C]: { t1: a } } : {} };
      const b = blocosAoVivo(c, e)[0]!;
      const noWrap = b.html.slice(b.html.indexOf('<div class="bubble-wrap">'));
      const filhas = [...noWrap.matchAll(/<(?:div|details)[^>]* data-parte="(\w+)"/g)].map((m) => m[1]);
      expect(filhas).toEqual(b.morfar!.partes.map((p) => p.chave));
      for (const p of b.morfar!.partes) expect(noWrap).toContain(p.html);
    }
  });

  it("revisão do #508: no silêncio do vigia o mascote para (idle, disponível) junto com a linha", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const mudo = comVigia(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), { mudoDesde: AGORA - 4 * 60_000, aberta: null, emFundo: 0, repeticao: null });
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 5 * 60_000 } }, atividades: { [C]: { t1: mudo } } };
    const b = blocosAoVivo(c, e)[0]!;
    expect(b.html).toContain('class="fala-viva-linha autor parado"');
    expect(b.morfar!.mascote).toMatchObject({ state: "idle", "data-estado": "disponivel" });
    expect(/<nod-mascote [^>]*>/.exec(b.html)![0]).toContain('state="idle"');
    expect(b.morfar!.partes.map((p) => p.chave)).toContain("vigia");
    // Com trabalho de verdade, o mesmo turno anima e diz "trabalhando".
    const ativo = blocosAoVivo(c, { ...e, atividades: { [C]: { t1: { ...mudo, vigia: null } } } })[0]!;
    expect(ativo.morfar!.mascote).toMatchObject({ state: "orbit", "data-estado": "trabalhando" });
  });

  it("NOD-348: sem ferramenta e sem texto, 'Pensando' no lugar da hora, mascote idle e atento", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: "claude", machineId: null, desde: AGORA } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toContain('state="idle"');
    expect(html).toContain('expression="attentif"');
    expect(html).toContain('<div class="msg-autor" data-parte="nome"><b>Ada</b></div><div class="fala-viva-linha autor" data-parte="viva" data-estado-fala="pensando"><span class="fala-viva-estado">Pensando</span>');
    expect(html).not.toContain("claude");
  });

  it("NOD-348: texto chegando, o balão sem cursor e a linha 'Escrevendo' no rodapé", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Olhando") } } };
    const blocos = blocosAoVivo(c, e);
    const html = blocos[0]!.html;
    expect(html).toContain('class="message bot fala-viva ao-vivo com-texto"');
    expect(html).toContain('<div class="bubble" data-parte="balao">');
    expect(html).not.toContain('class="cursor"');
    expect(blocos[0]!.morfar?.partes.map((p) => p.chave)).toEqual(["nome", "balao", "viva"]);
    expect(html).toContain('<div class="fala-viva-linha rodape" data-parte="viva" data-estado-fala="escrevendo"><span class="fala-viva-estado">Escrevendo</span>');
  });

  it("NOD-348: abrindo frentes, 'Abrindo frentes' com o mascote fazendo", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comFerramenta(ATIVIDADE_VAZIA, "Abriu frentes", { texto: "Abrindo frentes", frentes: true }) } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toContain('data-estado-fala="frentes"><span class="fala-viva-estado">Abrindo frentes</span>');
    expect(html).toContain('state="orbit"');
  });

  it("NOD-348: na sala, a fala é do bot do turno (agenteId), não do bot da conversa", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA, agenteId: "g" } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toContain("<b>Gil</b>");
    expect(html).toContain('aria-label="Gil · pensando"');
    expect(html).not.toContain("<b>Ada</b>");
  });

  it("QA do #508: no fim do turno a fala fica, parada, com a mesma chave, até a releitura trazer a fala gravada", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA - 12_000 };
    const comVivo: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Pronto, fechei setembro.") } } };
    const antes = blocosAoVivo(c, comVivo);
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(fim.turnosVivos.t1).toBeUndefined();
    const saindo = blocosAoVivo(fim.conversas[C]!, fim);
    expect(saindo.map((b) => b.chave)).toEqual(antes.map((b) => b.chave));
    const html = saindo[0]!.html;
    // Na classe, para o morph levar à raiz que ficou (vivo → saindo reaproveita o bloco) e o anunciador pular a fala.
    expect(saindo[0]!.morfar!.raiz).toBe("message bot fala-viva ao-vivo com-texto saindo");
    expect(html).toContain('<article class="message bot fala-viva ao-vivo com-texto saindo" data-turno="t1" data-morfar>');
    expect(html).toContain("Pronto, fechei setembro.");
    expect(html).toContain('class="fala-viva-linha rodape parado" data-parte="viva" data-estado-fala="respondeu"><span class="fala-viva-estado">Respondeu</span>');
    expect(html).toContain('<span class="fala-viva-tempo" aria-hidden="true">12 s</span>');
    expect(html).not.toContain("data-desde");
    expect(saindo[0]!.morfar!.mascote).toMatchObject({ state: "idle", "data-estado": "disponivel" });
    // A releitura (com a fala gravada) tira a fala que saía; e ela também some sozinha se a releitura não vier.
    const relida = reduzir(fim, { tipo: "hidratar-conversa", conversa: { ...(c as unknown as ConversaDto), mensagens: [msg("m1", "pessoa", 1), msg("m2", "agente", 2)] } as ConversaDto, agora: AGORA + 500 });
    expect(relida.falasSaindo?.[C]).toBeUndefined();
    expect(blocosAoVivo(fim.conversas[C]!, { ...fim, agora: AGORA + 15_000 })).toEqual([]);
    // Revisão 3: a releitura que saiu ANTES do fim (sem a fala gravada) não a tira; o tick a limpa depois de 15 s.
    const velha = reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA - 200 });
    expect(paradas(velha, "t1")).toHaveLength(1);
    // QA 3: a releitura que sai no mesmo instante do frame já traz a fala (o servidor grava antes de emitir) e a tira;
    // a de OUTRA conversa não tira as desta.
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: c as unknown as ConversaDto, agora: AGORA }), "t1")).toHaveLength(0);
    const dto = c as unknown as ConversaDto;
    const outra = { ...dto, conversa: { ...dto.conversa, id: "outra-conversa" }, mensagens: [] } as ConversaDto;
    expect(paradas(reduzir(fim, { tipo: "hidratar-conversa", conversa: outra, agora: AGORA + 500 }), "t1")).toHaveLength(1);
    expect(paradas(reduzir(fim, { tipo: "tick", agora: AGORA + 14_000 }), "t1")).toHaveLength(1);
    expect(reduzir(fim, { tipo: "tick", agora: AGORA + 15_000 }).falasSaindo).toEqual({});
  });

  it("revisão 3 do #508: com ferramenta, a fala parada sai sem o 'ver etapas' (a gravada não o tem) e o recolhido não repete o balão", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const a = comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Fechei o PR.");
    const comVivo: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } };
    const vivo = blocosAoVivo(c, comVivo)[0]!;
    expect(vivo.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "balao", "etapas", "viva"]);
    expect(vivo.html.slice(vivo.html.indexOf("</summary>"))).not.toContain("Fechei o PR");
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(blocosAoVivo(fim.conversas[C]!, fim)[0]!.morfar!.partes.map((p) => p.chave)).toEqual(["nome", "balao", "viva"]);
  });

  it("revisão 3 do #508: turno.fala no meio do turno deixa a fala parada antes da fala viva do mesmo turno", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const a = comTexto(comFerramenta(ATIVIDADE_VAZIA, "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Primeira parte.");
    const comVivo: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: a } } };
    const meio = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const blocos = blocosAoVivo(meio.conversas[C]!, meio);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, "vivo:t1"]);
    expect(blocos[0]!.html).toContain("Primeira parte.");
    expect(blocos[1]!.html).not.toContain("Primeira parte.");
    // O turno segue com as etapas (o "ver etapas" continua na fala viva).
    expect(blocos[1]!.morfar!.partes.map((p) => p.chave)).toContain("etapas");
  });

  it("QA do #508: sem texto ou interrompido, nada fica saindo; o turno de outro bot não a tira", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const frame = (tipo: string, dados: Record<string, unknown>, e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo, dados } as never, agora: AGORA });
    const semTexto = frame("turno.encerrado", { turnoId: "t1", conversaId: C }, { ...base, turnosVivos: { t1: vivo } });
    expect(semTexto.falasSaindo?.[C]).toBeUndefined();
    const comVivo: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Olá") } } };
    expect(frame("turno.interrompido", { turnoId: "t1", conversaId: C }, comVivo).falasSaindo?.[C]).toBeUndefined();
    const fim = frame("turno.encerrado", { turnoId: "t1", conversaId: C }, comVivo);
    expect(paradas(fim, "t1")).toHaveLength(1);
    // Revisão 3: na sala, o turno de outro bot (que começa ou é interrompido) não tira a fala parada deste.
    expect(paradas(frame("turno.iniciado", { turnoId: "t2", conversaId: C }, fim), "t1")).toHaveLength(1);
    expect(paradas(frame("turno.interrompido", { turnoId: "t2", conversaId: C }, fim), "t1")).toHaveLength(1);
  });

  it("QA 2 do #508: só fica parada a fala do turno rodando, da conversa aberta, fora de task e com texto", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const fim = (e: Estado) => reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const com = (t: Record<string, unknown>, a = comTexto(ATIVIDADE_VAZIA, "Olá"), extra: Partial<Estado> = {}): Estado => ({ ...base, turnosVivos: { t1: { ...vivo, ...t } as never }, atividades: { [C]: { t1: a } }, ...extra });
    expect(paradas(fim(com({})), "t1")).toHaveLength(1);
    expect(fim(com({ estado: "na_fila" })).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({ trabalhoId: "w1" })).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({}, comTexto(ATIVIDADE_VAZIA, "  \n "))).falasSaindo?.[C]).toBeUndefined();
    expect(fim(com({}, undefined, { conversas: {} })).falasSaindo?.[C]).toBeUndefined();
  });

  it("QA 2 do #508: na sala, a fala parada é do bot do turno, não do bot da conversa", () => {
    const { e: base } = cenario([msg("m1", "pessoa", 1)]);
    const frota = { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }, { id: "g", nome: "Gil", conversaId: "c2", cor: "teal", forma: "shape-hex" }] } as never;
    const comVivo: Estado = { ...base, frota, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA, agenteId: "g" } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Feito.") } } };
    const fim = reduzir(comVivo, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    const html = blocosAoVivo(fim.conversas[C]!, fim)[0]!.html;
    expect(html).toContain("<b>Gil</b>");
    expect(html).not.toContain("<b>Ada</b>");
  });

  it("QA 2 do #508: a ferramenta que chega depois do texto não esvazia o balão; a parada leva as duas partes", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const comA = (a: ReturnType<typeof comTexto>): Estado => ({ ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: a } } });
    const primeira = comTexto(ATIVIDADE_VAZIA, "Vou olhar o PR.");
    const usando = comFerramenta(primeira, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
    const chaves = (e: Estado) => blocosAoVivo(c, e)[0]!.morfar!.partes.map((p) => p.chave);
    expect(chaves(comA(usando))).toEqual(["nome", "balao", "etapas", "viva"]);
    expect(blocosAoVivo(c, comA(usando))[0]!.html).toContain("Usando GitHub");
    expect(blocosAoVivo(c, comA(usando))[0]!.html).toContain("Vou olhar o PR.");
    const segunda = comTexto(usando, "Está aprovado.");
    // Revisão 6: o texto que volta substitui a narração curta (que fica em "ver etapas"), e a viva já é a parada: o fim
    // do turno não muda o balão.
    const balaoVivo = (e: Estado) => blocosAoVivo(c, e)[0]!.morfar!.partes.find((p) => p.chave === "balao")!.html;
    expect(balaoVivo(comA(comTexto(usando, "Es")))).not.toContain("Vou olhar o PR.");
    expect(balaoVivo(comA(segunda))).toContain("Está aprovado.");
    const outra = comFerramenta(segunda, "Consultou Linear", { texto: "Usando Linear", frentes: false });
    expect(balaoVivo(comA(outra))).toContain("Está aprovado.");
    expect(balaoVivo(comA(outra))).not.toContain("Vou olhar o PR.");
    const fim = reduzir(comA(segunda), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    // Revisão 4: a parada segue a fala gravada (`comporFala`): a narração curta fica de fora, a longa entra.
    const balao = (e: Estado) => blocosAoVivo(e.conversas[C]!, e)[0]!.morfar!.partes.find((p) => p.chave === "balao")!.html;
    expect(balao(fim)).toContain("Está aprovado.");
    expect(balao(fim)).not.toContain("Vou olhar o PR.");
    expect(balao(fim)).toBe(balaoVivo(comA(segunda)));
    const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
    const longa = comTexto(comFerramenta(comTexto(ATIVIDADE_VAZIA, relatorio), "Consultou GitHub", { texto: "Usando GitHub", frentes: false }), "Está aprovado.");
    const fimLonga = reduzir(comA(longa), { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(balao(fimLonga)).toContain("setembro fechou acima da meta.");
    expect(balao(fimLonga)).toContain("Está aprovado.");
    // O turno.fala no meio leva as duas partes e a fala viva recomeça sem elas.
    const meio = reduzir(comA(segunda), { tipo: "frame", frame: { tipo: "turno.fala", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(meio.atividades[C]!.t1).toMatchObject({ atual: "", antes: [] });
  });

  it("revisão 4 do #508: dois turno.fala antes da releitura ficam os dois, na ordem; o interrompido não os tira", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = { turnoId: "t1", conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA };
    const frame = (tipo: string, e: Estado, agora: number) => reduzir(e, { tipo: "frame", frame: { tipo, dados: { turnoId: "t1", conversaId: C } } as never, agora });
    const com = (e: Estado, texto: string): Estado => ({ ...e, atividades: { [C]: { t1: comTexto(e.atividades[C]?.t1, texto) } } });
    let e: Estado = { ...base, turnosVivos: { t1: vivo }, atividades: { [C]: { t1: ATIVIDADE_VAZIA } } };
    e = frame("turno.fala", com(e, "Primeira."), AGORA);
    e = frame("turno.fala", com(e, "Segunda."), AGORA + 100);
    const blocos = blocosAoVivo(c, e);
    expect(blocos.map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, `saindo:t1:${AGORA + 100}:1`, "vivo:t1"]);
    expect(blocos[0]!.html).toContain("Primeira.");
    expect(blocos[1]!.html).toContain("Segunda.");
    const parado = frame("turno.interrompido", e, AGORA + 200);
    expect(paradas(parado, "t1")).toHaveLength(2);
    // Sem fala viva, a última fala parada do turno fica com a chave da fala viva.
    expect(blocosAoVivo(c, parado).map((b) => b.chave)).toEqual([`saindo:t1:${AGORA}:0`, "vivo:t1"]);
  });

  it("revisão 4 do #508: a fala parada do turno que acabou vem antes das vivas (sala, turno novo)", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const vivo = (turnoId: string) => ({ turnoId, conversaId: C, estado: "rodando" as const, executor: null, machineId: null, desde: AGORA });
    const e: Estado = { ...base, turnosVivos: { t1: vivo("t1"), t2: vivo("t2") }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Feito."), t2: ATIVIDADE_VAZIA } } };
    expect(blocosAoVivo(c, e).map((b) => b.chave)).toEqual(["vivo:t1", "vivo:t2"]);
    const fim = reduzir(e, { tipo: "frame", frame: { tipo: "turno.encerrado", dados: { turnoId: "t1", conversaId: C } } as never, agora: AGORA });
    expect(blocosAoVivo(fim.conversas[C]!, fim).map((b) => b.chave)).toEqual(["vivo:t1", "vivo:t2"]);
    expect(blocosAoVivo(fim.conversas[C]!, fim)[0]!.html).toContain("Respondeu");
  });

  it("NOD-348: na fila, a linha de sistema sem o nome da IA", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "na_fila", executor: "claude", machineId: null, desde: AGORA - 120_000 } } };
    const html = blocosAoVivo(c, e)[0]!.html;
    expect(html).toMatch(/^<div class="msg-sistema">na fila · /);
    expect(html).not.toContain("claude");
    expect(html).not.toContain("fala-viva");
  });

  it("10. o streaming já sai formatado: negrito, lista e tabela enquanto o texto chega", () => {
    const { e: base, c } = cenario([msg("m1", "pessoa", 1)]);
    const e: Estado = { ...base, turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } }, atividades: { [C]: { t1: comTexto(ATIVIDADE_VAZIA, "Fechei **setembro**:\n- Sul\n- Norte\n\n| Região | R$ |\n|---|---|\n| Sul | 98 |") } } };
    const corpo = blocosAoVivo(c, e).find((b) => b.chave === "vivo:t1")!.html;
    expect(corpo).toContain("<strong>setembro</strong>");
    expect(corpo).toContain('<ul class="md-lista"><li>Sul</li><li>Norte</li></ul>');
    expect(corpo).toContain('<div class="md-tabela">');
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
