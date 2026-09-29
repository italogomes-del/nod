import { describe, expect, it } from "vitest";
import { decidirNativa, NATIVAS_DE_ARQUIVO, NATIVAS_DO_TERMINAL, nativasDoTurno, pastaDoBot } from "../../../src/domain/nativas.ts";

const decidir = (ferramenta: string, entrada: Record<string, unknown>) => decidirNativa({ ferramenta, entrada });

describe("kit do terminal (ADR-052, revisto pela ADR-055)", () => {
  it("conversa e criação confiáveis com o harness Claude recebem o kit; sem ele, só arquivo e só com pasta", () => {
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false, terminal: true })).toEqual(NATIVAS_DO_TERMINAL);
    expect(nativasDoTurno({ modo: "criacao", confianca: "confiavel", pastasAutorizadas: false, terminal: true })).toEqual(NATIVAS_DO_TERMINAL);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).toEqual(NATIVAS_DE_ARQUIVO);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false })).toEqual([]);
    expect(nativasDoTurno({ modo: "conversa", confianca: "nao_confiavel", pastasAutorizadas: true, terminal: true })).toEqual([]);
    expect(nativasDoTurno({ modo: "rotina", confianca: "confiavel", pastasAutorizadas: true, terminal: true })).toEqual([]);
  });

  it("emenda da ADR-055: as skills da pessoa e os subagentes estão no kit, e o hook os deixa passar", () => {
    expect(NATIVAS_DO_TERMINAL).toEqual(expect.arrayContaining(["Skill", "Agent"]));
    expect(decidir("Skill", { skill: "review", args: "420" })).toEqual({ permitir: true, motivo: "skill da pessoa: cada ferramenta que ela usar passa pelo nod", contamina: false });
    expect(decidir("Agent", { subagent_type: "general-purpose", prompt: "revise" })).toMatchObject({ permitir: true, contamina: false });
    // O nome antigo do subagente (o `init` ainda o lista) não entra por engano: o hook recebe "Agent".
    expect(decidir("Task", {})).toMatchObject({ permitir: false });
    // A lista de tarefas do bot só organiza o trabalho da sessão.
    for (const f of ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]) {
      expect(NATIVAS_DO_TERMINAL).toContain(f);
      expect(decidir(f, {})).toMatchObject({ permitir: true, contamina: false });
    }
    // Fora do terminal (só arquivo, com pasta), nada de skill.
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).not.toContain("Skill");
  });

  it("a pasta do bot é o nome dele, sem o que o sistema de arquivos recusa", () => {
    expect(pastaDoBot("Ada")).toBe("Ada");
    expect(pastaDoBot("Dev 1 (cópia)")).toBe("Dev 1 (cópia)");
    expect(pastaDoBot("a/b:c")).toBe("a-b-c");
    expect(pastaDoBot("..")).toBe("bot");
  });

  it("ADR-055: arquivo em qualquer lugar do Mac, como a pessoa no Claude Code", () => {
    for (const [f, entrada] of [
      ["Write", { file_path: "/Users/marlon/nod/Ada/checklist.html" }],
      ["Edit", { file_path: "/Users/marlon/Inhouse/leapy/src/app.ts" }],
      ["Read", { file_path: "/Users/marlon/.zshrc" }],
      ["Grep", { path: "/etc" }],
      ["NotebookEdit", { notebook_path: "/tmp/x.ipynb" }],
    ] as const) expect(decidir(f, entrada), f).toMatchObject({ permitir: true, contamina: false });
  });

  it("ADR-055: menos onde moram as credenciais — as ferramentas de arquivo não abrem chaves nem tokens", () => {
    for (const [f, entrada] of [
      ["Read", { file_path: "/Users/marlon/.ssh/id_ed25519" }],
      ["Read", { file_path: "/Users/marlon/.aws/credentials" }],
      ["Read", { file_path: "/Users/marlon/.config/gh/hosts.yml" }],
      ["Grep", { pattern: "token", path: "/Users/marlon/.config/gh" }],
      ["Glob", { pattern: "**/*.pem" }],
      ["Write", { file_path: "/Users/marlon/.ssh/authorized_keys" }],
    ] as const) expect(decidir(f, entrada), `${f} ${JSON.stringify(entrada)}`).toMatchObject({ permitir: false });
  });

  it("Bash vai ao servidor com o comando; web contamina o turno; o que não é do kit é negado", () => {
    expect(decidir("Bash", { command: "gh pr list -R leapy-edtech/leapy" })).toMatchObject({ permitir: true, contamina: false, comando: "gh pr list -R leapy-edtech/leapy" });
    expect(decidir("Bash", { command: "  " }).permitir).toBe(false);
    expect(decidir("Bash", {}).permitir).toBe(false);
    expect(decidir("WebFetch", { url: "https://example.com" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("WebSearch", { query: "x" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("Task", {}).permitir).toBe(false);
    expect(decidir("mcp__nod__publicar_artefato", {})).toMatchObject({ permitir: true, contamina: false });
    expect(decidir("", {}).permitir).toBe(false);
  });
});
