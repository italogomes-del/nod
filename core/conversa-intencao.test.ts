import { describe, expect, it } from "vitest";
import { interpretarIntencao } from "./conversa-intencao.ts";

describe("interpretarIntencao", () => {
  it("primeira frase vira definir-papel", () => {
    const i = interpretarIntencao({
      texto: "Quero que você organize as tarefas do ClickUp",
      temInstrucoes: false,
      temPropostaPendente: false,
    });
    expect(i.tipo).toBe("definir-papel");
  });

  it("depois do papel, recorrência vira propor-rotina", () => {
    const i = interpretarIntencao({
      texto: "faz esse fechamento toda segunda às 7h e me manda antes de qualquer coisa sair",
      temInstrucoes: true,
      temPropostaPendente: false,
    });
    expect(i.tipo).toBe("propor-rotina");
  });

  it("conectar slack vira propor-concessao", () => {
    const i = interpretarIntencao({
      texto: "conecta com o Slack",
      temInstrucoes: true,
      temPropostaPendente: false,
    });
    expect(i.tipo).toBe("propor-concessao");
    if (i.tipo === "propor-concessao") expect(i.conectorId).toBe("slack");
  });

  it("sim confirma proposta pendente", () => {
    expect(
      interpretarIntencao({ texto: "sim", temInstrucoes: true, temPropostaPendente: true }).tipo,
    ).toBe("confirmar");
  });
});
