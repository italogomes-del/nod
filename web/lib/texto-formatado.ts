import { esc } from "./escape.ts";
import { aparaUrl, chipDoLink, lerLink, linkComNome } from "./links.ts";

/**
 * definido em 2026-09-17: ênfase e código; HTML do modelo continua texto.
 * definido em 2026-09-28 (ADR-053): links http(s) e tabelas também. O link mostra o destino (chip do app
 * ou domínio, e o endereço inteiro na dica); a célula da tabela é o mesmo texto escapado, nunca HTML.
 */
export interface OpcoesTexto {
  /** Identifica a mensagem: o "mostrar mais" de cada tabela sobrevive a um novo render (data-disclosure). */
  chave?: string;
  agora?: Date;
}

const LINHAS_VISIVEIS = 8;
/** Com até 10 linhas a tabela vem inteira: esconder 1 ou 2 linhas atrás de um botão só atrapalha. */
const LINHAS_SEM_MOSTRAR_MAIS = 10;

export function textoFormatado(texto: string, opcoes: OpcoesTexto = {}): string {
  let tabelas = 0;
  return texto.split(/(```[\s\S]*?```)/g).map((trecho, i) => {
    if (i % 2 === 1) return `<pre><code>${esc(trecho.slice(3, -3).replace(/^\w*\n/, ""))}</code></pre>`;
    return blocos(trecho).map((b) => (typeof b === "string" ? emLinha(b, opcoes) : tabelaHtml(b, opcoes, tabelas++))).join("");
  }).join("");
}

// ---------------------------------------------------------------- em linha

const EM_LINHA = new RegExp([
  "`[^`\\n]+`",
  "<https?:\\/\\/[^\\s<>]+>",
  "\\[[^\\]\\n]+\\]\\((?:[^()\\s]|\\([^()\\s]*\\))+\\)",
  "https?:\\/\\/[^\\s<>\"'`]+",
  "\\*\\*[^*\\n]+\\*\\*",
  "\\*[^*\\n]+\\*",
].map((p) => `(?:${p})`).join("|"), "g");

function emLinha(texto: string, opcoes: OpcoesTexto, dentroDeEnfase = false): string {
  let saida = "";
  let desde = 0;
  for (const achado of texto.matchAll(EM_LINHA)) {
    let trecho = achado[0];
    let resto = "";
    // O endereço solto não leva a pontuação da frase: "(veja https://x.com)." fecha fora do link.
    if (/^https?:\/\//.test(trecho)) {
      const aparada = aparaUrl(trecho);
      resto = trecho.slice(aparada.length);
      trecho = aparada;
    }
    saida += quebras(texto.slice(desde, achado.index)) + token(trecho, opcoes, dentroDeEnfase) + quebras(resto);
    desde = achado.index + achado[0].length;
  }
  return saida + quebras(texto.slice(desde));
}

function quebras(texto: string): string {
  return esc(texto).replaceAll("\n", "<br>");
}

function token(t: string, opcoes: OpcoesTexto, dentroDeEnfase: boolean): string {
  if (t.startsWith("`")) return `<code>${esc(t.slice(1, -1))}</code>`;
  if (t.startsWith("<")) {
    const url = lerLink(t.slice(1, -1));
    return url ? chipDoLink(url, opcoes.agora) : quebras(t);
  }
  if (t.startsWith("[")) {
    const meio = t.indexOf("](");
    const url = lerLink(t.slice(meio + 2, -1));
    // Só http(s) vira link; o resto ([abrir](javascript:…), file:, mailto:) fica como o bot escreveu.
    return url ? linkComNome(t.slice(1, meio), url, opcoes.agora) : quebras(t);
  }
  if (/^https?:\/\//.test(t)) {
    const url = lerLink(t);
    return url ? chipDoLink(url, opcoes.agora) : quebras(t);
  }
  // Dentro de negrito e itálico, link e código continuam funcionando; ênfase dentro de ênfase, não.
  if (dentroDeEnfase) return quebras(t);
  if (t.startsWith("**")) return `<strong>${emLinha(t.slice(2, -2), opcoes, true)}</strong>`;
  return `<em>${emLinha(t.slice(1, -1), opcoes, true)}</em>`;
}

// ---------------------------------------------------------------- tabelas

type Alinhamento = "" | "direita" | "centro";
export interface Tabela {
  cabecalho: string[];
  alinhamentos: Alinhamento[];
  linhas: string[][];
}

const SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Como no GitHub: cabeçalho com |, logo abaixo a linha |---| com o mesmo número de colunas. */
function blocos(texto: string): (string | Tabela)[] {
  const linhas = texto.split("\n");
  const saida: (string | Tabela)[] = [];
  let desde = 0;
  for (let i = 0; i < linhas.length - 1; i++) {
    const cabecalho = linhas[i]!;
    const separador = linhas[i + 1]!;
    if (!cabecalho.includes("|") || !separador.includes("|") || !SEPARADOR.test(separador)) continue;
    const colunas = celulas(cabecalho);
    const marcas = celulas(separador);
    if (colunas.length !== marcas.length) continue;
    let fim = i + 2;
    const corpo: string[][] = [];
    for (; fim < linhas.length && linhas[fim]!.includes("|") && linhas[fim]!.trim() !== ""; fim++) {
      // Linha torta não quebra a tabela: o que falta fica vazio, o que sobra sai.
      const c = celulas(linhas[fim]!);
      corpo.push(colunas.map((_, k) => c[k] ?? ""));
    }
    if (i > desde) saida.push(linhas.slice(desde, i).join("\n"));
    saida.push({ cabecalho: colunas, alinhamentos: marcas.map(alinhamento), linhas: corpo });
    desde = fim;
    i = fim - 1;
  }
  if (desde < linhas.length) saida.push(linhas.slice(desde).join("\n"));
  return saida;
}

function celulas(linha: string): string[] {
  let l = linha.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map((c) => c.replaceAll("\\|", "|").trim());
}

function alinhamento(marca: string): Alinhamento {
  const esquerda = marca.startsWith(":");
  const direita = marca.endsWith(":");
  return esquerda && direita ? "centro" : direita ? "direita" : "";
}

/** Célula curta (data, número, #PR) não quebra linha; texto longo quebra. */
const CELULA_CURTA = 20;

function celulaHtml(tag: "th" | "td", texto: string, al: Alinhamento, opcoes: OpcoesTexto): string {
  const classes = [al ? `al-${al}` : "", texto.length <= CELULA_CURTA ? "curta" : ""].filter(Boolean).join(" ");
  return `<${tag}${classes ? ` class="${classes}"` : ""}>${emLinha(texto, opcoes)}</${tag}>`;
}

const ICONE_COPIAR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>';

function tabelaHtml(t: Tabela, opcoes: OpcoesTexto, indice: number): string {
  const recolhe = t.linhas.length > LINHAS_SEM_MOSTRAR_MAIS;
  const cabeca = `<tr>${t.cabecalho.map((c, k) => celulaHtml("th", c, t.alinhamentos[k] ?? "", opcoes)).join("")}</tr>`;
  const corpo = t.linhas.map((linha, n) => `<tr${recolhe && n >= LINHAS_VISIVEIS ? ' class="md-extra"' : ""}>${linha.map((c, k) => celulaHtml("td", c, t.alinhamentos[k] ?? "", opcoes)).join("")}</tr>`).join("");
  const escondidas = t.linhas.length - LINHAS_VISIVEIS;
  const disclosure = opcoes.chave ? ` data-disclosure="${esc(`tabela:${opcoes.chave}:${indice}`)}"` : "";
  const mais = recolhe ? `<details class="md-tabela-mais"${disclosure}><summary><span class="md-mais">Mostrar as outras ${escondidas} linhas</span><span class="md-menos">Mostrar menos</span></summary></details>` : "";
  return `<div class="md-tabela"><div class="md-tabela-rolagem"><table><thead>${cabeca}</thead><tbody>${corpo}</tbody></table></div>${mais}<button type="button" class="md-tabela-copiar" data-act="copiar-tabela" data-tsv="${esc(tabelaParaTsv(t))}" aria-label="Copiar tabela">${ICONE_COPIAR}<span>Copiar</span></button></div>`;
}

/**
 * O texto que "Copiar" põe na área de transferência: colunas separadas por tabulação, como uma planilha
 * espera, com o que a pessoa lê na célula (o nome do link, o código sem crases, sem os asteriscos).
 */
export function tabelaParaTsv(t: Tabela): string {
  return [t.cabecalho, ...t.linhas].map((linha) => linha.map(textoSimples).join("\t")).join("\n");
}

function textoSimples(celula: string): string {
  return celula
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/<(https?:\/\/[^\s<>]+)>/g, "$1")
    .replace(/\[([^\]\n]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
