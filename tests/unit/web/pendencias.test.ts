import { describe, expect, it, vi } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { Pendencia } from "../../../src/contracts/pendencia.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { proximaHora, quandoPendencia, renderAFazerNaConversa } from "../../../web/telas/pendencias.ts";

// O "A fazer" está desligado desde 2026-10-06 (web/lib/a-fazer.ts); estes testes guardam como ele volta quando religado.
vi.mock("../../../web/lib/a-fazer.ts", () => ({ A_FAZER_LIGADO: true }));

/**
 * O "a fazer" do bot na web (ADR-064; canvas "Pendências", pranchas F6 e F7, A + C): o indicador embaixo da última
 * mensagem abre a lista ali mesmo, a gaveta tem a seção acima de Rotinas, e o frame do agente relê só a lista.
 */
const AGORA = new Date(2026, 8, 30, 15, 50).getTime();
const AS_15_49 = new Date(2026, 8, 30, 15, 49).getTime();
const AS_16_20 = new Date(2026, 8, 30, 16, 20).getTime();
const AUTORIA = { sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;

function pendencia(id: string, texto: string, extra: Partial<Pendencia> = {}): Pendencia {
  return { tenantId: "t", id, agenteId: "a1", conversaId: "c1", turnoId: "t0", texto, aPartirDe: null, cuidado: false, profundidade: 0, estado: "aberta", resolvidaEm: null, resolvidaPor: null, motivo: null, pedidaEm: null, criadoEm: AS_15_49, ...extra };
}

const TRES = [
  pendencia("p1", "Cobrar do Dev 1 o parecer do PR #475", { aPartirDe: AS_16_20 }),
  pendencia("p2", "Ler as outras 13 tasks da Entregas Engenharia"),
  pendencia("p3", "Pedir ao Dev 3 que confira a 86ajtj1xk no monorepo acme", { profundidade: 3 }),
];

function mensagem(id: string, texto: string): Mensagem {
  return { tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AS_15_49, autoria: { ...AUTORIA, autor_tipo: "agente", autor_id: "a1" } };
}

const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [mensagem("m1", "Deixei os dois anotados para depois.")], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };

const base: Estado = {
  ...estadoInicial,
  agora: AGORA,
  sessao: { tenantId: "t", pessoaId: "p" },
  tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" },
  frota: { agentes: [{ id: "a1", nome: "Chico", titulo: "Tech Lead", cor: "c-green", forma: "shape-cloud", ownerId: "p", conversaId: "c1", confirmado: true }] } as never,
  conversas: { c1: conversa },
  carregado: { rotinas: true, salas: true, conectores: true },
};

describe("o estado do a fazer", () => {
  it("o frame da pendência relê só a lista daquele bot; a conversa aberta pede a lista até ela chegar", () => {
    const frame = (acao: string) => reduzir(base, { tipo: "frame", frame: { tipo: "agente.mudou", dados: { agente_id: "a1", acao, pendencia_id: "p1", conversaId: "c1" } } as never, agora: AGORA });
    for (const acao of ["pendencia_anotada", "pendencia_concluida", "pendencia_descartada", "pendencia_pedida"]) {
      expect(frame(acao).invalidacoes).toEqual(["pendencias:a1"]);
    }
    expect(invalidacoesDaTela(base)).toContain("pendencias:a1");
    expect(invalidacoesDaTela(reduzir(base, { tipo: "hidratar-pendencias", agenteId: "a1", pendencias: [] }))).not.toContain("pendencias:a1");
  });

  it("abrir e fechar é da tela; a lista que fica vazia fecha junto", () => {
    const aberta = reduzir(reduzir(base, { tipo: "hidratar-pendencias", agenteId: "a1", pendencias: TRES }), { tipo: "a-fazer", agenteId: "a1", aberto: true });
    expect(aberta.aFazerAberto.a1).toBe(true);
    expect(reduzir(aberta, { tipo: "a-fazer", agenteId: "a1", aberto: false }).aFazerAberto.a1).toBe(false);
    expect(reduzir(aberta, { tipo: "hidratar-pendencias", agenteId: "a1", pendencias: TRES.slice(1) }).aFazerAberto.a1).toBe(true);
    expect(reduzir(aberta, { tipo: "hidratar-pendencias", agenteId: "a1", pendencias: [] }).aFazerAberto.a1).toBe(false);
  });
});

describe("o indicador embaixo da última mensagem", () => {
  it("com zero, nada; com pendências, 'N a fazer' e a hora futura mais próxima, logo depois da última mensagem", () => {
    expect(renderAFazerNaConversa({ ...base, pendencias: { a1: [] } }, "a1")).toBe("");
    expect(renderTimeline(conversa, base)).not.toContain("a-fazer");
    const e = { ...base, pendencias: { a1: TRES } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain("<b>3 a fazer</b><span class=\"a-fazer-quando\">· a partir de hoje às 16:20</span>");
    expect(html).toContain('data-act="a-fazer" data-agente="a1" data-abrir="1" aria-expanded="false"');
    expect(html.indexOf("Deixei os dois anotados")).toBeLessThan(html.indexOf("a-fazer-bt"));
    // Sem hora futura, só a contagem.
    expect(renderAFazerNaConversa({ ...base, pendencias: { a1: TRES.slice(1) } }, "a1")).not.toContain("a partir de");
  });

  it("aberto: Fechar no topo e cada item com o texto, o chip, a hora anotada, o complemento dos 3 bots e as duas ações", () => {
    const html = renderAFazerNaConversa({ ...base, pendencias: { a1: TRES }, aFazerAberto: { a1: true } }, "a1");
    expect(html).toContain('aria-label="A fazer de Chico"');
    expect(html).toMatch(/data-abrir="0" aria-expanded="true">[\s\S]*<b>3 a fazer<\/b><span class="a-fazer-fechar">Fechar<\/span>/);
    expect(html.indexOf("Fechar")).toBeLessThan(html.indexOf("Cobrar do Dev 1"));
    expect(html).toContain("A partir de hoje às 16:20");
    expect(html.match(/Na próxima rotina ou conversa/g)).toHaveLength(2);
    expect(html.match(/anotada às 15:49/g)).toHaveLength(3);
    expect(html).toContain("anotada às 15:49 · o pedido já tinha passado por 3 bots");
    expect(html.match(/data-act="pendencia-fazer-agora" data-id="p\d" data-agente="a1"/g)).toHaveLength(3);
    expect(html.match(/data-act="pendencia-descartar" data-id="p\d" data-agente="a1"/g)).toHaveLength(3);
  });

  it("o que a pessoa já pediu diz a hora do pedido; o texto do bot sai escapado", () => {
    const html = renderAFazerNaConversa({ ...base, pendencias: { a1: [pendencia("p9", "ver <b>isso</b>", { pedidaEm: new Date(2026, 8, 30, 15, 52).getTime() })] }, aFazerAberto: { a1: true } }, "a1");
    expect(html).toContain("anotada às 15:49 · pedida às 15:52");
    expect(html).toContain("ver &lt;b&gt;isso&lt;/b&gt;");
    expect(html).not.toContain("<b>isso</b>");
  });
});

describe("o cuidado à vista", () => {
  it("o item anotado depois de ler conteúdo de fora diz isso na conversa e na gaveta; o sem cuidado, não", () => {
    const lista = [pendencia("p7", "Responder o que o e-mail pediu", { cuidado: true }), pendencia("p8", "Cobrar o parecer")];
    const conversa = renderAFazerNaConversa({ ...base, pendencias: { a1: lista }, aFazerAberto: { a1: true } }, "a1");
    expect(conversa).toContain("anotada às 15:49 · anotada depois de ler conteúdo de fora");
    expect(conversa.match(/anotada depois de ler conteúdo de fora/g)).toHaveLength(1);
    const gaveta = renderDetalhes({ ...base, pendencias: { a1: lista } });
    expect(gaveta.match(/anotada depois de ler conteúdo de fora/g)).toHaveLength(1);
  });
});

describe("a gaveta do bot", () => {
  it("'A fazer · N' acima de Rotinas, com os mesmos itens e ações; sem pendência, sem seção", () => {
    const html = renderDetalhes({ ...base, pendencias: { a1: TRES } });
    expect(html).toContain("<h3>A fazer · 3</h3>");
    expect(html.indexOf("A fazer · 3")).toBeLessThan(html.indexOf("<h3>Rotinas</h3>"));
    expect(html.match(/data-act="pendencia-fazer-agora"/g)).toHaveLength(3);
    expect(html).toContain("o pedido já tinha passado por 3 bots");
    expect(renderDetalhes({ ...base, pendencias: { a1: [] } })).not.toContain("A fazer ·");
  });
});

describe("as horas do a fazer", () => {
  it("hoje, amanhã, ontem ou a data, no relógio da máquina; a próxima é a futura mais cedo", () => {
    expect(quandoPendencia(AS_16_20, AGORA)).toBe("hoje às 16:20");
    expect(quandoPendencia(new Date(2026, 9, 1, 10, 0).getTime(), AGORA)).toBe("amanhã às 10:00");
    expect(quandoPendencia(new Date(2026, 8, 29, 9, 0).getTime(), AGORA)).toBe("ontem às 09:00");
    expect(quandoPendencia(new Date(2026, 9, 3, 9, 0).getTime(), AGORA)).toBe("03/10 às 09:00");
    expect(proximaHora([pendencia("a", "x", { aPartirDe: AS_16_20 }), pendencia("b", "y", { aPartirDe: AS_16_20 - 10 * 60_000 }), pendencia("c", "z", { aPartirDe: AGORA - 60_000 })], AGORA)).toBe(AS_16_20 - 10 * 60_000);
    expect(proximaHora(TRES.slice(1), AGORA)).toBeNull();
  });
});
