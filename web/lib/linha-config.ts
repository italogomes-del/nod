import { ICONE } from "./icones.ts";
import { esc } from "./render.ts";

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): a linha única das Configurações. Toda lista das 6 seções usa
 * esta linha — título, detalhe, status com um ponto de cor e um controle à direita — e o mesmo switch, o mesmo seletor
 * (`<select>` nativo), o mesmo "…" (`.cl-mais`/`.cl-menu`) e a mesma linha recolhida (botão com `aria-expanded`, sem
 * `<details>`). A cor fica só no ponto; o texto sempre diz o estado.
 */

export type TomStatus = "ok" | "atencao" | "erro" | "neutro";

export type OpcaoSeletor = { valor: string; rotulo: string; selecionado?: boolean; desabilitado?: boolean };

export type ControleLinha =
  /** O switch: `data-act` no clique; `desabilitado` trava na posição guardada. */
  | { tipo: "switch"; ligado: boolean; acao: string; dados?: Record<string, string>; desabilitado?: boolean; descritoPor?: string }
  /** O `<select>`: a ação vai em `data-act-change` (o clique não dispara nada; só a troca). */
  | { tipo: "seletor"; acao: string; rotulo: string; opcoes: readonly OpcaoSeletor[]; dados?: Record<string, string> }
  /** O "…": `aberto` mostra os itens (HTML de botões) num `.cl-menu`. */
  | { tipo: "menu"; acao: string; aberto: boolean; rotulo: string; itens: string; dados?: Record<string, string> }
  /** A linha inteira vira um botão, com a seta. */
  | { tipo: "link"; acao: string; dados?: Record<string, string>; desabilitado?: boolean }
  /** A linha inteira abre e fecha o que vem embaixo dela (`id` estável: vira o `aria-controls`). */
  | { tipo: "recolhe"; id: string; acao: string; aberto: boolean; conteudo: string; dados?: Record<string, string> }
  /** Qualquer coisa à direita (atalhos, um botão de texto). */
  | { tipo: "html"; html: string };

export type LinhaConfig = {
  titulo: string;
  /** Texto simples (escapado). */
  detalhe?: string;
  /** HTML já escapado no lugar do detalhe (quando o detalhe precisa de marcação). */
  detalheHtml?: string;
  /** HTML do ícone (SVG ou mascote). */
  icone?: string;
  /** HTML focável antes do ícone (a alça de arrastar de Provedores, NOD-373): o `.lc-ic` é aria-hidden, então ela fica fora. */
  antes?: string;
  /** `vivo`: o status é lido quando muda (role="status"). */
  status?: { texto: string; tom: TomStatus; vivo?: boolean };
  /** A data numa coluna à direita (Feedback). */
  quando?: string;
  classe?: string;
  /** Excluir: o perigo fica no texto e no ícone, sem fundo. */
  perigo?: boolean;
  controle?: ControleLinha;
  /** Atributos extras na linha (ex.: `id`), já montados. */
  attrs?: string;
};

const dadosAttr = (dados: Record<string, string> | undefined): string =>
  dados ? Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("") : "";

export function statusLinha(s: { texto: string; tom: TomStatus; vivo?: boolean }): string {
  return `<span class="lc-status lc-tom-${s.tom}"${s.vivo ? ' role="status"' : ""}><i aria-hidden="true"></i>${esc(s.texto)}</span>`;
}

export function switchLinha(c: Extract<ControleLinha, { tipo: "switch" }>, rotulo: string): string {
  return `<button type="button" class="lc-switch" role="switch" aria-checked="${c.ligado}" aria-label="${esc(rotulo)}" data-act="${esc(c.acao)}"${dadosAttr(c.dados)}${c.descritoPor ? ` aria-describedby="${esc(c.descritoPor)}"` : ""}${c.desabilitado ? " disabled" : ""}><span></span></button>`;
}

export function seletorLinha(c: Extract<ControleLinha, { tipo: "seletor" }>): string {
  const opcoes = c.opcoes.map((o) => `<option value="${esc(o.valor)}"${o.selecionado ? " selected" : ""}${o.desabilitado ? " disabled" : ""}>${esc(o.rotulo)}</option>`).join("");
  return `<select class="lc-seletor" aria-label="${esc(c.rotulo)}" data-act-change="${esc(c.acao)}"${dadosAttr(c.dados)}>${opcoes}</select>`;
}

export function menuLinha(c: Extract<ControleLinha, { tipo: "menu" }>): string {
  const menu = c.aberto ? `<div class="cl-menu" role="menu" aria-label="${esc(c.rotulo)}">${c.itens}</div>` : "";
  return `<div class="cl-mais"><button type="button" class="cl-mais-bt" data-act="${esc(c.acao)}"${dadosAttr(c.dados)} aria-haspopup="menu" aria-expanded="${c.aberto}" aria-label="Mais ações de ${esc(c.rotulo)}">${ICONE.pontos}</button>${menu}</div>`;
}

/** Um item do "…" (o mesmo `.cl-menu` de Provedores e Máquinas). */
export function itemMenu(acao: string, icone: string, rotulo: string, extra: { nota?: string; dados?: Record<string, string>; perigo?: boolean; papel?: "menuitem" | "menuitemradio"; marcado?: boolean } = {}): string {
  const papel = extra.papel ?? "menuitem";
  const marcado = papel === "menuitemradio" ? ` aria-checked="${extra.marcado ?? false}"` : "";
  return `<button type="button" role="${papel}"${marcado}${extra.perigo ? ' class="perigo"' : ""} data-act="${esc(acao)}"${dadosAttr(extra.dados)}>${icone}<span>${esc(rotulo)}${extra.nota ? `<small>${esc(extra.nota)}</small>` : ""}</span></button>`;
}

/**
 * NOD-367 (a11y do "…", APG menu): setas, Home e End movem o foco entre os itens do `.cl-menu`, em volta. Devolve o
 * índice do próximo item, ou null quando a tecla não é de navegação. Os itens `aria-disabled` (a leitura da máquina)
 * entram na volta: é assim que o leitor de tela chega neles.
 */
export function proximoItemDoMenu(qtd: number, atual: number, tecla: string): number | null {
  if (qtd === 0) return null;
  if (tecla === "Home") return 0;
  if (tecla === "End") return qtd - 1;
  if (tecla !== "ArrowDown" && tecla !== "ArrowUp") return null;
  if (atual < 0) return tecla === "ArrowDown" ? 0 : qtd - 1;
  return (atual + (tecla === "ArrowDown" ? 1 : -1) + qtd) % qtd;
}

/** Um texto dentro do "…" (a leitura, uma nota): item desabilitado, focável pelas setas e lido pelo leitor de tela. */
export function textoNoMenu(html: string, chave: string, classe = "cfg-leitura"): string {
  // `data-menu-texto`: a chave estável do item, para o foco voltar a ele quando a leitura muda e o "…" é redesenhado
  // aberto (revisão 4: um div sem data-* deixava o foco cair no <body> a cada releitura de 30 s).
  return `<div class="${esc(classe)}" role="menuitem" aria-disabled="true" tabindex="-1" data-menu-texto="${esc(chave)}">${html}</div>`;
}

/** Normaliza para busca: sem acento e sem caixa ("Téo" acha "teo"). */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}

function miolo(l: LinhaConfig): string {
  const detalhe = l.detalheHtml ?? (l.detalhe ? esc(l.detalhe) : "");
  return `${l.antes ?? ""}${l.icone ? `<span class="lc-ic" aria-hidden="true">${l.icone}</span>` : ""}<span class="lc-txt"><b>${esc(l.titulo)}</b>${detalhe ? `<small>${detalhe}</small>` : ""}</span>${l.status ? statusLinha(l.status) : ""}${l.quando ? `<span class="lc-quando">${esc(l.quando)}</span>` : ""}`;
}

const SETA = `<span class="lc-seta" aria-hidden="true">${ICONE.seta}</span>`;

export function linhaConfig(l: LinhaConfig): string {
  const c = l.controle;
  const classes = ["lc-linha", l.classe ?? "", l.perigo ? "lc-perigo" : ""].filter(Boolean).join(" ");
  const attrs = l.attrs ? ` ${l.attrs}` : "";
  if (c?.tipo === "link") {
    return `<button type="button" class="${classes} lc-link" data-act="${esc(c.acao)}"${dadosAttr(c.dados)}${c.desabilitado ? " disabled" : ""}${attrs}>${miolo(l)}${SETA}</button>`;
  }
  if (c?.tipo === "recolhe") {
    const sub = `lc-sub-${c.id}`;
    return `<div class="lc-bloco"><button type="button" class="${classes} lc-link lc-recolhe" data-act="${esc(c.acao)}" data-recolhe="${esc(c.id)}"${dadosAttr(c.dados)} aria-expanded="${c.aberto}" aria-controls="${esc(sub)}"${attrs}>${miolo(l)}<span class="lc-seta${c.aberto ? " aberta" : ""}" aria-hidden="true">${ICONE.seta}</span></button><div class="lc-sub" id="${esc(sub)}"${c.aberto ? "" : " hidden"}>${c.aberto ? c.conteudo : ""}</div></div>`;
  }
  const ctrl = !c ? ""
    : c.tipo === "switch" ? switchLinha(c, l.titulo)
      : c.tipo === "seletor" ? seletorLinha(c)
        : c.tipo === "menu" ? menuLinha(c)
          : c.html;
  return `<div class="${classes}"${attrs}>${miolo(l)}${ctrl ? `<span class="lc-ctrl">${ctrl}</span>` : ""}</div>`;
}

/** Um grupo de linhas com título (opcional), contagem e nota embaixo. `linhas` já em HTML. */
export function grupoConfig(titulo: string | null, linhas: readonly string[], extra: { contagem?: number; nota?: string; notaHtml?: string; id?: string; classe?: string; aninhada?: boolean; listaAttrs?: string } = {}): string {
  const tit = titulo ? `<h3 class="lc-grupo-tit"${extra.id ? ` id="${esc(extra.id)}" tabindex="-1"` : ""}>${esc(titulo)}${extra.contagem !== undefined ? `<span>${extra.contagem}</span>` : ""}</h3>` : "";
  const nota = extra.notaHtml ?? (extra.nota ? esc(extra.nota) : "");
  const lista = linhas.length ? `<div class="lc-lista${extra.aninhada ? " lc-aninhada" : ""}"${extra.listaAttrs ? ` ${extra.listaAttrs}` : ""}>${linhas.join("")}</div>` : "";
  return `<section class="lc-grupo${extra.classe ? ` ${extra.classe}` : ""}">${tit}${lista}${nota ? `<p class="lc-nota">${nota}</p>` : ""}</section>`;
}

/** A lista aninhada de dentro de uma linha recolhida (Avançado, Chaves revogadas, Ocultos). */
export function listaAninhada(linhas: readonly string[]): string {
  return `<div class="lc-lista lc-aninhada">${linhas.join("")}</div>`;
}
