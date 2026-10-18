import { describe, expect, it } from "vitest";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** ADR-111: as chaves de experimento no menu da conta, logo abaixo do Modo dev, com o mesmo interruptor. */
describe("menu da conta: chaves de experimento (ADR-111)", () => {
  const base = { faixa: null, conexao: "Conectada", avisos: "Ligados", modoDev: false, banco: null };

  it("Calibração e Memória longa aparecem depois do Modo dev, como interruptores, no estado de cada uma", () => {
    const menu = htmlMenuConta({ ...base, experimentos: { calibracao: true, memoriaLonga: false, whatsapp: false } });
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
    expect(estadoInicial.experimentos).toEqual({ calibracao: false, memoriaLonga: false, whatsapp: false });
    const depois = reduzir(estadoInicial, { tipo: "experimentos", experimentos: { calibracao: false, memoriaLonga: true, whatsapp: false } });
    expect(depois.experimentos).toEqual({ calibracao: false, memoriaLonga: true, whatsapp: false });
  });

  // ADR-112: a terceira chave, logo abaixo da Calibração e da Memória longa, com o mesmo interruptor.
  it("Modo WhatsApp aparece depois da Memória longa, como interruptor, no estado dele e com a dica", () => {
    const ligado = htmlMenuConta({ ...base, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: true } });
    const memoria = ligado.indexOf('data-experimento="memoriaLonga"');
    const whatsapp = ligado.indexOf('data-experimento="whatsapp"');
    expect(memoria).toBeGreaterThan(-1);
    expect(whatsapp).toBeGreaterThan(memoria);
    expect(ligado).toMatch(/role="menuitemcheckbox" aria-checked="true" data-experimento="whatsapp" title="Experimento: respostas curtas, como no WhatsApp/);
    expect(ligado).toContain('<span class="mc-nome">Modo WhatsApp</span>');
    expect(htmlMenuConta(base)).toMatch(/aria-checked="false" data-experimento="whatsapp"/);
    expect(reduzir(estadoInicial, { tipo: "experimentos", experimentos: { calibracao: false, memoriaLonga: false, whatsapp: true } }).experimentos.whatsapp).toBe(true);
  });
});
