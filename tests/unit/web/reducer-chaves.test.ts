import { describe, expect, it } from "vitest";
import type { ChaveEmitidaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, invalidacoesDaTela, reduzir } from "../../../web/estado/reducer.ts";

const emitida: ChaveEmitidaDto = { chave: "abc.segredo", dados: { id: "k1", nome: "MacBook", prefixo: "segredo1", criadaEm: 1, ultimoUsoEm: null, revogadaEm: null } };

describe("reducer: Minhas chaves (ADR-031)", () => {
  it("a tela de chaves pede a lista quando ainda não carregou; depois de hidratar, não pede mais", () => {
    const naTela = reduzir(estadoInicial, { tipo: "navegar", tela: { tipo: "chaves" } });
    expect(invalidacoesDaTela(naTela)).toContain("chaves");
    const hidratado = reduzir(naTela, { tipo: "hidratar-chaves", chaves: [emitida.dados] });
    expect(invalidacoesDaTela(hidratado)).not.toContain("chaves");
  });

  it("a chave crua fica só enquanto a pessoa está na tela: some ao fechar, ao sair da tela e ao trocar de sessão", () => {
    const naTela = reduzir(estadoInicial, { tipo: "navegar", tela: { tipo: "chaves" } });
    const comChave = reduzir(naTela, { tipo: "chave-emitida", emitida });
    expect(comChave.chaveEmitida?.chave).toBe("abc.segredo");
    expect(comChave.invalidacoes).toContain("chaves");
    expect(reduzir(comChave, { tipo: "navegar", tela: { tipo: "chaves" } }).chaveEmitida).not.toBeNull();
    expect(reduzir(comChave, { tipo: "chave-emitida", emitida: null }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "navegar", tela: { tipo: "rotinas" } }).chaveEmitida).toBeNull();
    expect(reduzir(comChave, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).chaveEmitida).toBeNull();
  });
});
