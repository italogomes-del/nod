import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { trechoAplicavel, trechoDeRollback } from "../../../src/db/migrar.ts";

describe("trechoDeRollback (NOD-195)", () => {
  it("sem marcador devolve null", () => {
    expect(trechoDeRollback("CREATE TABLE a (id int);\n")).toBeNull();
    // Menção ao marcador no meio da linha não é marcador (mesma regra do trechoAplicavel).
    expect(trechoDeRollback("CREATE TABLE a (id int); -- ROLLBACK: drop\n")).toBeNull();
  });

  it("bloco vazio: marcador no fim do arquivo ou só linhas em branco e `--`", () => {
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:")).toBe("");
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:\n")?.trim()).toBe("");
    expect(trechoDeRollback("CREATE TABLE a (id int);\n-- ROLLBACK:\n--\n\n-- \n")?.trim()).toBe("");
  });

  it("tira o `-- ` de cada linha e mantém as linhas em branco", () => {
    const sql = "ALTER TABLE a ADD COLUMN b int;\n-- ROLLBACK:\n-- ALTER TABLE a\n--   DROP COLUMN b;\n\n-- DROP INDEX IF EXISTS x;\n";
    expect(trechoDeRollback(sql)).toBe("ALTER TABLE a\n  DROP COLUMN b;\n\nDROP INDEX IF EXISTS x;\n");
  });

  it("`-- -- texto` é comentário de verdade e não vira SQL; texto na linha do marcador também não", () => {
    const sql = "X;\n-- ROLLBACK: desfaz a coluna\n-- -- a constraint sai antes da coluna\n-- ALTER TABLE a DROP CONSTRAINT c;\n--   -- recuado também\n";
    expect(trechoDeRollback(sql)).toBe("\nALTER TABLE a DROP CONSTRAINT c;\n\n");
  });

  it("CRLF: o `\\r` não vai para o SQL", () => {
    expect(trechoDeRollback("X;\r\n-- ROLLBACK:\r\n-- DROP TABLE a;\r\n")).toBe("DROP TABLE a;\n");
  });

  it("aplicável + rollback cobrem o arquivo: o marcador é a fronteira dos dois", () => {
    const sql = "ALTER TABLE a ADD COLUMN b int;\n\n-- ROLLBACK:\n-- ALTER TABLE a DROP COLUMN b;\n";
    expect(trechoAplicavel(sql)).toBe("ALTER TABLE a ADD COLUMN b int;\n\n");
    expect(trechoDeRollback(sql)).toBe("ALTER TABLE a DROP COLUMN b;\n");
  });

  it("a 0059 real: o rollback são os dois comandos, na ordem", async () => {
    const conteudo = await readFile(new URL("../../../src/db/migrations/0059_avisos_fechados.sql", import.meta.url), "utf8");
    const comandos = (trechoDeRollback(conteudo) ?? "").split("\n").filter((l) => l.trim() !== "");
    expect(comandos).toEqual([
      "ALTER TABLE preferencias DROP CONSTRAINT preferencias_avisos_fechados;",
      "ALTER TABLE preferencias DROP COLUMN avisos_fechados;",
    ]);
  });
});
