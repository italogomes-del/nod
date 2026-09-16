import { describe, expect, it } from "vitest";
import { complementoCapacidades, detectarConectores, CATALOGO_CONECTORES } from "./catalogo-conectores.ts";

describe("catalogo-conectores", () => {
  it("detecta Slack, Notion e ClickUp no texto da pessoa", () => {
    const ids = detectarConectores(
      "Quero que me ajude no Slack e no Notion, e organize tarefas do ClickUp",
    ).map((c) => c.id);
    expect(ids).toEqual(["slack", "notion", "clickup"]);
  });

  it("capacidades começam todas fora do complemento ligado — E2.4", () => {
    const slack = CATALOGO_CONECTORES.find((c) => c.id === "slack");
    if (!slack) throw new Error("missing");
    const naoPode = complementoCapacidades(slack, []);
    expect(naoPode).toHaveLength(slack.capacidades.length);
  });
});
