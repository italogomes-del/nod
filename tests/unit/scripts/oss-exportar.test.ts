import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  comACaixaDe,
  exportar,
  limpo,
  planejarExport,
  publicar,
  reescreverPackageJson,
  TITULAR_PENDENTE,
  validarManifesto,
  varrerProibidos,
  type Entrada,
  type Manifesto,
} from "../../../scripts/oss/exportar.mjs";

/**
 * ADA-282: o export do snapshot público (scripts/oss/exportar.mjs). Prova sem rede e sem o repo público: o manifesto
 * aplicado (exclusão, reescrita, package.json, links), a varredura barrando segredo e dado proibido plantados, o export
 * determinístico e o push só com a flag certa, para um repo bare local, como UM commit por export (histórico zerado).
 */
const RAIZ = join(import.meta.dirname, "../../..");
const SCRIPT = join(RAIZ, "scripts/oss/exportar.mjs");
const tmp = mkdtempSync(join(tmpdir(), "oss-exportar-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const TEM_GITLEAKS = spawnSync(process.env.GITLEAKS ?? "gitleaks", ["version"]).status === 0;
// Um PAT do GitHub com cara de real, montado na hora para o próprio repo não carregar um segredo plantado.
const patPlantado = () => "ghp" + "_" + randomBytes(27).toString("base64").replace(/[^A-Za-z0-9]/g, "a").slice(0, 36);
const TENANT_FALSO = "dead" + "beef-0000-4000-8000-000000000001";

const base = (extra: Partial<Manifesto> = {}): Manifesto => ({ versao: 1, repoPublico: "dono/publico", excluir: [], ...extra });
const ent = (caminho: string, conteudo: string | Buffer, modo = "100644", tipo = "blob"): Entrada => ({
  caminho,
  modo,
  tipo,
  conteudo: Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo),
});

describe("manifesto", () => {
  it("o manifesto real valida e cobre a tabela do que fica fechado", () => {
    const m = validarManifesto(JSON.parse(readFileSync(join(RAIZ, "oss/manifesto.json"), "utf8")));
    for (const g of ["infra/gcp/**", "fechado/**", ".github/workflows/deploy.yml", ".github/workflows/ensaio-restauracao.yml", "docs/auditoria-2026-10-15/**", "docs/planos/**", "oss/**", "docs/open-source/**", "tests/unit/infra/**"]) {
      expect(m.excluir, g).toContain(g);
    }
    const motivos = (m.proibidos ?? []).map((p) => p.motivo);
    expect(motivos).toEqual(expect.arrayContaining(["tenant de produção do Marlon", "projeto GCP de produção", "e-mail real do Marlon", "bot interno da esteira"]));
    expect(m.packageJson?.remover).toContain("private");
  });

  // Regression: QA do PR #717, nome real colado num identificador (cLeapy, leapyCorporativa, Ingridd) escapava o \b
  // da reescrita e do proibido e ia para o snapshot.
  it("o manifesto real reescreve e barra o nome real colado num identificador", () => {
    const m = validarManifesto(JSON.parse(readFileSync(join(RAIZ, "oss/manifesto.json"), "utf8")));
    const p = planejarExport([ent("a.ts", "const cLeapy = 1; o.leapyCorporativa; LEAPYX; 'para Ingridd'; xumbregaBot; EngNodX; cTarsila")], m);
    expect(p.arquivos.get("a.ts")!.conteudo.toString()).not.toMatch(/leapy|ingrid|xumbrega|tarsila|engnod/i);
    const colados = new Map([["b.ts", { modo: "100644", conteudo: Buffer.from("cLeapy leapyCorporativa Ingridd xumbregaBot EngNodX cTarsila") }]]);
    expect(varrerProibidos(colados, m).map((a) => a.trecho)).toEqual(["Leapy", "leapy", "Ingrid", "xumbrega", "EngNod", "Tarsila"]);
  });

  it("recusa manifesto malformado dizendo a chave", () => {
    expect(() => validarManifesto({ versao: 2, repoPublico: "x", excluir: "a" })).toThrow(/versao[\s\S]*repoPublico[\s\S]*excluir/);
    expect(() => validarManifesto(base({ reescrever: [{ de: "a", regex: "b", para: "c" }] }))).toThrow(/"de" OU "regex"/);
    expect(() => validarManifesto(base({ proibidos: [{ regex: "(", motivo: "x" }] }))).toThrow(/regex inválida/);
    expect(() => validarManifesto(base({ proibidos: [{ padrao: "x", motivo: "" }] }))).toThrow(/motivo/);
    expect(() => validarManifesto(base({ aceitos: [{ arquivos: [], proibido: "x", porque: "" }] }))).toThrow(/aceitos\[0\]/);
  });
});

describe("planejarExport", () => {
  it("exclui por glob (arquivo e pasta) e avisa o glob que não casa nada", () => {
    const m = base({ excluir: ["infra/gcp/**", "docs/plano-*", "segredo.env", "sumiu/**"] });
    const p = planejarExport([ent("infra/gcp/config.env", "x"), ent("infra/postgres/a.sql", "y"), ent("docs/plano-x.md", "z"), ent("docs/adr/a.md", "w"), ent("segredo.env", "s")], m);
    expect([...p.arquivos.keys()].sort()).toEqual(["docs/adr/a.md", "infra/postgres/a.sql"]);
    expect(p.excluidos.sort()).toEqual(["docs/plano-x.md", "infra/gcp/config.env", "segredo.env"]);
    expect(p.avisos).toEqual(["exclusão que não casa nada (sumiu do repo?): sumiu/**"]);
  });

  it("reescreve texto (literal e regex, com escopo) e não toca binário", () => {
    const m = base({
      reescrever: [
        { de: "marlon@x.com", para: "pessoa@exemplo.com" },
        { regex: "\\bAcme\\b", para: "Lumen" },
        { arquivos: ["tests/**"], de: "Bot", para: "Robo" },
        { de: "nunca", para: "x" },
      ],
    });
    const bin = Buffer.concat([Buffer.from("marlon@x.com"), Buffer.from([0, 1, 2])]);
    const p = planejarExport([ent("a.ts", "oi marlon@x.com da Acme, AcmeX e Bot"), ent("tests/b.ts", "Bot"), ent("img.png", bin)], m);
    expect(p.arquivos.get("a.ts")!.conteudo.toString()).toBe("oi pessoa@exemplo.com da Lumen, AcmeX e Bot");
    expect(p.arquivos.get("tests/b.ts")!.conteudo.toString()).toBe("Robo");
    expect(p.arquivos.get("img.png")!.conteudo.equals(bin)).toBe(true);
    expect(p.avisos).toContain("reescrita que não casa nada: nunca");
  });

  it("reescrita sem caixa pega o e-mail em qualquer caixa e devolve na caixa do original", () => {
    const m = base({ reescrever: [{ de: "marlon@acme.com", para: "pessoa@exemplo.com", caixa: "preservar" }, { regex: "\\bacme\\b", para: "lumen", caixa: "preservar" }] });
    const p = planejarExport([ent("a.ts", "Marlon@Acme.com | MARLON@ACME.COM | marlon@acme.com | ACME Acme acme")], m);
    expect(p.arquivos.get("a.ts")!.conteudo.toString()).toBe("Pessoa@exemplo.com | PESSOA@EXEMPLO.COM | pessoa@exemplo.com | LUMEN Lumen lumen");
    expect(comACaixaDe("X", "lumen")).toBe("Lumen");
    expect(() => validarManifesto(base({ reescrever: [{ de: "a", para: "b", caixa: "x" as "preservar" }] }))).toThrow(/caixa só aceita/);
  });

  it("remove link simbólico para fora do repo ou para arquivo excluído e ignora submódulo", () => {
    const m = base({ excluir: ["privado/**"] });
    const p = planejarExport(
      [ent("privado/a", "x"), ent("ok", "b", "120000"), ent("b", "y"), ent("fora", "../../etc/passwd", "120000"), ent("abs", "/etc/passwd", "120000"), ent("pr", "privado/a", "120000"), ent("sub", "", "160000", "commit")],
      m,
    );
    expect([...p.arquivos.keys()].sort()).toEqual(["b", "ok"]);
    expect(p.avisos.sort()).toEqual([
      "link simbólico para arquivo excluído removido: pr → privado/a",
      "link simbólico para fora do repo removido: abs → /etc/passwd",
      "link simbólico para fora do repo removido: fora → ../../etc/passwd",
      "submódulo ignorado (o snapshot não carrega submódulos): sub",
    ]);
  });

  it("os extras (oss/publico) entram na raiz e ganham do arquivo do mesmo nome", () => {
    const p = planejarExport([ent("README.md", "interno")], base(), [{ caminho: "README.md", conteudo: Buffer.from("público") }, { caminho: "LICENSE", conteudo: Buffer.from("Apache") }]);
    expect(p.arquivos.get("README.md")!.conteudo.toString()).toBe("público");
    expect(p.arquivos.get("LICENSE")!.conteudo.toString()).toBe("Apache");
  });

  it("package.json: tira o private, põe a licença e remove os scripts que apontam para arquivo excluído (em cascata)", () => {
    const pkg = {
      name: "nod",
      private: true,
      scripts: { dev: "node scripts/dev.mjs", "db:backup": "bash scripts/backup-local.sh", tudo: "npm run dev && npm run db:backup", extra: "x", ok: "npm run dev" },
    };
    const { json, removidos } = reescreverPackageJson(pkg, { remover: ["private"], definir: { license: "Apache-2.0" }, removerScripts: ["extra"] }, ["scripts/backup-local.sh"]);
    expect(json.private).toBeUndefined();
    expect(json.license).toBe("Apache-2.0");
    expect(Object.keys(json.scripts!)).toEqual(["dev", "ok"]);
    expect(removidos.sort()).toEqual(["db:backup", "extra", "tudo"]);
  });
});

describe("varrerProibidos", () => {
  const m = base({
    proibidos: [
      { padrao: "deadbeef-", motivo: "tenant" },
      { regex: "\\bLeapy\\b", motivo: "cliente" },
    ],
    aceitos: [{ arquivos: ["src/db/migrations/**"], proibido: "tenant", porque: "migração aplicada" }],
  });
  const arqs = (o: Record<string, string | Buffer>) => new Map(Object.entries(o).map(([k, v]) => [k, { modo: "100644", conteudo: Buffer.isBuffer(v) ? v : Buffer.from(v) }]));

  it("acha o padrão com arquivo e linha, inclusive dentro de binário, sem case no literal", () => {
    const achados = varrerProibidos(arqs({ "a.ts": "x\ny DEADBEEF-1", "b.png": Buffer.concat([Buffer.from([0]), Buffer.from("Leapy")]), "c.ts": "leapy minúsculo não casa a regex" }), m);
    expect(achados).toEqual([
      { arquivo: "a.ts", linha: 2, motivo: "tenant", trecho: "DEADBEEF-" },
      { arquivo: "b.png", linha: 0, motivo: "cliente", trecho: "Leapy" },
    ]);
  });

  it("imagem fora da lista revisada é achado (uma captura nova pode ter dado real)", () => {
    const mi = base({ imagensRevisadas: ["web/icons/*.png"] });
    const achados = varrerProibidos(arqs({ "web/icons/a.png": "x", "docs/print.PNG": "x", "docs/video.mp4": "x", "a.ts": "png" }), mi);
    expect(achados.map((a) => a.arquivo)).toEqual(["docs/print.PNG", "docs/video.mp4"]);
    expect(achados[0]!.motivo).toMatch(/imagem fora da lista revisada/);
  });

  it("o aceito vale só para o proibido e os arquivos que ele cita", () => {
    const achados = varrerProibidos(arqs({ "src/db/migrations/0001.sql": "deadbeef- e Leapy", "src/db/seed.ts": "deadbeef-" }), m);
    expect(achados.map((a) => `${a.arquivo}:${a.motivo}`)).toEqual(["src/db/migrations/0001.sql:cliente", "src/db/seed.ts:tenant"]);
  });
});

// ---------------------------------------------------------------- de ponta a ponta, num repo git de mentira

function g(repo: string, ...args: string[]) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function repoDeMentira(nome: string, arquivos: Record<string, string>, manifesto: Partial<Manifesto> = {}) {
  const repo = join(tmp, nome);
  mkdirSync(repo, { recursive: true });
  g(repo, "init", "-q", "-b", "main");
  const tudo: Record<string, string> = {
    "oss/manifesto.json": JSON.stringify(
      base({
        repoPublico: "dono/publico",
        raizPublica: "oss/publico",
        excluir: ["oss/**", "infra/gcp/**"],
        reescrever: [{ de: "marlon@empresa.com", para: "pessoa@exemplo.com" }],
        packageJson: { remover: ["private"], definir: { license: "Apache-2.0" } },
        proibidos: [{ padrao: "deadbeef-", motivo: "tenant de produção" }],
        ...manifesto,
      }),
    ),
    "oss/publico/LICENSE": "Apache License 2.0\n",
    "oss/publico/NOTICE": "Copyright 2026 Fulano\n",
    "package.json": JSON.stringify({ name: "x", private: true, scripts: { deploy: "bash infra/gcp/deploy.sh" } }),
    "src/a.ts": "export const dono = 'marlon@empresa.com';\n",
    "infra/gcp/deploy.sh": "#!/bin/sh\necho prod\n",
    "bin/rodar.sh": "#!/bin/sh\necho oi\n",
    ...arquivos,
  };
  for (const [c, v] of Object.entries(tudo)) {
    mkdirSync(dirname(join(repo, c)), { recursive: true });
    writeFileSync(join(repo, c), v);
  }
  chmodSync(join(repo, "bin/rodar.sh"), 0o755);
  symlinkSync("a.ts", join(repo, "src/atalho.ts"));
  g(repo, "add", "-A");
  g(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c1");
  return repo;
}

describe("exportar (repo de mentira)", () => {
  it("aplica o manifesto no disco: exclui, reescreve, mantém modo e link, põe a LICENSE e não leva o manifesto", () => {
    const repo = repoDeMentira("disco", {});
    const saida = join(tmp, "disco-saida");
    const r = exportar({ repo, saida, gitleaks: false });
    expect(existsSync(join(saida, "infra"))).toBe(false);
    expect(existsSync(join(saida, "oss"))).toBe(false);
    expect(readFileSync(join(saida, "src/a.ts"), "utf8")).toContain("pessoa@exemplo.com");
    expect(lstatSync(join(saida, "bin/rodar.sh")).mode & 0o111).not.toBe(0);
    expect(readlinkSync(join(saida, "src/atalho.ts"))).toBe("a.ts");
    expect(readFileSync(join(saida, "LICENSE"), "utf8")).toContain("Apache License 2.0");
    const pkg = JSON.parse(readFileSync(join(saida, "package.json"), "utf8"));
    expect(pkg).toEqual({ name: "x", scripts: {}, license: "Apache-2.0" });
    expect(r.avisos).toContain("script do package.json removido (aponta para arquivo excluído): deploy");
    expect(limpo(r)).toBe(true);
  });

  it("só o que está commitado entra (a árvore de trabalho suja não vaza) e o export é determinístico", () => {
    const repo = repoDeMentira("determinismo", {});
    writeFileSync(join(repo, "src/rascunho.ts"), "deadbeef-");
    writeFileSync(join(repo, "src/a.ts"), "mudado sem commit");
    const r1 = exportar({ repo, saida: join(tmp, "det-1"), gitleaks: false });
    const r2 = exportar({ repo, saida: join(tmp, "det-2"), gitleaks: false });
    expect(r1.hash).toBe(r2.hash);
    expect(r1.arquivos.has("src/rascunho.ts")).toBe(false);
    expect(readFileSync(join(tmp, "det-1/src/a.ts"), "utf8")).toContain("pessoa@exemplo.com");
    expect(limpo(r1)).toBe(true);
  });

  it("a varredura barra o dado proibido plantado", () => {
    const repo = repoDeMentira("proibido", { "tests/fixture.ts": `const t = "${TENANT_FALSO}";\n` });
    const r = exportar({ repo, saida: join(tmp, "proibido-saida"), gitleaks: false });
    expect(r.proibidos).toEqual([{ arquivo: "tests/fixture.ts", linha: 1, motivo: "tenant de produção", trecho: "deadbeef-" }]);
    expect(limpo(r)).toBe(false);
  });

  it.skipIf(!TEM_GITLEAKS)("o gitleaks barra o segredo plantado no snapshot (e a mesma árvore sem ele passa)", () => {
    const comSegredo = repoDeMentira("segredo", { "src/config.ts": `export const token = "${patPlantado()}";\n` });
    const r = exportar({ repo: comSegredo, saida: join(tmp, "segredo-saida") });
    expect(r.gitleaks).toEqual([expect.objectContaining({ arquivo: "src/config.ts", linha: 1 })]);
    expect(limpo(r)).toBe(false);
    const semSegredo = repoDeMentira("sem-segredo", {});
    expect(exportar({ repo: semSegredo, saida: join(tmp, "sem-segredo-saida") }).gitleaks).toEqual([]);
  });

  it("sem o gitleaks instalado a varredura não passa como limpa", () => {
    const repo = repoDeMentira("sem-gitleaks", {});
    const antes = process.env.GITLEAKS;
    process.env.GITLEAKS = "/nao/existe/gitleaks";
    try {
      const r = exportar({ repo, saida: join(tmp, "sem-gitleaks-saida") });
      expect(r.gitleaks).toBeNull();
      expect(limpo(r)).toBe(false);
      expect(r.pendencias).toContain("gitleaks não está instalado: a varredura de segredos não rodou");
    } finally {
      if (antes === undefined) delete process.env.GITLEAKS;
      else process.env.GITLEAKS = antes;
    }
  });

  it("recusa --saida com conteúdo", () => {
    const repo = repoDeMentira("saida-cheia", {});
    const saida = join(tmp, "saida-cheia-dir");
    mkdirSync(saida);
    writeFileSync(join(saida, "x"), "y");
    expect(() => exportar({ repo, saida, gitleaks: false })).toThrow(/precisa estar vazia/);
  });
});

describe("publicar (push só com flag explícita)", () => {
  const bare = () => {
    const b = join(tmp, `bare-${randomBytes(4).toString("hex")}`);
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", b]);
    return b;
  };
  const semGitleaks = (r: ReturnType<typeof exportar>) => ({ ...r, gitleaks: [] }); // a varredura de segredo tem teste próprio

  it("recusa repo diferente do manifesto, varredura com achado, titular pendente e privado sujo, sem tocar o remoto", () => {
    const b = bare();
    const repo = repoDeMentira("recusas", { "oss/publico/NOTICE": `Copyright 2026 ${TITULAR_PENDENTE}\n`, "x.ts": "deadbeef-" });
    writeFileSync(join(repo, "sujo.txt"), "x");
    const r = semGitleaks(exportar({ repo, saida: join(tmp, "recusas-saida"), gitleaks: false }));
    expect(() => publicar(r, { repoPedido: "outro/repo", repo, remoto: b })).toThrow(
      /não é o repo do manifesto \(dono\/publico\)[\s\S]*varredura tem achados[\s\S]*NOTICE com o titular a definir[\s\S]*alteração por commitar/,
    );
    expect(() => publicar(r, { repoPedido: "", repo, remoto: b })).toThrow(/--push=\(vazio\)/);
    expect(spawnSync("git", ["-C", b, "rev-parse", "main"]).status).not.toBe(0);
  });

  it("publica UM commit por export, sem o histórico do privado e só com a árvore do snapshot", () => {
    const b = bare();
    const repo = repoDeMentira("publica", {});
    g(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c2 privado");
    const r1 = semGitleaks(exportar({ repo, saida: join(tmp, "publica-1"), gitleaks: false }));
    const c1 = publicar(r1, { repoPedido: "dono/publico", repo, remoto: b });
    expect(g(b, "rev-list", "--count", "main")).toBe("1");
    expect(g(b, "log", "-1", "--format=%s", "main")).toBe(`Export de gamefik/nod@${r1.sha.slice(0, 12)}`);
    const arvore = g(b, "ls-tree", "-r", "--name-only", "main").split("\n").sort();
    expect(arvore).toEqual(["LICENSE", "NOTICE", "bin/rodar.sh", "package.json", "src/a.ts", "src/atalho.ts"]);

    writeFileSync(join(repo, "src/b.ts"), "export {};\n");
    g(repo, "add", "-A");
    g(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c3");
    const r2 = semGitleaks(exportar({ repo, saida: join(tmp, "publica-2"), gitleaks: false }));
    const c2 = publicar(r2, { repoPedido: "dono/publico", repo, remoto: b });
    expect(g(b, "rev-list", "--count", "main")).toBe("2");
    expect(g(b, "rev-parse", `${c2}^`)).toBe(c1);
    expect(g(b, "show", "--name-status", "--format=", "main")).toBe("A\tsrc/b.ts");
  });
});

// ---------------------------------------------------------------- revisão do PR #717: vazamentos que passavam

describe("revisão: o que passava pela barreira", () => {
  const arqs = (o: Record<string, string | Buffer>) => new Map(Object.entries(o).map(([k, v]) => [k, { modo: "100644", conteudo: Buffer.isBuffer(v) ? v : Buffer.from(v) }]));
  const bare = () => {
    const b = join(tmp, `bare-rev-${randomBytes(4).toString("hex")}`);
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", b]);
    return b;
  };

  it("a exclusão por pasta pega arquivo e pasta com ponto (fechado/.env)", () => {
    const p = planejarExport([ent("fechado/.env", "x"), ent("fechado/.cfg/a", "y"), ent("docs/planos/.rascunho.md", "z"), ent("a.ts", "w")], base({ excluir: ["fechado/**", "docs/planos/**"] }));
    expect([...p.arquivos.keys()]).toEqual(["a.ts"]);
  });

  it("link simbólico para o pai (..), para pasta excluída e o que vem de oss/publico também saem", () => {
    const p = planejarExport(
      [ent("oss/x", "y"), ent("l1", "..", "120000"), ent("sub/l2", "../..", "120000"), ent("l3", "oss", "120000"), ent("ok", "a.ts", "120000"), ent("a.ts", "z")],
      base({ excluir: ["oss/**"] }),
      [{ caminho: "mau", modo: "120000", conteudo: Buffer.from("../../.env") }],
    );
    expect([...p.arquivos.keys()].sort()).toEqual(["a.ts", "ok"]);
  });

  it("o nome do arquivo também é varrido", () => {
    const m = base({ proibidos: [{ regex: "\\bleapy\\b", flags: "i", motivo: "cliente" }] });
    expect(varrerProibidos(arqs({ "docs/Leapy-contrato.md": "nada" }), m)).toEqual([{ arquivo: "docs/Leapy-contrato.md", linha: 0, motivo: "cliente", trecho: "Leapy" }]);
  });

  it("binário que não é imagem (pdf, banco) fora da lista revisada é achado, e UTF-16 dentro de binário revisado é varrido", () => {
    const m = base({ imagensRevisadas: ["web/icons/*.png"], proibidos: [{ regex: "\\bLeapy\\b", motivo: "cliente" }] });
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 1])]);
    const utf16 = Buffer.concat([Buffer.from([0x89, 0x50, 0]), Buffer.from(" Leapy ", "utf16le")]);
    const achados = varrerProibidos(arqs({ "docs/contrato.pdf": pdf, "dados.bin": pdf, "web/icons/a.png": utf16, "a.ts": "ok" }), m);
    expect(achados.map((a) => `${a.arquivo}:${a.motivo}`).sort()).toEqual([
      "dados.bin:binário ou imagem fora da lista revisada (imagensRevisadas)",
      "docs/contrato.pdf:binário ou imagem fora da lista revisada (imagensRevisadas)",
      "web/icons/a.png:cliente",
    ]);
  });

  it.skipIf(!TEM_GITLEAKS)("gitleaks:allow e .gitleaksignore no snapshot não silenciam o segredo", () => {
    const comAllow = repoDeMentira("allow", { "src/config.ts": `export const token = "${patPlantado()}"; // gitleaks:allow\n` });
    expect(exportar({ repo: comAllow, saida: join(tmp, "allow-saida") }).gitleaks).toHaveLength(1);
    const saida = join(tmp, "ignore-saida");
    const comIgnore = repoDeMentira("ignore", {
      "src/config.ts": `export const token = "${patPlantado()}";\n`,
      ".gitleaksignore": `${saida}/src/config.ts:github-pat:1\nsrc/config.ts:github-pat:1\n`,
    });
    expect(limpo(exportar({ repo: comIgnore, saida }))).toBe(false);
  });

  it("qualquer <... A DEFINIR> nos arquivos públicos é pendência e barra o push", () => {
    const b = bare();
    const repo = repoDeMentira("placeholder", { "oss/publico/NOTICE": "Copyright 2026 Fulano\nContato de segurança: <A DEFINIR>\n" });
    const r = { ...exportar({ repo, saida: join(tmp, "placeholder-saida"), gitleaks: false }), gitleaks: [] };
    expect(r.pendencias.join("\n")).toMatch(/NOTICE[\s\S]*<A DEFINIR>/);
    expect(() => publicar(r, { repoPedido: "dono/publico", repo, remoto: b })).toThrow(/push recusado/);
  });

  it("NOD_OSS_REMOTO no ambiente não desvia o push (só o parâmetro dos testes troca o remoto)", () => {
    const b = bare();
    const repo = repoDeMentira("env-remoto", {});
    const r = { ...exportar({ repo, saida: join(tmp, "env-remoto-saida"), gitleaks: false }), gitleaks: [] };
    const antes = { remoto: process.env.NOD_OSS_REMOTO, proto: process.env.GIT_ALLOW_PROTOCOL };
    process.env.NOD_OSS_REMOTO = b;
    process.env.GIT_ALLOW_PROTOCOL = "file"; // o https do github.com é recusado pelo git: nada sai da máquina
    try {
      expect(() => publicar(r, { repoPedido: "dono/publico", repo })).toThrow();
    } finally {
      for (const [k, v] of [["NOD_OSS_REMOTO", antes.remoto], ["GIT_ALLOW_PROTOCOL", antes.proto]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(spawnSync("git", ["-C", b, "rev-parse", "main"]).status).not.toBe(0);
  });

  it("o commit público leva o snapshot inteiro, mesmo arquivo que um .gitignore do snapshot ignoraria", () => {
    const b = bare();
    const repo = repoDeMentira("ignorado", { ".gitignore": "gerado.txt\n" });
    writeFileSync(join(repo, "gerado.txt"), "versionado de propósito\n");
    g(repo, "add", "-f", "gerado.txt");
    g(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c2");
    const r = { ...exportar({ repo, saida: join(tmp, "ignorado-saida"), gitleaks: false }), gitleaks: [] };
    publicar(r, { repoPedido: "dono/publico", repo, remoto: b });
    expect(g(b, "ls-tree", "-r", "--name-only", "main").split("\n")).toContain("gerado.txt");
  });
});

describe("CLI", () => {
  const cli = (repo: string, ...args: string[]) => spawnSync("node", [SCRIPT, "--repo", repo, ...args], { encoding: "utf8", env: { ...process.env, GITLEAKS: "/nao/existe" } });

  it("sai 2 com argumento desconhecido e não publica sem --push", () => {
    const r = spawnSync("node", [SCRIPT, "--publicar"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("argumento desconhecido: --publicar");
  });

  it("sai 1 quando a varredura não fecha (aqui, sem gitleaks), imprime o resumo e recusa o push", () => {
    const repo = repoDeMentira("cli", {});
    const r = cli(repo, "--json", "--saida", join(tmp, "cli-saida"));
    expect(r.status).toBe(1);
    const resumo = JSON.parse(r.stdout);
    expect(resumo.limpo).toBe(false);
    expect(resumo.gitleaks).toBeNull();
    expect(resumo.pendencias).toContain("gitleaks não está instalado: a varredura de segredos não rodou");
    const push = cli(repo, "--saida", join(tmp, "cli-push"), "--push=dono/publico");
    expect(push.status).toBe(1);
    expect(push.stderr).toMatch(/push recusado[\s\S]*varredura tem achados/);
  });
});
