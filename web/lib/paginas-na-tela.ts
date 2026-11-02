/**
 * NOD-445, Bloco 1: os gestos da pílula de páginas, nos nós vivos do cabeçalho (que é regravado a toda hora, então tudo é
 * delegado no documento e o estado é reaplicado no nó novo).
 *
 * - Doca: abre no hover (120 ms) e no foco; fecha 260 ms depois de sair. A largura anda numa mola: macia ao abrir (k 240, c 27), sem rebote ao fechar (k 300, c 36).
 * - Roda/trackpad sobre a pílula troca de página, uma por gesto (o gesto acaba após 380 ms sem evento da roda).
 * - Toque: segurar 380 ms abre a doca; arrastar de lado estica a pílula "como líquido" e, além de 36 px, troca de
 *   página; tocar fora fecha. O clique que vem depois de um arrasto ou de segurar não abre o painel do bot.
 * - A dica aparece uma vez (guardada no localStorage).
 * - Com a doca aberta, arrastar um ícone de lado muda a ordem das páginas (a 1ª posição é onde o agente abre).
 * - "Reduzir movimento": sem mola nem esticada; a doca só aparece e some.
 */
import { esticada, mostraDica, passoDaMola, passoDaRoda, passoDoArrasto, posicaoDoArrasto, presa, SEGURAR_MS, textoDaDica, TRAVA_DA_RODA_MS } from "./paginas.ts";

/** Posições aqui são as da pílula (a ordem de exibição), não os índices de dentro das páginas. */
export interface PilulaDePaginas {
  irPara(posicao: number): void;
  atual(): number;
  /** Leva a página da posição `de` para `para` (arrastar um ícone da doca). */
  mover(de: number, para: number): void;
  /** Quantas páginas; menos de 2 = a pílula de hoje (nenhum gesto). */
  total(): number;
  reduzido(): boolean;
  /** Segurar um ícone da doca aberta (sem arrastar) abre o menu dele. */
  menu?(posicao: number, ancora: HTMLElement): void;
}

const CHAVE_DA_DICA = "nod.paginas.dica";

export function ligarGestosDaPilula(doc: Document, p: PilulaDePaginas): void {
  const janela = doc.defaultView;
  const pil = (): HTMLElement | null => doc.querySelector<HTMLElement>("#cabecalho .qd-pil");
  const doca = (): HTMLElement | null => pil()?.querySelector<HTMLElement>(".pg-doca") ?? null;
  const ativa = (): boolean => p.total() > 1 && !!doca();
  /** A doca abre mesmo com uma página só: ela leva o "+ pedir um app". */
  const temDoca = (): boolean => p.total() > 0 && !!doca();

  /* ---------- a doca, com a mola na largura ---------- */
  let aberta = false;
  let largura = { x: 0, v: 0 };
  let quadroMola = 0;
  let ultimo = 0;
  let timerAbrir: ReturnType<typeof setTimeout> | null = null;
  let timerFechar: ReturnType<typeof setTimeout> | null = null;

  const alvoDaLargura = (): number => (aberta ? (doca()?.firstElementChild as HTMLElement | null)?.scrollWidth ?? 0 : 0);
  function pintar(): void {
    const d = doca();
    const c = pil();
    if (!d || !c) return;
    c.classList.toggle("pg-aberta", aberta);
    d.style.width = `${Math.max(0, largura.x)}px`;
  }
  function animarLargura(): void {
    if (p.reduzido() || !janela?.requestAnimationFrame) { largura = { x: alvoDaLargura(), v: 0 }; pintar(); return; }
    if (quadroMola) return;
    ultimo = 0;
    const passo = (t: number): void => {
      const dt = ultimo ? (t - ultimo) / 1000 : 1 / 60;
      ultimo = t;
      // Abrir: mola macia, quase sem passar do ponto. Fechar: amortecimento crítico, sem rebote (o rebote abaixo de 0 tremia).
      const r = aberta ? passoDaMola(largura, alvoDaLargura(), 240, 27, dt) : passoDaMola(largura, alvoDaLargura(), 300, 36, dt);
      largura = { x: r.x, v: r.v };
      pintar();
      quadroMola = r.parou ? 0 : janela.requestAnimationFrame(passo);
    };
    quadroMola = janela.requestAnimationFrame(passo);
  }
  function abrir(sim: boolean): void {
    if (timerAbrir) { clearTimeout(timerAbrir); timerAbrir = null; }
    if (timerFechar) { clearTimeout(timerFechar); timerFechar = null; }
    if (sim && !temDoca()) return;
    if (aberta === sim) return;
    aberta = sim;
    if (sim) esconderDica(true);
    animarLargura();
  }

  // O cabeçalho regravado traz uma doca nova, fechada: com a doca aberta, ela nasce aberta, sem mola.
  let observado: Element | null = null;
  const observador = typeof MutationObserver === "function" ? new MutationObserver(() => {
    const d = doca();
    if (!d) return;
    if (d.style.width === "" && (aberta || largura.x > 0)) pintar();
    mostrarDica();
  }) : null;
  function observar(): void {
    const cab = doc.getElementById("cabecalho");
    if (!observador || !cab || cab === observado) return;
    observador.disconnect();
    observador.observe(cab, { childList: true, subtree: true });
    observado = cab;
  }

  const naPilula = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>("#cabecalho .qd-pil") ?? null;

  doc.addEventListener("pointerover", (ev) => {
    observar();
    if (ev.pointerType !== "mouse" || !naPilula(ev.target) || !temDoca()) return;
    if (timerFechar) { clearTimeout(timerFechar); timerFechar = null; }
    if (!aberta && !timerAbrir) timerAbrir = setTimeout(() => { timerAbrir = null; abrir(true); }, 120);
  });
  doc.addEventListener("pointerout", (ev) => {
    if (ev.pointerType !== "mouse" || !naPilula(ev.target) || naPilula(ev.relatedTarget)) return;
    if (timerAbrir) { clearTimeout(timerAbrir); timerAbrir = null; }
    if (pil()?.contains(doc.activeElement) && doc.activeElement?.matches(":focus-visible")) return;
    if (aberta && !timerFechar && !reordem) timerFechar = setTimeout(() => { timerFechar = null; if (!reordem) abrir(false); }, 260);
  });
  // O teclado: o foco numa aba abre a doca; sair da pílula fecha.
  doc.addEventListener("focusin", (ev) => {
    observar();
    if ((ev.target as Element | null)?.closest?.("#cabecalho .pg-doca")) abrir(true);
  });
  doc.addEventListener("focusout", (ev) => {
    if (!(ev.target as Element | null)?.closest?.("#cabecalho .pg-doca")) return;
    if (naPilula(ev.relatedTarget)) return;
    // O nó saiu do DOM pela regravação (o foco volta à aba nova logo depois): não fecha.
    if (!(ev.target as Element).isConnected) return;
    if (!pil()?.matches(":hover")) abrir(false);
  });

  /* ---------- a roda ---------- */
  let travadaAte = 0;
  doc.addEventListener("wheel", (ev) => {
    if (!naPilula(ev.target) || !ativa()) return;
    ev.preventDefault();
    const agora = Date.now();
    // Um gesto só acaba depois de TRAVA_DA_RODA_MS sem evento: cada evento dele (a inércia do trackpad inclusive) empurra
    // a trava. Contada só do primeiro evento, um gesto mais longo que a trava (ou eventos espaçados) andava duas páginas.
    if (agora < travadaAte) { travadaAte = agora + TRAVA_DA_RODA_MS; return; }
    const passo = passoDaRoda(ev.deltaX, ev.deltaY);
    if (!passo) return;
    travadaAte = agora + TRAVA_DA_RODA_MS;
    puxar(passo);
  }, { passive: false });

  /** Anda uma página; na ponta, a pílula só dá um tranco para o lado (não há página ali). */
  function puxar(passo: -1 | 1): void {
    const i = p.atual() + passo;
    if (i < 0 || i >= p.total()) { tranco(passo); return; }
    p.irPara(i);
  }

  /* ---------- toque: segurar, arrastar e esticar ---------- */
  let toque: { id: number; x: number; y: number; arrastando: boolean; segurou: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let engolir = false;
  let esticar = { x: 0, v: 0 };
  let quadroEstica = 0;

  function aplicarEsticada(dx: number): void {
    const c = pil();
    if (!c) return;
    if (!dx || p.reduzido()) { c.style.transform = ""; c.style.transformOrigin = ""; return; }
    const e = esticada(dx);
    c.style.transformOrigin = e.origem;
    c.style.transform = `translateX(${e.tx}px) scale(${e.sx}, ${e.sy})`;
  }
  function soltarEsticada(de: number): void {
    if (p.reduzido() || !janela?.requestAnimationFrame) { aplicarEsticada(0); return; }
    if (quadroEstica) janela.cancelAnimationFrame(quadroEstica);
    esticar = { x: de, v: 0 };
    let antes = 0;
    const passo = (t: number): void => {
      const dt = antes ? (t - antes) / 1000 : 1 / 60;
      antes = t;
      const r = passoDaMola(esticar, 0, 300, 18, dt);
      esticar = { x: r.x, v: r.v };
      aplicarEsticada(r.parou ? 0 : r.x);
      quadroEstica = r.parou ? 0 : janela.requestAnimationFrame(passo);
    };
    quadroEstica = janela.requestAnimationFrame(passo);
  }
  function tranco(lado: -1 | 1): void { soltarEsticada(-lado * 28); }

  /* ---------- arrastar um ícone da doca aberta: muda a ordem ---------- */
  type Reordem = { id: number; mouse: boolean; el: HTMLElement; px0: number; x0: number; pos: number; passo: number; outros: HTMLElement[]; centros: number[]; alvo: number; ativo: boolean; segurar?: ReturnType<typeof setTimeout> };
  let reordem: Reordem | null = null;
  let engolirIcone = false;
  function moverIcones(dx: number): void {
    const r = reordem;
    if (!r) return;
    const n = r.outros.length + 1;
    const d = Math.max(-r.pos * r.passo, Math.min((n - 1 - r.pos) * r.passo, dx));
    r.el.style.transform = `translateX(${d}px)`;
    r.alvo = presa(posicaoDoArrasto(r.centros, r.x0 + d), n);
    r.outros.forEach((o, k) => {
      const de = k < r.pos ? k : k + 1;
      const para = k < r.alvo ? k : k + 1;
      o.style.transform = para === de ? "" : `translateX(${(para - de) * r.passo}px)`;
    });
  }
  function fimDaReordem(valeu: boolean): void {
    const r = reordem;
    if (!r) return;
    reordem = null;
    if (r.segurar) clearTimeout(r.segurar);
    doca()?.classList.remove("pg-reordenando");
    r.el.classList.remove("pg-arrastando");
    for (const e of [r.el, ...r.outros]) e.style.transform = "";
    if (!r.ativo) return;
    engolirIcone = true;
    setTimeout(() => { engolirIcone = false; }, 350);
    if (valeu && r.alvo !== r.pos) p.mover(r.pos, r.alvo);
    // Soltou fora da pílula (o ponteiro estava preso ao ícone): a doca fecha como no sair de sempre.
    if (r.mouse && !pil()?.matches(":hover") && !timerFechar) timerFechar = setTimeout(() => { timerFechar = null; abrir(false); }, 260);
  }
  doc.addEventListener("pointerdown", (ev) => {
    const ic = (ev.target as Element | null)?.closest?.<HTMLElement>("#cabecalho .pg-doca .pg-ic");
    if (!ic || !aberta || reordem || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    const todos = [...(doca()?.querySelectorAll<HTMLElement>(".pg-ic") ?? [])];
    const pos = todos.indexOf(ic);
    if (pos < 0 || todos.length < 2) return;
    const caixa = (e: HTMLElement): DOMRect => e.getBoundingClientRect();
    const outros = todos.filter((e) => e !== ic);
    const c = caixa(ic);
    const vizinho = todos[pos + 1] ?? todos[pos - 1];
    const passo = vizinho ? Math.abs(caixa(vizinho).left - c.left) : c.width;
    const r: Reordem = { id: ev.pointerId, mouse: ev.pointerType === "mouse", el: ic, px0: ev.clientX, x0: c.left + c.width / 2, pos, passo: passo || c.width, outros, centros: outros.map((e) => { const b = caixa(e); return b.left + b.width / 2; }), alvo: pos, ativo: false };
    reordem = r;
    // Segurar sem arrastar (no toque) abre o menu do ícone; o clique que vem depois não troca de página.
    if (!r.mouse && p.menu) r.segurar = setTimeout(() => {
      if (reordem !== r || r.ativo) return;
      reordem = null;
      engolirIcone = true;
      setTimeout(() => { engolirIcone = false; }, 600);
      janela?.navigator?.vibrate?.(8);
      p.menu?.(pos, ic);
    }, SEGURAR_MS);
    // O toque num ícone da doca aberta é da ordem, não do arrasto da pílula inteira.
    ev.stopImmediatePropagation();
  }, true);
  doc.addEventListener("pointermove", (ev) => {
    const r = reordem;
    if (!r || ev.pointerId !== r.id) return;
    const dx = ev.clientX - r.px0;
    if (!r.ativo) {
      if (Math.abs(dx) < 6) return;
      r.ativo = true;
      if (r.segurar) clearTimeout(r.segurar);
      try { r.el.setPointerCapture(ev.pointerId); } catch { /* sem captura: segue pelo documento */ }
      doca()?.classList.add("pg-reordenando");
      r.el.classList.add("pg-arrastando");
    }
    ev.preventDefault();
    moverIcones(dx);
  });
  doc.addEventListener("pointerup", (ev) => { if (reordem && ev.pointerId === reordem.id) fimDaReordem(true); });
  doc.addEventListener("pointercancel", (ev) => { if (reordem && ev.pointerId === reordem.id) fimDaReordem(false); });

  doc.addEventListener("pointerdown", (ev) => {
    observar();
    const c = naPilula(ev.target);
    // Tocar fora fecha a doca aberta pelo toque.
    if (!c) { if (aberta && ev.pointerType !== "mouse") abrir(false); return; }
    if (ev.pointerType === "mouse" || !temDoca() || toque) return;
    toque = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, arrastando: false, segurou: false, timer: null };
    const meu = toque;
    meu.timer = setTimeout(() => {
      if (toque !== meu || meu.arrastando) return;
      meu.segurou = true;
      janela?.navigator?.vibrate?.(8);
      abrir(true);
    }, SEGURAR_MS);
  });
  doc.addEventListener("pointermove", (ev) => {
    const t = toque;
    if (!t || ev.pointerId !== t.id) return;
    const dx = ev.clientX - t.x;
    const dy = ev.clientY - t.y;
    if (!t.arrastando) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) {
        // Puxar para baixo é a busca do main (bnc-puxando): o toque deixa de ser da pílula.
        if (Math.abs(dy) > 6) { if (t.timer) clearTimeout(t.timer); toque = null; }
        return;
      }
      t.arrastando = true;
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      if (quadroEstica) { janela?.cancelAnimationFrame(quadroEstica); quadroEstica = 0; }
    }
    aplicarEsticada(dx);
  });
  const fimDoToque = (ev: PointerEvent, valeu: boolean): void => {
    const t = toque;
    if (!t || ev.pointerId !== t.id) return;
    toque = null;
    if (t.timer) clearTimeout(t.timer);
    if (t.arrastando) {
      const dx = ev.clientX - t.x;
      soltarEsticada(dx);
      const passo = valeu ? passoDoArrasto(dx) : 0;
      if (passo) puxar(passo);
    }
    if (t.arrastando || t.segurou) engolirClique();
  };
  doc.addEventListener("pointerup", (ev) => fimDoToque(ev, true));
  doc.addEventListener("pointercancel", (ev) => fimDoToque(ev, false));

  function engolirClique(): void {
    engolir = true;
    setTimeout(() => { engolir = false; }, 350);
  }
  // Na fase de captura: o clique do fim do gesto não chega ao `alternar-detalhes` do main. O de um ícone da doca aberta
  // pelo toque passa, e a doca fecha logo depois.
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    const ic = alvo?.closest?.("#cabecalho .pg-ic");
    if (engolirIcone && ic) { ev.preventDefault(); ev.stopPropagation(); engolirIcone = false; return; }
    if (engolir && naPilula(alvo) && !ic) { ev.preventDefault(); ev.stopPropagation(); engolir = false; return; }
    if (ic && (ev as PointerEvent).pointerType && (ev as PointerEvent).pointerType !== "mouse") setTimeout(() => abrir(false), 220);
  }, true);

  /* ---------- a dica da primeira vez ---------- */
  let dica: HTMLElement | null = null;
  function mostrarDica(): void {
    if (dica || !ativa()) return;
    let jaViu: string | null = null;
    try { jaViu = janela?.localStorage.getItem(CHAVE_DA_DICA) ?? null; } catch { jaViu = "1"; }
    if (!mostraDica(p.total(), jaViu)) return;
    const c = pil();
    if (!c) return;
    const toqueGrosso = janela?.matchMedia?.("(pointer: coarse)").matches ?? false;
    dica = doc.createElement("div");
    dica.className = "pg-dica";
    dica.setAttribute("aria-hidden", "true");
    dica.textContent = textoDaDica(toqueGrosso);
    const r = c.getBoundingClientRect();
    dica.style.top = `${Math.round(r.bottom + 18)}px`;
    doc.body.append(dica);
    setTimeout(() => esconderDica(true), 5000);
  }
  function esconderDica(guardar: boolean): void {
    if (!dica) return;
    const d = dica;
    d.classList.add("pg-dica-sai");
    setTimeout(() => d.remove(), 400);
    if (guardar) { try { janela?.localStorage.setItem(CHAVE_DA_DICA, "1"); } catch { /* sem armazenamento: a dica volta na próxima */ } }
  }

  // O cabeçalho já pode estar na tela: observa desde já e mostra a dica sem esperar o primeiro ponteiro.
  observar();
  mostrarDica();
}
