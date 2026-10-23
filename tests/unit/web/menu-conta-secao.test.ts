import { describe, expect, it } from "vitest";
import { htmlSecaoConta } from "../../../web/telas/menu-conta.ts";

/** NOD-345: o topo do menu com contas. A pessoa de antes das contas não é provisória (revisão do PR 504). */
describe("htmlSecaoConta", () => {
  it("provisório: só o convite", () => {
    const h = htmlSecaoConta({ email: null, senha: false });
    expect(h).toContain('data-conta="inicio"');
    expect(h).not.toContain('data-conta="sair"');
  });

  it("pessoa de antes das contas: e-mail, Sessões e Sair; sem convite, senha nem pareamento", () => {
    const h = htmlSecaoConta({ email: "ana@time.com", senha: false, legado: true });
    expect(h).toContain("ana@time.com");
    expect(h).toContain('data-conta="sessoes"');
    expect(h).toContain('data-conta="sair"');
    expect(h).not.toContain('data-conta="inicio"');
    expect(h).not.toContain('data-conta="senha"');
    expect(h).not.toContain('data-conta="parear-gerar"');
  });

  it("com conta e senha: trocar senha, sessões, conectar outro computador e sair", () => {
    const h = htmlSecaoConta({ email: "ana@x.com", senha: true });
    for (const q of ["senha", "sessoes", "parear-gerar", "sair"]) expect(h).toContain(`data-conta="${q}"`);
  });
});
