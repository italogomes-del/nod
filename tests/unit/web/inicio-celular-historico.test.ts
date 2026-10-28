import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOD-379 (revisão do PR #548): a inicial do celular ligada ao histórico do navegador, num DOM de mentira (o unit não
 * tem jsdom). O ‹ e o voltar do navegador voltam à inicial; dois toques no ‹ não saem do app; sem entrada nossa, o ‹ não
 * faz history.back().
 */
type Fn = (ev: { state?: unknown }) => void;

function classes() {
  const s = new Set<string>();
  return { s, toggle: (c: string, v?: boolean) => { if (v ?? !s.has(c)) s.add(c); else s.delete(c); }, add: (c: string) => s.add(c), remove: (c: string) => s.delete(c), contains: (c: string) => s.has(c) };
}

function montar(celular = true) {
  const app = { classList: classes() };
  const linha = { dataset: { conversa: "c1" }, focus: () => undefined };
  const sidebar = { inert: false, contains: (el: unknown) => el === linha, querySelector: () => null };
  // O ‹ do cabeçalho: o navegar troca o cabeçalho (outro botão) logo depois de esconder a inicial.
  const foco = { voltar: { focado: false, focus() { this.focado = true; } } as { focado: boolean; focus(): void } };
  const stage = { inert: false };
  const detalhes = { inert: false };
  const ouvintes: Record<string, Fn[]> = {};
  const pilha: unknown[] = [null];
  let indice = 0;
  const backs: number[] = [];
  const historia = {
    get state() { return pilha[indice]; },
    replaceState(st: unknown) { pilha[indice] = st; },
    pushState(st: unknown) { pilha.splice(indice + 1); pilha.push(st); indice++; },
    back() {
      backs.push(indice);
      // O popstate chega depois (assíncrono), como no navegador.
      queueMicrotask(() => {
        if (indice === 0) return;
        indice--;
        for (const fn of ouvintes.popstate ?? []) fn({ state: pilha[indice] });
      });
    },
  };
  const mq = (casa: boolean) => ({ matches: casa, addEventListener: () => undefined });
  vi.stubGlobal("window", {
    matchMedia: (q: string) => mq(q.includes("reduce") ? true : celular),
    addEventListener: (t: string, fn: Fn) => { (ouvintes[t] ??= []).push(fn); },
    history: historia,
    visualViewport: null,
    setTimeout: () => 0,
  });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", {
    querySelector: (s: string) => (s === ".app" ? app : s === ".stage" ? stage : s.includes("abrir-bots") ? foco.voltar : null),
    querySelectorAll: () => [],
    getElementById: (id: string) => (id === "sidebar" ? sidebar : id === "detalhes" ? detalhes : null),
    addEventListener: () => undefined,
    documentElement: { classList: classes(), clientHeight: 844, style: { setProperty: () => undefined, removeProperty: () => undefined } },
    activeElement: null as unknown,
  });
  return { app, stage, detalhes, sidebar, backs, historia, pilha, linha, foco, saiuDoApp: () => indice === 0 && backs.length > 1 };
}

describe("inicial do celular e o histórico", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("entrar empilha uma entrada; o ‹ desempilha e a inicial aparece na hora", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    expect(c.botsAbertos()).toBe(true);
    c.entrarNaConversa();
    expect(c.botsAbertos()).toBe(false);
    expect(m.historia.state).toEqual({ nodInicio: "conversa" });
    c.voltarAoInicio();
    expect(c.botsAbertos()).toBe(true);
    expect(m.app.classList.contains("bots-abertos")).toBe(true);
    await Promise.resolve();
    expect(m.historia.state).toBeNull();
    expect(c.botsAbertos()).toBe(true);
  });

  it("dois toques rápidos no ‹ fazem um back() só (não saem do app)", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    c.voltarAoInicio();
    c.voltarAoInicio();
    await Promise.resolve();
    await Promise.resolve();
    expect(m.backs).toHaveLength(1);
    expect(c.botsAbertos()).toBe(true);
  });

  it("sem entrada nossa (link, recarregar), o ‹ só mostra a inicial", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.fecharBots();
    expect(c.botsAbertos()).toBe(false);
    c.voltarAoInicio();
    expect(m.backs).toHaveLength(0);
    expect(c.botsAbertos()).toBe(true);
  });

  it("entrando pela linha, o foco vai ao ‹ do cabeçalho redesenhado (não ao que o navegar descartou)", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    (document as unknown as { activeElement: unknown }).activeElement = m.linha;
    const antigo = m.foco.voltar;
    c.entrarNaConversa();
    // O dispatch do navegar redesenha o cabeçalho em seguida, ainda no mesmo passo.
    m.foco.voltar = { focado: false, focus() { this.focado = true; } };
    (document as unknown as { activeElement: unknown }).activeElement = null;
    await Promise.resolve();
    expect(antigo.focado).toBe(false);
    expect(m.foco.voltar.focado).toBe(true);
  });

  it("‹ e logo um bot, antes do popstate chegar: a conversa fica e o histórico ganha a entrada dela", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    c.voltarAoInicio();
    c.entrarNaConversa();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.botsAbertos()).toBe(false);
    expect(m.historia.state).toEqual({ nodInicio: "conversa" });
    expect(m.backs).toHaveLength(1);
    // O voltar seguinte desempilha de novo e mostra a inicial.
    c.voltarAoInicio();
    await Promise.resolve();
    expect(c.botsAbertos()).toBe(true);
    expect(m.historia.state).toBeNull();
  });

  it("sem sessão a entrada (no palco) não fica inerte e a inicial não aparece; com sessão, sim", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    expect(m.stage.inert).toBe(false);
    expect(c.botsAbertos()).toBe(false);
    expect(m.app.classList.contains("bots-abertos")).toBe(false);
    c.definirSessao(true);
    expect(m.stage.inert).toBe(true);
    expect(c.botsAbertos()).toBe(true);
    // A sessão caiu (sair, 401): a entrada volta a receber toque.
    c.definirSessao(false);
    expect(m.stage.inert).toBe(false);
  });

  it("recarregar com a marca de antes no histórico: ela é limpa e entrar num bot empilha de novo", async () => {
    const m = montar();
    m.pilha[0] = { nodInicio: "conversa" };
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    expect(m.historia.state).toBeNull();
    c.entrarNaConversa();
    expect(m.historia.state).toEqual({ nodInicio: "conversa" });
    expect(m.pilha).toHaveLength(2);
  });

  it("voltar com a gaveta do bot aberta: a gaveta fecha com a inicial à vista", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    m.app.classList.add("detalhes-abertos");
    c.voltarAoInicio();
    expect(m.app.classList.contains("detalhes-abertos")).toBe(false);
  });

  it("no computador nada empilha nem esconde", async () => {
    const m = montar(false);
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    c.fecharBots();
    c.voltarAoInicio();
    expect(m.historia.state).toBeNull();
    expect(m.backs).toHaveLength(0);
    expect(m.app.classList.contains("bots-abertos")).toBe(false);
  });
});

describe("guardas da ligação no main (revisão do PR #548)", () => {
  const main = readFileSync(new URL("../../../web/main.ts", import.meta.url), "utf8");

  it("a busca vazia que perde o foco não esconde a barra flutuante do celular", () => {
    const ouvinte = main.slice(main.indexOf('document.addEventListener("focusout"'), main.indexOf('document.addEventListener("focusout"') + 600);
    expect(ouvinte).toMatch(/closest\("\.inicio-busca"\)\) \{ redesenharAdiada\(\); return; \}\s*if \(campo\.value\.trim\(\)\) return;[\s\S]*setAttribute\("hidden"/);
  });

  it("abrir as Configurações pelo avatar não esconde a inicial (fechar volta a ela, não à conversa de baixo)", () => {
    const abrir = main.slice(main.indexOf("function abrirEspaco("), main.indexOf("function fecharEspaco("));
    expect(abrir).not.toContain("celular.fecharBots()");
    const fechar = main.slice(main.indexOf("function fecharEspaco("), main.indexOf("function fecharEspaco(") + 700);
    expect(fechar).toContain("#sidebar .me-topo");
  });

  it("a cópia do bot segurado não leva o ⋯ e a dica fica acima da inicial", () => {
    expect(main).toMatch(/segurado-copia"\);\s*for \(const mais of copia\.querySelectorAll\("\.bot-mais"\)\) mais\.remove\(\);/);
    const css = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
    const zDica = Number(/\.dica-toque-longo \{[^}]*z-index: (\d+)/.exec(css)?.[1]);
    const zInicial = Number(/\.sidebar \{[^}]*position: fixed[^}]*z-index: (\d+)/.exec(css)?.[1]);
    expect(zInicial).toBeGreaterThan(0);
    expect(zDica).toBeGreaterThan(zInicial);
  });

  it("o toque longo acha de novo a linha redesenhada durante a espera e diz se abriu o menu", () => {
    const f = main.slice(main.indexOf("function abrirMenuSegurado("), main.indexOf("const toqueLongo = criarToqueLongo"));
    expect(f).toContain("segurada.isConnected ? segurada : linhaRedesenhada(segurada)");
    expect(f).toMatch(/if \(!a \|\| !row\) return false;/);
    expect(f).toContain("return true;");
  });

  it("no celular, navegar ao início mostra a inicial (fechar um Trabalho) em vez de empilhar e cair numa conversa", () => {
    const f = main.slice(main.indexOf("function navegar(tela: Tela)"), main.indexOf("function aoTrocarDeTela("));
    expect(f).toMatch(/const paraInicial = celular\.ativo\(\) && tela\.tipo === "inicio";\s*if \(!paraInicial\) celular\.entrarNaConversa\(\);/);
    // A inicial aparece antes de ler a conversa: a que fica por baixo não é marcada como lida.
    expect(f.indexOf("if (paraInicial) celular.voltarAoInicio();")).toBeGreaterThan(-1);
    expect(f.indexOf("if (paraInicial) celular.voltarAoInicio();")).toBeLessThan(f.indexOf("lerConversaDaTela();"));
    expect(main).toContain("navegar(telaDaTask(telaDeOrigem(), id))");
  });

  it("com a inicial à vista, a gaveta de app do Marketplace não prende o foco (deixaria a inicial inerte)", () => {
    expect(main).toContain("prenderFocoNaGaveta(celular.botsAbertos() ? null : gavetaDoApp);");
  });

  it("Editar perfil e Renomear pelo toque longo entram na conversa (a gaveta do bot não abre por cima da inicial)", () => {
    for (const nome of ["function abrirNivel(", "function renomearNaGaveta("]) {
      const f = main.slice(main.indexOf(nome), main.indexOf(nome) + 500);
      expect(f).toContain("const t = telaDeOrigem();");
    }
  });

  it("com a inicial à vista, o Esc não age na tela escondida (gaveta do app, Marketplace, Trabalho, linha)", () => {
    const escs = main.split("\n").filter((l) => /ev\.key === "Escape" && (estado\.tela\.tipo === "conectores"|\(estado\.tela\.tipo === "trabalho")/.test(l));
    expect(escs).toHaveLength(3);
    for (const l of escs) expect(l).toContain("!celular.botsAbertos()");
  });

  it("o vazio conta os bots sem o Nod (ele está sempre lá)", () => {
    expect(main).toContain("bots: comuns.length + daEquipe.length");
  });

  it("mutantes do QA 2: a gaveta só some na inicial; no conversa, repintar não a fecha nem acende a inicial", async () => {
    const m = montar();
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    expect(m.app.classList.contains("bots-abertos")).toBe(false);
    expect(m.stage.inert).toBe(false);
    m.app.classList.add("detalhes-abertos");
    // Repintar (a sessão cai e volta) com a conversa aberta: a gaveta do bot continua aberta.
    c.definirSessao(false);
    c.definirSessao(true);
    expect(m.app.classList.contains("detalhes-abertos")).toBe(true);
    expect(m.app.classList.contains("bots-abertos")).toBe(false);
    expect(m.sidebar.inert).toBe(true);
  });

  it("mutantes do QA 2: no computador a barra lateral nunca fica inerte", async () => {
    const m = montar(false);
    const { criarCelular } = await import("../../../web/lib/gaveta-bots.ts");
    const c = criarCelular();
    c.definirSessao(true);
    c.entrarNaConversa();
    expect(m.sidebar.inert).toBe(false);
    expect(m.stage.inert).toBe(false);
    expect(m.app.classList.contains("bots-abertos")).toBe(false);
  });

  it("QA 2: o Tentar de novo da frota relê na hora (não só marca a invalidação, que a rede caída deixava presa)", () => {
    const trecho = main.slice(main.indexOf('"tentar-frota":'), main.indexOf('"ver-favoritos":'));
    expect(trecho).toContain("tentarFrotaAgora");
    expect(trecho).toContain("buscar: buscarFrota");
    expect(trecho).not.toContain('tipo: "invalidar"');
  });
});
