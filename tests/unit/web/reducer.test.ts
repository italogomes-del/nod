import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { conversaDaTela, estadoInicial, invalidacoesDaTela, reduzir } from "../../../web/estado/reducer.ts";

const frota: FrotaDto = {
  agentes: [
    {
      tenantId: "t",
      id: "a1",
      ownerId: "p",
      visibility: "privado",
      nome: "LGPD",
      titulo: "",
      descricao: "x",
      dono: "pessoa",
      forma: "shape-square",
      cor: "c-pink",
      fixado: false,
      oculto: false,
      confirmado: true,
      modelo: "claude-haiku-4-5-20251001",
      duplicadoDe: null,
      criadoEm: 1,
      conversaId: "c1",
      descricaoEstado: "sem acessos · nunca executou",
      computadorForaDoAr: null,
      ultimaMensagem: null,
    },
  ],
  inventario: { estado: "pronto", versao: "catcher", em: 1 },
  negacoes: [],
};

/** O reducer da web é reescrito por frames SSE (L9); a hidratação por REST continua sendo a fonte da verdade. */
describe("reducer: hidratação e o que cada tela precisa", () => {
  it("hidratar-frota guarda a frota e o inventário; a tela inicial é a frota", () => {
    const e = reduzir(estadoInicial, { tipo: "hidratar-frota", frota });
    expect(e.frota?.agentes.map((a) => a.nome)).toEqual(["LGPD"]);
    expect(e.inventario).toEqual({ estado: "pronto", versao: "catcher", em: 1 });
    expect(e.tela).toEqual({ tipo: "frota" });
  });

  it("invalidacoesDaTela diz o que falta buscar para a tela atual (sem repetir o que já está marcado)", () => {
    // A fila entra em QUALQUER tela desde 2026-09-18: ela alimenta o badge ⚑ e a faixa de chamada da
    // sidebar, que substituíram a entrada "Sua vez" do rail removido.
    expect(invalidacoesDaTela(estadoInicial)).toEqual(["frota", "sua-vez"]);
    let e = reduzir(estadoInicial, { tipo: "hidratar-frota", frota });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } });
    // Rotinas vêm junto com a conversa: elas moram no painel Detalhes, ao lado dela.
    expect(invalidacoesDaTela(e)).toEqual(["conversa:c1", "concessoes:a1", "rotinas", "conectores", "sua-vez"]);
    expect(conversaDaTela(e)).toBeNull();
    e = reduzir(e, { tipo: "invalidar", quais: ["conversa:c1"] });
    expect(invalidacoesDaTela(e)).toEqual(["concessoes:a1", "rotinas", "conectores", "sua-vez"]);
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "sua-vez" } });
    // "Sua vez" traz os conectores desde 2026-09-24: o card da rotina diz se o app que ela precisa está conectado.
    expect(invalidacoesDaTela(e)).toEqual(["conectores", "sua-vez"]);
  });

  it("sessão, conexão e tick são estado escrito (o relógio nunca é lido no reducer)", () => {
    let e = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "p" } });
    e = reduzir(e, { tipo: "conexao", estado: "reconectando", tentativa: 2, proximaEmMs: 2000 });
    e = reduzir(e, { tipo: "tick", agora: 123 });
    expect(e.sessao).toEqual({ tenantId: "t", pessoaId: "p" });
    expect(e.conexao).toEqual({ estado: "reconectando", tentativa: 2, proximaEmMs: 2000 });
    expect(e.agora).toBe(123);
  });
});
