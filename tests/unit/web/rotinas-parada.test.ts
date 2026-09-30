import { describe, expect, it } from "vitest";
import type { RotinaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { BloqueioRotina } from "../../../src/contracts/rotina.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { rotuloExecucao } from "../../../web/lib/execucao.ts";
import { desdeQuando, listaDeJanelas, quandoCurto } from "../../../web/lib/relogio.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { renderRotinas } from "../../../web/telas/rotinas.ts";
import { renderSuaVez, rotinasParadasPorAgente, SUBTITULO_ROTINA_PARADA } from "../../../web/telas/sua-vez.ts";

/**
 * Emenda da ADR-044, "rotina se trava sozinha": a rotina que o pré-voo parou diz, na lista, no painel,
 * no card e na barra lateral, que está PARADA, por falta de qual app, desde quando e o que não rodou —
 * e oferece o mesmo botão de um clique.
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-24T09:30:00-03:00");
const ONTEM_13 = Date.parse("2026-09-23T13:00:00-03:00");
const ONTEM_18 = Date.parse("2026-09-23T18:00:00-03:00");
const HOJE_8 = Date.parse("2026-09-24T08:00:00-03:00");
const H = 3_600_000;

const bloqueio: BloqueioRotina = { motivo: "sem_acesso", app: "Gmail", slug: "gmail", decisaoId: "d1", rodaNaHora: true, desde: ONTEM_13, naoRodaram: [HOJE_8, ONTEM_18, ONTEM_13], fusoIana: TZ };
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "E-mails às 8h, 13h e 18h", cron: "0 8,13,18 * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA + H, criadoEm: 0, excluidoEm: null, acessos: null } as const;
const dto = (b: BloqueioRotina | null): RotinaDto => ({ rotina: { ...rotina }, proximaExecucao: AGORA + H, bloqueio: b, resumo: `todo dia às 08:00, 13:00, 18:00 (${TZ})` });
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;

describe("relógio: o dia de calendário da rotina", () => {
  it("hoje, ontem e a data — no fuso da rotina, não em UTC", () => {
    expect(quandoCurto(HOJE_8, AGORA, TZ)).toBe("hoje 08:00");
    expect(quandoCurto(ONTEM_13, AGORA, TZ)).toBe("ontem 13:00");
    expect(quandoCurto(Date.parse("2026-09-22T18:00:00-03:00"), AGORA, TZ)).toBe("22/09 18:00");
    // 23:30 em São Paulo já é o dia seguinte em UTC: continua "ontem" para quem lê.
    expect(quandoCurto(Date.parse("2026-09-23T23:30:00-03:00"), AGORA, TZ)).toBe("ontem 23:30");
    expect(desdeQuando(ONTEM_13, AGORA, TZ)).toBe("desde ontem 13:00");
  });

  it("a lista sai em ordem; passou do máximo, conta e dá as pontas", () => {
    expect(listaDeJanelas([HOJE_8, ONTEM_13, ONTEM_18], AGORA, TZ)).toBe("ontem 13:00, ontem 18:00 e hoje 08:00");
    expect(listaDeJanelas([HOJE_8], AGORA, TZ)).toBe("hoje 08:00");
    const muitas = Array.from({ length: 9 }, (_, i) => HOJE_8 - i * 5 * 60_000);
    expect(listaDeJanelas(muitas, AGORA, TZ)).toBe("9 janelas, de hoje 07:20 a hoje 08:00");
  });
});

describe("histórico: a janela parada", () => {
  it("'parada (sem acesso)', 'parada (sem conexão)', 'parada (aguardando resposta)'; os outros desfechos não mudam", () => {
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "sem_acesso" })).toBe("parada (sem acesso)");
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "sem_conexao" })).toBe("parada (sem conexão)");
    expect(rotuloExecucao({ desfecho: "bloqueada", motivo: "aguardando_resposta" })).toBe("parada (aguardando resposta)");
    expect(rotuloExecucao({ desfecho: "passou_em_branco", motivo: "ninguem_respondeu_o_gate" })).toBe("passou em branco");
  });
});

describe("lista de rotinas e painel do bot", () => {
  it("a rotina parada leva a tag âmbar com o app, desde quando, o que não rodou e 'Permitir e rodar agora'", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(bloqueio)], execucoes: { r1: [{ tenantId: "t", id: "e1", rotinaId: "r1", instanteAgendado: HOJE_8, turnoId: null, desfecho: "bloqueada", motivo: "sem_acesso", em: HOJE_8 }] } });
    expect(html).toContain('<span class="tag tag-ambar" title="a rotina não roda até você liberar; nenhuma janela parada gastou crédito">parada · falta acesso ao Gmail</span>');
    expect(html).toContain("Parada desde ontem 13:00.");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain('data-act="decidir-proposta" data-id="d1">Permitir e rodar agora');
    expect(html).toContain("<b>parada (sem acesso)</b>");
    expect(html).not.toContain("· sem_acesso");
  });

  it("sem conexão: a tag diz o que conectar e o botão é o 'Conectar' do app; sem bloqueio, nada disso", () => {
    const html = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ ...bloqueio, motivo: "sem_conexao", decisaoId: null })] });
    expect(html).toContain("parada · falta conectar o Gmail");
    expect(html).toContain('data-act="abrir-conexao" data-id="gmail">Conectar');
    // O card é um por agente e app: sendo de OUTRA rotina do bot, permitir não roda esta na hora.
    const deOutra = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto({ ...bloqueio, rodaNaHora: false })] });
    expect(deOutra).toContain('data-act="decidir-proposta" data-id="d1" title="o pedido é de outra rotina deste bot; esta roda na próxima janela">Permitir acesso');
    expect(deOutra).not.toContain("Permitir e rodar agora");
    const livre = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(null)] });
    expect(livre).not.toContain("parada");
    expect(livre).not.toContain("Permitir e rodar agora");
  });

  it("o painel do bot mostra a mesma tag e o mesmo botão na linha da rotina", () => {
    const html = renderDetalhes({ ...estadoInicial, agora: AGORA, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, frota: { agentes: [agente], negacoes: [] } as never, rotinas: [dto(bloqueio)] });
    expect(html).toContain("parada · falta acesso ao Gmail");
    expect(html).toContain("desde ontem 13:00");
    expect(html).toContain('data-act="decidir-proposta" data-id="d1">Permitir e rodar agora');
  });
});

describe("o card do acesso que a rotina pediu", () => {
  type Item = SuaVezDto["itens"][number];
  const FRASE = "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar.";
  const proposta: Proposta = { tenantId: "t", id: "d1", conversaId: "c1", agenteId: "a1", estado: "pendente", criadoEm: ONTEM_13, kind: "acesso", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], rotinaId: "r1", geracao: 0 } };
  const item = (p: Proposta | null, parada: Item["rotinaParada"], estadoColuna: Item["estadoColuna"] = "pendente"): Item => ({
    decisao: { tenantId: "t", id: "d1", ownerId: "p", decisorId: "p", agenteId: "a1", conversaId: "c1", turnoId: null, tipo: "acesso", estado: estadoColuna === "vencido" ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + 18 * H).toISOString(), prazoExecucaoEm: null, frase: FRASE, desfecho: null, vistaEm: null, criadoEm: new Date(ONTEM_13).toISOString(), fioId: null },
    estadoColuna, agenteNome: "Nina", aguardandoHaMs: 6 * H, recusaAutomaticaEmMs: 18 * H, gemeas: [], itensAprovacao: [], proposta: p, fio: null, rotinaParada: parada,
  });
  const com = (i: Item): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, suaVez: { itens: [i], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });
  const parada = { desde: ONTEM_13, naoRodaram: [HOJE_8, ONTEM_18, ONTEM_13], fusoIana: TZ };

  it("'Sua vez': tag 'rotina parada' + desde, a linha do que não rodou e 'a rotina pausa sozinha em 18h'", () => {
    const html = renderSuaVez(com(item(proposta, parada)));
    expect(html).toContain(">rotina parada</span><span class=\"mudo\">desde ontem 13:00</span>");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain("a rotina pausa sozinha em 18h");
    expect(html).not.toContain("recusa automática");
    expect(html).toContain("Permitir e rodar agora");
  });

  it("pedido da CONVERSA segue com 'recusa automática' e sem tag; o vencido não diz que está parada", () => {
    const daConversa: Proposta = { ...proposta, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], turnoId: "t1" } };
    const html = renderSuaVez(com(item(daConversa, null)));
    expect(html).toContain("recusa automática em 18h");
    expect(html).not.toContain("rotina parada");
    const vencido = renderSuaVez(com(item(proposta, null, "vencido")));
    expect(vencido).not.toContain("rotina parada");
    expect(vencido).not.toContain("Não rodaram");
  });

  it("no chat, o card de um clique leva a mesma tag, o desde e a linha", () => {
    const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [proposta], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
    const html = renderTimeline(conversa, com(item(proposta, parada)));
    expect(html).toMatch(/<div class="ac-titulo">.*?<\/div><span class="tag tag-ambar dec-rotina-parada"/);
    expect(html).toContain("desde ontem 13:00");
    expect(html).toContain("Não rodaram: ontem 13:00, ontem 18:00 e hoje 08:00. Nenhuma tentativa gastou crédito.");
    expect(html).toContain("Permitir e rodar agora");
  });

  it("barra lateral: 'rotina parada' só para o agente com um pedido de rotina ABERTO", () => {
    expect([...rotinasParadasPorAgente(com(item(proposta, parada)))]).toEqual(["a1"]);
    expect(rotinasParadasPorAgente(com(item(proposta, parada, "vencido"))).size).toBe(0);
    expect(rotinasParadasPorAgente(com(item({ ...proposta, payload: { ...proposta.payload, rotinaId: undefined } } as Proposta, null))).size).toBe(0);
    expect(SUBTITULO_ROTINA_PARADA).toBe('<span class="sub-rotina-parada">rotina parada</span>');
  });
});
