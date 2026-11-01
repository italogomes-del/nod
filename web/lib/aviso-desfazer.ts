import { esc } from "./render.ts";

/**
 * NOD-449 (protótipo aprovado, passo "Lida, com Desfazer"): o aviso no pé da tela depois de marcar como lido — uma frase
 * e Desfazer. Sai sozinho em alguns segundos; um aviso novo toma o lugar do anterior (o Desfazer vale para o último).
 * No celular, fica acima da barra de baixo (o CSS cuida). `role="status"`: o leitor de tela anuncia sem roubar o foco.
 */

export const DURACAO_AVISO_MS = 6000;

let atual: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

export function fecharAvisoDesfazer(): void {
  if (!atual) return;
  clearTimeout(atual.timer);
  atual.el.remove();
  atual = null;
}

export function mostrarAvisoDesfazer(o: { texto: string; aoDesfazer: () => void | Promise<void>; ms?: number }): HTMLElement {
  fecharAvisoDesfazer();
  const el = document.createElement("div");
  el.className = "nl-aviso";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>${esc(o.texto)}</span><button type="button" class="nl-desfazer">Desfazer</button>`;
  el.querySelector("button")!.addEventListener("click", () => {
    fecharAvisoDesfazer();
    void o.aoDesfazer();
  });
  document.body.appendChild(el);
  const timer = setTimeout(() => {
    if (atual?.el === el) fecharAvisoDesfazer();
  }, o.ms ?? DURACAO_AVISO_MS);
  atual = { el, timer };
  return el;
}
