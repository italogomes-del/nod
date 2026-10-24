import { describe, expect, it } from "vitest";
import { NARRACAO_MAX_CHARS, comporFala } from "../../../src/domain/stream-json.ts";
import { ATIVIDADE_VAZIA, NARRACAO_MAX_CHARS_WEB, comFerramenta, comTexto, comporFalaWeb, textoDaFala } from "../../../web/lib/atividade.ts";

/** Revisão 4 do #508: a fala parada da web mostra o que a fala gravada pelo servidor vai mostrar. */
describe("comporFalaWeb = comporFala do domínio", () => {
  const longo = (s: string) => `${s} ${"palavra ".repeat(40)}`;
  const casos: [string[], string][] = [
    [[], "Pronto."],
    [["Vou olhar o PR."], "Está aprovado."],
    [[longo("Relatório A")], "Está aprovado."],
    [[longo("Relatório A"), "curto", longo("Relatório B")], "Fim."],
    [[longo("Repetido"), longo("Repetido")], "Fim."],
    [[longo("Contido")], `Abaixo: ${longo("Contido")}`],
    [["x".repeat(280)], "Fim."],
    [["x".repeat(281)], "Fim."],
    [[`  ${longo("Com  espaços")}  `], "  Fim.  "],
    // QA 3: o "contém" compara sem diferença de espaços, e o bloco é aparado antes de medir.
    [[longo("Espaços\n\tvariados")], `Abaixo: ${longo("Espaços variados")}`],
    [[`${" ".repeat(10)}${"y".repeat(275)}${" ".repeat(10)}`], "Fim."],
    [[longo("Contido")], `  ${longo("Contido")}\n`],
  ];
  it.each(casos)("caso %#", (antes, final) => {
    expect(comporFalaWeb(antes, final)).toBe(comporFala(antes, final));
  });
  it("o mesmo limite", () => expect(NARRACAO_MAX_CHARS_WEB).toBe(NARRACAO_MAX_CHARS));
});

describe("textoDaFala com várias ferramentas (QA 3 do #508)", () => {
  const relatorio = `Relatório: ${"setembro fechou acima da meta. ".repeat(12)}`;
  const ferramenta = (a: typeof ATIVIDADE_VAZIA) => comFerramenta(a, "Consultou GitHub", { texto: "Usando GitHub", frentes: false });
  it("o relatório longo de duas ferramentas atrás continua, como na fala gravada", () => {
    const a = comTexto(ferramenta(comTexto(ferramenta(comTexto(ATIVIDADE_VAZIA, relatorio)), "Vou ao Linear.")), "Fim.");
    expect(textoDaFala(a)).toBe(comporFala([relatorio, "Vou ao Linear."], "Fim."));
    expect(textoDaFala(a)).toContain("setembro fechou");
  });
  it("com a ferramenta rodando, o último bloco faz de final e os relatórios longos anteriores ficam", () => {
    const a = ferramenta(comTexto(ferramenta(comTexto(ATIVIDADE_VAZIA, relatorio)), "Vou ao Linear."));
    expect(textoDaFala(a)).toBe(comporFala([relatorio], "Vou ao Linear."));
    expect(textoDaFala(a)).toContain("setembro fechou");
  });
});
