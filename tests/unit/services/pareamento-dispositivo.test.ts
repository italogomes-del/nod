import { describe, expect, it } from "vitest";
import { criarPareamentoDispositivo, formatarCodigoPessoa, MAX_ERROS_POR_PESSOA, MAX_PEDIDOS_DISPOSITIVO, normalizarCodigoPessoa, PRAZO_CONVITE_MS, PRAZO_DISPOSITIVO_MS, type PareamentoDispositivo } from "../../../src/services/pareamento-dispositivo.ts";

const MARLON = { tenantId: "t1", pessoaId: "p-marlon" };
const ANA = { tenantId: "t1", pessoaId: "p-ana" };

function pedir(p: PareamentoDispositivo, nome = "vm-sp") {
  const pedido = p.pedir({ nome, plataforma: "linux" });
  if (!pedido) throw new Error("cheio");
  return pedido;
}

describe("pareamento por código (ADR-090)", () => {
  it("pede, a pessoa vê e aprova, e a troca devolve o escopo de quem aprovou uma vez só", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const pedido = pedir(p);
    expect(pedido.codigoPessoa).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "pendente" });
    agora += 125_000;
    expect(p.ver({ codigoPessoa: pedido.codigoPessoa.toLowerCase().replace("-", " "), escopo: MARLON })).toEqual({ nome: "vm-sp", plataforma: "linux", pedidoHaS: 125 });
    expect(p.aprovar({ codigoPessoa: pedido.codigoPessoa, escopo: MARLON })).toBe(true);
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "aprovado", escopo: MARLON, nome: "vm-sp" });
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "invalido" });
  });

  it("aprovado uma vez, o mesmo código não serve para outra pessoa nem para aprovar de novo", () => {
    const p = criarPareamentoDispositivo(() => 1_000);
    const { codigoPessoa } = pedir(p);
    expect(p.aprovar({ codigoPessoa, escopo: MARLON })).toBe(true);
    expect(p.ver({ codigoPessoa, escopo: ANA })).toBeNull();
    expect(p.aprovar({ codigoPessoa, escopo: ANA })).toBe(false);
  });

  it("o código vence no prazo, para a pessoa e para a máquina", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const pedido = pedir(p);
    agora += PRAZO_DISPOSITIVO_MS;
    expect(p.ver({ codigoPessoa: pedido.codigoPessoa, escopo: MARLON })).toBeNull();
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "invalido" });
  });

  it("errar o código demais bloqueia a pessoa (ver e aprovar), sem afetar outra; a janela passa", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const { codigoPessoa } = pedir(p);
    for (let i = 0; i < MAX_ERROS_POR_PESSOA; i++) expect(p.ver({ codigoPessoa: "ZZZZ-ZZZZ", escopo: MARLON })).toBeNull();
    expect(p.ver({ codigoPessoa, escopo: MARLON })).toBeNull();
    expect(p.aprovar({ codigoPessoa, escopo: MARLON })).toBe(false);
    expect(p.ver({ codigoPessoa, escopo: ANA })).toMatchObject({ nome: "vm-sp", plataforma: "linux" });
    agora += 600_000;
    const outro = pedir(p, "vm-2");
    expect(p.ver({ codigoPessoa: outro.codigoPessoa, escopo: MARLON })).toMatchObject({ nome: "vm-2" });
  });

  it("cheio, recusa o pedido novo em vez de despejar os que estão valendo (a rota é pública)", () => {
    const p = criarPareamentoDispositivo(() => 1_000);
    const primeiro = pedir(p);
    for (let i = 1; i < MAX_PEDIDOS_DISPOSITIVO; i++) pedir(p, `vm-${i}`);
    expect(p.pedir({ nome: "a-mais", plataforma: "linux" })).toBeNull();
    expect(p.trocar({ codigoDispositivo: primeiro.codigoDispositivo })).toEqual({ estado: "pendente" });
  });

  it("codigoDispositivo fora do formato é inválido sem olhar a tabela", () => {
    const p = criarPareamentoDispositivo();
    expect(p.trocar({ codigoDispositivo: "curto" })).toEqual({ estado: "invalido" });
  });

  it("normaliza e formata o código como a pessoa digitar", () => {
    expect(normalizarCodigoPessoa(" k7qm-4f2x ")).toBe("K7QM4F2X");
    expect(formatarCodigoPessoa("k7qm4f2x")).toBe("K7QM-4F2X");
  });
});

describe("convite de uso único no comando de instalação (ADR-102)", () => {
  it("a tela vê a máquina chegar pelo convite e aprova com o código dela; o convite não serve de novo nem para outra pessoa", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const { convite, expiraEm } = p.criarConvite(MARLON);
    expect(convite).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(expiraEm).toBe(agora + PRAZO_CONVITE_MS);
    expect(p.verConvite({ convite, escopo: MARLON })).toEqual({ estado: "pendente" });
    expect(p.verConvite({ convite, escopo: ANA })).toEqual({ estado: "invalido" });
    agora += 3_000;
    const pedido = p.pedir({ nome: "vm-bots", plataforma: "linux", convite })!;
    const visto = p.verConvite({ convite, escopo: MARLON });
    expect(visto).toEqual({ estado: "chegou", codigo: pedido.codigoPessoa, pedido: { nome: "vm-bots", plataforma: "linux", pedidoHaS: 0 } });
    // Uma segunda máquina com o mesmo convite pareia pelo caminho de sempre (código), sem tomar o lugar da primeira.
    const segundo = p.pedir({ nome: "intrusa", plataforma: "linux", convite })!;
    expect(p.verConvite({ convite, escopo: MARLON })).toMatchObject({ estado: "chegou", codigo: pedido.codigoPessoa });
    expect(segundo.codigoPessoa).not.toBe(pedido.codigoPessoa);
    if (visto.estado !== "chegou") throw new Error("não chegou");
    expect(p.aprovar({ codigoPessoa: visto.codigo, escopo: MARLON })).toBe(true);
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toMatchObject({ estado: "aprovado", nome: "vm-bots" });
    // Aprovado: o convite não mostra mais pedido.
    expect(p.verConvite({ convite, escopo: MARLON })).toEqual({ estado: "invalido" });
  });

  it("o convite vence em 30 min e um convite inventado não liga nada", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const { convite } = p.criarConvite(MARLON);
    agora += PRAZO_CONVITE_MS + 1;
    expect(p.verConvite({ convite, escopo: MARLON })).toEqual({ estado: "invalido" });
    expect(p.verConvite({ convite: "x".repeat(32), escopo: MARLON })).toEqual({ estado: "invalido" });
    expect(p.pedir({ nome: "vm", plataforma: "linux", convite: "x".repeat(32) })).not.toBeNull();
  });
});
