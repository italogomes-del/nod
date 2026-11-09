import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-001, ISSUE-002 e furos de mutante do QA do PR #716 (ADA-287)
// Found by /qa on 2026-11-09
// Report: .gstack/qa-reports/qa-report-ada-287-comunidade-2026-11-09.md
const RAIZ = join(import.meta.dirname, "../../..");
const PUBLICO = join(RAIZ, "oss/publico");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}
const README = readFileSync(join(PUBLICO, "README.md"), "utf8");
const OUTRA_LICENCA = new RegExp(`\\b${String.fromCharCode(70, 83, 76)}\\b|${["Functional", "Source"].join(" ")}`, "i");

/** O slug que o GitHub dá a um título de markdown (minúsculas, sem pontuação, espaço vira hífen). */
const slug = (titulo: string) =>
  titulo
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

describe("QA #716: oss/publico vai inteira para o público", () => {
  it("ISSUE-001: nenhum arquivo de oss/publico é só interno (o export da ADA-282 copia a pasta inteira, sem lista de exclusão)", () => {
    for (const f of arquivos(PUBLICO)) {
      const texto = readFileSync(f, "utf8");
      expect(texto, relative(RAIZ, f)).not.toMatch(/gamefik|LEIA-ME-INTERNO|não vai para o público/i);
    }
  });

  it("ISSUE-002: antes do passo instalar, o README diz para ativar o mise no shell (sem isso o npm ci não acha o Node)", () => {
    const antes = README.slice(0, README.indexOf("passo=instalar"));
    expect(antes).toMatch(/mise activate/);
  });

  it("a sigla da outra licença também não aparece no teste do site que a ADA-287 alterou", () => {
    expect(readFileSync(join(RAIZ, "tests/unit/site/site-estatico.test.ts"), "utf8")).not.toMatch(OUTRA_LICENCA);
  });

  it("link relativo com âncora aponta para um título que existe no arquivo de destino", () => {
    for (const f of arquivos(PUBLICO).filter((x) => x.endsWith(".md"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\]\(([^)\s:]*)#([^)\s]+)\)/g)) {
        const destino = m[1] ? join(dirname(f), m[1]) : f;
        const titulos = [...readFileSync(destino, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map((t) => slug(t[1]!));
        expect(titulos, `${relative(RAIZ, f)} → ${m[0]}`).toContain(m[2]);
      }
    }
  });
});
