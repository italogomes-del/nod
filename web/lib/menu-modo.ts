import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { chaveAvisoModo, renderMenuModo } from "../telas/aprovacoes.ts";
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
 * Avisos de modo fechados (revisto em 2026-10-06, pedido do Marlon): por modo, não por bot, e guardados no servidor
 * (0059) — o app do Mac limpa o localStorage a cada conexão, e o aviso voltava a cada abertura, em cada bot, a cada
 * troca de modo. O localStorage fica só de cache, para o aviso não piscar antes de as preferências chegarem.
 */
const CHAVE_AVISOS = "nod.avisosFechados";
const fechados = new Set<string>(lerFechados());

function lerFechados(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_AVISOS) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

function gravarFechados(): void {
  try { localStorage.setItem(CHAVE_AVISOS, JSON.stringify([...fechados].slice(-50))); } catch { /* o servidor guarda de qualquer jeito */ }
}

/** As chaves que o servidor devolveu em GET preferencias somam às do cache. */
export function hidratarAvisosFechados(chaves: readonly string[]): void {
  for (const c of chaves) fechados.add(c);
  gravarFechados();
}

export function avisoFechado(modo: ModoAprovacao): boolean {
  return fechados.has(chaveAvisoModo(modo));
}

/** Marca fechado aqui e devolve a chave, que quem chama grava no servidor. */
export function fecharAviso(modo: ModoAprovacao): string {
  const chave = chaveAvisoModo(modo);
  fechados.add(chave);
  gravarFechados();
  return chave;
}
