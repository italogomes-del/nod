import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { blocosAoVivo, blocosDoHistorico, renderCabecalhoConversa } from "../../../web/telas/conversa.ts";
import { horariosDaRotina, planejarLinhas } from "../../../web/telas/linhas-do-chat.ts";

/**
 * Chat limpo (#191, filha 03; #195, filha 07): a semente do épico, linha a linha, e a regra "tudo que não é balão fica no
 * centro". As fábricas seguem as de conversa-depois.test.ts, com as marcas novas do servidor (origemTurno, trabalhoId,
 * fimDoTurno).
 */

const C = "c-clarice";
// Horas no relógio local (a tela mostra HH:MM no fuso da máquina): 07/10, 09:00 e 12:00.
const AGORA = new Date(2026, 9, 7, 12, 0).getTime();
const MIN = 60_000;
const t0 = new Date(2026, 9, 7, 9, 0).getTime();

const autoriaBot = (id = "clarice") => ({ autor_tipo: "agente" as const, autor_id: id, sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:teste" as const, regra_versao: 1 });
const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: autoriaBot(), kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm,
  origemTurno: null, trabalhoId: null, fimDoTurno: false, ...extra,
} as Mensagem);
const daPessoa = (id: string, criadoEm: number): Mensagem => msg(id, criadoEm, { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never });
const doBot = (id: string, criadoEm: number, turno: string): Mensagem => msg(id, criadoEm, { turnoId: turno, origemTurno: "conversa", fimDoTurno: true });

/** Uma execução de rotina sem novidade: a fala do meio ficou gravada (ADR-067) e a do fim foi suprimida (silêncio). */
const execucaoSilenciosa = (i: number, criadoEm: number): Mensagem[] => [msg(`r${i}`, criadoEm, { turnoId: `tr${i}`, origemTurno: "rotina", trabalhoId: `tb-r${i}`, fimDoTurno: true, texto: "Li o #suporte: nada para o Marlon" })];
/** O pedido do Chico recebido pela Clarice: o pedido e duas falas do turno de delegação. */
const pedidoDoChico = (criadoEm: number): Mensagem[] => [
  msg("k1", criadoEm, { autoria: { ...autoriaBot("chico"), sob_procuracao_de: "p" }, turnoId: "tk", origemTurno: "delegacao", trabalhoId: "tb-k", payload: { kind: "peer_pedido", conversaOrigemId: "c-chico", turnoOrigemId: "t-chico" }, texto: "Clarice, revisa o #505" }),
  msg("k2", criadoEm + MIN, { turnoId: "tk", origemTurno: "delegacao", trabalhoId: "tb-k", texto: "Vou olhar" }),
  msg("k3", criadoEm + 2 * MIN, { turnoId: "tk", origemTurno: "delegacao", trabalhoId: "tb-k", fimDoTurno: true, texto: "Revisado: dois ajustes" }),
];
/** Uma execução com algo para a pessoa: fala do meio, a linha "Rotina executou" e a fala do fim. */
const execucaoComNovidade = (criadoEm: number): Mensagem[] => [
  msg("r6a", criadoEm, { turnoId: "tr6", origemTurno: "rotina", trabalhoId: "tb-r6", texto: "Lendo o #suporte" }),
  msg("r6b", criadoEm + MIN, { turnoId: "tr6", origemTurno: "rotina", trabalhoId: "tb-r6", kind: "rotina_execucao", texto: "Rotina executou em …", payload: { kind: "rotina_execucao", rotinaId: "rot-triagem", instanteAgendado: criadoEm, desfecho: "executou" } }),
  msg("r6c", criadoEm + MIN, { turnoId: "tr6", origemTurno: "rotina", trabalhoId: "tb-r6", fimDoTurno: true, texto: "A Gabriela marcou você no #suporte" }),
];

function semente(): Mensagem[] {
  return [
    daPessoa("p1", t0), doBot("b1", t0 + MIN, "t1"), daPessoa("p2", t0 + 2 * MIN), doBot("b2", t0 + 3 * MIN, "t2"),
    ...[0, 1, 2, 3, 4].flatMap((i) => execucaoSilenciosa(i + 1, t0 + (10 + 10 * i) * MIN)),
    ...pedidoDoChico(t0 + 70 * MIN),
    ...execucaoComNovidade(t0 + 100 * MIN),
    daPessoa("p3", t0 + 110 * MIN), doBot("b3", t0 + 111 * MIN, "t3"), daPessoa("p4", t0 + 112 * MIN), doBot("b4", t0 + 113 * MIN, "t4"),
  ];
}

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "clarice", conversaId: C, titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: t0, iniciadoEm: t0, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function cenario(mensagens: Mensagem[], extra: Partial<Estado> = {}, conversa: Partial<ConversaDto> = {}): { e: Estado; c: ConversaEstado } {
  const dto: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "clarice", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [], ...conversa,
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: dto, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "clarice", nome: "Clarice", conversaId: C, cor: "c-red", forma: "shape-circle" }, { id: "chico", nome: "Chico", conversaId: "c-chico", cor: "c-brown", forma: "shape-square" }] } as never,
    suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null },
    ...extra,
  };
  return { e, c: e.conversas[C]! };
}

const itens = (c: ConversaEstado, e: Estado) => blocosDoHistorico(c, e).filter((b) => b.chave !== "sep");
const ehBalao = (html: string): boolean => /^\s*<article class="message /.test(html);
const ehLinha = (html: string): boolean => /^\s*<div class="linha-centro-wrap"/.test(html);

describe("a semente da filha 03: 11 itens, 9 você↔bot", () => {
  it("2 trocas + 5 execuções sem novidade + 1 pedido de colega + 1 execução com novidade + 2 trocas = 8 balões, 1 'da rotina', 1 linha da rotina e 1 'Pedido do Chico'", () => {
    const { e, c } = cenario(semente());
    const blocos = itens(c, e);
    expect(blocos).toHaveLength(11);
    const baloes = blocos.filter((b) => ehBalao(b.html));
    const linhas = blocos.filter((b) => ehLinha(b.html));
    expect(baloes).toHaveLength(9);
    expect(linhas).toHaveLength(2);
    // 9 de 11 são você↔bot (82%): os 8 balões das trocas e o balão "da rotina", que é para a pessoa.
    expect(baloes.length / blocos.length).toBeGreaterThanOrEqual(0.8);
    expect(linhas[0]!.html).toContain("rodou 5 vezes");
    expect(linhas[0]!.html).toContain("09:10 a 09:50");
    expect(linhas[0]!.html).toContain("nada para você");
    expect(linhas[0]!.html).toContain('data-linha-tipo="rotina"');
    expect(linhas[1]!.html).toMatch(/Pedido do<\/span>.*<span class="linha-nome">Chico<\/span><span>· 3 mensagens<\/span>/);
    expect(linhas[1]!.html).toContain('data-linha-tipo="bots"');
    const daRotina = baloes.find((b) => b.html.includes("da rotina"));
    expect(daRotina?.html).toContain("A Gabriela marcou você no #suporte");
    expect(daRotina?.html).toContain('<span class="etiqueta-origem">da rotina');
    // Nenhuma fala do meio da rotina nem do pedido aparece no chat; a linha "Rotina executou" também some.
    const tudo = blocos.map((b) => b.html).join("");
    for (const escondida of ["Li o #suporte", "Vou olhar", "Revisado: dois ajustes", "Lendo o #suporte", "Rotina executou"]) expect(tudo).not.toContain(escondida);
    // A ordem: as trocas, a linha da rotina, o pedido, o balão da rotina, as outras trocas.
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "b1", "p2", "b2", "linha:r1", "linha:k1", "r6c", "p3", "b3", "p4", "b4"]);
  });

  it("com os trabalhos conhecidos, a linha diz o nome da rotina e abre a task quando é uma execução só", () => {
    const rotinas = [1, 2, 3, 4, 5].map((i) => trabalho(`tb-r${i}`, { origem: "rotina", rotinaId: "rot-triagem", rotinaNome: "Triagem do Slack", estado: "terminado", terminadoEm: t0 + 60 * MIN }));
    const { e, c } = cenario(semente(), { trabalhos: { trabalhos: [...rotinas, trabalho("tb-k", { origem: "colega", pedidoPorAgenteId: "chico", pedidoPorNome: "Chico" })], pressao: null, memoriaTotalMb: null } });
    const linha = itens(c, e).find((b) => b.chave === "linha:r1")!.html;
    expect(linha).toContain("<b>Triagem do Slack</b> rodou 5 vezes");
    // Cinco execuções: a linha abre a tela provisória com as mensagens delas.
    expect(linha).toContain('data-mensagens="r1,r2,r3,r4,r5"');
    // O pedido do colega abre a task de quem recebeu.
    expect(itens(c, e).find((b) => b.chave === "linha:k1")!.html).toContain('data-trabalho="tb-k"');
    const uma = cenario([...execucaoSilenciosa(1, t0), daPessoa("p9", t0 + MIN)], { trabalhos: { trabalhos: rotinas, pressao: null, memoriaTotalMb: null } });
    expect(itens(uma.c, uma.e)[0]!.html).toContain('data-trabalho="tb-r1"');
    expect(itens(uma.c, uma.e)[0]!.html).toContain("rodou 1 vez · 09:00");
  });

  it("um balão da pessoa no meio separa as execuções em duas linhas", () => {
    const { e, c } = cenario([...execucaoSilenciosa(1, t0), ...execucaoSilenciosa(2, t0 + 10 * MIN), daPessoa("p1", t0 + 15 * MIN), ...execucaoSilenciosa(3, t0 + 20 * MIN)]);
    const html = itens(c, e).map((b) => b.html);
    expect(html).toHaveLength(3);
    expect(html[0]).toContain("rodou 2 vezes · 09:00 e 09:10");
    expect(html[2]).toContain("rodou 1 vez · 09:20");
  });

  it("a execução que falhou continua com a linha de sempre, fora do grupo", () => {
    const falhou = msg("rf", t0, { turnoId: "trf", origemTurno: "rotina", trabalhoId: "tb-rf", kind: "rotina_execucao", texto: "A rotina falhou: sem acesso", payload: { kind: "rotina_execucao", rotinaId: "x", instanteAgendado: t0, desfecho: "falhou" } });
    const { e, c } = cenario([falhou]);
    expect(itens(c, e)[0]!.html).toContain("A rotina falhou: sem acesso");
  });

  it("servidor anterior ao épico (sem as marcas): a fala da rotina continua balão, como antes", () => {
    const antiga = { ...msg("r1", t0, { turnoId: "tr1" }) } as Mensagem;
    delete (antiga as Partial<Mensagem>).origemTurno;
    delete (antiga as Partial<Mensagem>).trabalhoId;
    delete (antiga as Partial<Mensagem>).fimDoTurno;
    const { e, c } = cenario([antiga]);
    expect(planejarLinhas([antiga], e).size).toBe(0);
    expect(ehBalao(itens(c, e)[0]!.html)).toBe(true);
  });

  it("horários: um, dois ou o intervalo", () => {
    expect(horariosDaRotina([t0])).toBe("09:00");
    expect(horariosDaRotina([t0 + 10 * MIN, t0])).toBe("09:00 e 09:10");
    expect(horariosDaRotina([t0, t0 + 10 * MIN, t0 + 30 * MIN])).toBe("09:00 a 09:30");
  });
});

describe("tasks na conversa (#195)", () => {
  const aberta = (trabalhoId: string, titulo: string, criadoEm: number): Mensagem => msg(`a-${trabalhoId}`, criadoEm, { kind: "sistema", texto: `Abriu a task ${titulo}`, payload: { kind: "trabalho_aberto", trabalhoId, titulo, origem: "pessoa" }, turnoId: "tc", origemTurno: "conversa" });

  it("'Abriu a task' é linha centralizada clicável; as falas do meio somem; o resultado vira balão 'da task …' com a linha 'terminou'", () => {
    const mensagens = [
      daPessoa("p1", t0), doBot("b1", t0 + MIN, "tc"), aberta("tb-1", "Migrar relatórios", t0 + MIN),
      msg("m1", t0 + 2 * MIN, { turnoId: "tt", origemTurno: "conversa", trabalhoId: "tb-1", texto: "Convertendo o lote 1" }),
      msg("m2", t0 + 40 * MIN, { turnoId: "tt", origemTurno: "conversa", trabalhoId: "tb-1", fimDoTurno: true, texto: "Migração pronta: 33 relatórios" }),
    ];
    const t = trabalho("tb-1", { titulo: "Migrar relatórios", estado: "terminado", terminadoEm: t0 + 39 * MIN, custoUsd: 0.88 });
    const { e, c } = cenario(mensagens, { trabalhos: { trabalhos: [t], pressao: null, memoriaTotalMb: null } });
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "b1", "linha:a-tb-1", "m2"]);
    expect(blocos[2]!.html).toContain("<span>Abriu a task</span><b>Migrar relatórios</b>");
    expect(blocos[2]!.html).toContain('data-trabalho="tb-1"');
    expect(blocos[2]!.html).toContain('data-linha-tipo="task"');
    expect(blocos[3]!.html).toContain('<span class="etiqueta-origem">da task Migrar relatórios</span>');
    expect(blocos[3]!.html).toContain("terminou · 39 min · US$ 0,88");
    expect(blocos.map((b) => b.html).join("")).not.toContain("Convertendo o lote 1");
  });

  it("a pergunta da task chega como balão com a etiqueta, mesmo no meio do turno", () => {
    const pergunta = msg("q1", t0 + 5 * MIN, { turnoId: "tt", origemTurno: "conversa", trabalhoId: "tb-2", payload: { kind: "pedido_a_pessoa", decisaoId: "d1", opcoes: ["Por plano", "Os dois"] }, texto: "Separo por plano ou por segmento?" });
    const { e, c } = cenario([aberta("tb-2", "Dashboard de churn Q3", t0), pergunta], { trabalhos: { trabalhos: [trabalho("tb-2", { titulo: "Dashboard de churn Q3", estado: "precisa_de_voce" })], pressao: null, memoriaTotalMb: null } });
    const html = itens(c, e).find((b) => b.chave === "q1")!.html;
    expect(html).toContain("da task Dashboard de churn Q3");
    expect(html).toContain("Separo por plano ou por segmento?");
  });

  it("'Fazer depois da …' e 'Fazer aqui' na linha da task nova; a pílula de memória entra embaixo dela sob pressão", () => {
    const um = trabalho("tb-1", { titulo: "Migrar relatórios", criadoEm: t0 });
    const dois = trabalho("tb-2", { titulo: "Dashboard de churn Q3", criadoEm: t0 + 10 * MIN, estado: "na_fila" });
    const { e, c } = cenario([aberta("tb-1", "Migrar relatórios", t0), aberta("tb-2", "Dashboard de churn Q3", t0 + 10 * MIN)], { pressao: "amarela", trabalhos: { trabalhos: [um, dois], pressao: "amarela", memoriaTotalMb: null } });
    const [primeira, segunda] = itens(c, e).map((b) => b.html);
    expect(primeira).not.toContain("Fazer depois");
    expect(primeira).toContain('data-act="trabalho-fazer-aqui" data-id="tb-1"');
    expect(segunda).toContain('data-act="trabalho-depois" data-id="tb-2" data-depois="tb-1"');
    expect(segunda).toContain("Fazer depois da Migrar relatórios");
    expect(primeira).not.toContain("pilula-memoria");
    expect(segunda).toContain('class="pilula-memoria amarela"');
    expect(segunda).toContain("Pouca memória no seu Mac");
    expect(segunda).toContain("· 2 trabalhos abertos");
    const vermelha = cenario(c.mensagens, { ...e, pressao: "vermelha" });
    expect(itens(vermelha.c, vermelha.e)[1]!.html).toContain("Seu Mac está quase sem memória");
    expect(itens(vermelha.c, vermelha.e)[1]!.html).toContain("pode travar");
  });

  it("o ao vivo de um turno de task não entra no chat (fica na tela da task)", () => {
    const { e: base, c } = cenario([daPessoa("p1", t0)]);
    const e: Estado = { ...base, turnosVivos: { tt: { turnoId: "tt", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA, trabalhoId: "tb-1" }, tc: { turnoId: "tc", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA } } };
    const chaves = blocosAoVivo(c, e).map((b) => b.chave);
    expect(chaves.some((k) => k.endsWith(":tc"))).toBe(true);
    expect(chaves.some((k) => k.endsWith(":tt"))).toBe(false);
    // Sem o trabalhoId no frame, vale o da conversa relida (turnosEmCurso) ou o turnoVivoId da lista.
    const semMarca: Estado = { ...e, turnosVivos: { tt: { ...e.turnosVivos.tt!, trabalhoId: null } }, trabalhos: { trabalhos: [trabalho("tb-1", { turnoVivoId: "tt" })], pressao: null, memoriaTotalMb: null } };
    expect(blocosAoVivo(c, semMarca).map((b) => b.chave)).toEqual([]);
  });

  it("o Parar do cabeçalho aparece com task aberta mesmo sem turno da conversa", () => {
    const { e } = cenario([], { trabalhos: { trabalhos: [trabalho("tb-1")], pressao: null, memoriaTotalMb: null } });
    expect(renderCabecalhoConversa(e, "clarice")).toContain('data-act="parar-conversa"');
    expect(renderCabecalhoConversa({ ...e, trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null } }, "clarice")).not.toContain('data-act="parar-conversa"');
  });
});

describe("revisão W7/W8/W10 (2026-10-08)", () => {
  const rotina = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => msg(id, criadoEm, { turnoId: "tr1", origemTurno: "rotina", trabalhoId: "tb-r1", ...extra });

  it("W7: a rotina em andamento não diz 'nada para você' (trabalho aberto, ou sem a linha da execução nem a última fala)", () => {
    const meio = [daPessoa("p1", t0), rotina("r1", t0 + MIN, { texto: "Lendo o #suporte" })];
    const comTrabalho = cenario(meio, { trabalhos: { trabalhos: [trabalho("tb-r1", { origem: "rotina", rotinaNome: "Triagem", estado: "rodando" })], pressao: null, memoriaTotalMb: null } });
    expect(itens(comTrabalho.c, comTrabalho.e).map((b) => b.html).join("")).not.toContain("nada para você");
    const semTrabalho = cenario(meio);
    expect(itens(semTrabalho.c, semTrabalho.e).map((b) => b.html).join("")).not.toContain("nada para você");
    // A última fala com o trabalho ainda aberto (a lista atrasada) também espera.
    const fimComAberto = cenario([rotina("r1", t0, { fimDoTurno: true })], { trabalhos: { trabalhos: [trabalho("tb-r1", { origem: "rotina", estado: "rodando" })], pressao: null, memoriaTotalMb: null } });
    expect(itens(fimComAberto.c, fimComAberto.e).map((b) => b.html).join("")).not.toContain("nada para você");
    // Acabou (a última fala do turno chegou e o trabalho fechou): a linha volta.
    const acabou = cenario([rotina("r1", t0, { fimDoTurno: true })], { trabalhos: { trabalhos: [trabalho("tb-r1", { origem: "rotina", estado: "terminado", terminadoEm: t0 + MIN })], pressao: null, memoriaTotalMb: null } });
    expect(itens(acabou.c, acabou.e)[0]?.html).toContain("rodou 1 vez · 09:00 · nada para você");
  });

  it("W8: o que a pessoa escreveu no campo da task mora na task; na `rede` (a conversa virou task) e sem saber a origem, fica no chat", () => {
    const naTask = (id: string, trabalhoId: string): Mensagem => msg(id, t0 + 5 * MIN, { autoria: { autor_tipo: "pessoa", autor_id: "p" } as never, origemTurno: null, trabalhoId, texto: `recado ${id}` });
    const aberta = (trabalhoId: string, origem: "pessoa" | "rede"): Mensagem => msg(`a-${trabalhoId}`, t0, { kind: "sistema", texto: "Abriu", payload: { kind: "trabalho_aberto", trabalhoId, titulo: `Task ${trabalhoId}`, origem }, turnoId: "tc", origemTurno: "conversa" });
    const { e, c } = cenario([aberta("tb-1", "pessoa"), naTask("x1", "tb-1"), aberta("tb-2", "rede"), naTask("x2", "tb-2"), naTask("x3", "tb-desconhecida")]);
    const html = itens(c, e).map((b) => b.html).join("");
    expect(html).not.toContain("recado x1");
    expect(html).toContain("recado x2");
    expect(html).toContain("recado x3");
    // Pela lista de trabalhos também (a linha "Abriu a task" saiu da janela carregada).
    const pelaLista = cenario([naTask("x4", "tb-4")], { trabalhos: { trabalhos: [trabalho("tb-4")], pressao: null, memoriaTotalMb: null } });
    expect(itens(pelaLista.c, pelaLista.e).map((b) => b.html).join("")).not.toContain("recado x4");
  });

  it("W10: a linha da rotina entra no lugar da primeira mensagem ESCONDIDA da execução, nunca no de uma à vista", () => {
    const aviso = rotina("rs", t0, { kind: "sistema", texto: "A rotina reconectou o Slack" });
    const { e, c } = cenario([aviso, rotina("r1", t0 + MIN, { fimDoTurno: true, texto: "Li o #suporte: nada" })]);
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["rs", "linha:r1"]);
    expect(blocos[0]?.html).toContain("A rotina reconectou o Slack");
    expect(blocos[1]?.html).toContain("rodou 1 vez · 09:00 · nada para você");
  });
});

describe("quem pede a um colega (padrão Grok)", () => {
  it("'Enviou mensagem para Chico' no pedido e 'N mensagens com Chico' na volta; a fala de quem pediu continua balão", () => {
    const handoff = msg("h1", t0, { turnoId: "t-pede", origemTurno: "conversa", kind: "handoff", texto: "x", payload: { kind: "handoff", de: "clarice", para: "chico", motivo: "revisar", tarefaId: "tarefa-1", trabalhoId: "tb-chico" } });
    const resposta = msg("h2", t0 + 30 * MIN, { turnoId: "t-volta", origemTurno: "retomada", kind: "peer_ask", texto: "Revisei", payload: { kind: "peer_ask", agenteId: "chico", nome: "Chico", naoSupervisionado: true, tarefaId: "tarefa-1", delegada: true } });
    const fala = msg("h3", t0 + 31 * MIN, { turnoId: "t-volta", origemTurno: "retomada", fimDoTurno: true, texto: "O Chico revisou: dois ajustes" });
    const { e, c } = cenario([doBot("b0", t0 - MIN, "t-pede"), handoff, resposta, fala]);
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["b0", "linha:h1", "linha:h2", "h3"]);
    expect(blocos[1]!.html).toMatch(/Enviou mensagem para<\/span><nod-mascote[^>]*>.*<span class="linha-nome">Chico<\/span>/);
    expect(blocos[1]!.html).toContain('data-trabalho="tb-chico"');
    expect(blocos[2]!.html).toContain("2 mensagens com</span>");
    expect(ehBalao(blocos[3]!.html)).toBe(true);
    expect(blocos.map((b) => b.html).join("")).not.toContain('class="collaboration"');
  });

  it("QA do épico (2026-10-08): a ROTINA que pede a um colega também mostra 'Enviou mensagem para' e 'N mensagens com'", () => {
    const daRotina = { origemTurno: "rotina" as const, trabalhoId: "tb-rot" };
    const handoff = msg("h1", t0, { turnoId: "t-rot", ...daRotina, kind: "handoff", texto: "x", payload: { kind: "handoff", de: "clarice", para: "chico", motivo: "revisar", tarefaId: "tarefa-2" } });
    const pedi = msg("h2", t0 + MIN, { turnoId: "t-rot", ...daRotina, fimDoTurno: true, texto: "Pedi ao Chico." });
    const exec = msg("h3", t0 + MIN, { turnoId: "t-rot", ...daRotina, kind: "rotina_execucao", texto: "Rotina executou", payload: { kind: "rotina_execucao", rotinaId: "rot", instanteAgendado: t0, desfecho: "executou" } });
    const resposta = msg("h4", t0 + 5 * MIN, { turnoId: "t-volta", origemTurno: "retomada", trabalhoId: "tb-rot", kind: "peer_ask", texto: "Revisei", payload: { kind: "peer_ask", agenteId: "chico", nome: "Chico", naoSupervisionado: true, tarefaId: "tarefa-2", delegada: true } });
    const fala = msg("h5", t0 + 6 * MIN, { turnoId: "t-volta", origemTurno: "retomada", trabalhoId: "tb-rot", fimDoTurno: true, texto: "O Chico revisou." });
    const { e, c } = cenario([handoff, pedi, exec, resposta, fala], { trabalhos: { trabalhos: [trabalho("tb-rot", { origem: "rotina", rotinaNome: "Revisão diária", estado: "terminado", terminadoEm: t0 + 7 * MIN })], pressao: null, memoriaTotalMb: null } });
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["h2", "linha:h1", "linha:h4", "h5"]);
    expect(blocos[1]!.html).toContain("Enviou mensagem para");
    expect(blocos[2]!.html).toContain("2 mensagens com</span>");
  });
});

describe("tudo que não é balão fica no centro", () => {
  /** As classes da raiz de um item que não é balão, e o CSS que as centraliza. */
  const CENTRO: Record<string, RegExp> = {
    "msg-linha": /\.msg-linha \{ margin-left: auto; margin-right: auto;/,
    "linha-centro-wrap": /\.linha-centro-wrap \{ display: flex; flex-direction: column; align-items: center;[^}]*margin: 2px auto 12px/,
    "avisos-sistema": /\.avisos-sistema \{ margin: 4px auto 12px;/,
  };
  const css = ["estilos.css", "interface.css"].map((f) => readFileSync(new URL(`../../../web/${f}`, import.meta.url), "utf8")).join("\n");

  it("cada item da semente e de uma conversa variada é balão ou tem a estrutura de linha centralizada", () => {
    const sistema = (id: string, extra: Partial<Mensagem>) => msg(id, t0, { kind: "sistema", texto: `aviso ${id}`, ...extra });
    const variadas = [
      ...semente(),
      sistema("s1", {}), daPessoa("px", t0),
      msg("ho", t0, { kind: "handoff", payload: { kind: "handoff", de: "clarice", para: "chico", motivo: "passou a vez" } }),
      msg("pa", t0, { kind: "passe", texto: "passou", payload: { kind: "passe", motivo: "fora_do_escopo" } as never }),
      msg("ng", t0, { kind: "negacao", texto: "negado", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "x", motivo: "fora_da_concessao" as never, terminal: false } }),
      msg("pr", t0, { kind: "parada", texto: "parou", payload: { kind: "parada", interrompidas: 1, nadaRodando: false } }),
      msg("ra", t0, { kind: "resultado_aprovacao", texto: "aprovou", payload: { kind: "resultado_aprovacao", decisaoId: "d", itens: [{ idx: 0, desfecho: "executado", texto: "a" }] } }),
      msg("ta", t0, { kind: "sistema", texto: "Abriu", payload: { kind: "trabalho_aberto", trabalhoId: "tb-9", titulo: "Nova", origem: "pessoa" } }),
      sistema("s2", {}), sistema("s3", {}), sistema("s4", {}),
    ];
    const { e, c } = cenario(variadas);
    for (const b of itens(c, e)) {
      if (ehBalao(b.html)) continue;
      const raiz = /^\s*<(?:div|details|section|span)\s+class="([^"]+)"/.exec(b.html)?.[1]?.split(" ")[0] ?? "";
      expect(Object.keys(CENTRO), `bloco ${b.chave}: ${b.html.slice(0, 80)}`).toContain(raiz);
    }
    for (const [classe, regra] of Object.entries(CENTRO)) expect(css, classe).toMatch(regra);
    // O pedido a colega e a resposta dele, por dentro da .msg-linha, também ficam no centro (antes: margem de 52px).
    expect(css).toMatch(/\.msg-handoff, \.msg-peer \{[^}]*margin: 12px auto 22px;/);
    expect(css).not.toMatch(/\.collaboration\{margin:12px 0 20px 64px/);
  });
});

describe("QA do épico (2026-10-08): nome de rotina longo não estica a linha nem a etiqueta", () => {
  it("o rotinaNome de 80 caracteres sai com 48 na linha 'rodou N vezes' e na etiqueta 'da rotina'", () => {
    const longo = "Toda manhã leia o canal #suporte e me avise se alguém marcar você ou o time";
    const lista = [1, 2].map((i) => trabalho(`tb-r${i}`, { origem: "rotina", rotinaId: "rot", rotinaNome: longo, estado: "terminado", terminadoEm: t0 + 60 * MIN }));
    const { e, c } = cenario([...execucaoSilenciosa(1, t0), ...execucaoSilenciosa(2, t0 + 10 * MIN)], { trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: null } });
    const linha = itens(c, e)[0]!.html;
    expect(linha).toContain("<b>Toda manhã leia o canal #suporte e me avise se…</b> rodou 2 vezes");
    expect(linha).not.toContain(longo);
    const com = cenario(execucaoComNovidade(t0), { trabalhos: { trabalhos: [trabalho("tb-r6", { origem: "rotina", rotinaNome: longo, estado: "terminado", terminadoEm: t0 + 2 * MIN })], pressao: null, memoriaTotalMb: null } });
    expect(itens(com.c, com.e).map((b) => b.html).join("")).toContain('<span class="etiqueta-origem">da rotina Toda manhã leia o canal #suporte e me avise se…</span>');
  });
});

describe("QA do épico (2026-10-08): o aviso de turno interrompido da task fica na tela dela", () => {
  it("Parar task / Fazer depois / Fazer aqui não deixam 'Turno interrompido' no chat; a task que falhou deixa", () => {
    const aviso = (id: string, trabalhoId: string): Mensagem => msg(id, t0 + MIN, { kind: "sistema", texto: "Turno interrompido: você pediu para parar.", turnoId: `t-${id}`, origemTurno: "conversa", trabalhoId });
    const lista = [trabalho("tb-parada", { estado: "parado", terminadoEm: t0 + MIN }), trabalho("tb-fila", { estado: "na_fila" }), trabalho("tb-falhou", { estado: "falhou", terminadoEm: t0 + MIN }), trabalho("tb-espera", { estado: "precisa_de_voce" })];
    const { e, c } = cenario([daPessoa("p1", t0), aviso("a1", "tb-parada"), aviso("a2", "tb-fila"), aviso("a3", "tb-falhou"), aviso("a4", "tb-espera")], { trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: null } });
    // A que falhou e a que ficou esperando a pessoa porque o Mac caiu no meio continuam com o aviso.
    expect(itens(c, e).map((b) => b.chave)).toEqual(["p1", "a3", "a4"]);
  });
});

describe("QA do épico (2026-10-08): a linha do meio do turno desce para depois da fala que a anunciou (K1, B1)", () => {
  it("\"Abriu a task\" e \"Enviou mensagem para\" entram depois do balão do bot do mesmo turno", () => {
    const abriu = msg("ab", t0 + MIN, { kind: "sistema", texto: "Abriu a task Migrar relatórios", turnoId: "tc", origemTurno: "conversa", payload: { kind: "trabalho_aberto", trabalhoId: "tb-m", titulo: "Migrar relatórios", origem: "pessoa" } });
    const anuncio = msg("an", t0 + 2 * MIN, { turnoId: "tc", origemTurno: "conversa", fimDoTurno: true, texto: "Abri uma task para isso." });
    const pediu = msg("hp", t0 + 4 * MIN, { turnoId: "tp", origemTurno: "conversa", kind: "handoff", texto: "x", payload: { kind: "handoff", de: "clarice", para: "chico", motivo: "revisar", tarefaId: "tarefa-9" } });
    const falou = msg("fp", t0 + 5 * MIN, { turnoId: "tp", origemTurno: "conversa", fimDoTurno: true, texto: "Pedi ao Chico." });
    const { e, c } = cenario([daPessoa("p1", t0), abriu, anuncio, daPessoa("p2", t0 + 3 * MIN), pediu, falou]);
    expect(itens(c, e).map((b) => b.chave)).toEqual(["p1", "an", "linha:ab", "p2", "fp", "linha:hp"]);
  });
});
