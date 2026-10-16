import { describe, expect, it } from "vitest";
import { nomeDaFerramenta, rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";

describe("rotuloFerramenta", () => {
  it("ferramenta nod tem rótulo próprio", () => {
    expect(rotuloFerramenta("mcp__nod__pedir_aprovacao")).toBe("Pediu aprovação");
    expect(rotuloFerramenta("mcp__nod__lembrar")).toBe("Anotou na memória");
  });
  it("conector: capacidade de leitura consulta, o resto altera", () => {
    expect(rotuloFerramenta("mcp__nod__gmail__search_threads")).toBe("Consultou Gmail");
    expect(rotuloFerramenta("mcp__nod__gmail__label_thread")).toBe("Alterou Gmail");
    expect(rotuloFerramenta("mcp__nod__google-calendar__list_events")).toBe("Consultou Google calendar");
    expect(rotuloFerramenta("mcp__nod__gmail__GMAIL_FETCH_EMAILS")).toBe("Consultou Gmail");
    expect(rotuloFerramenta("mcp__nod__gmail__GMAIL_ADD_LABEL_TO_EMAIL")).toBe("Alterou Gmail");
  });
  it("computador e pasta de trabalho viram um rótulo só", () => {
    expect(rotuloFerramenta("mcp__nod__computador_observar")).toBe("Usou o computador");
    expect(rotuloFerramenta("mcp__nod__workspace_ler_texto")).toBe("Usou a pasta de trabalho");
  });
  it("fora do proxy nod: nome nativo ou servidor MCP do Codex", () => {
    expect(rotuloFerramenta("Bash")).toBe("Rodou um comando");
    expect(rotuloFerramenta("TaskUpdate")).toBe("Organizou as tarefas");
    expect(rotuloFerramenta("Skill")).toBe("Usou uma skill");
    expect(rotuloFerramenta("Ferramenta_nova")).toBe("Usou Ferramenta_nova");
    expect(rotuloFerramenta("mcp__outro__fazer")).toBe("Usou Outro");
    expect(rotuloFerramenta("")).toBe("Usou uma ferramenta");
  });
});

describe("nomeDaFerramenta (NOD-73: o nome curto do aviso do vigia)", () => {
  it("nativas, conectores, computador e desconhecidas", () => {
    expect(nomeDaFerramenta("Bash")).toBe("Terminal");
    expect(nomeDaFerramenta("mcp__nod__gmail__search_threads")).toBe("Gmail");
    expect(nomeDaFerramenta("mcp__nod__computador_observar")).toBe("Computador");
    expect(nomeDaFerramenta("mcp__nod__workspace_ler_texto")).toBe("Pasta de trabalho");
    expect(nomeDaFerramenta("Ferramenta_nova")).toBe("Ferramenta_nova");
    expect(nomeDaFerramenta("")).toBe("uma ferramenta");
  });
});
