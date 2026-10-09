import { describe, expect, it } from "vitest";
import { criarPareamentoDispositivo, formatarCodigoPessoa, MAX_ERROS_POR_PESSOA, normalizarCodigoPessoa, PRAZO_DISPOSITIVO_MS } from "../../../src/services/pareamento-dispositivo.ts";

const MARLON = { tenantId: "t1", pessoaId: "p-marlon" };
const ANA = { tenantId: "t1", pessoaId: "p-ana" };

describe("pareamento por código (ADR-088)", () => {
  it("pede, a pessoa vê e aprova, e a troca devolve o escopo de quem aprovou uma vez só", () => {
    const p = criarPareamentoDispositivo(() => 1_000);
    const pedido = p.pedir({ nome: "vm-sp", plataforma: "linux" });
    expect(pedido.codigoPessoa).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "pendente" });
    expect(p.ver({ codigoPessoa: pedido.codigoPessoa.toLowerCase().replace("-", " "), escopo: MARLON })).toEqual({ nome: "vm-sp", plataforma: "linux" });
    expect(p.aprovar({ codigoPessoa: pedido.codigoPessoa, escopo: MARLON })).toBe(true);
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "aprovado", escopo: MARLON, nome: "vm-sp" });
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "invalido" });
  });

  it("aprovado uma vez, o mesmo código não serve para outra pessoa nem para aprovar de novo", () => {
    const p = criarPareamentoDispositivo(() => 1_000);
    const { codigoPessoa } = p.pedir({ nome: "vm-sp", plataforma: "linux" });
    expect(p.aprovar({ codigoPessoa, escopo: MARLON })).toBe(true);
    expect(p.ver({ codigoPessoa, escopo: ANA })).toBeNull();
    expect(p.aprovar({ codigoPessoa, escopo: ANA })).toBe(false);
  });

  it("o código vence em 10 min, para a pessoa e para a máquina", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const pedido = p.pedir({ nome: "vm-sp", plataforma: "linux" });
    agora += PRAZO_DISPOSITIVO_MS;
    expect(p.ver({ codigoPessoa: pedido.codigoPessoa, escopo: MARLON })).toBeNull();
    expect(p.trocar({ codigoDispositivo: pedido.codigoDispositivo })).toEqual({ estado: "invalido" });
  });

  it("errar o código demais bloqueia a pessoa (o código curto não pode ser adivinhado), sem afetar outra", () => {
    let agora = 1_000;
    const p = criarPareamentoDispositivo(() => agora);
    const { codigoPessoa } = p.pedir({ nome: "vm-sp", plataforma: "linux" });
    for (let i = 0; i < MAX_ERROS_POR_PESSOA; i++) expect(p.ver({ codigoPessoa: "ZZZZ-ZZZZ", escopo: MARLON })).toBeNull();
    expect(p.ver({ codigoPessoa, escopo: MARLON })).toBeNull();
    expect(p.ver({ codigoPessoa, escopo: ANA })).toEqual({ nome: "vm-sp", plataforma: "linux" });
    agora += 600_000;
    const outro = p.pedir({ nome: "vm-2", plataforma: "linux" });
    expect(p.ver({ codigoPessoa: outro.codigoPessoa, escopo: MARLON })).toEqual({ nome: "vm-2", plataforma: "linux" });
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
