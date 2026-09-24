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
