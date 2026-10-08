import { describe, expect, it } from "vitest";
import type { AcaoNoLote, PayloadPropostaLoteBots } from "../../../src/contracts/conversa.ts";
import type { Relato } from "../../../src/contracts/relato.ts";
import { listaDoLoteParaSuaVez, renderCardLote } from "../../../web/telas/card-lote.ts";
import { renderRelatos } from "../../../web/telas/relatos.ts";

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
    expect(h).toContain("3 mudanças esperam você");
    expect(h).toContain("O Nod propõe · Duplicar e criar em Engenharia");
    expect(h.match(/data-lote-i="/g)).toHaveLength(3);
    expect(h).not.toContain('data-lote-i="0"');
    expect(h).toContain('<span class="tag tag-ok">feito</span>');
    expect(h).toContain("em Engenharia · Revisa os PRs.");
    expect(h).toContain("Excluir e mudar o modo de um bot são arriscados");
    expect(h).toContain("O Nod leu conteúdo de fora nesta conversa");
    expect(h).toContain("github, ler e alterar");
    expect(h).toContain('data-act="decidir-lote"');
    expect(h).toContain('data-act="recusar-decisao"');
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
    const h = renderRelatos({ relatos });
    expect(h).toContain('data-filtro="todos"');
    expect(h).toContain("Todos · 3");
    expect(h).toContain("Bugs · 2");
    expect(h).toContain("Melhorias · 1");
    expect(h).not.toContain("Dúvidas ·");
    expect(h).toContain("<b>Anexar não abre no Safari</b>");
    expect(h).toContain("conversa com o Nod");
    expect(h).toContain("Tocar no clipe não faz nada.");
    expect(h).toContain("<b>Respondeu errado</b>");
    expect(h).toContain('data-tipo="melhoria"');
  });
});
