import { describe, expect, it } from "vitest";
import { decidirNativa, NATIVAS_DE_ARQUIVO, NATIVAS_DO_TERMINAL, nativasDoTurno, pastaDoBot } from "../../../src/domain/nativas.ts";

/** Resolve como o macOS: /var é link para /private/var (medido em 2026-09-28: o CLI entrega o caminho real). */
const resolver = (c: string) => c.replace(/^\/var\//, "/private/var/");
const PASTA = "/private/var/home/nod/Ada";
const decidir = (ferramenta: string, entrada: Record<string, unknown>, cwd = PASTA) => decidirNativa({ ferramenta, entrada, permitidas: [PASTA, "/Users/marlon/code/nod"], cwd, resolver });

describe("kit do terminal (ADR-052)", () => {
  it("conversa e criação confiáveis com o harness Claude recebem o kit; sem ele, só arquivo e só com pasta", () => {
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false, terminal: true })).toEqual(NATIVAS_DO_TERMINAL);
    expect(nativasDoTurno({ modo: "criacao", confianca: "confiavel", pastasAutorizadas: false, terminal: true })).toEqual(NATIVAS_DO_TERMINAL);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).toEqual(NATIVAS_DE_ARQUIVO);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false })).toEqual([]);
    expect(nativasDoTurno({ modo: "conversa", confianca: "nao_confiavel", pastasAutorizadas: true, terminal: true })).toEqual([]);
    expect(nativasDoTurno({ modo: "rotina", confianca: "confiavel", pastasAutorizadas: true, terminal: true })).toEqual([]);
  });

  it("a pasta do bot é o nome dele, sem o que o sistema de arquivos recusa", () => {
    expect(pastaDoBot("Ada")).toBe("Ada");
    expect(pastaDoBot("Dev 1 (cópia)")).toBe("Dev 1 (cópia)");
    expect(pastaDoBot("a/b:c")).toBe("a-b-c");
    expect(pastaDoBot("..")).toBe("bot");
  });

  it("arquivo só dentro da pasta do bot ou das pastas autorizadas, comparando o caminho REAL", () => {
    expect(decidir("Write", { file_path: "/var/home/nod/Ada/checklist.html" }).permitir).toBe(true);
    expect(decidir("Read", { file_path: "/Users/marlon/code/nod/README.md" }).permitir).toBe(true);
    expect(decidir("Edit", { file_path: "relativo.txt" }).permitir).toBe(true);
    expect(decidir("Write", { file_path: "/Users/marlon/.ssh/config" })).toMatchObject({ permitir: false, contamina: false });
    // Prefixo de nome não é pasta: /private/var/home/nod/Ada-outra não está dentro de .../Ada.
    expect(decidir("Read", { file_path: "/private/var/home/nod/Ada-outra/x" }).permitir).toBe(false);
    expect(decidir("Glob", {}).permitir).toBe(true);
    expect(decidir("Grep", { path: "/etc" }).permitir).toBe(false);
    expect(decidir("NotebookEdit", { notebook_path: "/tmp/x.ipynb" }).permitir).toBe(false);
  });

  it("Bash só no sandbox; web contamina o turno; o que não é do kit é negado", () => {
    expect(decidir("Bash", { command: "ls" })).toMatchObject({ permitir: true, contamina: false });
    expect(decidir("Bash", { command: "curl x", dangerouslyDisableSandbox: true }).permitir).toBe(false);
    expect(decidir("WebFetch", { url: "https://example.com" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("WebSearch", { query: "x" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("Task", {}).permitir).toBe(false);
    expect(decidir("mcp__nod__publicar_artefato", {})).toMatchObject({ permitir: true, contamina: false });
    expect(decidir("", {}).permitir).toBe(false);
  });
});
