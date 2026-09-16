import type { Agente } from "../../src/contracts/agente.ts";
import type { Autoria } from "../../src/contracts/evento.ts";

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

export function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Linguagem visual de prototypes/fleet-is-home.html: círculo cheio = PESSOA, quadrado vazado = AGENTE.
 * Lê `autor_tipo`, nunca infere do nome (ADR-023). A cor do agente vem do perfil (`cor`).
 */
export function avatar(p: { tipo: Autoria["autor_tipo"]; nome: string; cor?: string; tamanho?: "sm" | "md" | "lg" }): string {
  const t = p.tamanho ?? "md";
  if (p.tipo === "pessoa") return `<span class="av av-pessoa ${t}" title="${esc(p.nome)}">${esc(iniciais(p.nome))}</span>`;
  return `<span class="av av-agente ${t} ${esc(p.cor ?? "c-black")}" title="${esc(p.nome)}">${esc(iniciais(p.nome))}</span>`;
}

export function avatarAgente(a: Pick<Agente, "nome" | "cor">, tamanho: "sm" | "md" | "lg" = "md"): string {
  return avatar({ tipo: "agente", nome: a.nome, cor: a.cor, tamanho });
}

/**
 * Ícone CHEIO do bot no protótipo private-agents-minimal (PR #4): quadrado/hexágono/círculo preenchido
 * com a cor do perfil e iniciais em branco. Usado na sidebar, nos favoritos e no cabeçalho da conversa.
 */
export function iconeAgente(a: Pick<Agente, "nome" | "cor" | "forma">, tamanho: "" | "md" | "lg" = ""): string {
  const t = tamanho ? ` ${tamanho}` : "";
  return `<span class="icon ${esc(a.cor)} ${esc(a.forma)}${t}" title="${esc(a.nome)}">${esc(iniciais(a.nome))}</span>`;
}

/** 'HH:MM' no fuso da máquina da pessoa (a web só interpola; o servidor manda absoluto, ADR-007). */
export function hora(instante: number | string): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  if (Number.isNaN(t)) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

export function dataHora(instante: number | string, fusoIana?: string): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  if (Number.isNaN(t)) return "instante inválido";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

export function botao(act: string, rotulo: string, extra: { id?: string; classe?: string; dados?: Record<string, string>; desabilitado?: boolean; titulo?: string } = {}): string {
  const dados = Object.entries(extra.dados ?? {})
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join("");
  return `<button class="bt ${extra.classe ?? ""}" data-act="${esc(act)}"${extra.id ? ` data-id="${esc(extra.id)}"` : ""}${dados}${extra.desabilitado ? " disabled" : ""}${extra.titulo ? ` title="${esc(extra.titulo)}"` : ""}>${rotulo}</button>`;
}

/** Texto multilinha escapado com quebras preservadas. */
export function paragrafos(texto: string): string {
  return esc(texto).replaceAll("\n", "<br>");
}
