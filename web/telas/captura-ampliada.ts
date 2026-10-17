import { htmlCapturaAmpliada } from "./conversa.ts";

/**
 * NOD-56 (protótipo do Gil, 2026-10-05): a captura da tela do bot ampliada em sobreposição na conversa. Segue o padrão do
 * computador (append + showModal). Esc fecha (nativo do <dialog>), o clique no fundo fecha, e ao fechar o foco volta à
 * miniatura que abriu. "Abrir em nova aba" usa a mesma rota de anexos da miniatura.
 */
export function abrirCapturaAmpliada(origem: HTMLElement): HTMLDialogElement | null {
  const src = origem.dataset.src;
  if (!src) return null;
  document.querySelector<HTMLDialogElement>(".captura-ampliada")?.close();
  const legenda = origem.dataset.legenda ?? "Tela do computador ao fim do turno";
  const dialog = document.createElement("dialog");
  dialog.className = "captura-ampliada";
  dialog.setAttribute("aria-label", legenda);
  dialog.innerHTML = htmlCapturaAmpliada(src, legenda);
  // O clique no backdrop chega com o alvo no próprio <dialog> (o conteúdo fica num filho que o cobre). Exige que o
  // pressionar também tenha sido no fundo: arrastar de dentro da imagem para fora não fecha.
  let pressionouNoFundo = false;
  dialog.addEventListener("pointerdown", (ev) => { pressionouNoFundo = ev.target === dialog; });
  dialog.addEventListener("click", (ev) => {
    const alvo = ev.target as HTMLElement;
    if ((alvo === dialog && pressionouNoFundo) || alvo.closest('[data-captura="fechar"]')) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // A conversa pode ter re-renderizado com o dialog aberto: aí o foco vai à miniatura nova da mesma captura.
    const alvo = origem.isConnected ? origem : document.querySelector<HTMLElement>(`[data-act="ampliar-captura"][data-src="${CSS.escape(src)}"]`);
    alvo?.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('[data-captura="fechar"]')?.focus({ preventScroll: true });
  return dialog;
}
