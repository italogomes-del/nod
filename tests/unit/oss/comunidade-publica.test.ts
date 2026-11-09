import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { extrairPassos } from "../../../scripts/oss/seguir-readme.mjs";

/**
 * ADA-287: os arquivos de comunidade do repositório público moram em oss/publico/ e o export da ADA-282 os copia por
 * cima da raiz. Este teste guarda o contrato: os arquivos existem, o README tem o roteiro que o seguir-readme roda,
 * os links relativos apontam para algo que vai existir no público e nenhum texto carrega dado interno.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const PUBLICO = join(RAIZ, "oss/publico");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}
const publicos = arquivos(PUBLICO);
const ler = (rel: string) => readFileSync(join(PUBLICO, rel), "utf8");
const README = ler("README.md");

/** A licença que o núcleo NÃO usa. Montada por código para a própria sigla não aparecer em nenhum arquivo do PR. */
const OUTRA_LICENCA = new RegExp(`\\b${String.fromCharCode(70, 83, 76)}\\b|${["Functional", "Source"].join(" ")}`, "i");

/** Arquivos que o export da ADA-282 põe na raiz do público e que não estão em oss/publico nem na raiz daqui. */
const DO_EXPORT = new Set(["LICENSE", "LICENSING.md"]);

describe("comunidade do repo público (oss/publico)", () => {
  it.each([
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug.yml",
    ".github/ISSUE_TEMPLATE/ideia.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ])("tem %s", (rel) => {
    expect(existsSync(join(PUBLICO, rel))).toBe(true);
  });

  it("o README tem o roteiro de rodar local: clone, npm ci, .env do exemplo, banco, NOD_LOGIN=stub e /api/saude", () => {
    const passos = Object.fromEntries(extrairPassos(README).map((p) => [p.nome, p.comandos.join("\n")]));
    expect(passos.clonar).toMatch(/^git clone https:\/\/github\.com\/marlonwlv\/nod-oss\.git nod\ncd nod$/);
    expect(passos.instalar).toContain("npm ci");
    expect(passos.instalar).toContain("cp .env.example .env");
    expect(passos["banco-docker"]).toBe("npm run dev:setup");
    expect(passos["banco-proprio"]).toContain("infra/postgres/init/01_roles.sql");
    expect(passos.subir).toBe("NOD_LOGIN=stub npm run dev");
    expect(passos.conferir).toBe("curl -fsS http://127.0.0.1:8888/api/saude");
  });

  it("os scripts npm e os arquivos que o README cita existem neste repo", () => {
    const scripts = (JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const texto = publicos.map((f) => readFileSync(f, "utf8")).join("\n");
    const citados = [...new Set([...texto.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1]!))];
    expect(citados.length).toBeGreaterThan(3);
    for (const s of citados) expect(scripts, `npm run ${s}`).toHaveProperty(s);
    for (const f of [".env.example", ".mise.toml", "infra/postgres/init/01_roles.sql", "docker-compose.yml"]) expect(existsSync(join(RAIZ, f)), f).toBe(true);
    const env = readFileSync(join(RAIZ, ".env.example"), "utf8");
    expect(env).toMatch(/^NOD_LOGIN=stub$/m);
    expect(env).toMatch(/^NOD_EXECUTOR=catcher$/m);
    expect(env).toMatch(/^DATABASE_URL=postgres:\/\/nod_app:nod@127\.0\.0\.1:5434\/nod$/m);
  });

  it("todo link relativo aponta para um arquivo do público (oss/publico, a raiz daqui ou o que o export cria)", () => {
    for (const f of publicos.filter((x) => x.endsWith(".md"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const alvo = m[1]!;
        if (/^[a-z]+:/.test(alvo)) continue;
        const rel = relative(PUBLICO, join(dirname(f), alvo));
        const existe = existsSync(join(PUBLICO, rel)) || existsSync(join(RAIZ, rel)) || DO_EXPORT.has(rel);
        expect(existe, `${relative(RAIZ, f)} → ${alvo}`).toBe(true);
      }
    }
  });

  it("nenhum texto carrega dado interno: produção, e-mail pessoal, cliente ou bot da esteira", () => {
    const proibidos = [
      /172e1fdf/i,
      /gamefik/i,
      /nod-producao/i,
      /10\.183\./,
      /sslip\.io/i,
      /\bmarlon@|@gmail\.com|@leapy/i,
      /\b(leapy|lipe|doze contábil|ingrid)\b/i,
      /\b(xumbrega|engnod|tarsila)\b/i,
      /ghp_|sk-ant-|BEGIN [A-Z ]*PRIVATE KEY/,
    ];
    for (const f of publicos) {
      const texto = readFileSync(f, "utf8");
      for (const re of proibidos) expect(texto, `${relative(RAIZ, f)} casa ${re}`).not.toMatch(re);
      for (const [email] of texto.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/gi)) {
        expect(email, `${relative(RAIZ, f)}: e-mail ${email}`).toMatch(/@(nodbot\.ai|exemplo\.com)$|^seu@email/);
      }
    }
  });

  it("os templates de issue têm nome, descrição e corpo, e o config fecha issue em branco e manda segurança para o privado", () => {
    for (const t of ["bug.yml", "ideia.yml"]) {
      const y = ler(`.github/ISSUE_TEMPLATE/${t}`);
      expect(y).toMatch(/^name: \S/m);
      expect(y).toMatch(/^description: \S/m);
      expect(y).toMatch(/^body:\n/m);
      expect(y).toMatch(/required: true/);
    }
    const config = ler(".github/ISSUE_TEMPLATE/config.yml");
    expect(config).toMatch(/^blank_issues_enabled: false$/m);
    expect(config).toContain("https://github.com/marlonwlv/nod-oss/security/advisories/new");
  });

  it("SECURITY e conduta têm o canal de contato; CONTRIBUTING pede DCO (Signed-off-by), não CLA", () => {
    expect(ler("SECURITY.md")).toContain("seguranca@nodbot.ai");
    expect(ler("SECURITY.md")).toMatch(/não abra issue/i);
    expect(ler("CODE_OF_CONDUCT.md")).toContain("conduta@nodbot.ai");
    expect(ler("CONTRIBUTING.md")).toContain("Signed-off-by");
    expect(ler("CONTRIBUTING.md")).toContain("git commit -s");
    expect(ler(".github/pull_request_template.md")).toContain("Signed-off-by");
  });

  it("licença: o núcleo é Apache 2.0, aponta para LICENSE e LICENSING.md, e nenhum texto fala na outra licença", () => {
    expect(README).toContain("[Apache 2.0](LICENSE)");
    expect(README).toContain("[LICENSING.md](LICENSING.md)");
    expect(README).toMatch(/marca "nod"/);
    expect(ler("CONTRIBUTING.md")).toContain("[Apache 2.0](LICENSE)");
    for (const f of publicos) expect(readFileSync(f, "utf8"), relative(RAIZ, f)).not.toMatch(OUTRA_LICENCA);
  });

  it("a sigla da outra licença não aparece em nenhum arquivo da ADA-287 (nem nos testes e no script)", () => {
    const daTarefa = [...arquivos(PUBLICO), ...arquivos(join(RAIZ, "scripts/oss")), ...arquivos(join(RAIZ, "tests/unit/oss")), join(RAIZ, "site/index.html")];
    for (const f of daTarefa) expect(readFileSync(f, "utf8"), relative(RAIZ, f)).not.toMatch(OUTRA_LICENCA);
  });

  it("o README interno do gamefik/nod não é o público (ele continua sendo o de dentro)", () => {
    expect(readFileSync(join(RAIZ, "README.md"), "utf8")).not.toBe(README);
  });
});
