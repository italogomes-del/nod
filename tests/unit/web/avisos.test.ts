import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { contarAbertas, CORPO_MAX, novasAbertas, redigirAviso, type PedidoNovo } from "../../../web/lib/avisos.ts";
import { renderAvisos } from "../../../web/telas/espaco.ts";
import { renderChamada } from "../../../web/telas/sua-vez.ts";

/**
 * O que vira aviso (definido em 2026-09-24, "aviso no Mac"): a primeira leitura é só a linha de base;
 * depois, só pedido aberto que não estava na fila — um por grupo "×N" e por fio de pergunta —, nunca
 * vencido nem aviso de queda. A redação é a da faixa do topo, e o número do Dock é o dela.
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;

function item(id: string, p: { tipo?: TipoDecisao; agente?: string; nome?: string; conversa?: string; dona?: string; frase?: string; vencido?: boolean; gemeas?: string[]; fio?: { id: string; rodada: number } } = {}): Item {
  return {
    decisao: {
      tenantId: "t", id, ownerId: p.dona ?? "p", decisorId: "p", agenteId: p.agente ?? "a", conversaId: p.conversa ?? "c", turnoId: null, tipo: p.tipo ?? "acesso",
      estado: p.vencido ? "vencida" : "pendente", prazoDecisaoEm: new Date(AGORA + (p.vencido ? -H : 22 * H)).toISOString(), prazoExecucaoEm: null,
      frase: p.frase ?? `pedido ${id}`, desfecho: null, vistaEm: null, criadoEm: new Date(AGORA - 2 * H).toISOString(), fioId: p.fio && p.fio.id !== id ? p.fio.id : null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: p.nome ?? "Nina", aguardandoHaMs: 2 * H, recusaAutomaticaEmMs: 22 * H,
    gemeas: p.gemeas ?? [], itensAprovacao: [], proposta: null, fio: p.fio ?? null, rotinaParada: null,
  };
}

const incidente: SuaVezDto["incidentes"][number] = { id: "i1", tipo: "mac_sem_contato", comecouEm: AGORA - H, voltouEm: null, rotinas: 2, conversas: 1, agentes: ["Nina"] };

function fila(itens: Item[], incidentes: SuaVezDto["incidentes"] = []): SuaVezDto {
  return { itens, incidentes, foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null };
}

describe("novasAbertas", () => {
  it("a primeira leitura só fixa a linha de base: o que já esperava ao abrir não é novidade", () => {
    const r = novasAbertas(null, fila([item("d1"), item("d2", { vencido: true })]));
    expect(r.novas).toEqual([]);
    expect([...r.conhecidas].sort()).toEqual(["d1", "d2"]);
  });

  it("depois, devolve só os pedidos abertos que não estavam na fila", () => {
    const base = novasAbertas(null, fila([item("d1")])).conhecidas;
    const r = novasAbertas(base, fila([item("d1"), item("d2", { nome: "Taga", agente: "b", conversa: "cb", frase: "Posso ler o Gmail?" })]));
    expect(r.novas).toEqual([{ id: "d2", ids: ["d2"], agenteId: "b", agenteNome: "Taga", conversaId: "cb", ownerId: "p", frase: "Posso ler o Gmail?" }]);
    // O conjunto só cresce: a mesma leitura de novo não devolve nada.
    expect(novasAbertas(r.conhecidas, fila([item("d1"), item("d2")])).novas).toEqual([]);
  });

  it("grupo ×N conta uma vez; gêmea nova de um grupo já conhecido não é pedido novo", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    const r = novasAbertas(base, fila([item("g1", { gemeas: ["g2", "g3"] })]));
    expect(r.novas.map((n) => [n.id, n.ids])).toEqual([["g1", ["g1", "g2", "g3"]]]);
    expect(novasAbertas(r.conhecidas, fila([item("g1", { gemeas: ["g2", "g3", "g4"] })])).novas).toEqual([]);
    // O mais antigo venceu e outra gêmea virou a representante: continua o mesmo pedido.
    expect(novasAbertas(r.conhecidas, fila([item("g2", { gemeas: ["g3"] })])).novas).toEqual([]);
  });

  it("fio de pergunta conta uma vez; a rodada seguinte de uma pergunta respondida é pedido novo", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    const duasRodadas = fila([item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } }), item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } })]);
    const r = novasAbertas(base, duasRodadas);
    expect(r.novas.map((n) => [n.id, n.ids])).toEqual([["p1", ["p1", "p2"]]]);
    // A 1ª rodada foi respondida (saiu da fila) e o agente perguntou de novo.
    const antes = novasAbertas(base, fila([item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } })])).conhecidas;
    const depois = novasAbertas(antes, fila([item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } })]));
    expect(depois.novas.map((n) => n.id)).toEqual(["p2"]);
  });

  it("vencido nunca avisa, e aviso de queda do Mac não é pedido", () => {
    const base = novasAbertas(null, fila([])).conhecidas;
    expect(novasAbertas(base, fila([item("v1", { vencido: true })], [incidente])).novas).toEqual([]);
  });

  it("reaberta pela pessoa não é novidade (o id já era conhecido)", () => {
    const base = novasAbertas(null, fila([item("r1", { vencido: true })])).conhecidas;
    const reaberta = { ...item("r1"), estadoColuna: "reaberto" as const };
    expect(novasAbertas(base, fila([reaberta])).novas).toEqual([]);
  });
});

describe("contarAbertas", () => {
  it("é o número da faixa do topo: grupos e fios contam um, vencidos e quedas não contam", () => {
    const sv = fila(
      [item("g1", { gemeas: ["g2"] }), item("p1", { tipo: "pergunta", fio: { id: "p1", rodada: 1 } }), item("p2", { tipo: "pergunta", fio: { id: "p1", rodada: 2 } }), item("x", { nome: "Taga", agente: "b" }), item("v", { vencido: true })],
      [incidente],
    );
    expect(contarAbertas(sv)).toBe(3);
    // Desde o #62 a chamada do topo é o sino com contador; o número tem de ser o mesmo do Dock.
    const sino = renderChamada({ ...estadoInicial, suaVez: sv });
    expect(sino).toContain('aria-label="3 pedidos esperando por você"');
    expect(sino).toContain('<span class="sino-cont" aria-hidden="true">3</span>');
    expect(contarAbertas(fila([item("v", { vencido: true })]))).toBe(0);
    expect(contarAbertas(null)).toBe(0);
  });
});

describe("redigirAviso", () => {
  const pedido = (id: string, nome: string, frase = `pedido ${id}`, dona = "p"): PedidoNovo => ({ id, ids: [id], agenteId: `ag-${nome}`, agenteNome: nome, conversaId: `c-${nome}`, ownerId: dona, frase });

  it("um pedido: '{agente} precisa de você', a frase no corpo (até 140) e o clique abre a conversa", () => {
    const frase = `Posso mandar o relatório para a diretoria? ${"Ele tem os números de setembro e ".repeat(6)}fim.`;
    const aviso = redigirAviso([pedido("d1", "Nina", frase)], "p");
    expect(aviso?.titulo).toBe("Nina precisa de você");
    expect(Array.from(aviso?.corpo ?? "")).toHaveLength(CORPO_MAX);
    expect(aviso?.corpo.endsWith("…")).toBe(true);
    expect(aviso?.alvo).toEqual({ tipo: "conversa", conversaId: "c-Nina", agenteId: "ag-Nina" });
    expect(redigirAviso([pedido("d1", "Nina", "  Posso\n ler o  Gmail? ")])?.corpo).toBe("Posso ler o Gmail?");
  });

  it("a decisora designada que não é dona: o clique abre 'Sua vez' (ela não lê a conversa de outra pessoa)", () => {
    expect(redigirAviso([pedido("d1", "Nina", "x", "outra")], "p")?.alvo).toEqual({ tipo: "sua-vez" });
  });

  it("vários: '{N} pedidos esperando por você', quem pede no corpo, e o clique abre 'Sua vez'", () => {
    const aviso = redigirAviso([pedido("d1", "Nina"), pedido("d2", "Taga"), pedido("d3", "Nina"), pedido("d4", "Zé")]);
    expect(aviso).toEqual({ titulo: "4 pedidos esperando por você", corpo: "Nina, Taga e mais 1", alvo: { tipo: "sua-vez" } });
    expect(redigirAviso([pedido("d1", "Nina"), pedido("d2", "Taga")])?.corpo).toBe("Nina e Taga");
    expect(redigirAviso([pedido("d1", "Nina"), pedido("d2", "Nina")])?.corpo).toBe("Nina");
    expect(redigirAviso([])).toBeNull();
  });
});

describe("'Avisos' em Seu espaço", () => {
  it("diz a situação e as regras; no navegador bloqueado o interruptor trava e diz onde liberar", () => {
    const mac = renderAvisos({ onde: "mac", situacao: "ligados" });
    expect(mac).toContain('role="switch" aria-checked="true"');
    expect(mac).toContain("Avisar quando algo precisar de você");
    expect(mac).toContain("No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só.");
    expect(mac).toContain("O número no ícone do Dock mostra quantos pedidos estão abertos.");
    expect(renderAvisos({ onde: "mac", situacao: "bloqueados" })).toContain("Bloqueados pelo macOS: libere em Ajustes do Sistema → Notificações → nod");
    const navegador = renderAvisos({ onde: "navegador", situacao: "bloqueados" });
    expect(navegador).toContain('aria-checked="false" disabled');
    expect(navegador).toContain("Bloqueados pelo navegador");
    expect(navegador).toContain("O título da aba mostra quantos pedidos estão abertos.");
    expect(renderAvisos({ onde: "navegador", situacao: "desligados" })).toContain("Desligados");
  });

  const somDe = (html: string): string => html.match(/<button[^>]*data-act="alternar-som"[^>]*>/)?.[0] ?? "";

  it('"Tocar som" aparece com aria-checked do som quando o estado traz som', () => {
    const ligado = renderAvisos({ onde: "mac", situacao: "ligados", som: true });
    expect(somDe(ligado)).toContain('role="switch" aria-checked="true"');
    expect(somDe(ligado)).toContain('aria-describedby="avisos-som-ajuda"');
    expect(somDe(ligado)).not.toContain("disabled");
    expect(ligado).toContain("Tocar som");
    expect(ligado).toContain('id="avisos-som-ajuda"');
    expect(ligado).toContain("Desligado, o aviso aparece em silêncio: o banner e o número no Dock continuam.");
    // Logo abaixo do interruptor geral, antes das regras.
    expect(ligado.indexOf("alternar-avisos")).toBeLessThan(ligado.indexOf("alternar-som"));
    expect(ligado.indexOf("alternar-som")).toBeLessThan(ligado.indexOf("avisos-regras"));
    expect(somDe(renderAvisos({ onde: "mac", situacao: "ligados", som: false }))).toContain('aria-checked="false"');
    // Bloqueado pelo macOS conta como ligado: o som segue escolhível.
    expect(somDe(renderAvisos({ onde: "mac", situacao: "bloqueados", som: true }))).not.toContain("disabled");
  });

  it('com avisos desligados, "Tocar som" fica disabled na posição guardada e troca a ajuda', () => {
    for (const som of [true, false]) {
      const html = renderAvisos({ onde: "mac", situacao: "desligados", som });
      expect(somDe(html)).toContain(`aria-checked="${som}"`);
      expect(somDe(html)).toContain(" disabled");
      expect(html).toContain("Ligue os avisos para escolher. Sua escolha fica guardada.");
      expect(html).not.toContain("Desligado, o aviso aparece em silêncio");
    }
  });

  it("sem som no estado (navegador ou app antigo) a seção é idêntica à de hoje", () => {
    for (const a of [{ onde: "mac", situacao: "ligados" }, { onde: "mac", situacao: "desligados" }, { onde: "navegador", situacao: "ligados" }] as const) {
      const html = renderAvisos(a);
      expect(html).not.toContain("alternar-som");
      expect(html).not.toContain("Tocar som");
      expect(html).toBe(renderAvisos({ ...a, som: undefined }));
      expect(html).toMatch(/<\/div>\n {6}<ul class="avisos-regras">/);
    }
  });
});
