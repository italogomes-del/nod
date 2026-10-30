/**
 * NOD-429 (definido em 2026-10-30): a troca Conversa ↔ Quadro na pílula, nos nós vivos do palco.
 *
 * - O HTML do segmento não diz o modo (web/telas/quadro.ts, `segmento`); `sincronizar` marca `data-atual`,
 *   `aria-selected` e `tabindex` depois de cada desenho, e o indicador desliza por transição de CSS (web/quadro.css).
 * - A conversa (timeline, campo, faixas) nunca é regravada nem tirada do DOM: no modo Quadro ela fica por baixo, invisível
 *   e `inert`; a vista `#quadro` cobre o palco. Rolagem, rascunho e foco da conversa sobrevivem à ida e volta.
 * - Comentário final do Marlon na j7-1: o conteúdo desliza de lado nos dois sentidos (Web Animations, `movimentoDaTroca`);
 *   com "Reduzir movimento", fade curto sem deslocamento. Trocar de volta no meio inverte a animação em curso, do ponto
 *   onde ela está (sem salto).
 * - O modo é por conversa e só em memória: trocar de conversa (ou sair dela) volta para Conversa, sem animação.
 */
import { STATUS, direcaoDaTroca, ehModo, modoPelaTecla, movimentoDaTroca, type ModoDaConversa, type Status } from "./quadro.ts";
import { quadroVazio, type Filtro } from "../telas/quadro.ts";

/** Os pedaços do palco que são "a conversa": saem juntos quando o Quadro entra. */
export const LADO_DA_CONVERSA = ["timeline", "pilula-novas", "faixa-trabalhos", "composer"] as const;

const ehStatus = (v: unknown): v is Status => (STATUS as readonly unknown[]).includes(v);

export interface QuadroNaTela {
  /** Depois de cada desenho: `chave` é a conversa à vista com o quadro liberado, ou null (outra tela, flag desligada). */
  sincronizar(o: { chave: string | null; nome: string }): void;
  trocar(para: ModoDaConversa, o?: { foco?: boolean }): void;
  modo(): ModoDaConversa;
}

export function criarQuadroNaTela(doc: Document, o: { reduzido?: () => boolean; aoTrocar?: (m: ModoDaConversa) => void } = {}): QuadroNaTela {
  const reduzido = o.reduzido ?? (() => doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  let chave: string | null = null;
  let nome = "";
  let modo: ModoDaConversa = "conversa";
  let filtro: Filtro = "todos";
  /** As colunas que a pessoa abriu ou recolheu, ao contrário do padrão. */
  let alternadas = new Set<Status>();
  let animacoes: Animation[] = [];
  /** Quem está saindo na animação em curso (fica `inert`); na inversão, troca com quem entra. */
  let saindo: HTMLElement[] = [];
  let entrando: HTMLElement[] = [];
  let vez = 0;
  /**
   * A aba que tem o foco: se o render regravar o cabeçalho, o nó dela sai do DOM e o foco cai no body; aí ele vai para a aba
   * nova do mesmo modo. Zera quando a pessoa leva o foco para outro lugar (clique, toque, Tab), para não puxá-lo de volta.
   */
  let abaFocada: { el: HTMLElement; modo: ModoDaConversa } | null = null;

  const vista = (): HTMLElement | null => doc.getElementById("quadro");
  const conversa = (): HTMLElement[] => LADO_DA_CONVERSA.map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);

  function desenharVista(): void {
    const v = vista();
    if (v) v.innerHTML = quadroVazio({ nome, filtro, alternadas });
  }

  function mostrar(els: HTMLElement[]): void {
    for (const e of els) {
      e.classList.remove("qd-saiu");
      e.inert = false;
      if (e.id === "quadro") e.hidden = false;
    }
  }
  function esconder(els: HTMLElement[]): void {
    for (const e of els) {
      if (e.id === "quadro") { e.hidden = true; continue; }
      e.classList.add("qd-saiu");
      e.inert = true;
    }
  }

  function marcar(): void {
    const seg = doc.querySelector<HTMLElement>("#cabecalho .qd-seg");
    if (seg) {
      // Segmento recém-desenhado (cabeçalho regravado): nó novo não tem estilo anterior, então o indicador nasce no lugar.
      seg.dataset["atual"] = modo;
      for (const b of seg.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const s = b.dataset["modo"] === modo;
        b.setAttribute("aria-selected", String(s));
        b.tabIndex = s ? 0 : -1;
      }
    }
    doc.querySelector(".stage")?.classList.toggle("qd-no-quadro", modo === "quadro");
    const ativo = doc.activeElement;
    if (abaFocada && !abaFocada.el.isConnected && (!ativo || ativo === doc.body)) focarAba(abaFocada.modo);
  }

  function cancelar(): void {
    vez++;
    for (const a of animacoes) a.cancel();
    animacoes = [];
    saindo = [];
    entrando = [];
  }

  /** Sem animação: o estado final do modo atual. */
  function assentar(): void {
    const v = vista();
    if (modo === "quadro") { mostrar(v ? [v] : []); esconder(conversa()); }
    else { mostrar(conversa()); esconder(v ? [v] : []); }
    marcar();
  }

  function trocar(para: ModoDaConversa, op: { foco?: boolean } = {}): void {
    const direcao = chave === null ? null : direcaoDaTroca(modo, para);
    if (!direcao) { if (op.foco) focarAba(para); return; }
    if (animacoes.length) {
      // Volta no meio: a mesma animação anda para trás, do ponto onde está; quem saía passa a entrar.
      modo = para;
      marcar();
      o.aoTrocar?.(para);
      [saindo, entrando] = [entrando, saindo];
      for (const e of saindo) e.inert = true;
      for (const e of entrando) e.inert = false;
      for (const a of animacoes) a.reverse();
      if (op.foco) focarAba(para);
      return;
    }
    cancelar();
    const v = vista();
    if (!v) return;
    if (para === "quadro" && !v.firstElementChild) desenharVista();
    modo = para;
    marcar();
    // Depois de `modo = para`: quem ouve (o main, que marca a conversa como lida na volta) já vê o modo novo.
    o.aoTrocar?.(para);
    const sai = para === "quadro" ? conversa() : [v];
    const entra = para === "quadro" ? [v] : conversa();
    saindo = sai;
    entrando = entra;
    mostrar([...sai, ...entra]);
    for (const e of sai) e.inert = true;
    const mv = movimentoDaTroca(direcao, reduzido());
    const pode = typeof v.animate === "function";
    if (!pode) { assentar(); if (op.foco) focarAba(para); return; }
    const opcoes: KeyframeAnimationOptions = { duration: mv.ms, easing: mv.curva };
    animacoes = [...sai.map((e) => e.animate(mv.sai, opcoes)), ...entra.map((e) => e.animate(mv.entra, opcoes))];
    const minha = vez;
    const fim = (): void => {
      if (minha !== vez) return;
      animacoes = [];
      saindo = [];
      entrando = [];
      assentar();
    };
    void Promise.all(animacoes.map((a) => a.finished)).then(fim, fim);
    if (op.foco) focarAba(para);
  }

  function focarAba(m: ModoDaConversa): void {
    doc.querySelector<HTMLElement>(`#cabecalho .qd-seg [role="tab"][data-modo="${m}"]`)?.focus();
  }

  function sincronizar(s: { chave: string | null; nome: string }): void {
    // Fora de uma conversa com quadro, e já sem quadro: nada a mexer (o palco é de outra tela).
    if (s.chave === null && chave === null) return;
    if (s.chave !== chave) {
      cancelar();
      chave = s.chave;
      modo = "conversa";
      filtro = "todos";
      alternadas = new Set();
      const v = vista();
      if (v) v.innerHTML = "";
    }
    if (s.nome !== nome) { nome = s.nome; if (vista()?.firstElementChild) desenharVista(); }
    // No meio de uma animação o estado é dela; só o segmento (o cabeçalho pode ter sido regravado) é remarcado.
    if (animacoes.length) marcar();
    else assentar();
  }

  // As ações do segmento e do quadro vazio moram aqui, não no mapa de ações do main: são só da tela.
  doc.addEventListener("click", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset["act"];
    if (act === "modo-da-conversa" && el.closest("#cabecalho")) {
      const m = el.dataset["modo"];
      if (ehModo(m)) trocar(m);
    } else if (el.closest("#quadro") && (act === "abrir-coluna" || act === "filtro-do-quadro")) {
      if (act === "filtro-do-quadro") {
        const f = el.dataset["filtro"];
        if (f === "todos" || f === "pessoas" || f === "agentes") filtro = f;
      } else {
        const st = el.dataset["status"];
        if (ehStatus(st)) { if (alternadas.has(st)) alternadas.delete(st); else alternadas.add(st); }
      }
      const sel = act === "abrir-coluna" ? `[data-act="abrir-coluna"][data-status="${CSS.escape(el.dataset["status"] ?? "")}"]` : `[data-act="filtro-do-quadro"][data-filtro="${filtro}"]`;
      const lugar = act === "filtro-do-quadro" ? ".qd-barra-q" : el.closest(".qd-so-estreito") ? ".qd-so-estreito" : ".qd-so-largo";
      desenharVista();
      vista()?.querySelector<HTMLElement>(`${lugar} ${sel}`)?.focus();
    }
  });

  // O teclado do tablist (APG, ativação automática): ← → Home End trocam e levam o foco.
  doc.addEventListener("keydown", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>('#cabecalho .qd-seg [role="tab"]');
    if (!el || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const prox = modoPelaTecla(modo, ev.key);
    if (!prox) return;
    ev.preventDefault();
    trocar(prox, { foco: true });
  });

  const abaDe = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>('#cabecalho .qd-seg [role="tab"]') ?? null;
  doc.addEventListener("focusin", (ev) => {
    const el = abaDe(ev.target);
    const m = el?.dataset["modo"];
    abaFocada = el && ehModo(m) ? { el, modo: m } : null;
  });
  // A pessoa tirou o foco da aba com um clique ou toque fora dela (no vazio o foco cai no body, sem focusin): esquece.
  // Não dá para usar o focusout: o Chrome também o dispara quando a regravação tira o nó, e aí o foco tem de voltar.
  doc.addEventListener("pointerdown", (ev) => { if (!abaDe(ev.target)) abaFocada = null; }, true);

  return { sincronizar, trocar, modo: () => modo };
}
