import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { ADIAR_ATE_MS, GESTO_MS, TOQUE_PARADO_MS } from "../../web/lib/quadro.ts";

/**
 * ADA-7 no Chrome de verdade, em 390×844 (toque) e 1440×900: a pessoa rola o quadro e a tarefa aberta até o fim, um
 * frame `quadro.mudou` regrava a vista e a rolagem fica onde estava. Reprodução antes da correção (registrada na tarefa):
 * - tarefa aberta, foco no título (`abrirTarefa` o foca), rolada até o fim: o scrollTop ia a 0 (390: 2029 → 0; 1440:
 *   1582 → 0), porque o foco devolvido depois do innerHTML rolava até o título recriado;
 * - quadro no computador: o scrollLeft da `.qd-grade` ia de 400 a 0 a cada frame (a grade nasce de novo);
 * - foco num card: o foco caía no body (o card não tem id);
 * - `turno.delta` de OUTRA conversa relia e regravava o quadro inteiro (no app, ~4 vezes por segundo com qualquer bot
 *   escrevendo), o que trava o toque e contraria a ADR-061.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADA-7: o CI precisa do Chrome para provar a rolagem do quadro (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { criarQuadroCompartilhadoNaTela } from "./web/lib/quadro-compartilhado-na-tela.ts";
import { guardarRolagem, restaurarRolagem } from "./web/lib/rolagem-guardada.ts";
window.__rolagem = { guardarRolagem, restaurarRolagem };
const agora = 1_700_000_000_000;
// O relógio da página, controlado: cada montagem começa no início de um minuto (o "quadro igual" só vale no mesmo minuto,
// e a virada no meio de um teste o deixava intermitente) e __virarMinuto() prova a regra do minuto.
const relogio = Date.now.bind(Date);
let desvio = 0;
Date.now = () => relogio() + desvio;
window.__inicioDoMinuto = () => { desvio += 60_000 - (Date.now() % 60_000) + 200; };
window.__virarMinuto = () => { desvio += 60_000; };
const STS = ["backlog", "afazer", "fazendo", "revisao", "voce", "feito"];
const tarefa = (i) => ({ id: "t" + i, quadroId: "q1", titulo: "Tarefa número " + i + " com um título razoável", descricao: "linha\\n".repeat(80),
  status: STS[i % STS.length], agenteId: "a", ordem: i, linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false,
  turnoId: "tu1", criadoEm: agora, mudadoEm: agora, terminadaEm: null, execucao: "rodando", agenteNome: "Ada" });
let versao = 0;
const q = () => ({ id: "q1", agenteId: "a", meta: window.__meta ?? "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora + versao,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 90, tarefas: Array.from({ length: 90 }, (_, i) => ({ ...tarefa(i), mudadoEm: agora + (i === 3 ? versao : 0) })) });
window.__lidas = 0;
const api = {
  quadro: async () => { window.__lidas++; await new Promise((r) => setTimeout(r, window.__latencia ?? 0)); return { quadro: q() }; },
  // Com __respondeu, o pedido da pílula (m9) e a resposta do bot (m10): a faixa relê o quadro para o Desfazer.
  conversa: async () => ({ mensagens: [...Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, autoria: { autor_tipo: i % 2 ? "agente" : "pessoa", autor_id: "a" },
    texto: "mensagem " + i + " " + "palavra ".repeat(60), criadoEm: agora + i, kind: "texto", parcial: false })),
    ...(window.__respondeu ? [{ id: "m9", autoria: { autor_tipo: "pessoa", autor_id: "p" }, texto: "oi", criadoEm: agora + 9, kind: "texto", parcial: false },
      { id: "m10", autoria: { autor_tipo: "agente", autor_id: "a" }, texto: "Feito", criadoEm: agora + 10, kind: "texto", parcial: false }] : [])] }),
  // A recusa do servidor (o quadro não mudou): a releitura redesenha e o select volta ao valor real.
  mudarTarefa: async () => { await new Promise((r) => setTimeout(r, window.__latencia ?? 0)); if (window.__mudarOk) { versao++; return { quadro: q() }; } throw new Error("recusada"); },
  enviar: async () => ({ ids: { mensagem: "m9" } }),
  // Muda a cada __mudou: a tarefa aberta tem o que redesenhar quando o frame a cita.
  // Com __trabVivo, um trabalho rodando (o turno "tv"): os deltas dele reescrevem o log da tarefa aberta.
  trabalhosDaTarefa: async () => ({ execucoes: window.__trabVivo ? [{ id: "e1", numero: 1, origem: "inicio", turnoId: "tv", motivo: null, criadoEm: agora,
    estado: "rodando", turnoAtual: "tv", comecouEm: agora, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null }] : [],
    recados: [], conversaId: "c" + versao, semAgente: false }),
  historicoTarefa: async () => ({ historico: [] }),
  // Os comentários mudam só com __comentou(): a tarefa aberta tem o que redesenhar sem o trabalho mudar.
  comentariosDaTarefa: async () => ({ comentarios: Array.from({ length: window.__coms ?? 0 }, (_, i) => ({ id: "k" + i, quadroId: "q1", tarefaId: "t3", autor: { tipo: "pessoa" },
    texto: "comentário " + i, deFora: false, criadoEm: agora + i, autorNome: "Marlon", acionados: [] })), atividade: [], criadaPor: null }),
  // Com a passagem, os cards nascem arrastáveis (o arrasto entre colunas).
  definirPassagem: async () => ({ quadro: q() }),
};
const frame = (tipo, dados) => window.__q.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados });
// A atualização do quadro: uma tarefa mudou de verdade (a releitura traz outra versão).
window.__mudou = () => { versao++; frame("quadro.mudou", { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t3" }); };
// Um comentário novo na tarefa t3 (o quadro e o trabalho iguais).
window.__comentou = () => { window.__coms = (window.__coms ?? 0) + 1; frame("quadro.mudou", { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t3" }); };
// A releitura que traz o mesmo quadro (o frame da própria resposta, o reconectar).
window.__mesmo = () => frame("quadro.mudou", { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "" });
window.__meta2 = () => { window.__meta = "Meta nova"; frame("quadro.mudou", { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "" }); };
window.__encerrou = () => frame("turno.encerrado", { conversaId: "c9", turnoId: "x" });
window.__delta = () => frame("turno.delta", { conversaId: "c9", turnoId: "x", texto: "abc" });
window.__passoVivo = (n) => frame("turno.atividade", { conversaId: "c0", turnoId: "tv", rotulo: "Passo " + n, id: "p" + n });
window.__montar = () => {
  window.__inicioDoMinuto();
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: () => ({ avatar: "<span>A</span>", nome: "Ada" }),
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, agentes: () => [{ id: "a", nome: "Ada" }] } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
// O quadro da dona na tela de quem participa (NOD-455): o casco #qcp na conversa, como o main o põe.
window.__montarQcp = () => {
  document.getElementById("timeline").innerHTML = '<div id="qcp" class="qcp-casco"></div>';
  const apiQcp = { quadroPorId: async () => { window.__lidas++; await new Promise((r) => setTimeout(r, window.__latencia ?? 0)); return { quadro: q() }; }, atividadeDoQuadro: async () => ({ linhas: [] }) };
  const c = criarQuadroCompartilhadoNaTela(document, { api: () => apiQcp, agente: () => ({ avatar: "<span>A</span>", nome: "Ada" }), hora: () => "10:00",
    agendar: (f) => setTimeout(f, 10), aoSair: () => {}, aoPerderAcesso: () => {} });
  c.abrir("q1");
  window.__qcp = c;
  window.__mudouQcp = () => { versao++; c.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t3" } }); };
};
// Quem rola o casco: o primeiro ancestral (ou ele mesmo) que tem o que rolar; senão, a página.
window.__rolador = () => {
  for (let e = document.getElementById("qcp"); e && e !== document.body; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight + 10) return e;
  }
  return document.scrollingElement;
};
`;

type Medida = { top: number; max: number; left: number | null; ativo: string };
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADA-7: a atualização do quadro preserva a rolagem (Chrome real)", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-ada7-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    url = pathToFileURL(join(dir, "p.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string): Promise<void> => {
    for (let i = 0; i < 100; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const medir = async (): Promise<Medida> => JSON.parse(await avaliar<string>(cdp, `(() => {
    const v = document.getElementById("quadro");
    const g = [...document.querySelectorAll("#quadro .qd-grade")].find((e) => e.offsetParent);
    const a = document.activeElement;
    return JSON.stringify({ top: v.scrollTop, max: v.scrollHeight - v.clientHeight, left: g ? g.scrollLeft : null,
      ativo: a === document.body ? "body" : (a?.id || a?.dataset?.act || a?.tagName || "") });
  })()`)) as Medida;
  /** Dispara a atualização e espera a releitura (a contagem de leituras do quadro sobe) e o desenho. */
  const atualizar = async (): Promise<void> => {
    const antes = await avaliar<number>(cdp, "window.__lidas");
    // Revisão 11: a atualização precisa chegar à tela (a .qd-conteudo regravada), não só à leitura.
    await avaliar(cdp, `(() => { window.__regravouAtualizar = 0; const o = new MutationObserver(() => window.__regravouAtualizar++);
      o.observe(document.querySelector("#quadro > .qd-conteudo"), { childList: true }); window.__obsAtualizar?.disconnect(); window.__obsAtualizar = o; })()`);
    await avaliar(cdp, "window.__mudou()");
    await ate(`window.__lidas > ${antes}`);
    await ate("window.__regravouAtualizar > 0");
    await esperar(150);
  };

  for (const [w, h, toque] of [[390, 844, true], [1440, 900, false]] as const) {
    it(`${w}×${h}${toque ? " (toque)" : ""}: quadro e tarefa aberta, rolados até o fim, ficam no lugar depois do quadro.mudou`, async () => {
      await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: toque });
      await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: toque, maxTouchPoints: toque ? 5 : 1 });
      await cdp.enviar("Page.navigate", { url });
      await ate("window.__montar");
      await avaliar(cdp, "window.__montar()");
      await ate(`document.querySelector("#quadro [data-act='abrir-tarefa']")`);
      await esperar(150);

      // 1) O quadro rolado até o fim (e, no computador, a grade rolada para o lado).
      await avaliar(cdp, `(() => { document.activeElement?.blur(); const v = document.getElementById("quadro"); v.scrollTop = v.scrollHeight;
        const g = [...document.querySelectorAll("#quadro .qd-grade")].find((e) => e.offsetParent); if (g) g.scrollLeft = 400; })()`);
      await esperar(80);
      const q0 = await medir();
      expect(q0.max, "o quadro precisa rolar para o teste valer").toBeGreaterThan(200);
      expect(q0.top).toBeGreaterThan(q0.max - 2);
      await atualizar();
      const q1 = await medir();
      expect(Math.abs(q1.top - q0.top), `scrollTop do quadro ${q0.top} → ${q1.top}`).toBeLessThanOrEqual(1);
      if (!toque) expect(q0.left, "no computador a grade precisa rolar para o lado para o teste valer").toBeGreaterThan(0);
      if (q0.left !== null && q0.left > 0) expect(q1.left, `scrollLeft da grade ${q0.left} → ${q1.left}`).toBe(q0.left);

      // 2) Um card focado (a pessoa tocou/tabulou nele) segue focado e a vista não sai do lugar.
      await avaliar(cdp, `(() => { const v = document.getElementById("quadro"); const cs = [...document.querySelectorAll("#quadro [data-act='abrir-tarefa']")].filter((e) => e.offsetParent);
        const c = cs[cs.length - 1]; v.scrollTop = v.scrollHeight; c.focus({ preventScroll: true }); })()`);
      await esperar(80);
      const c0 = await medir();
      expect(c0.ativo).toBe("abrir-tarefa");
      await atualizar();
      const c1 = await medir();
      expect(c1.ativo, "o foco do card não cai no body").toBe("abrir-tarefa");
      expect(Math.abs(c1.top - c0.top), `scrollTop com o card focado ${c0.top} → ${c1.top}`).toBeLessThanOrEqual(1);

      // 3) A tarefa aberta (o título recebe o foco ao abrir), rolada até o fim.
      await avaliar(cdp, `(() => { document.activeElement?.blur(); [...document.querySelectorAll("#quadro [data-act='abrir-tarefa']")].find((e) => e.offsetParent).click(); })()`);
      await ate(`document.getElementById("qd-t-tit")`);
      await esperar(150);
      expect((await medir()).ativo, "abrir a tarefa foca o título").toBe("qd-t-tit");
      await avaliar(cdp, `(() => { const v = document.getElementById("quadro"); v.scrollTop = v.scrollHeight; })()`);
      await esperar(80);
      const t0 = await medir();
      expect(t0.max, "o detalhe precisa rolar para o teste valer").toBeGreaterThan(200);
      await atualizar();
      const t1 = await medir();
      expect(Math.abs(t1.top - t0.top), `scrollTop da tarefa aberta ${t0.top} → ${t1.top} (antes da correção ia a 0)`).toBeLessThanOrEqual(1);
      expect(t1.ativo, "o foco segue no título").toBe("qd-t-tit");
    }, 60_000);
  }

  it("390×844 (toque): a tarefa aberta no quadro compartilhado, rolada até o fim, fica no lugar depois do quadro.mudou", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarQcp");
    await avaliar(cdp, "window.__montarQcp()");
    await ate(`document.querySelector("#qcp [data-act='abrir-tarefa']")`);
    await avaliar(cdp, `[...document.querySelectorAll("#qcp [data-act='abrir-tarefa']")].find((e) => e.offsetParent).click()`);
    await ate(`document.activeElement?.id === "qcp-t-tit"`);
    await avaliar(cdp, `(() => { const r = window.__rolador(); r.scrollTop = r.scrollHeight; })()`);
    await esperar(80);
    const medirQcp = async (): Promise<{ top: number; max: number; ativo: string }> => JSON.parse(await avaliar<string>(cdp,
      `(() => { const r = window.__rolador(); return JSON.stringify({ top: r.scrollTop, max: r.scrollHeight - r.clientHeight, ativo: document.activeElement?.id || "" }); })()`)) as { top: number; max: number; ativo: string };
    const a0 = await medirQcp();
    expect(a0.max, "o detalhe precisa rolar para o teste valer").toBeGreaterThan(200);
    const antes = await avaliar<number>(cdp, "window.__lidas");
    await avaliar(cdp, `(() => { window.__regravouQcp = 0; new MutationObserver(() => window.__regravouQcp++).observe(document.getElementById("qcp"), { childList: true }); })()`);
    await avaliar(cdp, "window.__mudouQcp()");
    await ate(`window.__lidas > ${antes}`);
    await ate("window.__regravouQcp > 0");
    await esperar(150);
    const a1 = await medirQcp();
    expect(Math.abs(a1.top - a0.top), `scrollTop do compartilhado ${a0.top} → ${a1.top}`).toBeLessThanOrEqual(1);
    expect(a1.ativo).toBe("qcp-t-tit");
  }, 60_000);

  it("turno.delta de outra conversa não relê nem regrava o quadro (ADR-061)", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector("#quadro [data-act='abrir-tarefa']")`);
    await esperar(150);
    await avaliar(cdp, `(() => { window.__lidas = 0; window.__regravacoes = 0;
      new MutationObserver(() => window.__regravacoes++).observe(document.querySelector("#quadro > .qd-conteudo"), { childList: true });
      const id = setInterval(() => window.__delta(), 25); setTimeout(() => clearInterval(id), 600); })()`);
    await esperar(900);
    expect(await avaliar<number>(cdp, "window.__lidas"), "leituras do quadro durante os deltas").toBe(0);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações do quadro durante os deltas").toBe(0);
    // A releitura que traz o mesmo quadro lê, mas não regrava (a regravação sem mudança cortava o embalo do toque).
    await avaliar(cdp, "window.__mesmo()");
    await ate("window.__lidas >= 1");
    await esperar(150);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o mesmo quadro").toBe(0);
    // Num minuto novo, o mesmo quadro regrava (o "há 3 min" dos cards anda).
    await avaliar(cdp, "(() => { window.__virarMinuto(); window.__lidas = 0; window.__mesmo(); })()");
    await ate("window.__lidas >= 1");
    await ate("window.__regravacoes > 0");
    await avaliar(cdp, "(() => { window.__lidas = 1; window.__regravacoes = 0; })()");
    await avaliar(cdp, "window.__mudou()");
    await ate("window.__lidas >= 2");
    await esperar(150);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "o quadro que mudou regrava").toBeGreaterThan(0);
  }, 60_000);
  const montar = async (w: number, h: number, toque: boolean): Promise<void> => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: toque });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: toque, maxTouchPoints: toque ? 5 : 1 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector("#quadro [data-act='abrir-tarefa']")`);
    await esperar(200);
  };
  const observar = (): Promise<unknown> => avaliar(cdp, `(() => { window.__lidas = 0; window.__regravacoes = 0;
    new MutationObserver(() => window.__regravacoes++).observe(document.querySelector("#quadro > .qd-conteudo"), { childList: true }); })()`);

  it("390×844 (toque): com o dedo na tela, a releitura do frame espera o gesto acabar (a grade não nasce de novo no arrasto)", async () => {
    await montar(390, 844, true);
    await observar();
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa']")].find((e) => e.offsetParent).dispatchEvent(new Event("touchstart", { bubbles: true }))`);
    await avaliar(cdp, "window.__mudou()");
    await esperar(500);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o dedo na tela").toBe(0);
    await avaliar(cdp, `document.dispatchEvent(new Event("touchend", { bubbles: true }))`);
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("1440×900: o turno que acaba relê o quadro, e uma mudança fora das tarefas (a meta) aparece", async () => {
    await montar(1440, 900, false);
    await observar();
    await avaliar(cdp, "window.__encerrou()");
    await ate("window.__lidas >= 1");
    await avaliar(cdp, "window.__meta2()");
    await ate(`document.querySelector("#quadro .qd-conteudo").textContent.includes("Meta nova")`);
  }, 60_000);

  it("1440×900: a recusa do servidor com o quadro igual redesenha (o select volta ao status real)", async () => {
    await montar(1440, 900, false);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t0']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-status")`);
    await esperar(150);
    const real = await avaliar<string>(cdp, `document.getElementById("qd-t-status").value`);
    await avaliar(cdp, `(() => { window.__lidas = 0; const s = document.getElementById("qd-t-status");
      s.value = [...s.options].map((o) => o.value).find((v) => v !== s.value && v !== "voce" && v !== "bloqueado" && v !== "cancelado");
      s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await ate("window.__lidas >= 1");
    await esperar(150);
    expect(await avaliar<string>(cdp, `document.getElementById("qd-t-status").value`), "o select depois da recusa").toBe(real);
  }, 60_000);

  it("390×844: o histórico aberto da faixa fica onde a pessoa rolou quando o quadro regrava", async () => {
    await montar(390, 844, true);
    // Um recado pela pílula: a faixa fica "Mexendo no quadro…" e traz as últimas trocas.
    await avaliar(cdp, `(() => { document.getElementById("qc-txt").value = "oi"; document.querySelector('[data-form="conversa-no-quadro"]').requestSubmit(); })()`);
    await ate(`document.querySelector("#qc-faixa [data-act='qc-historico']")`);
    await avaliar(cdp, `document.querySelector("#qc-faixa [data-act='qc-historico']").click()`);
    await ate(`document.querySelector("#qc-faixa .qc-hist")`);
    await avaliar(cdp, `(() => { const h = document.querySelector("#qc-faixa .qc-hist"); h.scrollTop = h.scrollHeight; })()`);
    await esperar(80);
    const h0 = JSON.parse(await avaliar<string>(cdp, `(() => { const h = document.querySelector("#qc-faixa .qc-hist"); return JSON.stringify([h.scrollTop, h.scrollHeight - h.clientHeight]); })()`)) as [number, number];
    expect(h0[1], "o histórico precisa rolar para o teste valer").toBeGreaterThan(50);
    await atualizar();
    const h1 = await avaliar<number>(cdp, `document.querySelector("#qc-faixa .qc-hist").scrollTop`);
    expect(Math.abs(h1 - h0[0]), `scrollTop do histórico ${h0[0]} → ${h1}`).toBeLessThanOrEqual(1);
  }, 60_000);
  it("390×844 (toque real): o quadro regravado no meio do toque não prende a releitura depois que o dedo sai", async () => {
    await montar(390, 844, true);
    const [x, y] = JSON.parse(await avaliar<string>(cdp, `(() => { const r = [...document.querySelectorAll("#quadro [data-act='abrir-tarefa']")].find((e) => e.offsetParent).getBoundingClientRect();
      return JSON.stringify([r.left + 20, r.top + 10]); })()`)) as [number, number];
    // O dedo que arrasta sem rolar (como no cabeçalho da coluna, com touch-action: none): só o touchmove diz que ele mexe.
    await avaliar(cdp, `document.getElementById("quadro").style.touchAction = "none"`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    try {
      // Uma regravação no meio do toque (no app: os trabalhos da tarefa, o histórico, a releitura forçada): o card tocado nasce de novo.
      await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada outra", agenteId: "a" })`);
      await esperar(150);
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 30 }] });
      await esperar(150);
      await observar();
      await avaliar(cdp, "window.__mudou()");
      // O dedo segue mexendo além de TOQUE_PARADO_MS: os touchmove vão ao nó fora do documento.
      for (let i = 0; i < 8; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 30 + (i % 2) * 30 }] });
        await esperar(180);
      }
      expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o dedo mexendo no nó recriado").toBe(0);
    } finally {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    const t0 = Date.now();
    await ate("window.__regravacoes > 0");
    // Sem o fim do toque no alvo, a releitura só vencia no teto do dedo parado (TOQUE_PARADO_MS): metade dele separa os dois.
    expect(Date.now() - t0, "a releitura depois do toque").toBeLessThan(TOQUE_PARADO_MS / 2 + 50);
  }, 60_000);

  it("1440×900: enquanto a vista rola (a roda do mouse, o embalo), a releitura espera; ela chega logo depois de parar", async () => {
    await montar(1440, 900, false);
    await observar();
    await avaliar(cdp, `(() => { const v = document.getElementById("quadro"); let n = 0;
      window.__rolando = true; window.__maiorVao = 0; let ultimo = performance.now();
      const id = setInterval(() => { const t = performance.now(); window.__maiorVao = Math.max(window.__maiorVao, t - ultimo); ultimo = t; v.scrollTop = (n++ % 2) ? 300 : 320; }, 20);
      setTimeout(() => { clearInterval(id); window.__rolando = false; window.__parouEm = performance.now(); }, 800); })()`);
    await esperar(100);
    await avaliar(cdp, "window.__mudou()");
    await esperar(500);
    // Com a máquina carregada, um vão maior que GESTO_MS entre duas rolagens é "parou" de verdade: a asserção não vale.
    const vao = await avaliar<number>(cdp, "window.__maiorVao");
    if (vao < GESTO_MS * 0.8) expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações durante a rolagem").toBe(0);
    await ate("window.__regravacoes > 0");
    expect(await avaliar<boolean>(cdp, "window.__rolando"), "a regravação veio só depois de parar").toBe(false);
  }, 60_000);

  it("1440×900: o arrasto de um card segura a releitura até soltar, mesmo passando do teto do gesto", async () => {
    await montar(1440, 900, false);
    await observar();
    await avaliar(cdp, `(() => { window.__card = [...document.querySelectorAll("#quadro li.qd-card[draggable='true'][data-tarefa]")].find((e) => e.offsetParent);
      window.__card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })); })()`);
    await avaliar(cdp, "window.__mudou()");
    await esperar(3400);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações no meio do arrasto").toBe(0);
    expect(await avaliar<boolean>(cdp, "window.__card.isConnected"), "o card arrastado segue no documento").toBe(true);
    await avaliar(cdp, `window.__card.dispatchEvent(new DragEvent("dragend", { bubbles: true }))`);
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("390×844 (toque): com a tarefa aberta, o trabalho relido pelo frame espera o dedo sair para redesenhar", async () => {
    await montar(390, 844, true);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-tit")`);
    await esperar(600);
    await observar();
    await avaliar(cdp, `(() => { const t = document.getElementById("qd-t-tit"); t.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.__mexe = setInterval(() => t.dispatchEvent(new Event("touchmove", { bubbles: true })), 150); })()`);
    await avaliar(cdp, "window.__mudou()");
    await esperar(1300);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações da tarefa aberta com o dedo na tela").toBe(0);
    await avaliar(cdp, `(() => { clearInterval(window.__mexe); document.getElementById("qd-t-tit").dispatchEvent(new Event("touchend", { bubbles: true })); })()`);
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("1440×900: a recusa atropelada por um frame (a leitura dela descartada) ainda devolve o select ao status real", async () => {
    await montar(1440, 900, false);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t0']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-status")`);
    await esperar(150);
    const real = await avaliar<string>(cdp, `document.getElementById("qd-t-status").value`);
    await avaliar(cdp, `(() => { window.__latencia = 100; window.__lidas = 0; const s = document.getElementById("qd-t-status");
      s.value = [...s.options].map((o) => o.value).find((v) => v !== s.value && v !== "voce" && v !== "bloqueado" && v !== "cancelado");
      s.dispatchEvent(new Event("change", { bubbles: true }));
      // O turno de um bot acaba com a leitura da recusa no ar: a do frame a descarta e traz o mesmo quadro.
      setTimeout(() => window.__encerrou(), 130); })()`);
    await ate("window.__lidas >= 2");
    await esperar(400);
    expect(await avaliar<string>(cdp, `document.getElementById("qd-t-status").value`), "o select depois da recusa atropelada").toBe(real);
  }, 60_000);

  it("390×844 (toque): com a tarefa aberta, só um comentário novo também espera o dedo sair para redesenhar", async () => {
    await montar(390, 844, true);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-tit")`);
    await esperar(600);
    await observar();
    await avaliar(cdp, `(() => { const t = document.getElementById("qd-t-tit"); t.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.__mexe = setInterval(() => t.dispatchEvent(new Event("touchmove", { bubbles: true })), 150); })()`);
    await avaliar(cdp, "window.__comentou()");
    await esperar(1300);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o dedo na tela e um comentário novo").toBe(0);
    await avaliar(cdp, `(() => { clearInterval(window.__mexe); document.getElementById("qd-t-tit").dispatchEvent(new Event("touchend", { bubbles: true })); })()`);
    await ate(`document.querySelector("#quadro .qd-conteudo").textContent.includes("comentário 0")`);
    // A releitura seguinte (o frame sem tarefa citada: o quadro, o trabalho e os comentários iguais) não regrava.
    await esperar(300);
    await observar();
    await avaliar(cdp, "window.__mesmo()");
    await ate("window.__lidas >= 1");
    await esperar(700);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com os mesmos comentários").toBe(0);
  }, 60_000);

  it("844×390 (toque, grade larga): o dedo que começa no cabeçalho da coluna rola a grade", async () => {
    await montar(844, 390, true);
    const r = JSON.parse(await avaliar<string>(cdp, `(() => { const b = [...document.querySelectorAll("#quadro .qd-col-bt[data-arrasta]")].find((e) => e.offsetParent);
      if (!b) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, ta: getComputedStyle(b).touchAction,
      coarse: matchMedia("(pointer: coarse)").matches }); })()`)) as { x: number; y: number; ta: string; coarse: boolean } | null;
    expect(r, "a grade larga com o cabeçalho arrastável").not.toBeNull();
    expect(r!.coarse, "o Chrome emula o toque como ponteiro grosso").toBe(true);
    expect(r!.ta, "touch-action do cabeçalho no toque").not.toBe("none");
    const antes = await medir();
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r!.x, y: r!.y }] });
    try {
      for (let i = 1; i <= 8; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r!.x - i * 15, y: r!.y }] });
        await esperar(30);
      }
    } finally {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await esperar(300);
    const depois = await medir();
    expect(depois.left ?? 0, `a grade rolou para o lado a partir do cabeçalho (${antes.left} → ${depois.left})`).toBeGreaterThan(antes.left ?? 0);
  }, 60_000);

  it("390×844 (toque): no quadro compartilhado, o mesmo quadro não regrava e, com o dedo na tela, a releitura espera", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarQcp");
    await avaliar(cdp, "window.__montarQcp()");
    await ate(`document.querySelector("#qcp [data-act='abrir-tarefa']")`);
    await esperar(200);
    await avaliar(cdp, `(() => { window.__lidas = 0; window.__regravacoes = 0;
      new MutationObserver(() => window.__regravacoes++).observe(document.getElementById("qcp"), { childList: true }); })()`);
    // O mesmo quadro (o reconectar, o frame da própria resposta): lê e não regrava.
    await avaliar(cdp, "window.__qcp.reler()");
    await ate("window.__lidas >= 1");
    await esperar(300);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações do compartilhado com o mesmo quadro").toBe(0);
    const c = `[...document.querySelectorAll("#qcp [data-act='abrir-tarefa']")].find((e) => e.offsetParent)`;
    await avaliar(cdp, `(() => { const t = ${c}; t.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.__mexe = setInterval(() => t.dispatchEvent(new Event("touchmove", { bubbles: true })), 150); })()`);
    await avaliar(cdp, "window.__mudouQcp()");
    await esperar(900);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações do compartilhado com o dedo na tela").toBe(0);
    await avaliar(cdp, `(() => { clearInterval(window.__mexe); document.dispatchEvent(new Event("touchend", { bubbles: true })); })()`);
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("844×390 (toque real, grade larga): o dedo que segue mexendo segura a releitura além do teto do gesto (a grade não nasce de novo)", async () => {
    await montar(844, 390, true);
    const [x, y] = JSON.parse(await avaliar<string>(cdp, `(() => { const g = [...document.querySelectorAll("#quadro .qd-grade")].find((e) => e.offsetParent).getBoundingClientRect();
      return JSON.stringify([g.left + g.width / 2, g.top + 40]); })()`)) as [number, number];
    // Sem o navegador tomar o gesto para si (o Chrome headless não garante o embalo): só o touchmove diz que o dedo mexe.
    await avaliar(cdp, `document.getElementById("quadro").style.touchAction = "none"`);
    await observar();
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    try {
      await avaliar(cdp, "window.__mudou()");
      const t0 = Date.now();
      for (let i = 1; Date.now() - t0 < ADIAR_ATE_MS + 800; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (i % 2 ? -40 : 40), y }] });
        await esperar(150);
      }
      expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o dedo mexendo além de ADIAR_ATE_MS").toBe(0);
    } finally {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("390×844 (toque): o recado longo que rola por dentro fica onde a pessoa estava depois do quadro.mudou", async () => {
    await montar(390, 844, true);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-trab-recado")`);
    await esperar(300);
    await avaliar(cdp, `(() => { const c = document.getElementById("qd-trab-recado"); c.value = Array.from({ length: 30 }, (_, i) => "linha " + i).join("\\n");
      c.dispatchEvent(new Event("input", { bubbles: true })); c.focus({ preventScroll: true }); c.setSelectionRange(20, 20); c.scrollTop = 200; })()`);
    await esperar(80);
    const r0 = await avaliar<number>(cdp, `document.getElementById("qd-trab-recado").scrollTop`);
    expect(r0, "o recado precisa rolar por dentro para o teste valer").toBeGreaterThan(100);
    await observar();
    await avaliar(cdp, "window.__mudou()");
    // Revisão 9: com o foco no recado, a releitura espera ela sair dele (no iPhone, o foco por código fecha o teclado).
    await esperar(1000);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o foco no recado").toBe(0);
    expect(await avaliar<string>(cdp, "document.activeElement?.id"), "o foco segue no recado").toBe("qd-trab-recado");
    // Revisão 11: sem teto (o relógio passa 60 s): o campo não é recriado enquanto ela escreve.
    await avaliar(cdp, `(() => { window.__recado = document.getElementById("qd-trab-recado"); window.__virarMinuto();
      window.__recado.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await esperar(600);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com ela escrevendo depois de 60 s").toBe(0);
    expect(await avaliar<boolean>(cdp, "window.__recado.isConnected"), "o mesmo campo segue na tela").toBe(true);
    // Revisões 12 e 13: parada 60 s, mas com o teclado aberto, ainda segura. O teclado do Android com resizes-content
    // encolhe a janela inteira (innerHeight e o viewport visual juntos): é o que o override de 844 → 500 faz.
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 500, deviceScaleFactor: 1, mobile: true });
    await ate("innerHeight === 500");
    await avaliar(cdp, "window.__virarMinuto()");
    await esperar(600);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o teclado aberto").toBe(0);
    // O teclado fecha (o voltar do Android) e o foco fica: parada, a regravação chega, com o rascunho e o foco.
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await ate("window.__regravacoes > 0");
    await esperar(150);
    expect(await avaliar<string>(cdp, "document.activeElement?.id"), "o foco volta ao recado").toBe("qd-trab-recado");
    const r1 = JSON.parse(await avaliar<string>(cdp, `(() => { const c = document.getElementById("qd-trab-recado");
      return JSON.stringify({ top: c.scrollTop, linhas: c.value.split("\\n").length }); })()`)) as { top: number; linhas: number };
    expect(r1.linhas, "o rascunho do recado sobrevive").toBe(30);
    expect(Math.abs(r1.top - r0), `scrollTop do recado ${r0} → ${r1.top}`).toBeLessThanOrEqual(1);
  }, 60_000);

  it("1440×900: no quadro compartilhado, a grade rolada para o lado fica no lugar depois do quadro.mudou", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarQcp");
    await avaliar(cdp, "window.__montarQcp()");
    await ate(`[...document.querySelectorAll("#qcp .qd-grade")].find((e) => e.offsetParent)`);
    await esperar(200);
    const grade = `[...document.querySelectorAll("#qcp .qd-grade")].find((e) => e.offsetParent)`;
    await avaliar(cdp, `(() => { const g = ${grade}; g.scrollLeft = 400; window.__lidas = 0; window.__regravacoes = 0;
      new MutationObserver(() => window.__regravacoes++).observe(document.getElementById("qcp"), { childList: true }); })()`);
    const l0 = await avaliar<number>(cdp, `${grade}.scrollLeft`);
    expect(l0, "a grade do compartilhado precisa rolar para o lado para o teste valer").toBeGreaterThan(100);
    await avaliar(cdp, "window.__mudouQcp()");
    await ate("window.__regravacoes > 0");
    await esperar(100);
    expect(await avaliar<number>(cdp, `${grade}.scrollLeft`), "scrollLeft da grade do compartilhado").toBe(l0);
  }, 60_000);

  // Revisão 6: o dedo que começa com o GET no ar (a rede do celular, 300–600 ms): a resposta também espera o gesto.
  for (const qcp of [false, true]) {
    it(`390×844 (toque real${qcp ? ", compartilhado" : ""}): a resposta que chega com o dedo mexendo espera ele sair`, async () => {
      await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await cdp.enviar("Page.navigate", { url });
      const sel = qcp ? "#qcp" : "#quadro";
      await ate(qcp ? "window.__montarQcp" : "window.__montar");
      await avaliar(cdp, qcp ? "window.__montarQcp()" : "window.__montar()");
      await ate(`document.querySelector("${sel} [data-act='abrir-tarefa']")`);
      await esperar(300);
      const [x, y] = JSON.parse(await avaliar<string>(cdp, `(() => { const r = [...document.querySelectorAll("${sel} [data-act='abrir-tarefa']")].find((e) => e.offsetParent).getBoundingClientRect();
        return JSON.stringify([r.left + 20, r.top + 10]); })()`)) as [number, number];
      await avaliar(cdp, `(() => { document.documentElement.style.touchAction = "none"; window.__latencia = 600; window.__lidas = 0; window.__regravacoes = 0;
        new MutationObserver(() => window.__regravacoes++).observe(${qcp ? `document.getElementById("qcp")` : `document.querySelector("#quadro > .qd-conteudo")`}, { childList: true }); })()`);
      await avaliar(cdp, qcp ? "window.__mudouQcp()" : "window.__mudou()");
      await ate("window.__lidas >= 1");
      await esperar(100);
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      try {
        for (let i = 1; i <= 12; i++) {
          await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (i % 2 ? 30 : 0) }] });
          await esperar(100);
        }
        expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com a resposta chegando no meio do gesto").toBe(0);
      } finally {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await ate("window.__regravacoes > 0");
    }, 60_000);
  }

  it("390×844 (toque real, compartilhado): a resposta adiada pelo gesto que ficou velha (ela abriu outro quadro) não pinta por cima", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarQcp");
    await avaliar(cdp, "window.__montarQcp()");
    await ate(`document.querySelector("#qcp [data-act='abrir-tarefa']")`);
    await esperar(300);
    const [x, y] = JSON.parse(await avaliar<string>(cdp, `(() => { const r = [...document.querySelectorAll("#qcp [data-act='abrir-tarefa']")].find((e) => e.offsetParent).getBoundingClientRect();
      return JSON.stringify([r.left + 20, r.top + 10]); })()`)) as [number, number];
    await avaliar(cdp, `(() => { document.documentElement.style.touchAction = "none"; window.__latencia = 300; window.__lidas = 0; window.__meta = "Meta velha"; })()`);
    await avaliar(cdp, "window.__mudouQcp()");
    await ate("window.__lidas >= 1");
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    try {
      // A resposta com a meta velha chega e espera o dedo; enquanto isso ela abre outro quadro (a leitura nova).
      for (let i = 1; i <= 6; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (i % 2 ? 30 : 0) }] });
        await esperar(100);
      }
      expect(await avaliar<string>(cdp, `document.getElementById("qcp").textContent`), "a resposta velha ainda espera o dedo").not.toContain("Meta velha");
      await avaliar(cdp, `(() => { window.__latencia = 0; window.__meta = "Meta nova"; window.__qcp.abrir("q2"); })()`);
      await ate(`document.getElementById("qcp").textContent.includes("Meta nova")`);
      for (let i = 1; i <= 3; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (i % 2 ? 30 : 0) }] });
        await esperar(100);
      }
    } finally {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await esperar(600);
    const texto = await avaliar<string>(cdp, `document.getElementById("qcp").textContent`);
    expect(texto, "o quadro que ela abriu fica").toContain("Meta nova");
    expect(texto, "a resposta velha não pinta por cima").not.toContain("Meta velha");
  }, 60_000);

  it("390×844 (toque): o passo do trabalho que roda espera o dedo sair para reescrever o log (e escreve o último)", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__trabVivo = true; window.__montar()");
    await ate(`document.querySelector("#quadro [data-act='abrir-tarefa'][data-id='t3']")`);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-trab-log[data-trabalho='e1']")`);
    await esperar(600);
    // Sem o dedo, o passo escreve na hora (o log vivo continua vivo).
    await avaliar(cdp, "window.__passoVivo(1)");
    await ate(`document.querySelector("#quadro .qd-trab-log").textContent.includes("1 passo")`);
    await avaliar(cdp, `(() => { window.__logRegravado = 0; const l = document.querySelector("#quadro .qd-trab-log");
      new MutationObserver(() => window.__logRegravado++).observe(l, { childList: true, subtree: true, characterData: true });
      const t = document.getElementById("qd-t-tit"); t.dispatchEvent(new Event("touchstart", { bubbles: true }));
      window.__mexe = setInterval(() => t.dispatchEvent(new Event("touchmove", { bubbles: true })), 150); })()`);
    try {
      for (const n of [2, 3]) { await avaliar(cdp, `window.__passoVivo(${n})`); await esperar(400); }
      expect(await avaliar<number>(cdp, "window.__logRegravado"), "o log reescrito com o dedo na tela").toBe(0);
    } finally {
      await avaliar(cdp, `(() => { clearInterval(window.__mexe); document.getElementById("qd-t-tit").dispatchEvent(new Event("touchend", { bubbles: true })); })()`);
    }
    await ate(`document.querySelector("#quadro .qd-trab-log").textContent.includes("3 passos")`);
    await esperar(300);
    // Uma escrita só (o innerHTML tira e põe: 1 registro de childList), com o último passo.
    expect(await avaliar<number>(cdp, "window.__logRegravado"), "uma escrita só, com o último passo").toBe(1);
    await avaliar(cdp, "window.__trabVivo = false");
  }, 60_000);

  it("1440×900: o card arrastado que sai do documento no meio do arrasto não prende a releitura (revisão 9)", async () => {
    await montar(1440, 900, false);
    await ate(`document.querySelector("#quadro li.qd-card[draggable='true'][data-tarefa]")`);
    await observar();
    // O arrasto começa; o li sai do documento (um redesenho direto o recria) e o dragend vai ao nó solto, fora do doc.
    await avaliar(cdp, `(() => { const li = [...document.querySelectorAll("#quadro li.qd-card[draggable='true'][data-tarefa]")].find((e) => e.offsetParent);
      li.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() }));
      li.remove(); li.dispatchEvent(new DragEvent("dragend", { bubbles: true })); })()`);
    await avaliar(cdp, "window.__mudou()");
    await ate("window.__lidas > 0");
    await ate("window.__regravacoes > 0");
  }, 60_000);

  it("1440×900: a mudança da tarefa que volta depois de ela rolar não puxa a vista para o select (revisão 9)", async () => {
    await montar(1440, 900, false);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t0']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-status")`);
    await esperar(150);
    await avaliar(cdp, `(() => { window.__mudarOk = true; window.__latencia = 500; const s = document.getElementById("qd-t-status");
      s.value = [...s.options].map((o) => o.value).find((v) => v !== s.value && v !== "voce" && v !== "bloqueado" && v !== "cancelado");
      s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    // Enquanto a resposta não chega, ela rola até o fim do detalhe (o select sai da tela).
    await esperar(100);
    await avaliar(cdp, `(() => { const v = document.getElementById("quadro"); v.scrollTop = v.scrollHeight; })()`);
    await esperar(80);
    const t0 = await medir();
    expect(t0.max, "o detalhe precisa rolar para o teste valer").toBeGreaterThan(200);
    await esperar(1200);
    const t1 = await medir();
    expect(t1.ativo, "o foco volta ao select").toBe("qd-t-status");
    expect(Math.abs(t1.top - t0.top), `scrollTop ${t0.top} → ${t1.top}`).toBeLessThanOrEqual(1);
  }, 60_000);

  it("1440×900: a vista que encolhe no meio do redesenho volta ao lugar (a restauração da caixa e da grade)", async () => {
    await montar(1440, 900, false);
    const r = JSON.parse(await avaliar<string>(cdp, `(() => { const v = document.getElementById("quadro"); const c = v.querySelector(".qd-conteudo");
      const g = () => [...v.querySelectorAll(".qd-grade")].find((e) => e.offsetParent);
      v.scrollTop = v.scrollHeight; g().scrollLeft = 400;
      const antes = { top: v.scrollTop, left: g().scrollLeft };
      const guardada = window.__rolagem.guardarRolagem(v, v);
      const html = c.innerHTML;
      c.innerHTML = ""; void v.scrollHeight;
      const vazio = v.scrollTop;
      c.innerHTML = html;
      window.__rolagem.restaurarRolagem(v, v, guardada);
      return JSON.stringify({ antes, vazio, depois: { top: v.scrollTop, left: g().scrollLeft } }); })()`)) as { antes: { top: number; left: number }; vazio: number; depois: { top: number; left: number } };
    expect(r.antes.top, "o quadro precisa rolar para o teste valer").toBeGreaterThan(200);
    expect(r.vazio, "sem conteúdo, o navegador leva a vista ao topo").toBe(0);
    expect(r.depois).toEqual(r.antes);
  }, 60_000);

  it("390×844: o render do app (sincronizar com a mesma conversa) e a reidratação (reler) não levam ao topo", async () => {
    await montar(390, 844, true);
    // Revisão 13: com a tarefa aberta e o foco no título (o que a regravação devolve), senão o teste passava sem a correção.
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.activeElement?.id === "qd-t-tit"`);
    await avaliar(cdp, `(() => { const v = document.getElementById("quadro"); v.scrollTop = v.scrollHeight; })()`);
    await esperar(80);
    const q0 = await medir();
    expect(q0.max).toBeGreaterThan(200);
    await observar();
    // O minuto virado faz a reidratação regravar (o "parada há"), para o foco devolvido ser posto à prova.
    await avaliar(cdp, `(() => { window.__virarMinuto(); for (let i = 0; i < 3; i++) window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.reler(); })()`);
    await ate("window.__lidas > 0");
    await ate("window.__regravacoes > 0");
    await esperar(300);
    for (let i = 0; i < 3; i++) await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" })`);
    const q1 = await medir();
    expect(Math.abs(q1.top - q0.top), `scrollTop ${q0.top} → ${q1.top}`).toBeLessThanOrEqual(1);
    expect(q1.ativo, "o foco segue no título").toBe("qd-t-tit");
  }, 60_000);

  it("1440×900: com o foco na pílula (fora do que o desenho recria), o quadro.mudou chega logo (revisão 10)", async () => {
    await montar(1440, 900, false);
    await observar();
    await avaliar(cdp, `document.getElementById("qc-txt").focus()`);
    await avaliar(cdp, "window.__mudou()");
    const t0 = Date.now();
    await ate("window.__regravacoes > 0");
    expect(Date.now() - t0, "a regravação não espera o foco da pílula").toBeLessThan(ADIAR_ATE_MS);
    expect(await avaliar<string>(cdp, "document.activeElement?.id")).toBe("qc-txt");
  }, 60_000);

  it("390×844 (toque real): a resposta do bot ao pedido da pílula espera o dedo sair para regravar (revisão 10)", async () => {
    await montar(390, 844, true);
    await avaliar(cdp, `(() => { document.documentElement.style.touchAction = "none"; document.getElementById("qc-txt").value = "oi";
      document.querySelector('[data-form="conversa-no-quadro"]').requestSubmit(); document.activeElement?.blur(); })()`);
    await esperar(300);
    const [x, y] = JSON.parse(await avaliar<string>(cdp, `(() => { const r = [...document.querySelectorAll("#quadro [data-act='abrir-tarefa']")].find((e) => e.offsetParent).getBoundingClientRect();
      return JSON.stringify([r.left + 20, r.top + 10]); })()`)) as [number, number];
    await observar();
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    try {
      await avaliar(cdp, `(() => { window.__respondeu = true; window.__q.aoFrame({ streamId: "s", seq: 2, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1", mensagemId: "m10" } }); })()`);
      for (let i = 1; i <= 10; i++) {
        await cdp.enviar("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (i % 2 ? 30 : 0) }] });
        await esperar(100);
      }
      expect(await avaliar<number>(cdp, "window.__lidas"), "a resposta releu o quadro").toBeGreaterThan(0);
      expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o dedo mexendo").toBe(0);
    } finally {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await ate("window.__regravacoes > 0");
    await ate(`document.getElementById("qc-faixa")?.textContent.includes("Feito")`);
  }, 60_000);

  it("1440×900: no computador, o campo com foco na tarefa aberta não segura a atualização (revisão 11)", async () => {
    await montar(1440, 900, false);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t3']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-trab-recado")`);
    await esperar(300);
    await avaliar(cdp, `(() => { const c = document.getElementById("qd-trab-recado"); c.value = "rascunho"; c.dispatchEvent(new Event("input", { bubbles: true })); c.focus(); })()`);
    await observar();
    const t0 = Date.now();
    await avaliar(cdp, "window.__mudou()");
    await ate("window.__regravacoes > 0");
    expect(Date.now() - t0, "a regravação chega sem esperar o foco sair").toBeLessThan(ADIAR_ATE_MS);
    expect(await avaliar<string>(cdp, `document.activeElement?.id + "|" + document.getElementById("qd-trab-recado").value`)).toBe("qd-trab-recado|rascunho");
  }, 60_000);

  it("390×844 (toque): no quadro compartilhado, o comentário com foco não é recriado pela releitura até ela sair dele (revisão 11)", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montarQcp");
    await avaliar(cdp, "window.__montarQcp()");
    await ate(`document.querySelector("#qcp [data-act='abrir-tarefa']")`);
    await avaliar(cdp, `[...document.querySelectorAll("#qcp [data-act='abrir-tarefa']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qcp-com")`);
    await esperar(300);
    await avaliar(cdp, `(() => { const c = document.getElementById("qcp-com"); c.value = "comentando"; c.focus({ preventScroll: true }); window.__com = c;
      c.dispatchEvent(new Event("input", { bubbles: true }));
      window.__lidas = 0; window.__regravacoes = 0; new MutationObserver(() => window.__regravacoes++).observe(document.getElementById("qcp"), { childList: true }); })()`);
    await avaliar(cdp, "window.__mudouQcp()");
    await esperar(800);
    await avaliar(cdp, `(() => { window.__virarMinuto(); window.__com.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await esperar(600);
    expect(await avaliar<number>(cdp, "window.__regravacoes"), "regravações com o foco no comentário").toBe(0);
    expect(await avaliar<boolean>(cdp, "window.__com.isConnected"), "o mesmo campo segue na tela").toBe(true);
    await avaliar(cdp, "window.__com.blur()");
    await ate("window.__regravacoes > 0");
    expect(await avaliar<string>(cdp, `document.getElementById("qcp-com").value`), "o texto sobrevive").toBe("comentando");
  }, 60_000);
});
