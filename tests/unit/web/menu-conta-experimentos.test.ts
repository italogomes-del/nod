import { describe, expect, it } from "vitest";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** ADR-111: as chaves de experimento no menu da conta, logo abaixo do Modo dev, com o mesmo interruptor. */
describe("menu da conta: chaves de experimento (ADR-111)", () => {
  const base = { faixa: null, conexao: "Conectada", avisos: "Ligados", modoDev: false, banco: null };

  it("Calibração e Memória longa aparecem depois do Modo dev, como interruptores, no estado de cada uma", () => {
    const menu = htmlMenuConta({ ...base, experimentos: { calibracao: true, memoriaLonga: false } });
    const dev = menu.indexOf("data-modo-dev");
    const calibracao = menu.indexOf('data-experimento="calibracao"');
    const memoria = menu.indexOf('data-experimento="memoriaLonga"');
    expect(dev).toBeGreaterThan(-1);
    expect(calibracao).toBeGreaterThan(dev);
    expect(memoria).toBeGreaterThan(calibracao);
    expect(menu).toMatch(/role="menuitemcheckbox" aria-checked="true" data-experimento="calibracao"/);
    expect(menu).toMatch(/role="menuitemcheckbox" aria-checked="false" data-experimento="memoriaLonga"/);
    expect(menu).toContain('<span class="mc-nome">Calibração</span>');
    expect(menu).toContain('<span class="mc-nome">Memória longa</span>');
  });

  it("sem a preferência carregada, as duas desligadas", () => {
    const menu = htmlMenuConta(base);
    expect(menu).toMatch(/aria-checked="false" data-experimento="calibracao"/);
    expect(menu).toMatch(/aria-checked="false" data-experimento="memoriaLonga"/);
  });

  it("o estado nasce com as duas desligadas e guarda o que o servidor devolveu", () => {
    expect(estadoInicial.experimentos).toEqual({ calibracao: false, memoriaLonga: false });
    const depois = reduzir(estadoInicial, { tipo: "experimentos", experimentos: { calibracao: false, memoriaLonga: true } });
    expect(depois.experimentos).toEqual({ calibracao: false, memoriaLonga: true });
  });
});
