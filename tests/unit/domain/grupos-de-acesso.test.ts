import { describe, expect, it } from "vitest";
import { capacidadesDoNivel, grupoDaCapacidade, gruposDoCatalogo, nivelDasConcedidas } from "../../../src/domain/grupos-de-acesso.ts";

const cap = (nome: string, readOnlyHint: boolean) => ({ nome, readOnlyHint });
const CLICKUP = [
  cap("CLICKUP_GET_TASKS", true),
  cap("CLICKUP_GET_TASK_COMMENTS", true),
  cap("CLICKUP_CREATE_TASK", false),
  cap("CLICKUP_UPDATE_TASK", false),
  cap("CLICKUP_CREATE_TASK_COMMENT", false),
  cap("CLICKUP_DELETE_TASK", false),
  cap("CLICKUP_REMOVE_TAG_FROM_TASK", false),
];

describe("grupos de acesso (definido em 2026-09-25)", () => {
  it("ler é o readOnlyHint da sonda, nunca o nome: GET de escrita não vira leitura e DELETE marcado readOnly não vira apagar", () => {
    expect(grupoDaCapacidade(cap("CLICKUP_GET_OR_CREATE_FOLDER", false))).toBe("criar");
    expect(grupoDaCapacidade(cap("X_DELETE_CACHE_STATS", true))).toBe("ler");
  });

  it("escrita se separa pelo verbo, e apagar ganha de tudo (comentário apagado é apagar)", () => {
    expect(gruposDoCatalogo(CLICKUP)).toEqual([
      { id: "ler", rotulo: "Ler", capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_GET_TASK_COMMENTS"] },
      { id: "criar", rotulo: "Criar e enviar", capacidades: ["CLICKUP_CREATE_TASK"] },
      { id: "alterar", rotulo: "Editar", capacidades: ["CLICKUP_UPDATE_TASK"] },
      { id: "comentar", rotulo: "Comentar", capacidades: ["CLICKUP_CREATE_TASK_COMMENT"] },
      { id: "apagar", rotulo: "Apagar", capacidades: ["CLICKUP_DELETE_TASK", "CLICKUP_REMOVE_TAG_FROM_TASK"] },
    ]);
    expect(grupoDaCapacidade(cap("SLACK_DELETE_COMMENT", false))).toBe("apagar");
    expect(grupoDaCapacidade(cap("slack.send_message", false))).toBe("criar");
  });

  it("o nível: leitura = as de leitura; escrita = tudo menos apagar; nenhum = nada", () => {
    expect(capacidadesDoNivel(CLICKUP, "leitura")).toEqual(["CLICKUP_GET_TASKS", "CLICKUP_GET_TASK_COMMENTS"]);
    expect(capacidadesDoNivel(CLICKUP, "escrita")).toEqual(["CLICKUP_GET_TASKS", "CLICKUP_GET_TASK_COMMENTS", "CLICKUP_CREATE_TASK", "CLICKUP_UPDATE_TASK", "CLICKUP_CREATE_TASK_COMMENT"]);
    expect(capacidadesDoNivel(CLICKUP, "nenhum")).toEqual([]);
  });

  it("o nível de um conjunto concedido: qualquer escrita (ou nome fora do catálogo) já é escrita", () => {
    expect(nivelDasConcedidas(CLICKUP, [])).toBe("nenhum");
    expect(nivelDasConcedidas(CLICKUP, ["CLICKUP_GET_TASKS"])).toBe("leitura");
    expect(nivelDasConcedidas(CLICKUP, ["CLICKUP_GET_TASKS", "CLICKUP_UPDATE_TASK"])).toBe("escrita");
    expect(nivelDasConcedidas(CLICKUP, ["SUMIU_DO_CATALOGO"])).toBe("escrita");
  });
});
