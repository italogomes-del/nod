import { describe, expect, it } from "vitest";
import { comFerramenta, comTexto, ETAPAS_GUARDADAS, linhaAtual, resumoEtapa } from "../../../web/lib/atividade.ts";

describe("atividade do turno vivo", () => {
  it("ferramenta sem narração antes abre etapa com o rótulo; seguidas somam na mesma etapa", () => {
    let a = comFerramenta(undefined, "Consultou Gmail");
    a = comFerramenta(a, "Consultou Gmail");
    expect(a).toMatchObject({ etapas: [{ texto: "Consultou Gmail", ferramentas: 2 }], totalEtapas: 1, ferramentas: 2 });
  });
  it("narração só com espaços não vira etapa", () => {
    const a = comFerramenta(comTexto(comFerramenta(undefined, "X"), "  \n"), "Y");
    expect(a.totalEtapas).toBe(1);
    expect(a.etapas[0]?.ferramentas).toBe(2);
  });
  it("guarda só as últimas etapas, mas conta todas", () => {
    let a = comFerramenta(undefined, "X");
    for (let i = 0; i < ETAPAS_GUARDADAS + 5; i++) a = comFerramenta(comTexto(a, `passo ${i}.`), "X");
    expect(a.etapas).toHaveLength(ETAPAS_GUARDADAS);
    expect(a.totalEtapas).toBe(ETAPAS_GUARDADAS + 6);
    expect(a.etapas.at(-1)?.texto).toBe(`passo ${ETAPAS_GUARDADAS + 4}.`);
  });
  it("resumoEtapa lendo só o começo do texto dá o mesmo resumo que lendo o texto inteiro (texto longo, com marcação e listas)", () => {
    // A referência: a mesma limpeza e a mesma frase sobre o texto INTEIRO.
    const completo = (texto: string, max = 140): string => {
      const limpo = texto.replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
      const frase = /^(.+?[.!?…])(?:\s|$)/.exec(limpo)?.[1] ?? limpo;
      return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
    };
    let semente = 7;
    const sorteio = (n: number): number => {
      semente = (semente * 1103515245 + 12345) % 2 ** 31;
      return semente % n;
    };
    const pedacos = ["palavra ", "**negrito** ", "`código` ", "3.5 ", "fim. ", "pergunta? ", "\n", "\n- item ", "\n  • outro ", "## título\n", "> citação ", "     ", "***", "___"];
    for (let caso = 0; caso < 400; caso++) {
      let texto = "";
      const alvo = 1_500 + sorteio(4_000);
      while (texto.length < alvo) texto += pedacos[sorteio(pedacos.length)];
      const max = [20, 140, 400][caso % 3];
      expect(resumoEtapa(texto, max)).toBe(completo(texto, max));
    }
    // Começo só de marcação e espaço: o prefixo limpo fica curto e o resumo cai no texto inteiro.
    const vazio = `${"*** ".repeat(700)}Enfim uma frase. E outra.`;
    expect(resumoEtapa(vazio)).toBe(completo(vazio));
  });

  it("resumoEtapa: primeira frase, uma linha, sem marcação, com teto", () => {
    expect(resumoEtapa("**Identifiquei** um padrão claro: a maior parte é ClickUp. Vou seguir.")).toBe("Identifiquei um padrão claro: a maior parte é ClickUp.");
    expect(resumoEtapa("11 processados, total agora 322.\nContinuando.")).toBe("11 processados, total agora 322.");
    expect(resumoEtapa("- item sem ponto final")).toBe("item sem ponto final");
    expect(resumoEtapa("a".repeat(300), 20)).toHaveLength(20);
  });
  it("linhaAtual: narração corrente, senão a última ferramenta, senão começando", () => {
    expect(linhaAtual(comTexto(undefined, "Categorizando lote de 11 e-mails."))).toBe("Categorizando lote de 11 e-mails…");
    expect(linhaAtual(comFerramenta(undefined, "Consultou Gmail"))).toBe("Consultou Gmail…");
    expect(linhaAtual(comTexto(undefined, ""))).toBe("Começando…");
  });
});
