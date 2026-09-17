import type { FrotaDto } from "../../src/contracts/api.ts";
import { esc, iconeAgente, botao } from "../lib/render.ts";

export type BotGerido = FrotaDto["agentes"][number];
export type AcaoGestao = "fixar" | "mover" | "nao-lido" | "renomear" | "perfil" | "duplicar" | "copiar" | "ocultar" | "excluir" | "restaurar";

export function renderGestao(dados: FrotaDto | null, pessoaId?: string): string {
  const bots = dados?.agentes.filter((a) => a.ownerId === pessoaId) ?? [];
  const grupo = (titulo: string, lista: BotGerido[]) => `<section class="gestao-grupo"><h2>${titulo} <small>${lista.length}</small></h2>${lista.length ? lista.map((a) => `<article class="gestao-row">${iconeAgente(a)}<div><b>${esc(a.nome)}</b><p>${esc(a.titulo || "Sem título")}${a.secao ? ` · ${esc(a.secao)}` : ""}</p></div>${a.excluidoEm ? botao("restaurar-agente", "Restaurar", { id: a.id }) : botao("menu-agente", "•••", { id: a.id, titulo: `Ações de ${a.nome}` })}</article>`).join("") : '<p class="mudo">Nenhum agente aqui.</p>'}</section>`;
  return `<section class="tela tela-gestao"><header class="tela-cab"><h1>Gerenciar agentes</h1>${botao("atualizar-gestao", "Atualizar")}</header><p class="intro">Organize sua equipe e encontre os bots que saíram da barra lateral.</p>${!dados ? '<p role="status">Carregando…</p>' : grupo("Ativos", bots.filter((a) => !a.excluidoEm && !a.oculto)) + grupo("Ocultos", bots.filter((a) => !a.excluidoEm && a.oculto)) + '<p class="mudo">Ocultar não pausa o bot nem suas rotinas.</p>' + grupo("Excluídos", bots.filter((a) => a.excluidoEm)) + '<p class="mudo">Restaurar recupera o perfil e o histórico. Rotinas continuam pausadas e acessos precisam ser concedidos novamente.</p>'}</section>`;
}

function dialogo(html: string, menu = false): HTMLDialogElement {
  document.getElementById("gestao-dialogo")?.remove();
  const d = document.createElement("dialog");
  d.id = "gestao-dialogo";
  d.className = menu ? "bot-menu" : "bot-dialogo";
  d.innerHTML = html;
  d.addEventListener("click", (e) => { e.stopPropagation(); if (e.target === d) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

export function abrirMenu(a: BotGerido, dona: boolean, ancora: HTMLElement, executar: (acao: AcaoGestao) => void): void {
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
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, Math.min(r.right, window.innerWidth - 308))}px`;
  d.style.top = `${Math.max(12, Math.min(r.top, window.innerHeight - d.offsetHeight - 12))}px`;
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
