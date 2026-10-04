import { describe, expect, it } from "vitest";
import { soLinks, tabelaComo, textoFormatado } from "../../../web/lib/texto-formatado.ts";

describe("texto do modelo na conversa", () => {
  it("mostra ênfase e quebras sem transformar HTML ou URLs em elementos ativos", () => {
    expect(textoFormatado('**Dica:** use *clareza*\n<script>alert(1)</script> [abrir](javascript:alert(1))')).toBe('<strong>Dica:</strong> use <em>clareza</em><br>&lt;script&gt;alert(1)&lt;/script&gt; [abrir](javascript:alert(1))');
  });
  it("preserva código e escapa conteúdo em blocos e trechos inline", () => {
    expect(textoFormatado('```html\n<img onerror="alert(1)">\n```\n`**literal**`')).toBe('<pre><code>&lt;img onerror=&quot;alert(1)&quot;&gt;\n</code></pre><br><code>**literal**</code>');
  });
});

/** ADR-053, conforme o canvas "Links nas mensagens". */
describe("links no texto do bot", () => {
  it("URL solta vira o chip, que abre fora e sem contar de onde veio", () => {
    const html = textoFormatado("Os planos estão em https://zoom.us/pricing.");
    expect(html).toContain('<a class="lk-chip" href="https://zoom.us/pricing" data-lk target="_blank" rel="noopener noreferrer nofollow">');
    expect(html).toContain('<span class="lk-rotulo">zoom.us/pricing</span></a>.');
  });

  it("parêntese e ponto final ficam fora do link", () => {
    expect(textoFormatado("(veja https://zoom.us/pricing).")).toMatch(/^\(veja <a [^>]+href="https:\/\/zoom\.us\/pricing"[^>]*>.*<\/a>\)\.$/);
  });

  it("[nome](link) fica na frase; dentro de negrito também", () => {
    expect(textoFormatado("Comece pelo [PR #481](https://github.com/acme-edtech/acme/pull/481).")).toContain('>PR #481</a>.');
    expect(textoFormatado("**veja https://zoom.us/pricing**")).toMatch(/^<strong>veja <a class="lk-chip"[^>]*>.*<\/a><\/strong>$/);
  });

  it("URL dentro de código continua código", () => {
    expect(textoFormatado("rode `curl https://zoom.us/pricing`")).toBe("rode <code>curl https://zoom.us/pricing</code>");
  });

  it("endereço entre < > vira chip sem os sinais", () => {
    expect(textoFormatado("<https://zoom.us/pricing>")).toMatch(/^<a class="lk-chip"[^>]*>.*<\/a>$/);
  });
});

/** ADR-053, conforme o canvas "Tabelas nas mensagens". */
describe("tabelas no texto do bot", () => {
  const tabela = [
    "**Mais recentes**",
    "| PR | Título | Data |",
    "|---|---|---|",
    "| #481 | fix(coletas): barra contrato vencido | 28/09 |",
    "| #480 | Tarefa: criar uma página de dados… | 28/09 |",
    "",
    "**Antigos**",
  ].join("\n");

  it("cabeçalho e linha |---| viram tabela; o texto em volta segue como antes", () => {
    const html = textoFormatado(tabela);
    expect(html.startsWith("<strong>Mais recentes</strong>")).toBe(true);
    expect(html).toContain('<div class="md-tabela"><div class="md-tabela-rolagem"><table><thead><tr><th class="curta">PR</th><th class="curta">Título</th><th class="curta">Data</th></tr></thead>');
    expect(html).toContain('<tr><td class="curta">#481</td><td>fix(coletas): barra contrato vencido</td><td class="curta">28/09</td></tr>');
    expect(html).not.toContain("|---|");
    expect(html.endsWith("<br><strong>Antigos</strong>")).toBe(true);
  });

  it("os dois-pontos alinham a coluna", () => {
    const html = textoFormatado("| Pacote | De | Para |\n|---|--:|:-:|\n| vitest | 2 | 4 |");
    expect(html).toContain('<td class="al-direita curta">2</td><td class="al-centro curta">4</td>');
  });

  it("negrito, código e link funcionam na célula; HTML não", () => {
    const html = textoFormatado("| PR | Por quê | Link |\n|---|---|---|\n| **#417** | IDOR em `tenants` <b>x</b> | [abrir](https://github.com/acme-edtech/acme/pull/417) |");
    expect(html).toContain("<td class=\"curta\"><strong>#417</strong></td>");
    expect(html).toContain("<code>tenants</code> &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('href="https://github.com/acme-edtech/acme/pull/417"');
  });

  it("linha torta não quebra a tabela; \\| é barra dentro da célula", () => {
    const html = textoFormatado("| PR | Título | Data |\n|---|---|---|\n| #480 | a \\| b |");
    expect(html).toContain('<td class="curta">#480</td><td class="curta">a | b</td><td class="curta"></td>');
  });

  it("sem a linha |---| não é tabela", () => {
    expect(textoFormatado("| PR | Título |\n| #481 | fix |")).toBe("| PR | Título |<br>| #481 | fix |");
  });

  it("tabela dentro de bloco de código continua código", () => {
    expect(textoFormatado("```\n| a | b |\n|---|---|\n```")).toBe("<pre><code>| a | b |\n|---|---|\n</code></pre>");
  });

  it("mais de 10 linhas: 8 à vista e \"mostrar mais\", que sobrevive ao re-render pela chave", () => {
    const linhas = Array.from({ length: 12 }, (_, i) => `| #${400 + i} | x |`);
    const html = textoFormatado(["| PR | Grupo |", "|---|---|", ...linhas].join("\n"), { chave: "m1" });
    expect(html.match(/<tr class="md-extra">/g)).toHaveLength(4);
    expect(html).toContain('<details class="md-tabela-mais" data-disclosure="tabela:m1:0"><summary><span class="md-mais">Mostrar as outras 4 linhas</span>');
    const dez = textoFormatado(["| PR | Grupo |", "|---|---|", ...linhas.slice(0, 10)].join("\n"));
    expect(dez).not.toContain("md-tabela-mais");
  });

  const dadosDaTabela = (html: string): string[][] => JSON.parse(html.match(/data-tabela="([^"]*)"/)![1]!.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")) as string[][];

  it("Copiar como Planilha leva colunas separadas por tabulação, com o que a pessoa lê", () => {
    const html = textoFormatado("| PR | Link |\n|---|---|\n| **#417** | [abrir](https://github.com/x/y/pull/417) |\n| `#418` | https://zoom.us/pricing |");
    expect(tabelaComo("tsv", dadosDaTabela(html))).toBe("PR\tLink\n#417\tabrir\n#418\thttps://zoom.us/pricing");
  });

  it("rodapé da tabela: quantas linhas e colunas e Copiar como Planilha · CSV · JSON (2026-10-03)", () => {
    const html = textoFormatado("| Região | Receita |\n|---|--:|\n| Sul | R$ 98 mil |\n| Norte, Nordeste | R$ \"132\" mil |");
    expect(html).toContain('<div class="md-tabela-rodape"><span>2 linhas · 2 colunas</span>');
    expect(html.match(/data-act="copiar-tabela"/g)).toHaveLength(3);
    expect(html).toContain('data-formato="csv"');
    expect(html).not.toContain("md-tabela-copiar");
    const dados = dadosDaTabela(html);
    expect(tabelaComo("csv", dados)).toBe('Região,Receita\nSul,R$ 98 mil\n"Norte, Nordeste","R$ ""132"" mil"');
    expect(JSON.parse(tabelaComo("json", dados))).toEqual([{ Região: "Sul", Receita: "R$ 98 mil" }, { Região: "Norte, Nordeste", Receita: 'R$ "132" mil' }]);
  });
});

describe("listas e títulos no texto do bot (2026-10-03)", () => {
  it("'-' e '1.' viram lista; '##' vira título; o texto em volta vira parágrafo sem <br> sobrando", () => {
    const html = textoFormatado("## Resumo\nFechei setembro:\n\n- receita **R$ 482 mil**\n- 12% acima de agosto\n\n1. Sul\n2. Norte\n\nPosso mandar?");
    expect(html).toBe('<p class="md-titulo">Resumo</p><p class="md-paragrafo">Fechei setembro:</p><ul class="md-lista"><li>receita <strong>R$ 482 mil</strong></li><li>12% acima de agosto</li></ul><ol class="md-lista"><li>Sul</li><li>Norte</li></ol><p class="md-paragrafo">Posso mandar?</p>');
  });

  it("lista numerada guarda o número de início; linha recuada continua o item", () => {
    expect(textoFormatado("3. terceiro\n   continua\n4. quarto")).toBe('<ol class="md-lista" start="3"><li>terceiro continua</li><li>quarto</li></ol>');
  });

  it("sem lista nem título, o texto sai exatamente como antes", () => {
    expect(textoFormatado("um *dois*\n\ntrês")).toBe("um <em>dois</em><br><br>três");
  });

  it("*itálico* no começo da linha não vira lista; HTML continua texto dentro do item", () => {
    expect(textoFormatado("*ênfase* aqui")).toBe("<em>ênfase</em> aqui");
    expect(textoFormatado("- <b>x</b>")).toBe('<ul class="md-lista"><li>&lt;b&gt;x&lt;/b&gt;</li></ul>');
  });
});

describe("soLinks: a linha 'agora' do cartão de atividade (2026-10-03)", () => {
  it("o link vira chip e o resto continua texto escapado", () => {
    const html = soLinks("Lendo <os> arquivos de https://github.com/acme/loja/pull/481.");
    expect(html.startsWith("Lendo &lt;os&gt; arquivos de ")).toBe(true);
    expect(html).toContain('href="https://github.com/acme/loja/pull/481"');
    expect(html.endsWith(".")).toBe(true);
  });
});
