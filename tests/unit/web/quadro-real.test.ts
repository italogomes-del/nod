import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { acesos, codigoDaTarefa, fraseDoPrazo, historicoDaFaixa, linhaUnica, respostaDoBot, tarefaNoQuadro, tarefasPorStatus } from "../../../web/lib/quadro-dados.ts";
import { cardDaTarefa, faixaDoQuadro, pilulaDoQuadro, quadroDaMeta, tarefaAberta } from "../../../web/telas/quadro-real.ts";
import { confiar } from "../../../web/telas/quadro.ts";

/** NOD-442: o quadro de verdade na tela, sem DOM (o Chrome real fica em tests/concurrency/quadro-jornada-chrome.test.ts). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, execucao: null, agenteNome: "Ada", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, agenteNome: "Ada",
  tarefas, ultimoLote: null, feitas: 0, total: tarefas.length, ...extra,
});
const agente = (id: string) => (id === "a" ? { avatar: confiar(`<span class="av">A</span>`), nome: "Ada" } : null);
const fala = (id: string, de: "eu" | "a" | "b", texto: string, extra = {}) => ({
  id, texto, kind: "texto" as const, parcial: false, criadoEm: 1,
  autoria: de === "eu" ? { autor_tipo: "pessoa" as const, autor_id: "p" } : { autor_tipo: "agente" as const, autor_id: de }, ...extra,
}) as never;

describe("quadro-dados", () => {
  it("o código do card: o do Linear; sem ele, # e os 4 primeiros do id", () => {
    expect(codigoDaTarefa({ id: "ab-cd-ef", linearId: "NOD-1" })).toBe("NOD-1");
    expect(codigoDaTarefa({ id: "ab-cd-ef", linearId: null })).toBe("#abcd");
  });

  it("as tarefas por status, na ordem", () => {
    const por = tarefasPorStatus(q([t("b", { ordem: 2 }), t("a", { ordem: 1 }), t("c", { status: "feito" })]));
    expect(por.afazer.map((x) => x.id)).toEqual(["a", "b"]);
    expect(por.feito.map((x) => x.id)).toEqual(["c"]);
  });

  it("acende o que mudou e o que a dica do frame disse; a primeira leitura e a troca de quadro não acendem nada", () => {
    const a = q([t("1"), t("2")]);
    expect(acesos(null, a).size).toBe(0);
    expect([...acesos(a, q([t("1", { status: "feito" }), t("2"), t("3")]))]).toEqual(["1", "3"]);
    expect([...acesos(a, a, ["2"])]).toEqual(["2"]);
    expect(acesos(a, q([t("1", { status: "feito" })], { id: "q2" })).size).toBe(0);
  });

  it("a frase do prazo", () => {
    expect(fraseDoPrazo("2026-11-06")).toBe("até 6 nov");
    expect(fraseDoPrazo(null)).toBe("sem prazo");
    expect(fraseDoPrazo("amanhã")).toBe("sem prazo");
  });

  it("a resposta do bot: a última fala final dele depois do pedido, sem markdown; de outro bot ou parcial não conta", () => {
    const ms = [fala("0", "a", "antes"), fala("p", "eu", "pedido"), fala("1", "b", "outro bot"), fala("2", "a", "parcial", { parcial: true }), fala("3", "a", "Pus **X** em [A fazer](u).\n\nok")];
    expect(respostaDoBot(ms, "a", "p")).toEqual({ id: "3", texto: "Pus X em A fazer. ok" });
    expect(respostaDoBot(ms.slice(0, 3), "a", "p")).toBeNull();
    expect(respostaDoBot(ms, "a", "sumiu")).toBeNull();
    // A fala do meio do turno dá lugar à última; a próxima fala da pessoa encerra a busca (codex rodada 5).
    const depois = [...ms, fala("4", "a", "Pronto: 3 tarefas."), fala("5", "eu", "outro pedido"), fala("6", "a", "de outro pedido")];
    expect(respostaDoBot(depois, "a", "p")).toEqual({ id: "4", texto: "Pronto: 3 tarefas." });
  });

  it("linhaUnica tira bloco de código e colapsa espaços; o histórico guarda só a pessoa e o anfitrião, até n", () => {
    expect(linhaUnica("a ```x\ny``` b")).toBe("a b");
    const h = historicoDaFaixa([fala("1", "eu", "oi"), fala("2", "b", "outro"), fala("3", "a", "ok"), fala("4", "a", "fim")], "a", 2);
    expect(h.map((x) => [x.id, x.de])).toEqual([["3", "bot"], ["4", "bot"]]);
  });

  it("a tarefa aberta que saiu do quadro volta null", () => {
    expect(tarefaNoQuadro(q([t("1")]), "1")?.id).toBe("1");
    expect(tarefaNoQuadro(q([t("1")]), "2")).toBeNull();
    expect(tarefaNoQuadro(null, "1")).toBeNull();
  });
});

describe("quadro-real (o html)", () => {
  it("o card: Você é o responsável quando a tarefa espera a pessoa, com a pergunta; bloqueado mostra o motivo; PR e Linear viram etiquetas", () => {
    const voce = cardDaTarefa(t("1", { status: "voce", pergunta: "Qual workspace?" }), agente);
    expect(voce.voce).toBeTruthy();
    expect(JSON.stringify(voce)).toContain("Qual workspace?");
    const bloq = cardDaTarefa(t("2", { status: "bloqueado", pergunta: "Falta o token" }), agente);
    expect(JSON.stringify(bloq)).toContain("Falta o token");
    const pr = cardDaTarefa(t("3", { prUrl: "https://github.com/o/r/pull/9", linearId: "NOD-9" }), agente);
    expect(pr.tags).toEqual(expect.arrayContaining(["PR #9", "Linear"]));
    expect(pr.codigo).toBe("NOD-9");
  });

  it("texto hostil (título, meta, descrição, pergunta, nome do bot) sai escapado em todo html", () => {
    const tm = t("1", { titulo: MAL, descricao: MAL, pergunta: MAL, status: "voce", agenteNome: MAL });
    const qm = q([tm], { meta: MAL, agenteNome: MAL });
    const htmls = [
      quadroDaMeta({ q: qm, nome: MAL, agente, filtro: "todos", alternadas: new Set(), acesas: new Set() }),
      tarefaAberta({ t: tm, q: qm, agente }),
      faixaDoQuadro({ faixa: { tipo: "resposta", texto: MAL, loteId: MAL, mensagemId: "m" }, avatarBot: null, historico: [{ id: "h", de: "bot", texto: MAL, em: 1 }], aberto: true, hora: () => "10:00" }),
      faixaDoQuadro({ faixa: { tipo: "erro", texto: MAL }, avatarBot: null, historico: [], aberto: false, hora: () => "10:00" }),
      pilulaDoQuadro({ meta: MAL, nome: MAL }),
    ];
    for (const h of htmls) {
      expect(h).not.toContain("<img");
      expect(h).not.toMatch(/onerror="/);
    }
  });

  it("os links da tarefa: só http(s), em aba nova com noopener; javascript: não vira link", () => {
    const boa = tarefaAberta({ t: t("1", { prUrl: "https://github.com/o/r/pull/3", linearId: "NOD-3", linearUrl: "https://linear.app/x/NOD-3" }), q: q([]), agente });
    expect(boa).toContain(`href="https://github.com/o/r/pull/3"`);
    expect(boa).toContain(`rel="noopener noreferrer"`);
    const ruim = tarefaAberta({ t: t("1", { prUrl: "javascript:alert(1)", linearId: "NOD-3", linearUrl: "javascript:alert(1)" }), q: q([]), agente });
    expect(ruim).not.toContain("javascript:");
  });

  it("coluna recolhida por padrão abre quando tem tarefa; vazia continua recolhida", () => {
    const vazio = quadroDaMeta({ q: q([t("1")]), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() });
    const comCancelada = quadroDaMeta({ q: q([t("1", { status: "cancelado" })]), nome: "Ada", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() });
    const recolhidas = (h: string) => (h.match(/qd-col-recolhida/g) ?? []).length;
    expect(recolhidas(comCancelada)).toBe(recolhidas(vazio) - 1);
  });

  it("a faixa: aguardando mostra o giro; resposta com lote mostra Desfazer; sem lote, não", () => {
    const base = { avatarBot: null, historico: [], aberto: false, hora: () => "10:00" };
    expect(faixaDoQuadro({ ...base, faixa: { tipo: "aguardando", pedidoId: "p" } })).toContain("Mexendo no quadro");
    expect(faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "ok", loteId: "L1", mensagemId: "m" } })).toContain(`data-act="qc-desfazer" data-id="L1"`);
    expect(faixaDoQuadro({ ...base, faixa: { tipo: "resposta", texto: "ok", loteId: null, mensagemId: "m" } })).not.toContain("qc-desfazer");
  });
});
