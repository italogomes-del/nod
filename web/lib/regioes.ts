/**
 * Render por REGIÕES (plano L9): cada região é um nó fixo do index.html cujo innerHTML só é trocado
 * quando o HTML mudou — e o composer NUNCA é regravado enquanto a conversa é a mesma (o textarea
 * preserva texto, foco e cursor entre frames). Sem framework: strings + delegação de eventos por
 * `data-act` em main.ts. ADR-029 (render por classe): estados de falha viram texto com relógio.
 */
import { seletoresDoFoco } from "./foco-do-bloco.ts";

const ultimoHtml = new Map<string, string>();

export function regiao(id: string, html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (ultimoHtml.get(id) === html) return;
  ultimoHtml.set(id, html);
  el.innerHTML = html;
}

/**
 * A região seria regravada com este HTML? definido em 2026-09-28 (ADR-051): quem guarda nó VIVO dentro
 * dela (o iframe do artefato) só o tira antes quando o innerHTML vai mesmo ser trocado.
 */
export function regiaoMudaria(id: string, html: string): boolean {
  return ultimoHtml.get(id) !== html;
}

/** Zera o cache de uma região (quando o nó foi trocado por fora). */
export function esquecerRegiao(id: string): void {
  ultimoHtml.delete(id);
  blocosAplicados.delete(id);
}

type Bloco = { chave: string; html: string };
type BlocoNaTela = Bloco & { el: Element };
const blocosAplicados = new Map<string, BlocoNaTela[]>();

/** A região seria mexida por estes blocos? Mesmas chaves, na mesma ordem e com o mesmo HTML = nada a fazer. */
export function blocosMudariam(id: string, blocos: readonly Bloco[]): boolean {
  const raiz = document.getElementById(id);
  const antes = blocosAplicados.get(id);
  if (!raiz || !antes || antes.length !== blocos.length) return true;
  return antes.some((b, i) => b.el.parentNode !== raiz || b.chave !== blocos[i]?.chave || b.html !== blocos[i]?.html);
}

/**
 * Região por BLOCOS com chave (definido em 2026-09-30): cada bloco é um `<div class="bloco">` (display: contents no
 * CSS) e só os blocos cujo HTML mudou são refeitos; os que saíram são tirados e os novos entram no lugar. Os que
 * ficam não são tocados — nem o mascote, nem o <details> aberto, nem o campo com texto. medido em 2026-09-30 (Chrome
 * headless com o main.ts real): no fim de um turno na conversa aberta, regravar o histórico inteiro de 200 mensagens
 * (~28 mil nós) custava 381 ms e recriava 80 mascotes; em blocos, as duas escritas somaram 0,3 ms.
 */
export function regiaoPorBlocos(id: string, blocos: readonly Bloco[]): void {
  const raiz = document.getElementById(id);
  if (!raiz) return;
  const focado = document.activeElement instanceof HTMLElement && raiz.contains(document.activeElement) ? document.activeElement : null;
  const porChave = new Map((blocosAplicados.get(id) ?? []).filter((b) => b.el.parentNode === raiz).map((b) => [b.chave, b]));
  const vistos = new Set<string>();
  const novos: BlocoNaTela[] = blocos.map((b) => {
    // Chave repetida não reaproveita nada: o segundo bloco com a mesma chave sempre nasce de novo.
    const antes = vistos.has(b.chave) ? undefined : porChave.get(b.chave);
    vistos.add(b.chave);
    if (antes && antes.html === b.html) return { ...b, el: antes.el };
    const el = document.createElement("div");
    el.className = "bloco";
    el.innerHTML = b.html;
    return { ...b, el };
  });
  const ficam = new Set(novos.map((b) => b.el));
  for (const filho of [...raiz.children]) if (!ficam.has(filho)) filho.remove();
  // Na ordem nova: quem já está no lugar fica; o que falta entra (ou muda de lugar, o caso raro).
  let cursor = raiz.firstElementChild;
  for (const { el } of novos) {
    if (el === cursor) cursor = cursor.nextElementSibling;
    else raiz.insertBefore(el, cursor);
  }
  blocosAplicados.set(id, novos);
  ultimoHtml.delete(id);
  // O botão focado morava num bloco refeito (o chip ou a barra da fala que acabou de reagir): o foco volta ao mesmo
  // botão no bloco novo, em vez de cair no <body> e perder o lugar na conversa (revisão do PR 392, em 2026-10-18).
  if (focado && !focado.isConnected) {
    for (const seletor of seletoresDoFoco(focado.dataset)) {
      const alvo = raiz.querySelector<HTMLElement>(seletor);
      if (alvo) { alvo.focus({ preventScroll: true }); break; }
    }
  }
}
