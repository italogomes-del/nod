import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { abertasPorAgente, perguntasPorAgente, renderChamada, selosDoAgente, SUBTITULO_ESPERANDO } from "../../../web/telas/sua-vez.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";

/**
 * O rail saiu em 2026-09-18 (main.ts). Estes testes travam o que tomou o lugar dele: o sinal de
 * decisão na sidebar e o painel do bot. Sem eles, remover a entrada "Sua vez" apagaria o aviso, e
 * "Rotinas"/"Marketplace" sumiriam sem destino.
 */
const decisao = (id: string, agenteId: string, agenteNome: string, vencido = false, gemeas: string[] = []): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId, conversaId: `c-${agenteId}`, turnoId: null, tipo: "acesso", estado: vencido ? "vencida" : "pendente", prazoDecisaoEm: "2026-09-18T00:00:00Z", prazoExecucaoEm: null, frase: `Ler Slack ${id}`, desfecho: null, vistaEm: null, criadoEm: "2026-09-18T00:00:00Z" },
  estadoColuna: vencido ? "vencido" : "pendente",
  agenteNome,
  aguardandoHaMs: 0,
  recusaAutomaticaEmMs: 60_000,
  gemeas,
  itensAprovacao: [],
  proposta: null,
});

const comFila = (itens: SuaVezDto["itens"], incidentes: SuaVezDto["incidentes"] = []): Estado => ({ ...estadoInicial, suaVez: { itens, incidentes, foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null } });

describe("o sinal que substituiu a entrada \"Sua vez\" do rail", () => {
  it("conta só as decisões abertas por agente — vencida não pede ação e não vira badge", () => {
    const estado = comFila([decisao("d1", "a1", "Vera"), decisao("d2", "a1", "Vera"), decisao("d3", "a2", "Tuca", true)]);
    const por = abertasPorAgente(estado);
    expect(por.get("a1")).toBe(2);
    expect(por.get("a2")).toBeUndefined();
  });

  it("⚑ e faixa contam GRUPOS: um ×3 é uma decisão a tomar; aviso de queda do Mac não é decisão e não conta (definido em 2026-09-24)", () => {
    const queda: SuaVezDto["incidentes"][number] = { id: "i1", tipo: "mac_sem_contato", comecouEm: 0, voltouEm: 60_000, rotinas: 3, conversas: 1, agentes: ["Vera"] };
    const estado = comFila([decisao("d1", "a1", "Vera", false, ["d1b", "d1c"]), decisao("d2", "a2", "Tuca")], [queda]);
    expect(abertasPorAgente(estado).get("a1")).toBe(1);
    expect(abertasPorAgente(estado).get("a2")).toBe(1);
    expect(renderChamada(estado)).toContain("<b>2 pedidos</b> esperando por você");
    const umSo = comFila([decisao("d1", "a1", "Vera", false, ["d1b", "d1c"])], [queda]);
    expect(renderChamada(umSo)).toContain("precisa de você");
    expect(renderChamada(umSo)).not.toContain("pedidos");
  });

  it("pergunta aberta conta como PEDIDO na faixa, mas tem selo azul de balão próprio, separado do ⚑ (emenda da ADR-045)", () => {
    const pergunta = (id: string, agenteId: string, nome: string, vencido = false): SuaVezDto["itens"][number] => {
      const d = decisao(id, agenteId, nome, vencido);
      return { ...d, decisao: { ...d.decisao, tipo: "pergunta" } };
    };
    const estado = comFila([decisao("d1", "a1", "Vera"), pergunta("p1", "a1", "Vera"), pergunta("p2", "a1", "Vera"), pergunta("p3", "a2", "Tuca"), pergunta("p4", "a3", "Nina", true)]);
    // ⚑ só decisão; balão só pergunta; vencida não conta em nenhum.
    expect(abertasPorAgente(estado).get("a1")).toBe(1);
    expect(abertasPorAgente(estado).get("a2")).toBeUndefined();
    expect(perguntasPorAgente(estado).get("a1")).toBe(2);
    expect(perguntasPorAgente(estado).get("a2")).toBe(1);
    expect(perguntasPorAgente(estado).get("a3")).toBeUndefined();
    // A faixa do topo conta decisões E perguntas: as duas esperam pela pessoa.
    expect(renderChamada(estado)).toContain("<b>4 pedidos</b> esperando por você");

    const selos = selosDoAgente(1, 2);
    expect(selos).toContain('<span class="ch-badge" title="uma decisão esperando você">⚑</span>');
    expect(selos).toContain('class="ch-badge ch-pergunta" title="2 perguntas esperando sua resposta"');
    expect(selos).toContain("</svg>2</span>");
    const soPergunta = selosDoAgente(0, 1);
    expect(soPergunta).not.toContain("⚑");
    expect(soPergunta).toContain("uma pergunta esperando sua resposta");
    expect(soPergunta).toContain("</svg>1</span>");
    expect(selosDoAgente(0, 0)).toBe("");
    expect(SUBTITULO_ESPERANDO).toBe('<span class="sub-esperando">esperando sua resposta</span>');
  });

  it("a faixa nomeia o agente quando é uma só e leva à conversa dela", () => {
    const html = renderChamada(comFila([decisao("d1", "a1", "Vera")]));
    expect(html).toContain("Vera");
    expect(html).toContain("precisa de você");
    expect(html).toContain('data-act="abrir-conversa"');
    expect(html).toContain('data-conversa="c-a1"');
    // Com uma só, "ver todas" seria um desvio inútil: a conversa já resolve.
    expect(html).not.toContain("ver todas");
  });

  it("com várias, conta e oferece a fila completa, abrindo a mais antiga", () => {
    const html = renderChamada(comFila([decisao("d1", "a1", "Vera"), decisao("d2", "a2", "Tuca")]));
    expect(html).toContain("2 pedidos");
    expect(html).toContain('data-conversa="c-a1"');
    expect(html).toContain("ver todos");
    expect(html).toContain('data-tela="sua-vez"');
  });

  it("some quando não há nada aberto — inclusive com a fila só de vencidas", () => {
    expect(renderChamada(comFila([]))).toBe("");
    expect(renderChamada(comFila([decisao("d1", "a1", "Vera", true)]))).toBe("");
    expect(renderChamada(estadoInicial)).toBe("");
  });
});

describe("o painel do bot, destino de Rotinas e Marketplace", () => {
  const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Vera", titulo: "Jurídica", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;
  const base: Estado = {
    ...estadoInicial,
    tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" },
    frota: { agentes: [agente], negacoes: [] } as never,
  };

  it("traz rotinas com controle real, sem exigir a tela cheia", () => {
    const estado: Estado = {
      ...base,
      rotinas: [{ rotina: { id: "r1", agenteId: "a1", conversaId: "c1", instrucao: "Resumo dos PRs", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", estado: "ativa", exigeAprovacao: true, fonte: "", entregavel: "", limitesAprovacao: "", politicaSemDado: "" }, proximaExecucao: 10_000 } as never],
      agora: 0,
    };
    const html = renderDetalhes(estado);
    expect(html).toContain("Resumo dos PRs");
    expect(html).toContain('data-act="pausar-rotina"');
    expect(html).toContain('data-act="executar-rotina"');
  });

  it("escreve o acesso concedido com o nome do conector e deixa revogar ali mesmo", () => {
    const estado: Estado = {
      ...base,
      conectores: [{ id: "k1", nome: "GitHub", slug: "github", catalogo: [], habilitado: true, transporte: "http", env: {}, args: [], declaracao: "nao-toca", ultimaFalha: null, sondadoEm: null } as never],
      concessoes: { a1: [{ id: "g1", agenteId: "a1", conectorId: "k1", capacidade: "ler_issues" } as never] },
    };
    const html = renderDetalhes(estado);
    expect(html).toContain("GitHub");
    expect(html).toContain("ler_issues");
    expect(html).toContain('data-act="revogar-acessos"');
    expect(html).toContain('data-ids="g1"');
    // Sem a sonda dizer que é leitura, o painel não promete "só leitura".
    expect(html).toContain("pode alterar · 1 ação");
  });

  it("ADR-044: agrupa por app e nível — 'Gmail · só leitura · N ações' — com os nomes técnicos só no <details>", () => {
    const catalogo = [
      { nome: "GMAIL_FETCH_EMAILS", readOnlyHint: true },
      { nome: "GMAIL_LIST_LABELS", readOnlyHint: true },
      { nome: "GMAIL_SEND_EMAIL", readOnlyHint: false },
    ];
    const estado: Estado = {
      ...base,
      conectores: [{ id: "k1", nome: "Gmail", slug: "gmail", catalogo, habilitado: true, transporte: "http", env: {}, args: [], declaracao: "nao-toca", ultimaFalha: null, sondadoEm: null } as never],
      concessoes: { a1: [
        { id: "g1", agenteId: "a1", conectorId: "k1", capacidade: "GMAIL_FETCH_EMAILS" } as never,
        { id: "g2", agenteId: "a1", conectorId: "k1", capacidade: "GMAIL_LIST_LABELS" } as never,
        { id: "g3", agenteId: "a1", conectorId: "k1", capacidade: "GMAIL_SEND_EMAIL" } as never,
      ] },
    };
    const html = renderDetalhes(estado);
    expect(html.match(/class="acesso"/g)).toHaveLength(2);
    expect(html).toContain("só leitura · 2 ações");
    expect(html).toContain("pode alterar · 1 ação");
    expect(html).toContain('data-ids="g1,g2"');
    expect(html).toContain('data-ids="g3"');
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
    expect(html).not.toContain('data-act="revogar"');
  });

  it("sem acessos, convida a conectar em vez de deixar a seção muda", () => {
    const html = renderDetalhes(base);
    expect(html).toContain("ainda não usa nenhuma ferramenta externa");
    expect(html).toContain('data-act="abrir-conexao"');
  });
});
