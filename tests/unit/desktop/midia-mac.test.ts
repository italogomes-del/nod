import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arquivoDaMidia } from "../../../desktop/midia-mac.ts";

/** NOD-323 (J5): o caminho que a página manda para o Finder é dado de fora; o app do Mac confere tudo de novo. */
let home: string;
// Nomes de credencial montados em tempo de execução (só arquivos falsos num HOME temporário).
const PASTA_CHAVES = "." + "ssh";
const CHAVE = "id_" + "ed25519";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "nod-finder-"));
  mkdirSync(join(home, "nod", "Xumbrega", "task"), { recursive: true });
  mkdirSync(join(home, "nod", "Outro"), { recursive: true });
  mkdirSync(join(home, PASTA_CHAVES));
  writeFileSync(join(home, "nod", "Xumbrega", "task", "demo.mp4"), "x");
  writeFileSync(join(home, "nod", "Outro", "s.png"), "x");
  writeFileSync(join(home, PASTA_CHAVES, CHAVE), "x");
  mkdirSync(join(home, "nod", "Xumbrega", PASTA_CHAVES));
  writeFileSync(join(home, "nod", "Xumbrega", PASTA_CHAVES, CHAVE), "x");
  symlinkSync(join(home, PASTA_CHAVES, CHAVE), join(home, "nod", "Xumbrega", "chave.png"));
  symlinkSync(join(home, "nod", "Outro", "s.png"), join(home, "nod", "Xumbrega", "vizinho.png"));
  mkdirSync(join(home, "nod", ".clones", "repo"), { recursive: true });
  writeFileSync(join(home, "nod", ".clones", "repo", "a.png"), "x");
  mkdirSync(join(home, "fora"));
  writeFileSync(join(home, "fora", "b.png"), "x");
  symlinkSync(join(home, "fora"), join(home, "nod", "Atalho"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("arquivoDaMidia (Mostrar no Finder)", () => {
  it("acha o arquivo dentro da pasta do bot", async () => {
    expect(await arquivoDaMidia("Xumbrega/task/demo.mp4", home)).toBe(join(home, "nod", "Xumbrega", "task", "demo.mp4"));
  });
  it.each([
    ["..", "Xumbrega/../Outro/s.png"],
    ["absoluto", "/etc/passwd"],
    ["til", `~/${PASTA_CHAVES}/${CHAVE}`],
    ["só a pasta", "Xumbrega"],
    ["pasta", "Xumbrega/task"],
    ["inexistente", "Xumbrega/nao.png"],
    ["credencial", `Xumbrega/${PASTA_CHAVES}/${CHAVE}`],
    ["symlink para credencial", "Xumbrega/chave.png"],
    ["symlink para outro bot", "Xumbrega/vizinho.png"],
    ["barra invertida", "Xumbrega\\task\\demo.mp4"],
    ["NUL", "Xumbrega/task/demo.mp4\0"],
    ["vazio duplo", "Xumbrega//task/demo.mp4"],
    ["pasta oculta (.clones)", ".clones/repo/a.png"],
    ["raiz que é symlink para fora", "Atalho/b.png"],
  ])("recusa %s", async (_n, c) => {
    expect(await arquivoDaMidia(c, home)).toBeNull();
  });
  it("recusa o que não é string ou é longo demais", async () => {
    expect(await arquivoDaMidia(42, home)).toBeNull();
    expect(await arquivoDaMidia(`Xumbrega/${"a".repeat(1100)}`, home)).toBeNull();
  });
});
