import { describe, expect, it } from "vitest";
import type { AcaoNoLote, PayloadPropostaLoteBots } from "../../../src/contracts/conversa.ts";
import type { Relato } from "../../../src/contracts/relato.ts";
import { listaDoLoteParaSuaVez, renderCardLote } from "../../../web/telas/card-lote.ts";
import { renderRelatos } from "../../../web/telas/relatos.ts";
import { CONFIG_UI_INICIAL } from "../../../web/estado/reducer.ts";

/** O card do lote do Nod (ADR-082) e a tela Relatos com tipo e origem (0062). */
const acao = (i: number, p: Partial<AcaoNoLote>): AcaoNoLote => ({ i, tipo: "criar", estado: "esperando", motivo: "manual", alvoNome: "Bot", botId: null, alvoDaAcao: null, ...p });

describe("card do lote do Nod", () => {
  const lote: PayloadPropostaLoteBots = {
    kind: "lote_bots",
    resumo: "Duplicar e criar em Engenharia",
    acoes: [
      acao(0, { tipo: "duplicar", alvoNome: "Dev 1", estado: "feita", motivo: null, botId: "b9" }),
      acao(1, { tipo: "criar", alvoNome: "Revisor de PR", secao: "Engenharia", descricao: "Revisa os PRs." }),
      acao(2, { tipo: "excluir", alvoNome: "Dev antigo", motivo: "arriscada" }),
      acao(3, { tipo: "dar_acesso", alvoNome: "Revisor de PR", app: "github", nivel: "escrita", motivo: "conteudo_de_fora" }),
    ],
  };

  it("aberto: uma caixa marcada por ação que espera, o motivo do arriscado e do conteúdo de fora, 'feito' na que o modo fez, e os botões", () => {
    const h = renderCardLote({ id: "p1" }, lote, true);
    // NOD-399: sem "O Nod propõe"; o resumo do Nod é o título.
    expect(h).not.toContain("propõe");
    // Revisão 3 do PR #607: o título tem o verbo; o resumo do Nod vira a linha.
    expect(h).toContain("<span>Aplicar 3 mudanças nos seus bots</span>");
    expect(h).toContain("<li>Duplicar e criar em Engenharia</li>");
    // Revisão 4: as 3 que esperam ficam à vista (o "feito" vai para "Mais 1"), com o motivo do dar_acesso.
    const [vista] = h.split('<details class="cp-detalhes lote-mais"');
    expect(vista?.match(/data-lote-i="/g)).toHaveLength(3);
    expect(vista).toContain("O Nod leu conteúdo de fora nesta conversa, então dar acesso");
    expect(h).toMatch(/<summary>Mais 1<\/summary><div class="lote-acoes"><label class="lote-acao"><span class="lote-texto"><span><i class="lote-verbo">Duplicar/);
    expect(h.match(/data-lote-i="/g)).toHaveLength(3);
    expect(h).not.toContain('data-lote-i="0"');
    expect(h).toContain('<span class="tag tag-ok">feito</span>');
    expect(h).toContain("em Engenharia · Revisa os PRs.");
    expect(h).toContain("Excluir é arriscado: o Nod sempre pergunta antes.");
    expect(h).toContain("O Nod leu conteúdo de fora nesta conversa");
    expect(h).toContain("github, ler e alterar");
    expect(h).toContain('data-act="decidir-lote"');
    expect(h).toContain('data-act="recusar-decisao"');
  });

  it("revisão 3/4 do PR #607: o que espera nunca fica recolhido; só o que já tem desfecho vai para 'Mais N'", () => {
    const feitas = [0, 1, 2].map((i) => acao(i, { alvoNome: `Feito ${i}`, estado: "feita", motivo: null }));
    const esperam = [3, 4, 5, 6].map((i) => acao(i, { tipo: i === 6 ? "excluir" : "criar", alvoNome: `Bot ${i}`, motivo: i === 6 ? "arriscada" : "manual" }));
    const h = renderCardLote({ id: "p9" }, { kind: "lote_bots", resumo: "", acoes: [...feitas, ...esperam] }, true);
    const [vista, mais] = h.split('<details class="cp-detalhes lote-mais" data-disclosure="lote-p9"><summary>Mais 3</summary>');
    expect(vista?.match(/data-lote-i="\d" checked/g)).toHaveLength(4);
    expect(vista).toContain("Excluir é arriscado");
    expect(mais).not.toContain("data-lote-i");
    expect(mais?.match(/tag-ok">feito/g)).toHaveLength(3);
    expect(h).not.toContain("<details open");
    // decidido: nada espera, até 3 à vista e o resto recolhido
    const d = renderCardLote({ id: "p9" }, { kind: "lote_bots", resumo: "", acoes: [...feitas, ...esperam.map((a) => ({ ...a, estado: "recusada" as const }))] }, false);
    expect(d).toContain("<summary>Mais 4</summary>");
  });

  it("NOD-289: o duplicar diz que as rotinas da cópia vêm pausadas", () => {
    const h = renderCardLote({ id: "p3" }, { kind: "lote_bots", resumo: "Duplicar", acoes: [acao(0, { tipo: "duplicar", alvoNome: "Dev 1" })] }, true);
    expect(h).toContain("leva memória, acessos e rotinas do original; as rotinas vêm pausadas");
    // NOD-316: a cópia não herda o modo do original.
    expect(h).toContain("começa em Aprovar automaticamente; mude em Aprovações");
  });

  it("2026-10-18: ligar o total pelo Nod diz que só liga com o ok da pessoa", () => {
    const h = renderCardLote({ id: "p2" }, { kind: "lote_bots", resumo: "Dev 1 sem aprovações", acoes: [acao(0, { tipo: "mudar_modo", alvoNome: "Dev 1", modo: "total", motivo: "ligar_total", botId: "b1" })] }, true);
    expect(h).toContain("para sem aprovações");
    expect(h).toContain("Ignorar todas as aprovações só liga com o seu ok: o Nod nunca põe um bot nesse modo sozinho.");
  });

  it("Sua vez lista só as que esperam, antes do botão que aprova todas", () => {
    const h = listaDoLoteParaSuaVez(lote);
    expect(h.match(/<li>/g)).toHaveLength(3);
    expect(h).toContain("Excluir</i>Dev antigo");
    expect(h).not.toContain("Dev 1");
  });

  it("decidido: sem caixas nem botões; cada ação com o desfecho", () => {
    const decidido: PayloadPropostaLoteBots = { ...lote, acoes: [lote.acoes[0]!, { ...lote.acoes[1]!, estado: "feita" }, { ...lote.acoes[2]!, estado: "recusada" }, { ...lote.acoes[3]!, estado: "falhou", erro: "depende_de_acao_recusada" }] };
    const h = renderCardLote({ id: "p1" }, decidido, false);
    expect(h).toContain("Mudanças nos seus bots");
    expect(h).not.toContain("data-lote-i");
    expect(h).not.toContain('data-act="decidir-lote"');
    expect(h).toContain("não feito");
    expect(h).toContain("não deu certo (depende de acao recusada)");
  });
});

describe("Relatos com tipo e origem (0062)", () => {
  const base = { tenantId: "t", conversaId: "c", turnoId: null, alcance: "janela" as const, mensagensAnexadas: 3, diagnostico: null, criadoEm: 0, metadados: { estadoTurno: null, origemTurno: null, sinais: null, motivoFalha: null, motivoInterrupcao: null, modelo: null, harness: null, executor: null, machineId: null, custoUsd: null, reenvios: null, confiancaMensagem: "confiavel" as const, mensagemParcial: false, versaoApp: null, correlationId: null } };
  const relatos: Relato[] = [
    { ...base, id: "r1", mensagemId: null, tipo: "bug", origem: "nod", categoria: "interface", titulo: "Anexar não abre no Safari", resumo: "Tocar no clipe não faz nada." },
    { ...base, id: "r2", mensagemId: null, tipo: "melhoria", origem: "nod", categoria: "outro", titulo: "Arrastar bot entre seções", resumo: null },
    { ...base, id: "r3", mensagemId: "m1", tipo: "bug", origem: "botao", categoria: "resposta_errada", alcance: "mensagem", mensagensAnexadas: 1 },
  ];

  it("filtros só dos tipos presentes, o título do Nod e a origem; o do botão segue com a categoria", () => {
    const h = renderRelatos({ relatos, configUi: CONFIG_UI_INICIAL });
    expect(h).toContain("Todos · 3");
    expect(h).toContain("Bugs · 2");
    expect(h).toContain("Melhorias · 1");
    expect(h).not.toContain("Dúvidas ·");
    expect(h).toContain("<b>Anexar não abre no Safari</b>");
    expect(h).toContain("conversa com o Nod");
    expect(h).toContain("<b>Respondeu errado</b>");
    expect(h).toContain('data-tipo="melhoria"');
    // o texto da pessoa fica no detalhe, que abre embaixo da linha
    const aberto = renderRelatos({ relatos, configUi: { ...CONFIG_UI_INICIAL, abertos: ["relato-r1"] } });
    expect(aberto).toContain("Tocar no clipe não faz nada.");
  });
});
