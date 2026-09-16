import { describe, expect, it } from "vitest";
import { redigir } from "../../../src/domain/redacao.ts";

describe("redacao", () => {
  it("rotina sem resposta NÃO envia — caso adversarial", () => {
    const t = redigir("rotina-sem-resposta", 0);
    expect(t).toMatch(/nada foi enviado/i);
    expect(t).not.toMatch(/tent(e|ar) de novo/i);
  });

  it("chaves novas com parâmetros; placeholder sem valor fica visível (nunca some em silêncio)", () => {
    expect(redigir("handoff", 0, { de: "Vera", para: "Tuca", motivo: "ele conhece o PR" })).toBe("Vera passou para Tuca: ele conhece o PR.");
    expect(redigir("sem-acessos-nunca-executou", 0)).toBe("sem acessos · nunca executou");
    expect(redigir("parei-falta-dado", 0, { dado: "CNPJ", quem: "Ana" })).toBe("parei: falta CNPJ; quem destrava: Ana; não vou tentar de novo.");
    expect(redigir("turno-interrompido", 0)).toContain("{motivo}");
    expect(redigir("parada-nada-rodando", 0)).toMatch(/nada estava rodando/i);
    expect(redigir("memoria-nao-e-fonte", 0)).toMatch(/não substitui fonte autoritativa/i);
  });
});
