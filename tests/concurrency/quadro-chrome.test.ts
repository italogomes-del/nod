import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-429: os dois comentários finais do Marlon provados no Chrome de verdade, com o CSS e o JS do app (sem servidor):
 *  - j4-5: a recusa da trava ("Feito só aceita vindo de Em revisão · Mandar para Em revisão") cabe no card, na coluna
 *    mais estreita (192 px) e na lista do celular (390);
 *  - j7-1: a troca Conversa ↔ Quadro desliza nos dois sentidos (indicador e conteúdo, 220 ms) e, com Reduzir movimento,
 *    vira um fade sem deslocamento.
 * Sem Chrome na máquina, o teste é pulado (o CI instala o do playwright).
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { estadoInicial, reduzir } from "./web/estado/reducer.ts";
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { renderCabecalhoConversa } from "./web/telas/conversa.ts";
import { card, linha } from "./web/telas/quadro.ts";
const C = "c1";
const conversa = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
  mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
const e = { ...reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 }), sessao: { pessoaId: "p", tenantId: "t" },
  tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
  frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square", ownerId: "p" }] } };
const recusa = { texto: "Feito só aceita vindo de Em revisão", acao: "Mandar para Em revisão", recusa: true };
const tarefa = { id: "NOD-512", titulo: "Ligar o quadro ao turno do agente", aviso: recusa, tags: ["web"], quando: "agora" };
window.__card = card(tarefa);
window.__linha = linha(tarefa);
/** Monta o palco como o main.ts: o cabeçalho real da conversa (com ou sem o quadro) e a troca nos nós vivos. */
window.__montar = (comQuadro) => {
  const cab = document.getElementById("cabecalho");
  cab.classList.add("cabecalho-pilula");
  cab.innerHTML = renderCabecalhoConversa(e, "a", { comQuadro });
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  window.__trocas = [];
  // Quem ouve a troca (o main lê a conversa na volta) precisa ver o modo novo no momento da chamada.
  const q = criarQuadroNaTela(document, { aoTrocar: (m) => window.__trocas.push(m + ":" + q.modo()) });
  q.sincronizar(comQuadro ? { chave: C, nome: "Ada" } : { chave: null, nome: "" });
  window.__quadro = q;
};
/** O render regrava o cabeçalho (mascote, presença): o segmento é outro nó. */
window.__regravar = () => {
  document.getElementById("cabecalho").innerHTML = renderCabecalhoConversa(e, "a", { comQuadro: true });
  window.__quadro.sincronizar({ chave: C, nome: "Ada" });
};
`;

/** O index.html de verdade, com todos os CSS do app embutidos na ordem dele e o JS do teste no lugar do main.ts. */
async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "quadro.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-429 no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod429-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000); // o abrirChrome espera a porta até 80 s (a 1ª abertura no runner é lenta): o erro dele aparece antes do prazo do hook
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  /** 1440 é o computador; 390 é o celular de verdade (toque, sem hover: a CONSULTA_CELULAR do mobile.css casa). */
  async function abrir(largura: number, reduzido: boolean, comQuadro = true, deitado = false): Promise<void> {
    const celular = largura < 700 || deitado;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: deitado ? 390 : celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: reduzido ? "reduce" : "no-preference" },
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
    ] });
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montar")); i++) await esperar(50);
    await avaliar(cdp, `window.__montar(${comQuadro})`);
  }

  /**
   * Clica numa aba e devolve os quadros-chave das animações de quem entra e de quem sai. Com `pausarEm`, para tudo (o
   * deslize e a transição do indicador) nesse ponto, no mesmo passo do clique: a máquina carregada não chega ao fim antes.
   */
  const trocar = (modo: string, pausarEm?: number) => avaliar<{ quadro: string[]; timeline: string[]; ms: number; easing: string }>(cdp, `(() => {
    document.querySelector('#cabecalho [data-modo="${modo}"]').click();
    ${pausarEm === undefined ? "" : `for (const a of document.getAnimations()) { a.pause(); a.currentTime = ${pausarEm}; }`}
    const kf = (id) => (document.getElementById(id).getAnimations()[0]?.effect.getKeyframes() ?? []).map((k) => (k.transform ?? "-").replace("(0px)", "(0)"));
    const t = document.getElementById("quadro").getAnimations()[0]?.effect.getTiming();
    return { quadro: kf("quadro"), timeline: kf("timeline"), ms: t?.duration ?? 0, easing: t?.easing ?? "" };
  })()`);
  /** Espera as animações e transições em curso acabarem de fato (prazo fixo estoura na máquina carregada) e mais um respiro. */
  const acabar = () => avaliar(cdp, `Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))).then(() => new Promise((r) => setTimeout(r, 50)))`);
  const xDoIndicador = () => avaliar<number>(cdp, `new DOMMatrix(getComputedStyle(document.querySelector(".qd-seg-ind")).transform).m41`);
  const xDaVista = () => avaliar<number>(cdp, `new DOMMatrix(getComputedStyle(document.getElementById("quadro")).transform).m41`);
  const estadoFinal = () => avaliar<{ atual: string; quadroOculto: boolean; timelineVis: string; timelineInert: boolean; selecionada: string | null }>(cdp, `({
    atual: document.querySelector(".qd-seg").dataset.atual, quadroOculto: document.getElementById("quadro").hidden,
    timelineVis: getComputedStyle(document.getElementById("timeline")).visibility, timelineInert: document.getElementById("timeline").inert,
    selecionada: document.querySelector('.qd-seg [aria-selected="true"]')?.dataset.modo ?? null })`);

  /** Onde o aviso de recusa fica em relação ao seu card (ou linha), dentro da vista real do quadro. */
  const medirRecusa = (sel: string) => avaliar<{ dentro: boolean; transborda: boolean; linhas: number; title: string; largura: number }>(cdp, `(() => {
    const av = document.querySelector(${JSON.stringify(sel)} + " .qd-aviso-recusa");
    const box = av.closest(".qd-card, .qd-l");
    const a = av.getBoundingClientRect(), b = box.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(av).lineHeight);
    return { dentro: a.left >= b.left - 0.5 && a.right <= b.right + 0.5, transborda: box.scrollWidth > box.clientWidth + 1, linhas: Math.round(a.height / lh), title: av.title, largura: b.width };
  })()`);

  it("j4-5 · 1440px: na coluna real do quadro (a mais estreita), a recusa da trava fica dentro do card, quebrando linha, com o texto inteiro no title", async () => {
    await abrir(1440, true);
    await trocar("quadro");
    await acabar();
    // A coluna mais estreita da grade: o card entra nela, como a NOD-415 vai pôr.
    await avaliar(cdp, `(() => {
      const cols = [...document.querySelectorAll("#quadro .qd-so-largo .qd-col:not(.qd-col-recolhida)")];
      const alvo = cols.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
      alvo.querySelector(".qd-col-lista").innerHTML = window.__card;
    })()`);
    const r = await medirRecusa("#quadro .qd-so-largo");
    expect(r.largura).toBeLessThan(240);
    expect(r.dentro).toBe(true);
    expect(r.transborda).toBe(false);
    expect(r.linhas).toBeGreaterThanOrEqual(2);
    expect(r.title).toBe("Feito só aceita vindo de Em revisão · Mandar para Em revisão");
  }, 30_000);

  it("j4-5 · 390px (celular, toque): o quadro vira lista, e a recusa na linha fica dentro dela; a cápsula da pílula cabe na tela", async () => {
    await abrir(390, true);
    await trocar("quadro");
    await acabar();
    expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector("#quadro .qd-so-largo")).display`)).toBe("none");
    await avaliar(cdp, `document.querySelector("#quadro .qd-so-estreito .qd-lg-lista").innerHTML = window.__linha`);
    const l = await medirRecusa("#quadro .qd-so-estreito");
    expect(l.dentro).toBe(true);
    expect(l.transborda).toBe(false);
    expect(l.title).toBe("Feito só aceita vindo de Em revisão · Mandar para Em revisão");
    const pil = await avaliar<{ esq: number; dir: number; abas: number[]; nomes: string[] }>(cdp, `(() => {
      const r = document.querySelector("#cabecalho .qd-pil").getBoundingClientRect();
      const abas = [...document.querySelectorAll("#cabecalho .qd-seg-bt")];
      return { esq: r.left, dir: r.right, abas: abas.map((a) => a.getBoundingClientRect().width), nomes: abas.map((a) => a.getAttribute("aria-label")) };
    })()`);
    expect(pil.esq).toBeGreaterThanOrEqual(0);
    expect(pil.dir).toBeLessThanOrEqual(390);
    // Só ícones no celular (a CONSULTA_CELULAR casou), e o nome segue para o leitor de tela.
    expect(pil.abas).toEqual([44, 44]);
    expect(pil.nomes).toEqual(["Conversa", "Quadro"]);
  }, 30_000);

  for (const [largura, deitado] of [[390, false], [844, true]] as const) {
    it(`revisão 4 do PR 606: celular ${deitado ? "deitado (844×390, a grade)" : "em pé (390, a lista)"}: todo alvo do quadro e da cápsula tem 44 px e nada rola de lado`, async () => {
      await abrir(largura, false, true, deitado);
      await trocar("quadro");
      await acabar();
      const r = await avaliar<{ pequenos: string[]; rolagem: number; botoes: number }>(cdp, `(() => {
        const bts = [...document.querySelectorAll("#quadro button, #cabecalho .qd-pil button")].filter((b) => b.getClientRects().length);
        const pequenos = bts.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.className + ":" + Math.round(b.getBoundingClientRect().height));
        return { pequenos, rolagem: document.documentElement.scrollWidth, botoes: bts.length };
      })()`);
      expect(r.botoes).toBeGreaterThan(5);
      expect(r.pequenos).toEqual([]);
      expect(r.rolagem).toBeLessThanOrEqual(largura);
    }, 30_000);
  }

  it("j7-1 · 1440px: ida e volta deslizam de lado (220 ms) e o indicador anda na pílula", async () => {
    await abrir(1440, false);
    const largura = await avaliar<number>(cdp, `document.querySelector(".qd-seg-ind").getBoundingClientRect().width`);
    const ida = await trocar("quadro", 110);
    expect(ida.ms).toBe(220);
    expect(ida.easing).toMatch(/cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
    expect(ida.quadro).toEqual(["translateX(48px)", "translateX(0)"]);
    expect(ida.timeline).toEqual(["translateX(0)", "translateX(-48px)"]);
    // Parado no meio (110 de 220 ms): o indicador está a caminho, e a transição dele existe (sem ela, já estaria no fim).
    expect(await avaliar<number>(cdp, `document.querySelector(".qd-seg-ind").getAnimations().length`)).toBeGreaterThan(0);
    const meio = await xDoIndicador();
    expect(meio).toBeGreaterThan(1);
    expect(meio).toBeLessThan(largura - 1);
    await avaliar(cdp, `for (const a of document.getAnimations()) a.play()`);
    await acabar();
    // Pousa exatamente na aba Quadro, e a cápsula não mudou de largura com a troca.
    expect(await xDoIndicador()).toBeCloseTo(largura, 0);
    expect(await avaliar<number>(cdp, `document.querySelector(".qd-seg-ind").getBoundingClientRect().left - document.querySelector('.qd-seg [data-modo="quadro"]').getBoundingClientRect().left`)).toBeCloseTo(0, 0);
    expect(await estadoFinal()).toEqual({ atual: "quadro", quadroOculto: false, timelineVis: "hidden", timelineInert: true, selecionada: "quadro" });
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#quadro .qd-so-largo .qd-col").length`)).toBe(8);

    const volta = await trocar("conversa");
    expect(volta.quadro).toEqual(["translateX(0)", "translateX(48px)"]);
    expect(volta.timeline).toEqual(["translateX(-48px)", "translateX(0)"]);
    await acabar();
    expect(await xDoIndicador()).toBeCloseTo(0, 0);
    expect(await estadoFinal()).toEqual({ atual: "conversa", quadroOculto: true, timelineVis: "visible", timelineInert: false, selecionada: "conversa" });
  }, 30_000);

  it("j7-1 · voltar no meio da ida inverte do ponto onde está, sem salto, e assenta na Conversa", async () => {
    await abrir(1440, false);
    // Pausa a ida em 80 ms (sem depender do relógio da máquina, que sob carga atrasa o primeiro quadro) e mede de lá.
    await avaliar(cdp, `document.querySelector('#cabecalho [data-modo="quadro"]').click(); for (const a of document.getAnimations()) { a.pause(); a.currentTime = 80; }`);
    const antes = await xDaVista();
    expect(antes).toBeGreaterThan(2);
    expect(antes).toBeLessThan(46);
    await avaliar(cdp, `document.querySelector('#cabecalho [data-modo="conversa"]').click()`);
    const depois = await xDaVista();
    // A mesma animação anda para trás a partir dos 80 ms (não recomeça nem segue para a frente). Sem medir o relógio: depois do
    // `ready` a taxa pendente do reverse() já vale, então ela é negativa e o tempo não passou de 80 (a CI da main pegou o
    // "currentTime < 80" com a máquina carregada, sem nenhum quadro entre o play e a leitura).
    const inv = await avaliar<{ taxa: number; t: number }>(cdp, `(async () => {
      for (const a of document.getAnimations()) a.play();
      const a = document.getElementById("quadro").getAnimations()[0];
      await a.ready;
      return { taxa: a.playbackRate, t: Number(a.currentTime) };
    })()`);
    expect(inv.taxa).toBeLessThan(0);
    expect(inv.t).toBeLessThanOrEqual(80);
    expect(inv.t).toBeGreaterThan(0);
    expect(Math.abs(depois - antes)).toBeLessThan(6);
    // Espera a volta acabar de fato (não um prazo fixo, que a máquina carregada estoura) e mais um quadro para o assentar.
    await acabar();
    expect(await estadoFinal()).toEqual({ atual: "conversa", quadroOculto: true, timelineVis: "visible", timelineInert: false, selecionada: "conversa" });
    // A inversão também avisa quem ouve, já com o modo novo.
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["quadro:quadro", "conversa:conversa"]);
  }, 30_000);

  it("revisão 2 do PR 606: quem ouve a troca (a leitura da conversa na volta) já vê o modo novo", async () => {
    await abrir(1440, false);
    await trocar("quadro");
    await acabar();
    await trocar("conversa");
    await acabar();
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["quadro:quadro", "conversa:conversa"]);
  }, 30_000);

  it("revisão 2 do PR 606: depois que a pessoa clica fora da aba, a regravação não puxa o foco de volta (← → não trocam sem querer)", async () => {
    await abrir(1440, false);
    const clicar = async (x: number, y: number) => {
      for (const type of ["mousePressed", "mouseReleased"]) await cdp.enviar("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    };
    const aba = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('#cabecalho [data-modo="conversa"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await clicar(aba.x, aba.y);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.modo ?? ""`)).toBe("conversa");
    // Regravar com o foco ainda na aba: o foco vai para a aba nova.
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.modo ?? ""`)).toBe("conversa");
    await clicar(700, 500); // o vazio da conversa: o foco cai no body
    expect(await avaliar<string>(cdp, `document.activeElement.tagName`)).toBe("BODY");
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.tagName`)).toBe("BODY");
  }, 30_000);

  it("j7-1 · teclado: → vai ao Quadro com o foco na aba, ⇧→ não troca, e o foco sobrevive à regravação do cabeçalho", async () => {
    await abrir(1440, false);
    await avaliar(cdp, `document.querySelector('#cabecalho [data-modo="conversa"]').focus()`);
    const tecla = async (modifiers = 0) => {
      await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers });
      await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers });
    };
    await avaliar(cdp, `window.__teclas = []; document.addEventListener("keydown", (e) => window.__teclas.push(e.key + ":" + e.shiftKey), true)`);
    await tecla(8); // ⇧→ (seleção/atalho): não é a seta da aba
    expect(await avaliar<string[]>(cdp, `window.__teclas`)).toEqual(["ArrowRight:true"]);
    expect(await avaliar<string>(cdp, `document.querySelector(".qd-seg").dataset.atual`)).toBe("conversa");
    await tecla();
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.modo`)).toBe("quadro");
    await acabar();
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.modo`)).toBe("quadro");
    // O segmento novo nasce no lugar: sem transição do indicador desde a Conversa.
    expect(await xDoIndicador()).toBeGreaterThan(20);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro", selecionada: "quadro" });
  }, 30_000);

  it("flag desligada: a pílula é a de sempre e a troca não mexe no palco (nem no inert de outra camada)", async () => {
    await abrir(1440, false, false);
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#cabecalho .qd-pil, #cabecalho .qd-seg").length`)).toBe(0);
    await avaliar(cdp, `document.getElementById("timeline").inert = true; window.__quadro.sincronizar({ chave: null, nome: "" })`);
    expect(await avaliar<boolean>(cdp, `document.getElementById("timeline").inert`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.getElementById("quadro").hidden`)).toBe(true);
  }, 30_000);

  for (const largura of [1440, 390]) {
    it(`j7-1 · ${largura}px com Reduzir movimento: fade curto, sem transform no conteúdo nem no indicador`, async () => {
      await abrir(largura, true);
      const ida = await trocar("quadro");
      expect(ida.ms).toBe(120);
      expect(ida.quadro).toEqual(["-", "-"]);
      expect(ida.timeline).toEqual(["-", "-"]);
      await esperar(40);
      expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector(".qd-seg-ind")).transform`)).toBe("none");
      await acabar();
      // Sem o indicador andando, a aba escolhida precisa de marca própria (fundo).
      expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector('.qd-seg [aria-selected="true"]')).backgroundColor`)).not.toBe("rgba(0, 0, 0, 0)");
      expect(await estadoFinal()).toMatchObject({ atual: "quadro", quadroOculto: false, timelineVis: "hidden" });
      const volta = await trocar("conversa");
      expect(volta.quadro).toEqual(["-", "-"]);
    }, 30_000);
  }
});
