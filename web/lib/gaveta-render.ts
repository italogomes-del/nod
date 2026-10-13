import type { Estado } from "../estado/reducer.ts";
import { renderDetalhes } from "../telas/detalhes.ts";
import { lembrar } from "./lembrar.ts";
import { regiao, regiaoMudaria } from "./regioes.ts";

/**
 * Definido em 2026-10-12 (GFK-2027): texto não salvo fica no DOM; a Inteligência tem o rascunho no reducer e
 * acompanha cada mudança, mesmo suja. Os botões e a rolagem desse nível continuam no lugar após redesenhar.
 */
export function atualizarGaveta(estado: Estado, gavetaSuja: string | null): void {
  const inteligencia = estado.gaveta?.nivel.tipo === "inteligencia";
  if (!inteligencia && gavetaSuja === JSON.stringify(estado.gaveta)) return;
  const html = lembrar("detalhes", estado, [], renderDetalhes);
  if (!regiaoMudaria("detalhes", html)) return;

  const ativo = document.activeElement;
  let foco: string | null = null;
  if (inteligencia && ativo instanceof HTMLButtonElement && ativo.closest('#detalhes [data-form="inteligencia"]')) {
    if (ativo.dataset.act) {
      foco = `button${[...ativo.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}="${CSS.escape(a.value)}"]`).join("")}`;
    } else if (ativo.hasAttribute("data-alca-ordem")) {
      const ia = ativo.closest<HTMLElement>("[data-ordem-item]")?.dataset.ordemItem;
      if (ia) foco = `[data-ordem-item="${CSS.escape(ia)}"] button[data-alca-ordem]`;
    }
  }
  const corpo = inteligencia ? document.querySelector<HTMLElement>("#detalhes .gv-corpo") : null;
  const rolagem = corpo?.scrollTop ?? 0;
  regiao("detalhes", html);
  if (corpo) {
    const novo = document.querySelector<HTMLElement>("#detalhes .gv-corpo");
    if (novo) novo.scrollTop = rolagem;
  }
  if (foco) document.querySelector<HTMLElement>(`#detalhes ${foco}`)?.focus({ preventScroll: true });
}
