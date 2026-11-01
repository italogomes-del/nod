import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-442 no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - o quadro de verdade desenha os cards; abrir uma tarefa mostra o detalhe com o painel lateral;
 *  - ajuste v2 do Gil (protótipo nod-442 @ fbfc5ec): acima de 700 px a caixa de recado segue o eixo e a largura da
 *    coluna da tarefa (o painel é coluna própria à direita); no protótipo, 574/574 a 1440 e 608/608 a 1508. Abaixo de
 *    700, nada muda: o painel desce para baixo da tarefa e a caixa ocupa a largura;
 *  - a conversa no quadro: enviar → "Mexendo no quadro…" → a resposta do bot com Desfazer → desfazer;
 *  - o frame `quadro.mudou` acende o card que mudou (ao vivo, sem trocar de tela).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
// No job do CI que instala o Chromium (NOD_QA_EXIGE_CHROME=1) a falta é erro, não pulo silencioso.
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-442: o CI precisa do Chrome para provar o quadro (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
const agora = 1_700_000_000_000;
const tarefa = (id, titulo, status, extra = {}) => ({ id, quadroId: "q1", titulo, descricao: "Descrição de " + titulo, status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "Ada", ...extra });
const base = () => ({ id: "q1", agenteId: "a", meta: "Lançar a jornada do quadro", prazo: "2026-11-06", cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 1, total: 4, tarefas: [
    tarefa("t1", "Escrever o executor das ações", "fazendo", { execucao: "rodando" }),
    tarefa("t2", "Trocar o token do Linear", "voce", { pergunta: "Qual workspace do Linear?" }),
    tarefa("t3", "Abrir o PR da tela", "revisao", { prUrl: "https://github.com/gamefik/nod/pull/612", linearId: "NOD-442", linearUrl: "https://linear.app/x/NOD-442" }),
    tarefa("t4", "Plano da jornada", "feito"),
  ] });
let q = base();
const fala = (id, autor, texto) => ({ tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: agora,
  autoria: autor === "eu" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" } });
let mensagens = [];
const chamadas = [];
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  conversa: async () => ({ mensagens: structuredClone(mensagens) }),
  enviar: async (c, texto) => { chamadas.push(["enviar", texto]); mensagens.push(fala("m" + mensagens.length, "eu", texto)); return { ok: true, ids: { mensagem: "m" + (mensagens.length - 1) } }; },
  responderTarefa: async (a, id, resposta) => { chamadas.push(["responder", id, resposta]); return { ok: true, quadro: q, lote: null, desfeito: false }; },
  desfazerLoteQuadro: async (a, lote) => { chamadas.push(["desfazer", lote]); q = { ...q, tarefas: q.tarefas.filter((t) => t.id !== "t5"), ultimoLote: null }; return { ok: true, quadro: q, lote: null, desfeito: true }; },
};
window.__chamadas = chamadas;
/** O bot "responde": cria uma tarefa (lote L1), fala na conversa e manda os frames, como o servidor. */
window.__botResponde = () => {
  q = { ...q, tarefas: [...q.tarefas, tarefa("t5", "Gravar o vídeo do roteiro", "afazer")],
    ultimoLote: { id: "L1", quadroId: "q1", autor: { tipo: "agente", agenteId: "a" }, resumo: "criou 1 tarefa", tarefaIds: ["t5"], desfeitoEm: null, criadoEm: agora } };
  mensagens.push(fala("m" + mensagens.length, "bot", "Pus **Gravar o vídeo** em A fazer."));
  window.__q.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L1", tarefas: "t5" } });
  window.__q.aoFrame({ streamId: "s", seq: 2, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/** O bot fala antes de mexer no quadro (uma fala intermediária do mesmo turno, sem lote). */
window.__botFalaAntes = () => {
  mensagens.push(fala("m" + mensagens.length, "bot", "Vou olhar o quadro."));
  window.__q.aoFrame({ streamId: "s", seq: 0, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/** Outro aparelho (ou outro bot) mudou uma tarefa: só o frame chega. */
window.__mudouLa = () => {
  q = { ...q, tarefas: q.tarefas.map((t) => t.id === "t1" ? { ...t, status: "revisao", mudadoEm: agora + 5 } : t) };
  window.__q.aoFrame({ streamId: "s", seq: 3, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L2", tarefas: "t1" } });
};
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const ad = '<span class="avatar">A</span>';
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => id === "a" ? { avatar: ad, nome: "Ada" } : null,
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10 } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "jornada.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-442 no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod442-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9000 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };

  async function abrir(largura: number): Promise<void> {
    const celular = largura < 700;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
    ] });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector("#quadro .qd-card")`);
  }

  const abrirTarefa = async (id: string) => {
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="${id}"]')].find((b) => b.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-tarefa")`);
  };

  type Eixos = { caixa: { x: number; w: number }; coluna: { x: number; w: number }; lado: { x: number; y: number; w: number }; colunaFim: number; vista: number; rolagem: number };
  const eixos = () => avaliar<Eixos>(cdp, `(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const p = r("#quadro .qc-pil"), c = r("#quadro .qd-t-principal"), l = r("#quadro .qd-lado");
    return { caixa: { x: (p.left + p.right) / 2, w: p.width }, coluna: { x: (c.left + c.right) / 2, w: c.width }, lado: { x: l.left, y: l.top, w: l.width },
      colunaFim: c.bottom, vista: ((v, cs) => v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))(document.querySelector("#quadro"), getComputedStyle(document.querySelector("#quadro"))), rolagem: document.getElementById("quadro").scrollWidth - document.getElementById("quadro").clientWidth };
  })()`);

  it("o quadro de verdade: os cards nas colunas, o código, a pergunta no card de Você e o PR como etiqueta", async () => {
    await abrir(1440);
    const r = await avaliar<{ cards: number; voce: string; pr: string; meta: string }>(cdp, `(() => ({
      cards: document.querySelectorAll("#quadro .qd-so-largo .qd-card").length,
      voce: document.querySelector('#quadro .qd-so-largo [data-id="t2"]').closest(".qd-card").textContent,
      pr: document.querySelector('#quadro .qd-so-largo [data-id="t3"]').closest(".qd-card").textContent,
      meta: document.querySelector("#quadro .qd-conteudo").textContent }))()`);
    expect(r.cards).toBe(4);
    expect(r.voce).toContain("Qual workspace do Linear?");
    expect(r.pr).toContain("PR #612");
    expect(r.pr).toContain("NOD-442");
    expect(r.meta).toContain("até 6 nov");
  });

  // O corte é a largura de conteúdo da vista do quadro (container query), não a da janela: em 768 e 1024 a barra lateral deixa a vista
  // com 700px ou menos, e vale o layout estreito (revisão rodada 5: o tablet também é medido).
  for (const largura of [768, 1024]) {
    it(`ajuste v2 do Gil · ${largura}px de janela: com a vista de 700px ou menos, nada muda (o painel desce, a caixa no eixo)`, async () => {
      await abrir(largura);
      await abrirTarefa("t3");
      const e = await eixos();
      process.stdout.write(`[NOD-442] ${largura}px: vista ${e.vista}px\n`);
      if (e.vista > 700) {
        expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(e.caixa.w - e.coluna.w)).toBeLessThanOrEqual(1);
        expect(e.lado.x).toBeGreaterThan(e.coluna.x + e.coluna.w / 2);
      } else {
        expect(e.lado.y).toBeGreaterThanOrEqual(e.colunaFim - 1);
        expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
        expect(e.caixa.w).toBeLessThanOrEqual(641);
      }
      expect(e.rolagem).toBeLessThanOrEqual(0);
    });
  }

  for (const largura of [1440, 1508, 1920, 2560]) {
    it(`ajuste v2 do Gil · ${largura}px: no detalhe com painel, a caixa de recado tem o eixo e a largura da coluna da tarefa; o painel é coluna à direita`, async () => {
      await abrir(largura);
      await abrirTarefa("t3");
      const e = await eixos();
      process.stdout.write(`[NOD-442] ${largura}px: eixo da caixa ${e.caixa.x.toFixed(1)} / eixo da coluna ${e.coluna.x.toFixed(1)}; larguras ${e.caixa.w.toFixed(1)} / ${e.coluna.w.toFixed(1)}\n`);
      expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(e.caixa.w - e.coluna.w)).toBeLessThanOrEqual(1);
      expect(e.lado.x).toBeGreaterThan(e.coluna.x + e.coluna.w / 2);
      expect(e.rolagem).toBeLessThanOrEqual(0);
    });
  }

  it("ajuste v2 do Gil · 390px (celular): nada muda — o painel desce para baixo da tarefa e a caixa fica com a largura da tela", async () => {
    await abrir(390);
    await abrirTarefa("t3");
    const e = await eixos();
    expect(e.lado.y).toBeGreaterThanOrEqual(e.colunaFim - 1);
    expect(e.caixa.w).toBeGreaterThan(300);
    expect(Math.abs(e.caixa.x - 195)).toBeLessThanOrEqual(2);
    expect(e.rolagem).toBeLessThanOrEqual(0);
  });

  it("a resposta da tarefa em Você sai pela rota de responder, com o texto da pessoa", async () => {
    await abrir(1440);
    await abrirTarefa("t2");
    await avaliar(cdp, `(() => { const t = document.querySelector("#quadro .qd-resp-in"); t.value = "O do EngNod"; t.form.requestSubmit(); })()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    expect(await avaliar(cdp, "window.__chamadas.find((c) => c[0] === 'responder')")).toEqual(["responder", "t2", "O do EngNod"]);
  });

  it("conversa no quadro: enviar → Mexendo no quadro… → a resposta do bot com Desfazer; o card novo acende; Desfazer tira", async () => {
    await abrir(1440);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "Põe gravar o vídeo em A fazer"; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
    await ate(`document.querySelector("#quadro .qc-aguarda")`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa").textContent`)).toContain("Mexendo no quadro");
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("");
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.querySelector("#quadro .qc-ok")`);
    const r = await avaliar<{ faixa: string; brilho: boolean; desfazer: boolean }>(cdp, `({ faixa: document.getElementById("qc-faixa").textContent,
      brilho: !!document.querySelector('#quadro .qd-so-largo [data-id="t5"]')?.closest(".qd-brilho"),
      desfazer: !!document.querySelector('#quadro [data-act="qc-desfazer"][data-id="L1"]') })`);
    expect(r.faixa).toContain("Pus Gravar o vídeo em A fazer.");
    expect(r.brilho).toBe(true);
    expect(r.desfazer).toBe(true);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="qc-desfazer"]').click()`);
    await ate(`!document.querySelector('#quadro .qd-so-largo [data-id="t5"]')`);
    expect(await avaliar(cdp, "window.__chamadas.find((c) => c[0] === 'desfazer')")).toEqual(["desfazer", "L1"]);
  });

  it("conversa no quadro: depois de uma fala intermediária do bot, a fala final ainda sobe na faixa com o Desfazer (codex rodada 6)", async () => {
    await abrir(1440);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "Põe gravar o vídeo em A fazer"; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
    await ate(`document.querySelector("#quadro .qc-aguarda")`);
    await avaliar(cdp, "window.__botFalaAntes()");
    await ate(`document.getElementById("qc-faixa").textContent.includes("Vou olhar o quadro.")`);
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pus Gravar o vídeo em A fazer.")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro [data-act="qc-desfazer"][data-id="L1"]')`)).toBe(true);
  });

  it("ao vivo: o frame quadro.mudou de outro aparelho move o card e o acende, sem trocar de tela", async () => {
    await abrir(1440);
    await avaliar(cdp, "window.__mudouLa()");
    await ate(`document.querySelector('#quadro .qd-so-largo [data-id="t1"]')?.closest(".qd-brilho")`);
    const col = await avaliar<string>(cdp, `document.querySelector('#quadro .qd-so-largo [data-id="t1"]').closest(".qd-col").textContent`);
    expect(col).toContain("Em revisão");
  });
});
