import { describe, expect, it } from "vitest";
import type { QuadroDto, TarefaDto } from "../../../src/contracts/quadro.ts";
import { acesos, atalhosDePrazo, codigoDaTarefa, faltaParaOPrazo, fraseDoPrazo, historicoDaFaixa, linhaUnica, respostaDoBot, tarefaNoQuadro, tarefasPorStatus } from "../../../web/lib/quadro-dados.ts";
import { avisoDoGithub, cardDaTarefa, faixaDoQuadro, menuDePrazo, pilulaDoQuadro, prMaisProblematico, quadroDaMeta, semQuadro, tarefaAberta, tomDoPr, topoDoQuadro } from "../../../web/telas/quadro-real.ts";
import { card, confiar } from "../../../web/telas/quadro.ts";
import { COLUNAS_PADRAO, colunasDto } from "../../../src/domain/colunas.ts";

/** NOD-442: o quadro de verdade na tela, sem DOM (o Chrome real fica em tests/concurrency/quadro-jornada-chrome.test.ts). */

const MAL = `<img src=x onerror="alert(1)">"'&`;
const t = (id: string, extra: Partial<TarefaDto> = {}): TarefaDto => ({
  id, quadroId: "q1", titulo: `Tarefa ${id}`, descricao: "", status: "afazer", voltarPara: null, agenteId: "a", ordem: 1, linearId: null, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: 1, mudadoEm: 1, terminadaEm: null, execucao: null, agenteNome: "Ada", ...extra,
});
const q = (tarefas: TarefaDto[], extra: Partial<QuadroDto> = {}): QuadroDto => ({
  id: "q1", agenteId: "a", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: 1, atualizadoEm: 1, metaDesde: 1, agenteNome: "Ada",
  colunas: colunasDto(COLUNAS_PADRAO), tarefas, ultimoLote: null, feitas: 0, total: tarefas.length, ...extra,
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
    expect(por.afazer!.map((x) => x.id)).toEqual(["a", "b"]);
    expect(por.feito!.map((x) => x.id)).toEqual(["c"]);
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

  it("NOD-421: os PRs ligados nos Entregáveis (estado em texto), as linhas de sistema em Atividade e o +1 no card", () => {
    const prs = [
      { repo: "gamefik/nod", numero: 612, url: "https://github.com/gamefik/nod/pull/612", estado: "aberto" as const, ci: "falhou" as const, conflito: true },
      { repo: "gamefik/nod", numero: 613, url: "javascript:alert(1)", estado: "mergeado" as const, ci: null, conflito: false },
    ];
    const linhas = [{ tipo: "ci_falhou" as const, texto: `GitHub · CI falhou no #612 ${MAL}`, criadoEm: Date.parse("2026-11-02T14:02:00Z") }];
    const h = String(tarefaAberta({ t: t("1", { prs, linhas }), q: q([]), agente }));
    expect(h).toContain(`href="https://github.com/gamefik/nod/pull/612"`);
    expect(h).toContain("gamefik/nod #612</a><span class=\"qd-pr-estado\"> · CI falhou · conflito · aberto</span>");
    expect(h).not.toContain("javascript:");
    expect(h).toContain(`Entregáveis <span class="qd-n">1</span>`);
    expect(h).toContain("Atividade");
    expect(h).toContain("GitHub · CI falhou no #612");
    expect(h).not.toMatch(/onerror="/);
    // 🧭 da Ada: o card mostra o PR mais problemático (o #612, CI falhou) com o ponto, mais "+N".
    const c = cardDaTarefa(t("1", { prUrl: "https://github.com/gamefik/nod/pull/613", prs }), agente);
    expect(c.pr).toEqual({ texto: "PR #612 +1", tom: "falhou", titulo: "CI falhou · conflito · aberto" });
    expect(c.tags).toBeUndefined();
    expect(String(card(c))).toContain(`<i class="qd-pr-ponto qd-pr-falhou" aria-hidden="true"></i>PR #612 +1<span class="qd-sr"> (CI falhou · conflito · aberto)</span></span>`);
    // Sem PR ligado nem linha: como antes (o pr_url do agente, sem Atividade).
    const antes = String(tarefaAberta({ t: t("1", { prUrl: "https://github.com/o/r/pull/3" }), q: q([]), agente }));
    expect(antes).toContain(`Entregáveis <span class="qd-n">1</span>`);
    expect(antes).not.toContain("Atividade");
  });

  it("3ª revisão do PR #621: o ícone de cada PR em Entregáveis segue o estado (CI falhando, fechado sem merge, aberto, mergeado)", () => {
    const pr = (numero: number, o: Partial<NonNullable<TarefaDto["prs"]>[number]>) => ({ repo: "o/r", numero, url: `https://github.com/o/r/pull/${numero}`, estado: "aberto" as const, ci: null, conflito: false, ...o });
    const prs = [pr(1, { ci: "falhou" }), pr(2, { estado: "fechado" }), pr(3, { ci: "ok" }), pr(4, { estado: "mergeado" })];
    const h = String(tarefaAberta({ t: t("1", { prs }), q: q([]), agente }));
    const icones = [...h.matchAll(/<li><svg[^>]*class="([^"]*)"[^>]*>.*?o\/r #(\d+)<\/a>/g)].map((m) => [m[2], /qd-ic-[a-z]+/.exec(m[1]!)?.[0]]);
    expect(icones).toEqual([["1", "qd-ic-falhou"], ["2", "qd-ic-fechado"], ["3", "qd-ic-fila"], ["4", "qd-ic-mergeado"]]);
  });

  it("NOD-421 (🧭): o tom do ponto e o PR mais problemático do card", () => {
    const pr = (numero: number, o: Partial<{ estado: "aberto" | "mergeado" | "fechado"; ci: "pendente" | "ok" | "falhou" | null; conflito: boolean }>) =>
      ({ repo: "o/r", numero, url: `https://github.com/o/r/pull/${numero}`, branch: "x", estado: "aberto" as const, ci: null, conflito: false, ...o });
    expect(tomDoPr(pr(1, { ci: "falhou" }))).toBe("falhou");
    expect(tomDoPr(pr(1, { ci: "ok", conflito: true }))).toBe("conflito");
    expect(tomDoPr(pr(1, { ci: "pendente" }))).toBe("pendente");
    expect(tomDoPr(pr(1, {}))).toBe("pendente");
    expect(tomDoPr(pr(1, { ci: "ok" }))).toBe("ok");
    expect(tomDoPr(pr(1, { estado: "mergeado", ci: "falhou" }))).toBe("mergeado");
    expect(tomDoPr(pr(1, { estado: "fechado" }))).toBe("fechado");
    expect(prMaisProblematico([pr(1, { estado: "mergeado" }), pr(2, { ci: "ok" }), pr(3, { conflito: true })]).numero).toBe(3);
    expect(prMaisProblematico([pr(1, { estado: "mergeado" }), pr(2, { estado: "fechado" })]).numero).toBe(1);
    expect(prMaisProblematico([pr(4, { ci: "ok" }), pr(9, { ci: "ok" })]).numero).toBe(9);
    // Sem PR ligado: a tag de antes, sem ponto.
    expect(cardDaTarefa(t("1", { prUrl: "https://github.com/o/r/pull/3" }), agente).tags).toEqual(["PR #3"]);
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

describe("revisão do PR #621: o estado do PR para leitor de tela e o aviso do GitHub no topo", () => {
  it("o estado do PR do card vai num qd-sr (o ponto é aria-hidden e o title não é lido por todo leitor)", () => {
    const prs = [{ repo: "gamefik/nod", numero: 7, url: "https://github.com/gamefik/nod/pull/7", estado: "mergeado" as const, ci: "ok" as const, conflito: false }];
    const h = String(card(cardDaTarefa(t("1", { prs }), agente)));
    expect(h).toMatch(/<span class="qd-sr"> \([^)]*mergeado[^)]*\)<\/span>/);
  });

  it("o aviso é uma linha discreta (p, sem role de alerta), escapada; sem aviso, nada", () => {
    expect(avisoDoGithub({ avisoGithub: null })).toBe("");
    expect(avisoDoGithub({})).toBe("");
    const h = String(avisoDoGithub({ avisoGithub: "GitHub não conectado no servidor: os PRs não sincronizam" }));
    expect(h).toBe(`<p class="qd-aviso-gh">GitHub não conectado no servidor: os PRs não sincronizam</p>`);
    expect(String(avisoDoGithub({ avisoGithub: MAL }))).not.toContain("<img");
    const tela = String(quadroDaMeta({ q: q([], { avisoGithub: "GitHub · sem acesso a gamefik/privado" }), nome: "Ana", agente, filtro: "todos", alternadas: new Set(), acesas: new Set() }));
    expect(tela).toContain(`<p class="qd-aviso-gh">GitHub · sem acesso a gamefik/privado</p>`);
    expect(tela).not.toMatch(/role="alert"|aria-live="assertive"/);
  });
});

describe("NOD-415 (ADR-141): meta opcional, prazo e criar pela tela", () => {
  // Quarta, 04/11/2026, 10h em São Paulo.
  const QUARTA = Date.parse("2026-11-04T13:00:00Z");

  it("os atalhos de prazo: hoje, amanhã, a próxima sexta e sábado, e o fim do mês, pela data de São Paulo", () => {
    expect(atalhosDePrazo(QUARTA)).toEqual([
      { rotulo: "Hoje", valor: "2026-11-04" }, { rotulo: "Amanhã", valor: "2026-11-05" }, { rotulo: "Sexta", valor: "2026-11-06" },
      { rotulo: "Sábado", valor: "2026-11-07" }, { rotulo: "Fim do mês", valor: "2026-11-30" },
    ]);
    // 01h UTC de quinta ainda é quarta em São Paulo.
    expect(atalhosDePrazo(Date.parse("2026-11-05T01:00:00Z"))[0]?.valor).toBe("2026-11-04");
    // Na sexta, "Sexta" é hoje; fim de dezembro vira o 31.
    expect(atalhosDePrazo(Date.parse("2026-12-04T13:00:00Z")).map((a) => a.valor)).toEqual(["2026-12-04", "2026-12-05", "2026-12-04", "2026-12-05", "2026-12-31"]);
  });

  it("quanto falta para o prazo", () => {
    expect(faltaParaOPrazo(null, QUARTA)).toBe("");
    expect(faltaParaOPrazo("2026-11-04", QUARTA)).toBe("vence hoje");
    expect(faltaParaOPrazo("2026-11-05", QUARTA)).toBe("falta 1 dia");
    expect(faltaParaOPrazo("2026-11-11", QUARTA)).toBe("faltam 7 dias");
    expect(faltaParaOPrazo("2026-11-03", QUARTA)).toBe("venceu");
  });

  it("sem meta (fluxo contínuo): só + Meta e o prazo, nenhuma fração nem barra", () => {
    const h = String(topoDoQuadro(q([t("1"), t("2", { status: "feito" })], { meta: null, feitas: 1, total: 2, prazo: "2026-11-11" }), { agora: QUARTA }));
    expect(h).toContain("qd-meta-fluxo");
    expect(h).toContain(">+ Meta<");
    expect(h).toContain("faltam 7 dias");
    expect(h).not.toMatch(/de 2 feitas|progressbar|qd-barra/);
  });

  it("com meta: a meta clicável, a barra, N de M feitas e quanto falta; cumprida no lugar do falta", () => {
    const h = String(topoDoQuadro(q([], { meta: MAL, feitas: 1, total: 4, prazo: "2026-11-05" }), { agora: QUARTA }));
    expect(h).toContain('data-act="editar-meta"');
    expect(h).not.toContain("<img");
    expect(h).toContain('aria-valuenow="1"');
    expect(h).toContain("1 de 4 feitas");
    expect(h).toContain("falta 1 dia");
    expect(String(topoDoQuadro(q([], { meta: "M", feitas: 4, total: 4, cumpridoEm: 9 }), { agora: QUARTA }))).toContain(">cumprida<");
    expect(String(topoDoQuadro(q([], { meta: "M", total: 0 }), { agora: QUARTA }))).toContain("nenhuma tarefa ainda");
  });

  it("editando a meta: o campo com a meta atual, escapada", () => {
    const h = String(topoDoQuadro(q([], { meta: MAL }), { agora: QUARTA, editandoMeta: true }));
    expect(h).toContain('data-form="editar-meta"');
    expect(h).toContain('id="qd-meta-in"');
    expect(h).not.toContain("<img");
  });

  it("o menu de prazo: o atual selecionado, Sem prazo, os atalhos e Outra data", () => {
    const fora = menuDePrazo("2026-12-25", QUARTA);
    expect(fora).toMatch(/<option value="2026-12-25" selected>/);
    expect(fora).toContain('<option value="">Sem prazo</option>');
    expect(fora).toContain('value="outra"');
    expect(menuDePrazo(null, QUARTA)).toContain('<option value="" selected>Sem prazo</option>');
    // O atual se lê "até …" mesmo quando é um atalho; só ele vem selecionado.
    const amanha = menuDePrazo("2026-11-05", QUARTA);
    expect(amanha).toMatch(/^<span class="qd-prazo">.*<select[^>]*><option value="2026-11-05" selected>até /);
    expect(amanha.match(/ selected/g)).toHaveLength(1);
  });

  it("sem quadro: o form de criar com meta opcional e o botão sempre habilitado", () => {
    const h = String(semQuadro(MAL, QUARTA));
    expect(h).toContain('data-form="criar-quadro"');
    expect(h).toContain('id="qd-criar-prazo"');
    expect(h).toMatch(/<button type="submit" class="qd-bt qd-bt-pri">Criar quadro<\/button>/);
    expect(h).not.toMatch(/required|disabled/);
    expect(h).not.toContain("<img");
  });
});
