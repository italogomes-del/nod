import { describe, expect, it } from "vitest";
import { proporPapel } from "./proposta-agente.ts";
import { CATALOGO_CONECTORES } from "./catalogo-conectores.ts";

const agora = Date.parse("2026-09-16T12:00:00-03:00");

describe("proporPapel", () => {
  it("descrição em linguagem natural lista acesso e o que NÃO deve fazer — nada concedido", () => {
    const p = proporPapel({
      texto:
        "Olá, você é meu novo agente. Quero que me ajude a responder formulários da LGPD e organizar tarefas do ClickUp.",
      formasUsadas: [],
      coresUsadas: [],
      catalogo: CATALOGO_CONECTORES,
      fusoIana: "America/Sao_Paulo",
      agora,
    });
    expect(p.nome).toBe("LGPD");
    expect(p.acessosPedidos.map((a) => a.conectorId)).toContain("clickup");
    expect(p.naoDeveFazer.some((l) => /nasce vazio/i.test(l))).toBe(true);
    expect(p.rotina).toBeNull();
  });

  it("recorrência no texto vira proposta de rotina, não agendamento", () => {
    const p = proporPapel({
      texto: "Fecha o relatório do ClickUp toda segunda às 7h",
      formasUsadas: ["shape-square"],
      coresUsadas: ["c-red"],
      catalogo: CATALOGO_CONECTORES,
      fusoIana: "America/Sao_Paulo",
      agora,
    });
    expect(p.rotina?.cron).toBe("0 7 * * 1");
    expect(p.rotina?.exigeAprovacao).toBe(true);
    expect(p.forma).toBe("shape-hex");
  });
});
