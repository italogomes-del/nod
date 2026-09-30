import type { SecaoEspaco } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";
import type { AcaoGestao, BotGerido } from "./gestao.ts";
import { htmlMenuConta, type DadosMenuConta } from "./menu-conta.ts";

export type { AcaoGestao, BotGerido } from "./gestao.ts";

export function dialogo(html: string, menu = false): HTMLDialogElement {
  document.getElementById("gestao-dialogo")?.remove();
  const d = document.createElement("dialog");
  d.id = "gestao-dialogo";
  d.className = menu ? "bot-menu" : "bot-dialogo";
  d.innerHTML = html;
  const titulo = d.querySelector("h2");
  if (titulo) { titulo.id = "gestao-dialogo-titulo"; d.setAttribute("aria-labelledby", titulo.id); }
  const focoAnterior = document.activeElement;
  d.addEventListener("click", (e) => { e.stopPropagation(); if (e.target === d) d.close(); });
  d.addEventListener("close", () => { d.remove(); if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus(); });
  document.body.append(d);
  d.showModal();
  return d;
}

export function abrirMenu(a: BotGerido, dona: boolean, ancora: HTMLElement, executar: (acao: AcaoGestao) => void, ponto?: { x: number; y: number }): void {
  const caminhos: Record<AcaoGestao, string> = {
    fixar: "M16 3l5 5-4 1-4 4v4l-2 2-3-5-5-3 2-2h4l4-4z M8 16l-5 5",
    mover: "M3 5h6l2 3h10v12H3z",
    "nao-lido": "M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
    renomear: "M16 3l5 5-12 12-6 1 1-6z M13 6l5 5",
    perfil: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 10h6 M9 12h6 M17 16h6",
    duplicar: "M8 8h13v13H8z M4 16H3V3h13v1",
    copiar: "M8 8h13v13H8z M4 16H3V3h13v1",
    ocultar: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M3 3l18 18 M10 10a3 3 0 004 4",
    excluir: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
    restaurar: "M3 4v6h6 M3 10a9 9 0 119 11",
  };
  const item = (acao: AcaoGestao, _icone: string, texto: string, perigo = false) => `<button type="button" role="menuitem" data-gestao="${acao}"${perigo ? ' class="danger"' : ""}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${caminhos[acao]}"/></svg>${texto}</button>`;
  const d = dialogo(`<div role="menu" aria-label="Ações de ${esc(a.nome)}"><p class="menu-nome">${esc(a.nome)}</p>${dona ? item("fixar", "♧", a.fixado ? "Desafixar" : "Fixar") + item("mover", "▱", "Mover para…") + item("nao-lido", "◉", a.naoLido ? "Marcar como lido" : "Marcar como não lido") + '<hr>' + item("renomear", "✎", "Renomear bot") + item("perfil", "⚙", "Editar perfil") : ""}${item("duplicar", "▣", "Duplicar")}<hr>${item("copiar", "▢", "Copiar ID da conversa")}${dona ? '<hr>' + item("ocultar", "◌", a.oculto ? "Mostrar na barra lateral" : "Ocultar da barra lateral") + item("excluir", "♲", "Excluir", true) : ""}</div>`, true);
  // definido em 2026-09-30: no clique direito o menu nasce no cursor; sem ponto, ao lado do que o abriu.
  const r = ancora.getBoundingClientRect();
  const x = ponto ? ponto.x + 4 : r.right;
  const y = ponto ? ponto.y + 4 : r.top;
  d.style.left = `${Math.max(12, Math.min(x, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.max(12, Math.min(y, window.innerHeight - d.offsetHeight - 12))}px`;
  d.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gestao]");
    if (btn) { const acao = btn.dataset.gestao as AcaoGestao; d.close(); executar(acao); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
}

export function pedirGestao(titulo: string, corpo: string, confirmar: string, salvar: (dados: FormData) => Promise<void>, perigo = false): void {
  const d = dialogo(`<form><h2>${esc(titulo)}</h2>${corpo}<p class="dialogo-erro" role="alert"></p><div class="acoes"><button class="bt" type="button" data-cancelar>Cancelar</button><button class="bt ${perigo ? "danger" : "pri"}" type="submit">${esc(confirmar)}</button></div></form>`);
  d.querySelector("[data-cancelar]")?.addEventListener("click", () => d.close());
  d.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault(); e.stopPropagation();
    const form = e.currentTarget as HTMLFormElement;
    const dados = new FormData(form);
    for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    void salvar(dados).then(() => d.close()).catch(() => {
      d.querySelector(".dialogo-erro")!.textContent = "Não foi possível concluir. Confira o aviso da página e tente novamente.";
      for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false;
    });
  });
  d.querySelector<HTMLInputElement>("input")?.select();
}

/** O menu da conta (web/telas/menu-conta.ts) sobre o mesmo diálogo dos menus do bot. */
export function abrirMenuConta(ancora: HTMLElement, dados: DadosMenuConta, acoes: { secao(s: SecaoEspaco): void; modoDev(): Promise<boolean> }): void {
  const d = dialogo(htmlMenuConta(dados), true);
  d.classList.add("menu-conta");
  // Nasce acima do avatar, alinhado à esquerda da barra (a largura dela menos as margens).
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, r.left)}px`;
  d.style.top = `${Math.max(12, r.top - d.offsetHeight - 10)}px`;
  d.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const secao = alvo.closest<HTMLElement>("[data-secao]")?.dataset.secao as SecaoEspaco | undefined;
    if (secao) { d.close(); acoes.secao(secao); return; }
    const chave = alvo.closest<HTMLElement>("[data-modo-dev]");
    if (chave) void acoes.modoDev().then((ligado) => chave.setAttribute("aria-checked", String(ligado)));
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  d.querySelector<HTMLButtonElement>("[data-secao]:not(.mc-faixa [data-secao])")?.focus();
}
