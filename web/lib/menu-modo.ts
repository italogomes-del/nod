import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { renderMenuModo } from "../telas/aprovacoes.ts";
import { dialogo } from "../telas/gestao-agentes.ts";

/**
 * A metade com DOM do chip de aprovações (ADR-059): o menu que abre acima do chip e os avisos fechados. Mora fora
 * de telas/aprovacoes.ts para os testes da web (Node, sem DOM) importarem o render sem puxar `document`.
 */
export function abrirMenuModo(ancora: HTMLElement, nome: string, atual: ModoAprovacao, escolher: (modo: ModoAprovacao) => void): void {
  const d = dialogo(renderMenuModo(nome, atual), true);
  d.classList.add("modo-menu");
  ancora.setAttribute("aria-expanded", "true");
  d.addEventListener("close", () => ancora.setAttribute("aria-expanded", "false"));
  // O campo fica no pé da tela: o menu abre ACIMA do chip, alinhado à esquerda dele.
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.max(12, r.top - d.offsetHeight - 8)}px`;
  d.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  d.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-modo]");
    if (!btn) return;
    const modo = btn.dataset.modo as ModoAprovacao;
    d.close();
    if (modo !== atual) escolher(modo);
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("[data-modo]")];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
}

/**
 * Avisos fechados, por bot e modo. definido em 2026-09-29: localStorage é conveniência — o app desktop o limpa a cada
 * conexão, e aí o aviso volta uma vez por sessão, o que para um bot que aprova sozinho é aceitável.
 */
const CHAVE_AVISOS = "nod.avisosModoFechados";
const fechados = new Set<string>(lerFechados());

function lerFechados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_AVISOS) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

function gravarFechados(): void {
  try { localStorage.setItem(CHAVE_AVISOS, JSON.stringify([...fechados].slice(-200))); } catch { /* o aviso some nesta sessão mesmo sem storage */ }
}

export function avisoFechado(agenteId: string, modo: ModoAprovacao): boolean {
  return fechados.has(`${agenteId}:${modo}`);
}

export function fecharAviso(agenteId: string, modo: ModoAprovacao): void {
  fechados.add(`${agenteId}:${modo}`);
  gravarFechados();
}

/** Trocar de modo reabre o aviso do modo novo: é a confirmação do que a pessoa acabou de ligar. */
export function reabrirAviso(agenteId: string, modo: ModoAprovacao): void {
  fechados.delete(`${agenteId}:${modo}`);
  gravarFechados();
}
