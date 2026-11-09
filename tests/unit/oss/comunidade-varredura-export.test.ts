import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { planejarExport, varrerProibidos } from "../../../scripts/oss/exportar.mjs";

const RAIZ = join(import.meta.dirname, "../../..");

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
}

describe("ADA-287 no snapshot público", () => {
  it("os arquivos da comunidade passam na varredura de proibidos do export (ADA-282)", () => {
    const manifesto = JSON.parse(readFileSync(join(RAIZ, "oss/manifesto.json"), "utf8"));
    const publico = join(RAIZ, "oss/publico");
    const doRepo = [
      ...listar(join(RAIZ, "tests/unit/oss")),
      ...listar(join(RAIZ, "scripts/oss")).filter((p) => /seguir-readme/.test(p)),
      ...listar(join(RAIZ, "tests/unit/site")).filter((p) => /site-estatico/.test(p)),
      join(RAIZ, "site/index.html"),
    ];
    // O mesmo caminho do export: exclusões e reescritas do manifesto, oss/publico por cima da raiz, depois a varredura.
    const entradas = doRepo.map((p) => ({ caminho: relative(RAIZ, p), modo: "100644", tipo: "blob", conteudo: readFileSync(p) }));
    const extras = listar(publico).map((p) => ({ caminho: relative(publico, p), modo: "100644", conteudo: readFileSync(p) }));
    const { arquivos } = planejarExport(entradas, manifesto, extras);
    expect(arquivos.size).toBeGreaterThan(extras.length);
    expect(varrerProibidos(arquivos, manifesto)).toEqual([]);
  });
});
