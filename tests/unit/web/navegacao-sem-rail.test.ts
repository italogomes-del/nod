import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { abertasPorAgente, perguntasPorAgente, renderChamada, SUBTITULO_ESPERANDO } from "../../../web/telas/sua-vez.ts";
import { nomeLegivel, renderDetalhes } from "../../../web/telas/detalhes.ts";

/**
 * O rail saiu em 2026-09-18 (main.ts). Estes testes travam o que tomou o lugar dele: o sinal de
 * decisão na sidebar e o painel do bot. Sem eles, remover a entrada "Sua vez" apagaria o aviso, e
 * "Rotinas"/"Marketplace" sumiriam sem destino.
 */
const decisao = (id: string, agenteId: string, agenteNome: string, vencido = false, gemeas: string[] = []): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId, conversaId: `c-${agenteId}`, turnoId: null, tipo: "acesso", estado: vencido ? "vencida" : "pendente", prazoDecisaoEm: "2026-09-18T00:00:00Z", prazoExecucaoEm: null, frase: `Ler Slack ${id}`, desfecho: null, vistaEm: null, criadoEm: "2026-09-18T00:00:00Z", fioId: null },
  estadoColuna: vencido ? "vencido" : "pendente",
  agenteNome,
  aguardandoHaMs: 0,
  recusaAutomaticaEmMs: 60_000,
  gemeas,
  itensAprovacao: [],
  proposta: null,
  fio: null,
  rotinaParada: null,
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
    expect(renderChamada(estado)).toContain("2 pedidos esperando por você");
    const umSo = comFila([decisao("d1", "a1", "Vera", false, ["d1b", "d1c"])], [queda]);
    expect(renderChamada(umSo)).toContain("precisa de você");
    expect(renderChamada(umSo)).not.toContain("pedidos");
  });

  it("pergunta aberta conta como PEDIDO no sino e é contada à parte das decisões (emenda da ADR-045)", () => {
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
    expect(renderChamada(estado)).toContain("4 pedidos esperando por você");

    expect(SUBTITULO_ESPERANDO).toBe('<span class="sub-esperando">esperando sua resposta</span>');
  });

  it("o sino nomeia o agente quando é um só e leva à conversa dela", () => {
    const html = renderChamada(comFila([decisao("d1", "a1", "Vera")]));
    expect(html).toContain("Vera");
    expect(html).toContain("precisa de você");
    expect(html).toContain('data-act="abrir-conversa"');
    expect(html).toContain('data-conversa="c-a1"');
    // Com um só, a fila seria um desvio inútil: a conversa já resolve.
    expect(html).not.toContain('data-tela="sua-vez"');
    expect(html).toContain('class="sino-ponto"');
  });

  it("com vários, o sino conta e leva à fila completa", () => {
    const html = renderChamada(comFila([decisao("d1", "a1", "Vera"), decisao("d2", "a2", "Tuca")]));
    expect(html).toContain("2 pedidos");
    expect(html).toContain('<span class="sino-cont" aria-hidden="true">2</span>');
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
    expect(html).toContain("<small>pode alterar</small>");
    expect(html).toContain("1 ação permitida");
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
    expect(html).toContain("<small>só leitura</small>");
    expect(html).toContain("2 ações permitidas");
    expect(html).toContain("Não envia nem altera nada.");
    expect(html).toContain("1 ação permitida");
    expect(html).toContain('data-ids="g1,g2"');
    expect(html).toContain('data-ids="g3"');
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
    expect(html).not.toContain('data-act="revogar"');
  });

  it("cada ação vira uma linha legível; a descrição do catálogo fica só no title (definido em 2026-09-24)", () => {
    expect(nomeLegivel("SLACK_FETCH_MESSAGE_THREAD", "Slack")).toBe("Fetch message thread");
    expect(nomeLegivel("GMAIL_SEND_EMAIL", "Gmail")).toBe("Send email");
    expect(nomeLegivel("ler_issues", "GitHub")).toBe("Ler issues");
    const estado: Estado = {
      ...base,
      conectores: [{ id: "k1", nome: "Slack", slug: "slack", catalogo: [{ nome: "SLACK_WHO_AM_I", descricao: "Return the identity (user + workspace).", readOnlyHint: true }], habilitado: true, transporte: "http", env: {}, args: [], declaracao: "nao-toca", ultimaFalha: null, sondadoEm: null } as never],
      concessoes: { a1: [{ id: "g1", agenteId: "a1", conectorId: "k1", capacidade: "SLACK_WHO_AM_I" } as never] },
    };
    const html = renderDetalhes(estado);
    expect(html).toContain('<li title="Return the identity (user + workspace).">Who am i</li>');
  });

  it("o histórico da rotina abre e fecha; um evento que recarrega a lista não o reabre", () => {
    const rotina = { rotina: { id: "r1", agenteId: "a1", conversaId: "c1", instrucao: "Resumo", cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", estado: "ativa" }, proximaExecucao: 10_000 } as never;
    const fechado: Estado = { ...base, rotinas: [rotina], execucoes: { r1: [] }, agora: 0 };
    expect(renderDetalhes(fechado)).toContain(">Histórico</button>");
    expect(renderDetalhes(fechado)).not.toContain("nunca executou");
    const aberto = reduzir(fechado, { tipo: "alternar-historico", rotinaId: "r1" });
    expect(renderDetalhes(aberto)).toContain(">Ocultar histórico</button>");
    expect(renderDetalhes(aberto)).toContain("nunca executou");
    const fechadoDeNovo = reduzir(reduzir(aberto, { tipo: "alternar-historico", rotinaId: "r1" }), { tipo: "hidratar-execucoes", rotinaId: "r1", execucoes: [] });
    expect(renderDetalhes(fechadoDeNovo)).not.toContain("nunca executou");
  });

  it("sem acessos, convida a conectar em vez de deixar a seção muda", () => {
    const html = renderDetalhes(base);
    expect(html).toContain("ainda não usa nenhuma ferramenta externa");
    expect(html).toContain('data-act="abrir-conexao"');
  });
});
