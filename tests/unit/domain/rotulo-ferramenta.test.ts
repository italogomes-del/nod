import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ferramentaEmUso, frameDaFerramenta, nomeDaFerramenta, rotuloFerramenta } from "../../../src/domain/rotulo-ferramenta.ts";

describe("ferramentaEmUso: servidor com nome de IA (revisão 3 do #508)", () => {
  it("não mostra o nome da IA: o navegador pelo que é, o resto sem nome; o conector claude_ai segue pelo app", () => {
    expect(ferramentaEmUso("mcp__claude-in-chrome__navigate").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__codex__exec").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__openai_tools__run").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).not.toMatch(/claude/i);
  });

  it("revisão 4: o rótulo do 'ver etapas' e o nome do vigia também não mostram o nome da IA", () => {
    expect(rotuloFerramenta("mcp__claude-in-chrome__navigate")).toBe("Usou o navegador");
    expect(rotuloFerramenta("mcp__codex__exec")).toBe("Usou uma ferramenta");
    expect(nomeDaFerramenta("mcp__claude-in-chrome__navigate")).toBe("Navegador");
    expect(nomeDaFerramenta("mcp__codex__exec")).toBe("uma ferramenta");
    expect(rotuloFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Usou Linear");
    expect(nomeDaFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Linear");
    // Revisão 5: os colados também (o servidor de documentação da OpenAI usado com o Codex).
    for (const n of ["mcp__openaiDeveloperDocs__search", "mcp__claudeCode__x", "mcp__myGPT__run"]) {
      expect(rotuloFerramenta(n)).toBe("Usou uma ferramenta");
      expect(nomeDaFerramenta(n)).toBe("uma ferramenta");
      expect(ferramentaEmUso(n).texto).toBe("Usando uma ferramenta");
    }
    expect(rotuloFerramenta("mcp__github__get_pr")).toBe("Usou Github");
    // QA 3: as outras IAs e os outros nomes de navegador.
    expect(ferramentaEmUso("mcp__gemini__ask").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("mcp__anthropic-browser__open").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__codex-navegador__open").texto).toBe("Usando o navegador");
    expect(ferramentaEmUso("mcp__claude_ai__x").texto).toBe("Usando uma ferramenta");
    // Revisão 7: o app de um conector do nod com nome de IA.
    expect(rotuloFerramenta("mcp__nod__openai__OPENAI_LIST_MODELS")).toBe("Consultou uma ferramenta");
    expect(nomeDaFerramenta("mcp__nod__openai__OPENAI_LIST_MODELS")).toBe("uma ferramenta");
    expect(ferramentaEmUso("mcp__nod__anthropic__ANTHROPIC_CREATE_X").texto).toBe("Usando uma ferramenta");
  });
});

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

// NOD-348: a fala viva diz "Usando ‹ferramenta›" com o nome que já existe (os verbos no presente são da NOD-352).
describe("ferramentaEmUso", () => {
  it("nativas com o nome do vigia; desconhecida e vazia viram 'uma ferramenta' (nunca o id cru)", () => {
    expect(ferramentaEmUso("Bash")).toEqual({ texto: "Usando Terminal", frentes: false });
    expect(ferramentaEmUso("WebSearch").texto).toBe("Usando Pesquisa na web");
    expect(ferramentaEmUso("TodoWrite").texto).toBe("Usando uma ferramenta");
    expect(ferramentaEmUso("").texto).toBe("Usando uma ferramenta");
  });
  it("conector, computador e pasta de trabalho, como no vigia", () => {
    expect(ferramentaEmUso("mcp__nod__linear__LINEAR_LIST_ISSUES").texto).toBe("Usando Linear");
    expect(ferramentaEmUso("mcp__nod__gmail__search_threads").texto).toBe("Usando Gmail");
    expect(ferramentaEmUso("mcp__nod__computador_clicar").texto).toBe("Usando Computador");
    expect(ferramentaEmUso("mcp__nod__workspace_ler_texto").texto).toBe("Usando Pasta de trabalho");
    expect(ferramentaEmUso("mcp__outro__fazer").texto).toBe("Usando Outro");
  });
  it("frentes têm estado próprio; o resto do nod é 'Usando o nod'", () => {
    expect(ferramentaEmUso("mcp__nod__abrir_frentes")).toEqual({ texto: "Abrindo frentes", frentes: true });
    expect(ferramentaEmUso("mcp__nod__mandar_para_frente").frentes).toBe(true);
    expect(ferramentaEmUso("mcp__nod__criar_bots")).toEqual({ texto: "Usando o nod", frentes: false });
    expect(ferramentaEmUso("mcp__outro__abrir_frentes").frentes).toBe(false);
  });
  it("o conector do CLI não mostra o nome da IA", () => {
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).toBe("Usando Linear");
    // QA 2 do #508: o "ver etapas" e o aviso do vigia também sem o nome da IA.
    expect(rotuloFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Usou Linear");
    expect(nomeDaFerramenta("mcp__claude_ai_Linear__list_issues")).toBe("Linear");
    expect(ferramentaEmUso("mcp__claude_ai_Linear__list_issues").texto).not.toMatch(/claude/i);
  });
});

describe("frameDaFerramenta (QA do #508)", () => {
  it("leva nome, rótulo e emUso", () => {
    expect(frameDaFerramenta("mcp__nod__linear__LINEAR_LIST_ISSUES")).toEqual({ nome: "mcp__nod__linear__LINEAR_LIST_ISSUES", rotulo: rotuloFerramenta("mcp__nod__linear__LINEAR_LIST_ISSUES"), emUso: { texto: "Usando Linear", frentes: false } });
  });
  it("compor.ts: todo turno.atividade de ferramenta sai por frameDaFerramenta (a ponte e o laço local)", () => {
    const compor = readFileSync(new URL("../../../src/adapters/http/compor.ts", import.meta.url), "utf8");
    const publicacoes = [...compor.matchAll(/publicarDoPlano\(plano, "turno\.atividade", ([^)]*\)?)/g)].map((x) => x[1]);
    expect(publicacoes.length).toBeGreaterThanOrEqual(2);
    for (const p of publicacoes) expect(p).toMatch(/^frameDaFerramenta\(/);
  });
});
