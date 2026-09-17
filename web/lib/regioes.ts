/**
 * Render por REGIÕES (plano L9): cada região é um nó fixo do index.html cujo innerHTML só é trocado
 * quando o HTML mudou — e o composer NUNCA é regravado enquanto a conversa é a mesma (o textarea
 * preserva texto, foco e cursor entre frames). Sem framework: strings + delegação de eventos por
 * `data-act` em main.ts. ADR-029 (render por classe): estados de falha viram texto com relógio.
 */
const ultimoHtml = new Map<string, string>();

export function regiao(id: string, html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (ultimoHtml.get(id) === html) return;
  ultimoHtml.set(id, html);
  el.innerHTML = html;
}

/** Zera o cache de uma região (quando o nó foi trocado por fora). */
export function esquecerRegiao(id: string): void {
  ultimoHtml.delete(id);
}

