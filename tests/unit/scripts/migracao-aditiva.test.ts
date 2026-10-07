import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_ADITIVA, ehNova, semComentarios, verificarMigracao, verificarPasta } from "../../../scripts/migracao-aditiva.ts";

/** NOD-186: migração nova só adiciona; o rollback de código (NOD-173) depende disso. */
const MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "db", "migrations");
const verificar = (sql: string) => verificarMigracao("0059_x.sql", sql);

describe("scripts/migracao-aditiva.ts (NOD-186)", () => {
  it("só CREATE / ADD COLUMN passa", () => {
    expect(
      verificar(`CREATE TABLE t (id uuid PRIMARY KEY);
ALTER TABLE t ADD COLUMN nome text NOT NULL DEFAULT '';
ALTER TABLE t ALTER COLUMN nome DROP NOT NULL, ALTER COLUMN nome DROP DEFAULT, DROP CONSTRAINT t_ck;
CREATE INDEX t_nome ON t (nome);
`),
    ).toEqual([]);
  });

  it.each([
    ["DROP TABLE", "DROP TABLE IF EXISTS velha;", 2],
    ["DROP COLUMN", "ALTER TABLE t DROP COLUMN nome;", 2],
    ["DROP COLUMN", "ALTER TABLE t ADD COLUMN a int, DROP nome;", 2],
    ["RENAME", "ALTER TABLE t RENAME COLUMN a TO b;", 2],
    ["RENAME", "ALTER TYPE codigo_erro RENAME VALUE 'x' TO 'y';", 2],
    ["ALTER COLUMN … TYPE", "ALTER TABLE t\n  ALTER COLUMN a TYPE bigint;", 3],
    ["ALTER COLUMN … TYPE", "ALTER TABLE t ALTER a SET DATA TYPE bigint;", 2],
    ["SET NOT NULL", "ALTER TABLE t\n  ALTER COLUMN a SET NOT NULL;", 3],
  ] as const)("barra %s: %s", (comando, sql, linha) => {
    const problemas = verificar(`-- cabeçalho\n${sql}\n`);
    // Linha no arquivo original (o cabeçalho é a 1), onde o comando começa.
    expect(problemas).toEqual([{ arquivo: "0059_x.sql", linha, comando, motivo: "destrutiva" }]);
  });

  it("a linha reportada é a do arquivo original, depois de comentários de bloco", () => {
    const sql = "/* longo\n   comentário\n*/\nCREATE TABLE a (id int);\n\nDROP TABLE b;\n";
    expect(verificar(sql)).toEqual([{ arquivo: "0059_x.sql", linha: 6, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  it("DROP só depois de `-- ROLLBACK:` passa", () => {
    expect(verificar("CREATE TABLE t (id int);\n\n-- ROLLBACK:\nDROP TABLE t;\nALTER TABLE x DROP COLUMN y;\n")).toEqual([]);
  });

  it("DROP dentro de comentário ou de literal passa", () => {
    expect(
      verificar(`-- antes era DROP TABLE velha; agora só adiciona
/* ALTER TABLE t RENAME COLUMN a TO b; */
COMMENT ON TABLE t IS 'não use DROP TABLE nem SET NOT NULL aqui; it''s RENAME-free';
`),
    ).toEqual([]);
  });

  it.each([
    ["aspa solta em $$…$$", "COMMENT ON TABLE t IS $$it's$$;\nDROP TABLE x;\nSELECT 'a';\n"],
    ["aspa solta em $tag$…$tag$", "COMMENT ON TABLE t IS $c$it's$c$;\nDROP TABLE x;\nSELECT 'a';\n"],
    ["E'…' com \\'", "SELECT E'a\\'b';\nDROP TABLE x;\nSELECT 'c';\n"],
    ['identificador "a--b"', 'CREATE TABLE "a--b" (id int);\nDROP TABLE x;\n'],
    ["/* aninhado */", "/* a /* b */ c */\nDROP TABLE x;\n"],
  ])("literal ou comentário não esconde o SQL depois dele: %s", (_, sql) => {
    expect(verificar(sql)).toEqual([{ arquivo: "0059_x.sql", linha: 2, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  it("corpo de DO $$…$$ é código e é verificado; literal dentro dele não", () => {
    expect(verificar("DO $$ BEGIN\n  RAISE NOTICE 'DROP TABLE y';\n  ALTER TABLE t DROP COLUMN c;\nEND $$;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 3, comando: "DROP COLUMN", motivo: "destrutiva" },
    ]);
  });

  it("tabela chamada type não é ALTER … TYPE; DROP IF EXISTS sem COLUMN barra", () => {
    expect(verificar('ALTER TABLE type ADD COLUMN a int;\nALTER TABLE "rename" ADD COLUMN b int;\n')).toEqual([]);
    expect(verificar("ALTER TABLE t DROP IF EXISTS c;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 1, comando: "DROP COLUMN", motivo: "destrutiva" },
    ]);
  });

  it("a marca não cobre a instrução seguinte na mesma linha; cobre a cláusula logo abaixo", () => {
    expect(verificar("-- destrutiva-ok: m\nDROP TABLE a; DROP TABLE b;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 2, comando: "DROP TABLE", motivo: "destrutiva" },
    ]);
    expect(verificar("ALTER TABLE t\n  ADD COLUMN n int,\n  -- destrutiva-ok: coluna morta\n  DROP COLUMN v;\n")).toEqual([]);
  });

  it("exceção com motivo passa; sem motivo falha", () => {
    const comMotivo = "-- destrutiva-ok: coluna nunca lida desde a 0040 (NOD-999)\nALTER TABLE t DROP COLUMN velha;\n";
    expect(verificar(comMotivo)).toEqual([]);
    // Marca antes da instrução de várias linhas também vale.
    expect(verificar("-- destrutiva-ok: tipo só alarga\nALTER TABLE t\n  ALTER COLUMN a TYPE bigint;\n")).toEqual([]);
    expect(verificar("-- destrutiva-ok:   \nALTER TABLE t DROP COLUMN velha;\n")).toEqual([
      { arquivo: "0059_x.sql", linha: 2, comando: "DROP COLUMN", motivo: "excecao_sem_motivo" },
    ]);
    // A marca vale só para o comando seguinte, não para o arquivo.
    expect(verificar(`${comMotivo}DROP TABLE outra;\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 3, comando: "DROP TABLE", motivo: "destrutiva" }]);
  });

  describe("QA (NOD-186): furos achados na sonda", () => {
    it.each([
      ["coluna chamada type, sem COLUMN", "ALTER TABLE t ALTER type TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["coluna chamada index, sem COLUMN", "ALTER TABLE public.t ALTER index SET DATA TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["coluna chamada type, com COLUMN", "ALTER TABLE t ALTER COLUMN type TYPE bigint;", "ALTER COLUMN … TYPE"],
      ["ALTER FOREIGN TABLE", "ALTER FOREIGN TABLE t DROP COLUMN c;", "DROP COLUMN"],
      ["EXECUTE com literal em DO", "DO $$ BEGIN EXECUTE 'DROP TABLE x'; END $$;", "DROP TABLE"],
      ["EXECUTE format(…) em DO", "DO $$ BEGIN EXECUTE format('ALTER TABLE %I DROP COLUMN c', 't'); END $$;", "DROP COLUMN"],
    ] as const)("barra %s", (_, sql, comando) => {
      expect(verificar(`${sql}\n`)).toEqual([{ arquivo: "0059_x.sql", linha: 1, comando, motivo: "destrutiva" }]);
    });

    it("objeto chamado type continua sem falso positivo", () => {
      expect(verificar("ALTER TYPE type ADD VALUE 'x';\nALTER DOMAIN type SET DEFAULT 1;\nALTER TABLE type ADD COLUMN a int;\n")).toEqual([]);
    });

    it("marca de exceção comentada em /* */ ou dentro de literal não vale", () => {
      const barrado = [{ arquivo: "0059_x.sql", linha: 4, comando: "DROP TABLE", motivo: "destrutiva" }];
      expect(verificar("/*\n-- destrutiva-ok: m\n*/\nDROP TABLE a;\n")).toEqual(barrado);
      expect(verificar("SELECT '\n-- destrutiva-ok: m\n';\nDROP TABLE a;\n")).toEqual(barrado);
    });

    it("marca de exceção vale em arquivo com CRLF", () => {
      expect(verificar("-- destrutiva-ok: tabela morta (NOD-999)\r\nDROP TABLE a;\r\n")).toEqual([]);
    });
  });

  it(`arquivo com prefixo ≤ ${BASE_ADITIVA} é ignorado; acima, verificado`, async () => {
    expect(ehNova("0058_limite_do_plano.sql")).toBe(false);
    expect(ehNova("0059_nova.sql")).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), "nod-186-"));
    try {
      await writeFile(join(dir, "0058_antiga.sql"), "DROP TABLE antiga;\n");
      await writeFile(join(dir, "0059_nova.sql"), "ALTER TABLE t RENAME TO u;\n");
      const r = await verificarPasta(dir);
      expect(r.verificadas).toEqual(["0059_nova.sql"]);
      expect(r.problemas).toEqual([{ arquivo: "0059_nova.sql", linha: 1, comando: "RENAME", motivo: "destrutiva" }]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("o repositório real passa, e sem o corte as duas antigas conhecidas seriam barradas", async () => {
    expect((await verificarPasta(MIGRACOES)).problemas).toEqual([]);
    const todas = (await verificarPasta(MIGRACOES, 0)).problemas.map((p) => `${p.arquivo}:${p.linha} ${p.comando}`);
    expect(todas).toEqual(["0003_decisora_escreve.sql:114 ALTER COLUMN … TYPE", "0046_codigo_dado_pessoal.sql:11 RENAME"]);
  });

  it("semComentarios preserva posições e quebras de linha", () => {
    const sql = "a -- x\n/* y\nz */ 'q''r' b";
    const limpo = semComentarios(sql);
    expect(limpo).toHaveLength(sql.length);
    expect(limpo.split("\n")).toHaveLength(3);
    expect(limpo.replace(/\s+/g, "")).toBe("a''b");
  });
});
