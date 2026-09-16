import { describe, expect, it } from "vitest";
import { quemResponde } from "./canal-responde.ts";

describe("canal-responde", () => {
  it("menção vence política nunca", () => {
    const r = quemResponde({
      texto: "oi @Marola olha isso",
      membrosAgenteIds: ["a1"],
      nomes: { a1: "Marola" },
      politica: "nunca",
    });
    expect(r).toEqual(["a1"]);
  });
});
