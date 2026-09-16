import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = new URL("../../../src/contracts/", import.meta.url);

/** EMENDA 26: src/contracts contém só tipos e `as const`; nenhum import sai da pasta (critério da L2). */
describe("src/contracts é fechado", () => {
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("todo import é relativo à própria pasta (./x.ts)", () => {
    for (const f of arquivos) {
      const src = readFileSync(new URL(f, DIR), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const i of imports) expect(i, `${f} importa ${i}`).toMatch(/^\.\/[a-z-]+\.ts$/);
    }
  });

  it("nenhum arquivo passa de 200 linhas (gatilho de revisão registrado no AGENTS.md)", () => {
    for (const f of arquivos) {
      const linhas = readFileSync(new URL(f, DIR), "utf8").split("\n").length;
      expect(linhas, `${f} tem ${linhas} linhas`).toBeLessThanOrEqual(200);
    }
  });

  it("os 22 arquivos do plano existem", () => {
    const esperados = ["ids", "evento", "agente", "memoria", "conversa", "mensagem", "turno", "plano-turno", "ponte", "rotina", "sala", "conector", "concessao", "decisao", "item-aprovacao", "frame", "negacao", "motivos", "inventario", "ferramentas-nod", "servicos", "api"];
    for (const e of esperados) expect(arquivos).toContain(`${e}.ts`);
  });
});
