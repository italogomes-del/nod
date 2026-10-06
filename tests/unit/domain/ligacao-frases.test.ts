import { describe, expect, it } from "vitest";
import { ehSoOk, semOkDeFecho } from "../../../src/domain/ligacao-frases.ts";

describe('o "ok" que fecha a volta depois de uma ferramenta', () => {
  it("ehSoOk: só o ok sozinho, com ou sem ponto", () => {
    for (const t of ["ok", "Ok.", " OK ", "ok!", "Ok ."]) expect(ehSoOk(t), t).toBe(true);
    for (const t of ["", "ok, anotado", "Tudo ok", "okay", "Ok. E agora?"]) expect(ehSoOk(t), t).toBe(false);
  });

  it("semOkDeFecho tira só o ok do fim da resposta", () => {
    expect(semOkDeFecho("Prazer, Marlon! Como você conheceu o nod? ok")).toBe("Prazer, Marlon! Como você conheceu o nod?");
    expect(semOkDeFecho("Perfeito. Agora vou te mostrar o nod. Ok.")).toBe("Perfeito. Agora vou te mostrar o nod.");
    expect(semOkDeFecho("ok")).toBe("");
    expect(semOkDeFecho("Como você conheceu o nod?")).toBe("Como você conheceu o nod?");
    expect(semOkDeFecho("Ok, vamos lá. Qual o seu nome?")).toBe("Ok, vamos lá. Qual o seu nome?");
  });
});
import { criarSegmentador, FRASE_CHAT, FRASE_RESTO_CHAT, removerAberturaRepetida, textoFalavel } from "../../../src/domain/ligacao-frases.ts";

const falavel = (md: string) => textoFalavel(md).falavel;

describe("textoFalavel: markdown vira fala", () => {
  it("tira negrito, itálico, tachado e código curto sem mexer em snake_case nem em conta", () => {
    expect(falavel("Isso é **muito** importante e _bem_ *simples*, ~~ontem~~ hoje.")).toBe("Isso é muito importante e bem simples, ontem hoje.");
    expect(falavel("O campo `pessoa_id` fica em snake_case e 2 * 3 dá 6.")).toBe("O campo pessoa_id fica em snake_case e 2 * 3 dá 6.");
  });

  it("título e item de lista viram frases", () => {
    expect(falavel("## Resumo\n- primeiro item\n- segundo item\n1. terceiro\n2) quarto")).toBe("Resumo. Primeiro item. Segundo item. Terceiro. Quarto.");
    expect(falavel("- [x] feito\n- [ ] falta")).toBe("Feito. Falta.");
  });

  it("parágrafos ganham ponto; quebra simples junta; citação e régua somem", () => {
    expect(falavel("Oi\n\nTudo certo por aqui\ne por aí")).toBe("Oi. Tudo certo por aqui e por aí.");
    expect(falavel("> citação\n\n---\n\nfim")).toBe("Citação. Fim.");
  });

  it("link vira só o texto", () => {
    const r = textoFalavel("Abri o [PR #481](https://github.com/acme/nod/pull/481) agora.");
    expect(r.falavel).toBe("Abri o PR #481 agora.");
    expect(r.foiProChat).toBe(false);
  });

  it("bloco de código vira \"te mandei no chat\" uma vez", () => {
    const r = textoFalavel("Rode isto:\n```bash\nnpm run check\n```\nE depois isto:\n```\nnpm start\n```");
    expect(r.falavel).toBe(`Rode isto: ${FRASE_CHAT} E depois isto:`);
    expect(r.foiProChat).toBe(true);
  });

  it("bloco sem fechar e crases triplas na mesma linha também vão pro chat", () => {
    expect(falavel("Veja:\n```ts\nconst a = 1;")).toBe(`Veja: ${FRASE_CHAT}`);
    expect(falavel("Use ```npm ci``` antes.\n\nDepois roda.")).toContain(FRASE_CHAT);
  });

  it("tabela vira \"te mandei no chat\"", () => {
    const r = textoFalavel("Os números:\n\n| mês | total |\n|---|---|\n| jan | 10 |\n| fev | 12 |\n\nFevereiro foi melhor.");
    expect(r.falavel).toBe(`Os números: ${FRASE_CHAT} Fevereiro foi melhor.`);
    expect(r.foiProChat).toBe(true);
  });

  it("URL solta sozinha vira a frase do chat; no meio da frase vira \"o link\" e a frase do chat vem depois", () => {
    expect(falavel("https://x.com/a.b")).toBe(FRASE_CHAT);
    expect(falavel("Veja em https://x.com/a.b. Depois me fala.")).toBe(`Veja em o link. ${FRASE_CHAT} Depois me fala.`);
    expect(falavel("O site é www.nod.dev, abre lá.")).toBe(`O site é o link, abre lá. ${FRASE_CHAT}`);
  });

  it("código longo em linha vai pro chat como \"o código\"", () => {
    expect(falavel("Troque por `if (a) { b(); }` e pronto.")).toBe(`Troque por o código e pronto. ${FRASE_CHAT}`);
    expect(falavel("Abra o `index.ts`.")).toBe("Abra o index.ts.");
  });

  it("jaMandouProChat não repete a frase do chat", () => {
    expect(textoFalavel("```\nx\n```", { jaMandouProChat: true }).falavel).toBe("");
    expect(textoFalavel("Veja https://a.com/x agora.", { jaMandouProChat: true }).falavel).toBe("Veja o link agora.");
  });
});

describe("textoFalavel: normalizações de fala", () => {
  it("dinheiro", () => {
    expect(falavel("Custa R$ 10.")).toBe("Custa 10 reais.");
    expect(falavel("Total: R$ 1.000,50")).toBe("Total: 1.000 reais e 50 centavos.");
    expect(falavel("R$ 1,00 e R$1")).toBe("1 real e 1 real.");
    expect(falavel("Só R$ 0,50.")).toBe("Só 50 centavos.");
    expect(falavel("R$ 2,01")).toBe("2 reais e 1 centavo.");
    expect(falavel("R$ 3,5")).toBe("3 reais e 50 centavos.");
  });

  it("porcentagem, número e horário", () => {
    expect(falavel("Subiu 15% hoje.")).toBe("Subiu 15 por cento hoje.");
    expect(falavel("Pedido nº 42 e Nº 7.")).toBe("Pedido número 42 e número 7.");
    expect(falavel("A reunião é às 14h30.")).toBe("A reunião é às 14 e 30.");
    expect(falavel("Começa às 9h e vai até 18h05.")).toBe("Começa às 9 horas e vai até 18 e 5.");
    expect(falavel("Às 14h00 em ponto.")).toBe("Às 14 horas em ponto.");
  });

  it("não estraga versão, arquivo nem decimal", () => {
    expect(falavel("Saiu a v1.2.3 no index.ts com 3,5 de nota.")).toBe("Saiu a v1.2.3 no index.ts com 3,5 de nota.");
  });

  it("tira emoji", () => {
    expect(falavel("Feito! 🎉")).toBe("Feito!");
  });
});

describe("textoFalavel: teto de 60 palavras", () => {
  const frase = (n: number) => `${Array.from({ length: n - 1 }, (_, i) => `palavra${i}`).join(" ")} fim.`;

  it("até 60 palavras fala tudo", () => {
    const r = textoFalavel([frase(20), frase(20), frase(20)].join(" "));
    expect(r.cortou).toBe(false);
    expect(r.foiProChat).toBe(false);
    expect(r.palavras).toBe(60);
  });

  it("passou do teto: corta no fim de frase e manda o resto pro chat", () => {
    const r = textoFalavel([frase(25), frase(25), frase(25)].join(" "));
    expect(r.cortou).toBe(true);
    expect(r.foiProChat).toBe(true);
    expect(r.falavel.endsWith(FRASE_RESTO_CHAT)).toBe(true);
    expect(r.falavel.replace(FRASE_RESTO_CHAT, "").trim().split(/\s+/).length).toBe(50);
  });

  it("uma frase só, gigante, corta na última vírgula que cabe", () => {
    const longa = `${Array.from({ length: 40 }, (_, i) => `a${i}`).join(" ")}, ${Array.from({ length: 40 }, (_, i) => `b${i}`).join(" ")}.`;
    const r = textoFalavel(longa);
    expect(r.falavel).toBe(`A0 ${Array.from({ length: 39 }, (_, i) => `a${i + 1}`).join(" ")}. ${FRASE_RESTO_CHAT}`);
  });

  it("o teto vale na resposta inteira (palavrasJaFaladas)", () => {
    const r = textoFalavel(frase(20), { palavrasJaFaladas: 50 });
    expect(r.cortou).toBe(true);
    expect(r.falavel).toBe(FRASE_RESTO_CHAT);
    const cabe = textoFalavel(frase(10), { palavrasJaFaladas: 50 });
    expect(cabe.cortou).toBe(false);
  });
});

/** Alimenta o segmentador caractere a caractere (o pior caso do streaming) e fecha. */
function segmentar(texto: string, passo = 1): string[] {
  const s = criarSegmentador();
  const r: string[] = [];
  for (let i = 0; i < texto.length; i += passo) r.push(...s.adicionar(texto.slice(i, i + passo), i));
  r.push(...s.fechar());
  return r;
}

describe("criarSegmentador", () => {
  it("primeiro trecho curto: a primeira vírgula depois de 4 palavras", () => {
    expect(segmentar("Olha, eu vi a sua agenda, e amanhã você tem duas reuniões.")).toEqual(["Olha, eu vi a sua agenda,", "e amanhã você tem duas reuniões."]);
  });

  it("primeiro trecho curto: fim de frase, mesmo de uma palavra", () => {
    expect(segmentar("Feito. A rotina já está ativa.")).toEqual(["Feito.", "A rotina já está ativa."]);
  });

  it("depois do primeiro, frases inteiras (vírgula não corta frase curta)", () => {
    expect(segmentar("Oi. Vou ver a agenda, os e-mails e o calendário. Já te falo!")).toEqual(["Oi.", "Vou ver a agenda, os e-mails e o calendário.", "Já te falo!"]);
  });

  it("frase de mais de 25 palavras corta na vírgula", () => {
    const longa = "Oi. Hoje você tem a reunião de planejamento com o time de produto às dez horas da manhã na sala grande, depois o almoço com a Ana e no fim da tarde a revisão do PR.";
    const r = segmentar(longa);
    expect(r[0]).toBe("Oi.");
    expect(r[1]).toBe("Hoje você tem a reunião de planejamento com o time de produto às dez horas da manhã na sala grande,");
    expect(r[2]).toBe("depois o almoço com a Ana e no fim da tarde a revisão do PR.");
  });

  it("nunca corta em abreviação, número, versão, arquivo ou URL", () => {
    const texto = "Falei com o Sr. Silva e a Dra. Ana sobre o pedido nº. 12, etc. e tal. O valor é 1.000,50 com 3,5 de taxa às 14h30. Saiu a v1.2.3 no index.ts, veja https://x.com/a.b?c=1,2 agora. Fim.";
    const r = segmentar(texto);
    expect(r).toEqual([
      "Falei com o Sr. Silva e a Dra. Ana sobre o pedido nº. 12,",
      "etc. e tal.",
      "O valor é 1.000,50 com 3,5 de taxa às 14h30.",
      "Saiu a v1.2.3 no index.ts, veja https://x.com/a.b?c=1,2 agora.",
      "Fim.",
    ]);
  });

  it("p.ex., iniciais e siglas com ponto não fecham frase", () => {
    expect(segmentar("Use um app, p.ex. o Gmail. Fala com J. R. Tolkien da S.A. amanhã. Ok.")).toEqual(["Use um app, p.ex. o Gmail.", "Fala com J. R. Tolkien da S.A. amanhã.", "Ok."]);
  });

  it("o resultado é o mesmo em pedaços de qualquer tamanho", () => {
    const texto = "Olha, eu vi a sua agenda, e amanhã tem reunião com o Dr. Paulo às 14h30. Custa R$ 1.000,50. Fim.";
    const umPorUm = segmentar(texto, 1);
    for (const passo of [2, 3, 7, 50, texto.length]) expect(segmentar(texto, passo)).toEqual(umPorUm);
  });

  it("lista: cada item é um trecho; marcador \"1.\" não fecha frase", () => {
    expect(segmentar("Três coisas:\n1. Agenda\n2. E-mails\n3. Rotinas")).toEqual(["Três coisas:", "1. Agenda", "2. E-mails", "3. Rotinas"]);
    expect(segmentar("Custa 1. Mas\n10. Item")).toEqual(["Custa 1.", "Mas", "10. Item"]);
  });

  it("bloco de código fica inteiro num trecho", () => {
    const r = segmentar("Roda isto. Depois:\n```\nnpm ci. npm test.\nnpm start\n```\nPronto.");
    expect(r).toContain("```\nnpm ci. npm test.\nnpm start\n```");
  });

  it("linhas de tabela ficam juntas", () => {
    const r = segmentar("Veja.\n| a | b |\n|---|---|\n| 1 | 2 |\nFim.");
    expect(r).toEqual(["Veja.", "| a | b |\n|---|---|\n| 1 | 2 |", "Fim."]);
  });

  it("vencer: 400 ms parado com 3 palavras solta o primeiro trecho, só com palavras inteiras", () => {
    const s = criarSegmentador();
    expect(s.adicionar("Vou procurar na sua agen", 0)).toEqual([]);
    expect(s.vencer(399)).toBeNull();
    expect(s.vencer(400)).toBe("Vou procurar na sua");
    expect(s.adicionar("da de hoje.", 500)).toEqual([]);
    expect(s.fechar()).toEqual(["agenda de hoje."]);
  });

  it("vencer: menos de 3 palavras espera; abreviação no fim não é deixada sozinha", () => {
    const s = criarSegmentador();
    s.adicionar("Vou ver", 0);
    expect(s.vencer(1000)).toBeNull();
    const t = criarSegmentador();
    t.adicionar("Falei com o Sr. ", 0);
    expect(t.vencer(1000)).toBe("Falei com o");
  });

  it("vencer: fim de frase parado (antes de uma ferramenta) sai em qualquer trecho", () => {
    const s = criarSegmentador();
    expect(s.adicionar("Tá. Vou ver sua agenda.", 0)).toEqual(["Tá."]);
    expect(s.vencer(100)).toBeNull();
    expect(s.vencer(400)).toBe("Vou ver sua agenda.");
    expect(s.fechar()).toEqual([]);
  });

  it("vencer: depois do primeiro trecho, texto sem fim de frase não sai por tempo", () => {
    const s = criarSegmentador();
    s.adicionar("Oi. Vou procurar na sua agenda de", 0);
    expect(s.vencer(5000)).toBeNull();
  });

  it("fechar devolve o resto e reinicia para a próxima resposta", () => {
    const s = criarSegmentador();
    expect(s.adicionar("Oi, tudo", 0)).toEqual([]);
    expect(s.fechar()).toEqual(["Oi, tudo"]);
    expect(s.fechar()).toEqual([]);
    expect(s.adicionar("Feito. Mais", 10)).toEqual(["Feito."]);
  });
});

describe("removerAberturaRepetida", () => {
  it("tira a abertura que repete um reconhecimento recém-tocado", () => {
    expect(removerAberturaRepetida("Certo, vou criar a rotina.", "reconhecimento.02")).toBe("Vou criar a rotina.");
    expect(removerAberturaRepetida("Beleza! A reunião é às três.", "reconhecimento")).toBe("A reunião é às três.");
    expect(removerAberturaRepetida("Tá bom, já anotei.", "Entendi.")).toBe("Já anotei.");
    expect(removerAberturaRepetida("Ok. Feito.", "Tá.")).toBe("Feito.");
    expect(removerAberturaRepetida("entendi, então amanhã.", "reconhecimento.01")).toBe("Então amanhã.");
  });

  it("não mexe sem reconhecimento antes, sem pontuação depois ou se só sobra a abertura", () => {
    expect(removerAberturaRepetida("Certo, vou criar.", null)).toBe("Certo, vou criar.");
    expect(removerAberturaRepetida("Certo, vou criar.", "pensando.01")).toBe("Certo, vou criar.");
    expect(removerAberturaRepetida("Entendi que você quer amanhã.", "reconhecimento.01")).toBe("Entendi que você quer amanhã.");
    expect(removerAberturaRepetida("Certo.", "reconhecimento.01")).toBe("Certo.");
    expect(removerAberturaRepetida("Tático, o plano.", "reconhecimento.01")).toBe("Tático, o plano.");
  });
});

describe("trecho cortado na vírgula (UAT de 2026-10-04)", () => {
  it("segue com a vírgula, sem ponto colado", () => {
    expect(textoFalavel("Então: você é Marlon,").falavel).toBe("Então: você é Marlon,");
  });
});

import { FRASE_RESTO_TELA, FRASE_TABELA, LEITURA, textoParaLeitura } from "../../../src/domain/ligacao-frases.ts";

const lido = (md: string) => textoParaLeitura(md).join(" ");

describe("textoParaLeitura (NOD-180: ouvir uma resposta pronta)", () => {
  it("texto simples sai igual, com ponto, sem nada mandado para o chat", () => {
    expect(textoParaLeitura("Tudo certo por aqui")).toEqual(["Tudo certo por aqui."]);
    expect(lido("Pronto. Já resolvi.")).not.toMatch(/chat/iu);
  });

  it("vazio ou só código vira [] ou só o aviso do bloco", () => {
    expect(textoParaLeitura("")).toEqual([]);
    expect(textoParaLeitura("   \n\n  ")).toEqual([]);
    expect(textoParaLeitura("**  **")).toEqual([]);
    expect(textoParaLeitura("```ts\nconst a = 1;\n```")).toEqual(["Aqui tem um bloco de código em TypeScript."]);
  });

  it("bloco de código: uma frase por bloco, com a linguagem conhecida", () => {
    const md = "Veja:\n\n```py\nprint(1)\n```\n\nE também:\n\n```\nx\n```\n\n~~~sql\nselect 1;\n~~~\n\n```brainfuck\n+++\n```";
    const t = lido(md);
    expect(t).toContain("Aqui tem um bloco de código em Python.");
    expect(t).toContain("Aqui tem um bloco de código em SQL.");
    expect(t.match(/Aqui tem um bloco de código\./gu)).toHaveLength(2);
    expect(t).not.toMatch(/print|select|\+\+\+/u);
  });

  it("bloco sem fecho não vaza o código", () => {
    expect(lido("Olha:\n```js\nconst segredo = 42;")).toBe("Olha: Aqui tem um bloco de código em JavaScript.");
  });

  it("tabela vira uma frase só, mesmo com várias linhas", () => {
    const md = "Resumo:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nFim.";
    const t = textoParaLeitura(md);
    expect(t.join(" ").match(new RegExp(FRASE_TABELA, "gu"))).toHaveLength(1);
    expect(t.join(" ")).not.toMatch(/\|/u);
  });

  it("link vira o rótulo; URL solta e <url> viram 'um link'", () => {
    expect(lido("Abri o [PR #157](https://github.com/marlonwlv/nod/pull/157).")).toBe("Abri o PR #157.");
    expect(lido("Veja https://exemplo.com/a?b=1 agora.")).toBe("Veja um link agora.");
    expect(lido("Veja <https://exemplo.com>.")).toBe("Veja um link.");
  });

  it("código em linha curto é lido; longo vira 'um trecho de código'", () => {
    expect(lido("Rode `npm run check`.")).toBe("Rode npm run check.");
    expect(lido("Use `if (a) { b(); }` no fim.")).toBe("Use um trecho de código no fim.");
  });

  it("caminho vira o nome do arquivo, sem pegar data nem e/ou", () => {
    expect(lido("Mexi em src/adapters/voz/spi.ts hoje.")).toBe("Mexi em spi.ts hoje.");
    expect(lido("Veja docs/adr/ e o resto.")).toBe("Veja adr e o resto.");
    expect(lido("Dia 06/10/2026, e/ou amanhã a 80 km/h.")).toContain("e/ou");
    expect(lido("Dia 06/10/2026.")).not.toBe("Dia 2026.");
  });

  it("não parte número, abreviação nem versão", () => {
    const t = textoParaLeitura("Custou R$ 1.000,50 ao Sr. Silva. A versão é v1.2.3 desde ontem. Fim.");
    const tudo = t.join(" ");
    expect(tudo).toContain("Sr. Silva");
    expect(tudo).toMatch(/1\.2\.3/u);
    expect(t.some((x) => x.endsWith("Sr."))).toBe(false);
  });

  // Regressão (QA NOD-180, 2026-10-06): com 2 barras, uma lista de palavras virava só a última ("sim/não/talvez" → "talvez").
  it("palavras separadas por barra, sem extensão nem raiz, ficam como estão", () => {
    expect(lido("Defina leitura/escrita/execução no arquivo.")).toContain("leitura/escrita/execução");
    expect(lido("Responda sim/não/talvez.")).toContain("sim/não/talvez");
    expect(lido("Abri ~/nod/Tarsila/qa-180 e /tmp/saida agora.")).toBe("Abri qa-180 e saida agora.");
  });

  // Regressão (QA NOD-180, 2026-10-06): a cerca de 4 crases fechava na de 3 de dentro e o código era lido em voz alta.
  it("bloco dentro de bloco (cerca de 4 crases) e bloco recuado em lista não vazam o código", () => {
    expect(lido("Exemplo:\n\n````md\n```ts\nconst segredo = 42;\n```\n````\n\nFim.")).toBe("Exemplo: Aqui tem um bloco de código em Markdown. Fim.");
    expect(lido("1. Rode:\n   ```bash\n   npm ci\n   ```\n2. Pronto.")).not.toMatch(/npm|ci\b/u);
    expect(lido("Use ```npm ci``` aqui.")).toBe("Use npm ci aqui.");
  });

  it("1º trecho tem até 25 palavras; os outros juntam frases até 400 caracteres", () => {
    const frase = "Esta é uma frase de exemplo com várias palavras para encher o trecho.";
    const md = Array.from({ length: 30 }, () => frase).join(" ");
    const t = textoParaLeitura(md);
    expect(t[0]?.split(/\s+/u).length).toBeLessThanOrEqual(LEITURA.primeiroPalavras);
    for (const x of t.slice(1)) expect(x.length).toBeLessThanOrEqual(LEITURA.trechoCaracteres);
    expect(t.join(" ").replace(/\s+/gu, " ")).toBe(md);
  });

  it("1º trecho longo corta na vírgula que cabe", () => {
    const md = "Olhei o PR inteiro com calma e atenção, conferi cada um dos testes e também os logs do CI que passaram sem nenhum problema de verdade.";
    const t = textoParaLeitura(md);
    expect(t[0]).toBe("Olhei o PR inteiro com calma e atenção,");
    expect(t.join(" ")).toBe(md);
  });

  it("frase gigante sem pontuação é partida em pedaços de até 1.000 caracteres", () => {
    const md = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");
    const t = textoParaLeitura(md);
    for (const x of t) expect(x.length).toBeLessThanOrEqual(LEITURA.tetoTrechoCaracteres);
    expect(t.length).toBeGreaterThan(2);
  });

  // Regressão (QA NOD-180, 2026-10-06): o 1º trecho só olhava palavras; um token longo sem espaço ia inteiro ao TTS (3.978 caracteres).
  it("1º trecho também respeita o tamanho de trecho, mesmo com palavra gigante", () => {
    for (const md of ["a".repeat(5000), `Hash: ${"ção".repeat(1500)}`, `${"x".repeat(900)} fim de frase.`]) {
      const t = textoParaLeitura(md);
      expect(t[0]?.length).toBeLessThanOrEqual(LEITURA.trechoCaracteres);
      for (const x of t) expect(x.length).toBeLessThanOrEqual(LEITURA.tetoTrechoCaracteres);
    }
  });

  it("passou de 4.000 caracteres: corta no fim de frase e fecha com 'O resto está na tela.'", () => {
    const md = Array.from({ length: 200 }, (_, i) => `Esta é a frase número ${i} da resposta longa.`).join(" ");
    const t = textoParaLeitura(md);
    const tudo = t.join(" ");
    expect(tudo.length).toBeLessThanOrEqual(LEITURA.maxCaracteres);
    expect(tudo.endsWith(`resposta longa. ${FRASE_RESTO_TELA}`)).toBe(true);
  });

  it("até 4.000 caracteres não ganha o fecho", () => {
    expect(lido("Uma resposta curta.")).not.toContain(FRASE_RESTO_TELA);
  });

  it("listas e títulos viram frases faladas, sem marcadores", () => {
    const t = lido("## Resumo\n\n- primeiro item\n- segundo item\n\n**Importante:** acabou");
    expect(t).not.toMatch(/[#*]/u);
    expect(t).toContain("Primeiro item");
    expect(t).toContain("acabou");
  });
});
