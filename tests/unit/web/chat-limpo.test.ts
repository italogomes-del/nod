import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { blocosAoVivo, blocosDoHistorico, mostraPararNoCampo } from "../../../web/telas/conversa.ts";
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
    // #219: com o disco crítico (nenhuma task nova começa), a pílula do disco no lugar da de memória — uma só; com o
    // disco só em alerta, a task da pessoa começa e fica a de memória.
    const segurada = { ...dois, esperaDoMac: "disco" as const };
    const disco = cenario(c.mensagens, { ...e, trabalhos: { trabalhos: [um, segurada], pressao: "amarela", memoriaTotalMb: null, segurando: true, motivoEspera: "disco", seguraTudoNovo: true } });
    const comDisco = itens(disco.c, disco.e)[1]!.html;
    expect(comDisco).toContain("Pouco espaço no disco");
    expect(comDisco).toContain("1 trabalho espera espaço no disco");
    expect(comDisco).not.toContain("Pouca memória no seu Mac");
    const alerta = cenario(c.mensagens, { ...e, trabalhos: { trabalhos: [um, segurada], pressao: "amarela", memoriaTotalMb: null, segurando: true, motivoEspera: "disco", seguraTudoNovo: false } });
    expect(itens(alerta.c, alerta.e)[1]!.html).toContain("Pouca memória no seu Mac");
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

  // Plano "tela limpa" (2026-10-16, E11): o Parar saiu do cabeçalho e é o Enviar do campo que vira Parar.
  it("o Parar do campo aparece com task aberta mesmo sem turno da conversa", () => {
    const { e } = cenario([], { trabalhos: { trabalhos: [trabalho("tb-1")], pressao: null, memoriaTotalMb: null } });
    expect(mostraPararNoCampo(e, "clarice")).toBe(true);
    expect(mostraPararNoCampo({ ...e, trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null } }, "clarice")).toBe(false);
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

describe("ADR-099 (I2): o lote de frentes vira uma linha só, e o recado a uma frente também", () => {
  const lote = (id: string, frentes: { trabalhoId: string; titulo: string }[], criadoEm: number) =>
    msg(id, criadoEm, { kind: "sistema", texto: "Começou", turnoId: "tc", origemTurno: "conversa", payload: { kind: "frentes_abertas", loteId: `l-${id}`, origem: "pessoa", frentes } });

  it("várias frentes: uma linha \"Começou N frentes\" com um botão por frente; uma só: a linha de abrir, clicável", () => {
    const tres = lote("l3", [{ trabalhoId: "f-a", titulo: "Login" }, { trabalhoId: "f-b", titulo: "CI <vermelha>" }, { trabalhoId: "f-c", titulo: "Notas" }], t0 + MIN);
    const uma = lote("l1", [{ trabalhoId: "f-d", titulo: "Deploy" }], t0 + 3 * MIN);
    const anuncio = msg("an", t0 + 2 * MIN, { turnoId: "tc", origemTurno: "conversa", fimDoTurno: true, texto: "Comecei três frentes." });
    const { e, c } = cenario([daPessoa("p1", t0), tres, anuncio, uma]);
    const planos = planejarLinhas(c.mensagens, e);
    const htmlTres = (planos.get("l3") as { html: string }).html;
    expect(htmlTres).toContain("Começou 3 frentes");
    for (const id of ["f-a", "f-b", "f-c"]) expect(htmlTres).toContain(`data-act="abrir-trabalho" data-id="${id}"`);
    expect(htmlTres).toContain("CI &lt;vermelha&gt;");
    const htmlUma = (planos.get("l1") as { html: string }).html;
    expect(htmlUma).toContain("Começou a frente");
    expect(htmlUma).toContain('data-trabalho="f-d"');
    // A linha do turno desce para depois da fala que a anunciou, como a "Abriu a task".
    expect(itens(c, e).map((b) => b.chave)).toEqual(["p1", "an", "linha:l3", "linha:l1"]);
    for (const b of itens(c, e)) expect(ehBalao(b.html) || ehLinha(b.html), b.chave).toBe(true);
  });

  it("ADR-099 (parte 5, quadro 06): a linha das várias frentes é uma só, \"●●● Começou 3 frentes: A, B e C · hora\", com um ponto na cor do bot por frente", () => {
    const tres = lote("l3", [{ trabalhoId: "f-a", titulo: "Login" }, { trabalhoId: "f-b", titulo: "CI" }, { trabalhoId: "f-c", titulo: "Notas" }], t0 + MIN);
    const cinco = lote("l5", ["a", "b", "c", "d", "e"].map((x) => ({ trabalhoId: `g-${x}`, titulo: x })), t0 + 2 * MIN);
    const { e, c } = cenario([daPessoa("p1", t0), tres, cinco]);
    const planos = planejarLinhas(c.mensagens, e);
    const html = (planos.get("l3") as { html: string }).html;
    expect(html).toContain('<div class="linha-centro-wrap"><div class="linha-centro linha-task linha-frentes estatica">');
    expect(html).toContain("<span>Começou 3 frentes:</span>");
    expect(html.match(/<span class="ponto-trabalho c-red"><\/span>/g)).toHaveLength(3);
    expect(html).toMatch(/Login<\/button><span class="linha-sep">, <\/span><button[^>]*>CI<\/button><span class="linha-sep"> e <\/span><button[^>]*>Notas<\/button>/);
    expect(html).toContain('<span class="linha-hora">· 09:01</span>');
    // Sem caixas de botão embaixo da linha: os títulos são o atalho.
    expect(html).not.toContain("linha-acoes");
    // Acima de três frentes, três pontos (a contagem está no texto).
    expect((planos.get("l5") as { html: string }).html.match(/class="ponto-trabalho c-red"/g)).toHaveLength(3);
  });

  it("ADR-099 (parte 5, quadro 02): \"✓ 3 frentes terminaram · hora\" centralizada; com uma frente, a linha abre a tela dela; parou/falhou dizem", () => {
    const fim = (id: string, frentes: { trabalhoId: string; titulo: string; estado: "terminado" | "parado" | "falhou" }[], criadoEm: number) =>
      msg(id, criadoEm, { kind: "sistema", texto: "3 frentes terminaram", turnoId: "tv", payload: { kind: "frentes_terminadas", loteId: `l-${id}`, frentes } });
    const todas = fim("ft", [{ trabalhoId: "f-a", titulo: "Login", estado: "terminado" }, { trabalhoId: "f-b", titulo: "CI", estado: "terminado" }, { trabalhoId: "f-c", titulo: "Notas", estado: "terminado" }], t0 + 55 * MIN);
    const uma = fim("f1", [{ trabalhoId: "f-d", titulo: "Deploy", estado: "terminado" }], t0 + 56 * MIN);
    const mista = fim("fm", [{ trabalhoId: "f-e", titulo: "A", estado: "terminado" }, { trabalhoId: "f-f", titulo: "B", estado: "falhou" }], t0 + 57 * MIN);
    const { e, c } = cenario([daPessoa("p1", t0), todas, uma, mista]);
    const planos = planejarLinhas(c.mensagens, e);
    const html = (id: string) => (planos.get(id) as { html: string }).html;
    expect(html("ft")).toContain('<span class="linha-ok" aria-hidden="true">✓</span><span>3 frentes terminaram · 09:55</span>');
    expect(html("ft")).toContain("linha-centro estatica");
    expect(html("f1")).toContain('data-trabalho="f-d"');
    expect(html("f1")).toContain("<b>Deploy</b><span>terminou · 09:56</span>");
    expect(html("fm")).toContain('<span class="linha-falhou" aria-hidden="true">!</span><span>2 frentes voltaram · 1 falhou · 09:57</span>');
    // Nada disso é a mensagem de sistema comum (a caixa cinza à esquerda).
    for (const b of itens(c, e)) expect(b.html).not.toContain("msg-sistema");
  });

  it("ADR-099 (decisão 7): o pedido de colega respondido vira \"↩ Respondi ao pedido de X · hora\", centralizada (o nome vem escapado)", () => {
    const resp = msg("pr", t0 + 20 * MIN, { kind: "sistema", texto: "Respondi ao pedido de Chico", confianca: "nao_confiavel", payload: { kind: "pedido_respondido", loteId: "l9", agenteId: "chico", nome: "Chico" } });
    const estranho = msg("px", t0 + 21 * MIN, { kind: "sistema", texto: "Respondi ao pedido de <b>", confianca: "nao_confiavel", payload: { kind: "pedido_respondido", loteId: "l8", agenteId: "fora", nome: "<b>x</b>" } });
    const { e, c } = cenario([daPessoa("p1", t0), resp, estranho]);
    const planos = planejarLinhas(c.mensagens, e);
    const html = (planos.get("pr") as { html: string }).html;
    expect(html).toContain('<div class="linha-centro-wrap"><span class="linha-centro estatica linha-respondido">');
    expect(html).toContain("<span>Respondi ao pedido de</span>");
    expect(html).toContain('<span class="linha-nome">Chico</span><span class="linha-hora">· 09:20</span>');
    expect((planos.get("px") as { html: string }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("\"Virou a frente\" (a rede de 2 min) também é linha centralizada que abre a frente", () => {
    const virou = msg("vf", t0 + MIN, { kind: "sistema", texto: "Virou a frente Relatório", turnoId: "tc", origemTurno: "conversa", payload: { kind: "trabalho_aberto", trabalhoId: "f-r", titulo: "Relatório", origem: "rede" } });
    const { e, c } = cenario([daPessoa("p1", t0), virou]);
    const html = (planejarLinhas(c.mensagens, e).get("vf") as { html: string }).html;
    expect(html).toContain("<span>Virou a frente</span><b>Relatório</b>");
    expect(html).toContain('<div class="linha-centro-wrap"><button type="button" class="linha-centro linha-task"');
  });

  it("o recado a uma frente é uma linha que abre a frente", () => {
    const copia = msg("rc", t0 + MIN, { kind: "sistema", texto: "Recado para a frente Login: teste no iPhone", confianca: "nao_confiavel", turnoId: "tc", origemTurno: "conversa", payload: { kind: "recado_a_frente", trabalhoId: "f-a", titulo: "Login" } });
    const { e, c } = cenario([daPessoa("p1", t0), copia]);
    const html = (planejarLinhas(c.mensagens, e).get("rc") as { html: string }).html;
    expect(html).toContain("Repassou um recado à frente");
    expect(html).toContain('data-trabalho="f-a"');
  });
});

describe("ADR-099 (I7 revista): a rotina e o pedido de colega sem trabalho seguem agrupados pela raiz do turno", () => {
  // A execução é um turno do dono sem trabalho ("tr"); o retorno das frentes é uma retomada dele ("tv", raiz "tr").
  const daTriagem = (criadoEm: number): Mensagem[] => [
    msg("ra", criadoEm, { turnoId: "tr", origemTurno: "rotina", fimDoTurno: true, texto: "Abri uma frente para o PR 7." }),
    msg("rf", criadoEm, { kind: "sistema", texto: "Começou a frente PR 7", turnoId: "tr", origemTurno: "rotina", payload: { kind: "frentes_abertas", loteId: "l1", origem: "rotina", frentes: [{ trabalhoId: "f-7", titulo: "PR 7" }] } }),
  ];
  const doRetorno = (criadoEm: number): Mensagem[] => [
    msg("rx", criadoEm, { turnoId: "tr", origemTurno: "rotina", kind: "rotina_execucao", texto: "Rotina executou em …", payload: { kind: "rotina_execucao", rotinaId: "rot-prs", instanteAgendado: criadoEm, desfecho: "executou" } }),
    msg("rv", criadoEm, { turnoId: "tv", origemTurno: "retomada", raiz: { turnoId: "tr", origem: "rotina" }, fimDoTurno: true, texto: "O PR 7 tem dois comentários seus para responder." }),
  ];

  it("enquanto as frentes rodam: a fala do dono some, fica a linha \"Começou a frente\" e nada de \"nada para você\"", () => {
    const { e, c } = cenario([daPessoa("p1", t0), ...daTriagem(t0 + MIN)]);
    const tudo = itens(c, e).map((b) => b.html).join("");
    expect(tudo).not.toContain("Abri uma frente para o PR 7.");
    expect(tudo).toContain("Começou a frente");
    expect(tudo).not.toContain("nada para você");
  });

  it("no retorno: o resultado da retomada vira o balão \"da rotina\"; o \"comecei\" do dono não", () => {
    const { e, c } = cenario([daPessoa("p1", t0), ...daTriagem(t0 + MIN), ...doRetorno(t0 + 30 * MIN)]);
    const daRotina = itens(c, e).filter((b) => ehBalao(b.html) && b.html.includes('<span class="etiqueta-origem">da rotina'));
    expect(daRotina).toHaveLength(1);
    expect(daRotina[0]!.html).toContain("O PR 7 tem dois comentários seus para responder.");
    const tudo = itens(c, e).map((b) => b.html).join("");
    expect(tudo).not.toContain("Abri uma frente para o PR 7.");
    expect(tudo).not.toContain("Rotina executou");
  });

  it("o pedido de colega sem trabalho e a retomada dele viram a mesma linha \"Pedido do Chico\"", () => {
    const pedido = [
      msg("k1", t0 + MIN, { autoria: { ...autoriaBot("chico"), sob_procuracao_de: "p" }, turnoId: "tk", origemTurno: "delegacao", payload: { kind: "peer_pedido", conversaOrigemId: "c-chico", turnoOrigemId: "t-chico" }, texto: "Clarice, revisa o #505" }),
      msg("k2", t0 + 2 * MIN, { turnoId: "tk", origemTurno: "delegacao", fimDoTurno: true, texto: "Pedi acesso ao GitHub" }),
      msg("k3", t0 + 9 * MIN, { turnoId: "tk2", origemTurno: "retomada", raiz: { turnoId: "tk", origem: "delegacao" }, fimDoTurno: true, texto: "Revisado: dois ajustes" }),
    ];
    const { e, c } = cenario([daPessoa("p1", t0), ...pedido]);
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "linha:k1"]);
    expect(blocos[1]!.html).toMatch(/Pedido do<\/span>.*Chico<\/span><span>· 3 mensagens<\/span>/);
  });
});

/**
 * Chat limpo, PR 2 (ADR-114): o servidor manda o destino de cada mensagem da conversa própria. O que é `atividade` some, o
 * `anexo` não vira linha mas continua dando título e origem, e a mensagem sem destino (sala, servidor de antes) segue o
 * desenho de antes.
 */
describe("chat limpo com destino (ADR-114, PR 2)", () => {
  const destino = (m: Mensagem, d: NonNullable<Mensagem["destino"]>): Mensagem => ({ ...m, destino: d });
  const comDestino = (ms: Mensagem[]): Mensagem[] => ms.map((m) => (m.destino ? m : destino(m, "chat")));
  const sistema = (id: string, criadoEm: number, texto: string, extra: Partial<Mensagem> = {}): Mensagem => msg(id, criadoEm, { kind: "sistema", texto, ...extra });
  const html = (c: ConversaEstado, e: Estado): string => itens(c, e).map((b) => b.html).join("");

  it("avisos de Atividade somem; o que fica no chat continua; nada de 'N avisos do sistema · ver'", () => {
    const ms = comDestino([
      daPessoa("p1", t0), doBot("b1", t0 + MIN, "t1"),
      destino(sistema("s1", t0 + 2 * MIN, "Anotei uma preferência: em reais"), "atividade"),
      destino(msg("n1", t0 + 3 * MIN, { kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } }), "atividade"),
      destino(sistema("s2", t0 + 4 * MIN, "Conversa compactada. Clarice continua daqui, com o resumo."), "atividade"),
      sistema("o1", t0 + 5 * MIN, "Tirei este pedido da fila: nada foi feito com ele; se ainda precisar, peça de novo."),
      sistema("o2", t0 + 6 * MIN, "Rotina pausada: todo dia às 9h"),
      sistema("o3", t0 + 7 * MIN, "Esta mensagem não rodou."),
    ]);
    const { e, c } = cenario(ms);
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "b1", "o1", "o2", "o3"]);
    expect(html(c, e)).not.toContain("avisos do sistema");
    expect(html(c, e)).not.toContain("Anotei");
    expect(html(c, e)).not.toContain("Bash negada");
  });

  it("aba antiga / servidor sem destino: o desenho de antes, com o recolhimento dos avisos", () => {
    const ms = [daPessoa("p1", t0), sistema("s1", t0 + MIN, "Anotei uma preferência: em reais"), sistema("s2", t0 + 2 * MIN, "aviso 2"), sistema("s3", t0 + 3 * MIN, "aviso 3")];
    const { e, c } = cenario(ms);
    expect(html(c, e)).toContain("3 avisos do sistema · ver");
  });

  it("o anexo não vira linha: sem 'Abriu a task', sem 'terminou · 39 min', e o balão do resultado leva o título da task", () => {
    const ms = comDestino([
      daPessoa("p1", t0), doBot("b1", t0 + MIN, "tc"),
      destino(sistema("a-tb-1", t0 + MIN, "Abriu a task Migrar relatórios", { payload: { kind: "trabalho_aberto", trabalhoId: "tb-1", titulo: "Migrar relatórios", origem: "pessoa" }, turnoId: "tc", origemTurno: "conversa" }), "anexo"),
      msg("m1", t0 + 2 * MIN, { turnoId: "tt", origemTurno: "conversa", trabalhoId: "tb-1", texto: "Convertendo o lote 1" }),
      msg("m2", t0 + 40 * MIN, { turnoId: "tt", origemTurno: "conversa", trabalhoId: "tb-1", fimDoTurno: true, texto: "Migração pronta: 33 relatórios" }),
      destino(sistema("r1", t0 + 41 * MIN, "Respondi ao pedido de Chico", { payload: { kind: "pedido_respondido", loteId: "l", agenteId: "chico", nome: "Chico" } }), "anexo"),
      destino(sistema("f1", t0 + 42 * MIN, "3 frentes terminaram", { payload: { kind: "frentes_terminadas", loteId: "l2", frentes: [{ trabalhoId: "x", titulo: "X", estado: "terminado" }, { trabalhoId: "y", titulo: "Y", estado: "terminado" }] } }), "anexo"),
    ]);
    // O trabalho já saiu da lista: o título vem só do anexo.
    const t = trabalho("tb-1", { titulo: "Migrar relatórios", estado: "terminado", terminadoEm: t0 + 39 * MIN, custoUsd: 0.88 });
    const { e, c } = cenario(ms, { trabalhos: { trabalhos: [t], pressao: null, memoriaTotalMb: null } });
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "b1", "m2"]);
    expect(blocos[2]!.html).toContain('<span class="etiqueta-origem">da task Migrar relatórios</span>');
    const tudo = html(c, e);
    expect(tudo).not.toContain("Abriu a task");
    expect(tudo).not.toContain("terminou ·");
    expect(tudo).not.toContain("Respondi ao pedido");
    expect(tudo).not.toContain("frentes terminaram");
    const semLista = cenario(ms);
    expect(itens(semLista.c, semLista.e).find((b) => b.chave === "m2")?.html).toContain("da task Migrar relatórios");
  });

  it("a rotina que abriu frentes não vira resultado antes da hora: o 'comecei…' segue escondido com o anexo", () => {
    const ms = comDestino([
      msg("r1", t0, { turnoId: "tr", origemTurno: "rotina", fimDoTurno: true, texto: "Comecei 2 frentes" }),
      destino(sistema("fa", t0 + 1, "Começou 2 frentes", { turnoId: "tr", origemTurno: "rotina", payload: { kind: "frentes_abertas", loteId: "l", origem: "rotina", frentes: [{ trabalhoId: "f1", titulo: "A" }, { trabalhoId: "f2", titulo: "B" }] } }), "anexo"),
    ]);
    const { e, c } = cenario(ms);
    const tudo = html(c, e);
    expect(tudo).not.toContain("Comecei 2 frentes");
    expect(tudo).not.toContain("Começou 2 frentes");
  });

  it("a sala não tem destino e segue como antes", () => {
    const ms = [daPessoa("p1", t0), sistema("s1", t0 + MIN, "Anotei")];
    const { e, c } = cenario(ms, {}, { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "sala", agenteId: null, salaId: "s", sessaoCli: null, criadoEm: 1 } as never });
    expect(html(c, e)).toContain("Anotei");
  });

  it("destino que muda com o tempo: o limite que passou, a troca decidida e o computador que voltou saem; enquanto pedem ação, ficam", () => {
    const limite = (id: string, voltaEm: number) => sistema(id, t0, "Claude no limite", { payload: { kind: "limite_do_plano", harness: "claude-cli", voltaEm } });
    const ms = comDestino([
      daPessoa("p1", t0 - MIN),
      limite("lim-passou", AGORA - MIN), limite("lim-vale", AGORA + 60 * MIN),
      sistema("fora", t0 + MIN, "Computador fora do ar", { payload: { kind: "computador_fora_do_ar", agenteId: "clarice", desde: t0, motivo: "boot_falhou" } as never }),
    ]);
    const voltou = cenario(ms);
    const chaves = itens(voltou.c, voltou.e).map((b) => b.chave);
    expect(chaves).toContain("lim-vale");
    expect(chaves).not.toContain("lim-passou");
    expect(chaves).not.toContain("fora");
    const aindaFora = cenario(ms, { frota: { agentes: [{ id: "clarice", nome: "Clarice", conversaId: C, cor: "c-red", forma: "shape-circle", computadorForaDoAr: { desde: t0, motivo: "boot_falhou" } }] } as never });
    expect(itens(aindaFora.c, aindaFora.e).map((b) => b.chave)).toContain("fora");
  });

  it("planejarLinhas marca oculta o que é Atividade e deixa sem plano o que é chat", () => {
    const ms = comDestino([doBot("b1", t0, "t1"), destino(sistema("s1", t0 + MIN, "Anotei"), "atividade")]);
    const { e } = cenario(ms);
    const planos = planejarLinhas(ms, e);
    expect(planos.get("s1")).toEqual({ tipo: "oculta" });
    expect(planos.has("b1")).toBe(false);
  });

  /**
   * Revisão do PR 2 (18/10): a linha "Rotina executou" é o que diz à web que a execução TEVE algo para a pessoa — a
   * silenciosa (sem_novidade) não grava linha nenhuma. Ela vem na janela como `anexo`: some do chat, e o resultado continua
   * no balão "da rotina …". Sem ela na janela, o resultado virava "rodou 1 vez · nada para você".
   */
  it("a rotina que executou com novidade: o resultado fica no balão 'da rotina'; o marcador (anexo) não vira linha", () => {
    const [meio, marcador, fim] = execucaoComNovidade(t0);
    const ms = comDestino([daPessoa("p1", t0 - MIN), meio!, destino(marcador!, "anexo"), fim!]);
    const { e, c } = cenario(ms);
    const blocos = itens(c, e);
    expect(blocos.map((b) => b.chave)).toEqual(["p1", "r6c"]);
    expect(blocos[1]!.html).toContain("A Gabriela marcou você no #suporte");
    expect(blocos[1]!.html).toContain('<span class="etiqueta-origem">da rotina');
    expect(html(c, e)).not.toContain("nada para você");
    expect(html(c, e)).not.toContain("Rotina executou");
  });
});
