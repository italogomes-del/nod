import { areaVisivel, CONSULTA_CELULAR } from "./celular.ts";

/** O toque abre as ações da mensagem (relatar) só se não caiu num link, botão ou campo dentro dela. */
export const SELETOR_INTERATIVO = "a, button, input, textarea, select, summary, label, [role='button'], [contenteditable='true']";

export interface Celular {
  /** true quando a consulta de celular casa agora. */
  ativo(): boolean;
  botsAbertos(): boolean;
  abrirBots(): void;
  fecharBots(): void;
  alternarBots(): void;
}

/**
 * Liga a gaveta de bots, o fundo escurecido, o Esc, o `inert` das partes atrás e a altura acima do teclado. A barra de bots
 * (#sidebar) é a mesma do desktop; no celular ela fica fora da tela até o ☰ do cabeçalho (`data-act="abrir-bots"`).
 */
export function criarCelular(): Celular {
  const consulta = window.matchMedia(CONSULTA_CELULAR);
  const app = document.querySelector<HTMLElement>(".app");
  const sidebar = document.getElementById("sidebar");
  const stage = document.querySelector<HTMLElement>(".stage");
  let abertos = false;
  const fundo = document.createElement("div");
  fundo.className = "fundo-gaveta-bots";
  fundo.hidden = true;
  fundo.setAttribute("aria-hidden", "true");
  app?.append(fundo);

  function pintar(): void {
    const ligado = consulta.matches;
    const mostrar = ligado && abertos;
    app?.classList.toggle("bots-abertos", mostrar);
    fundo.hidden = !mostrar;
    // Fora da tela a barra não recebe Tab nem leitor de tela; aberta, é o palco que fica de fora.
    if (sidebar) sidebar.inert = ligado && !mostrar;
    if (stage) stage.inert = mostrar;
    for (const bt of document.querySelectorAll('[data-act="abrir-bots"]')) bt.setAttribute("aria-expanded", String(mostrar));
  }

  function mudar(proximo: boolean): void {
    if (abertos === proximo) return;
    abertos = proximo;
    pintar();
  }

  function ajustarAltura(): void {
    const area = areaVisivel(window.visualViewport, consulta.matches);
    const raiz = document.documentElement.style;
    if (area) {
      raiz.setProperty("--altura-visivel", `${area.altura}px`);
      raiz.setProperty("--topo-visivel", `${area.topo}px`);
    } else {
      raiz.removeProperty("--altura-visivel");
      raiz.removeProperty("--topo-visivel");
    }
  }

  fundo.addEventListener("click", () => mudar(false));
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !abertos || !consulta.matches || document.querySelector("dialog[open]")) return;
    ev.preventDefault();
    mudar(false);
  });
  // O toque numa mensagem mostra o "relatar" dela (no celular ele não fica à vista o tempo todo, nem apagado).
  document.addEventListener("click", (ev) => {
    if (!consulta.matches || !(ev.target instanceof Element) || ev.target.closest(SELETOR_INTERATIVO)) return;
    const mensagem = ev.target.closest(".message, .msg-linha");
    if (!mensagem) return;
    for (const outra of document.querySelectorAll(".acoes-a-mostra")) if (outra !== mensagem) outra.classList.remove("acoes-a-mostra");
    mensagem.classList.toggle("acoes-a-mostra");
  });
  consulta.addEventListener("change", () => {
    abertos = false;
    pintar();
    ajustarAltura();
  });
  window.visualViewport?.addEventListener("resize", ajustarAltura);
  window.visualViewport?.addEventListener("scroll", ajustarAltura);
  window.addEventListener("resize", ajustarAltura);
  pintar();
  ajustarAltura();

  return {
    ativo: () => consulta.matches,
    botsAbertos: () => consulta.matches && abertos,
    abrirBots: () => { if (consulta.matches) mudar(true); },
    fecharBots: () => mudar(false),
    alternarBots: () => { if (consulta.matches) mudar(!abertos); },
  };
}
