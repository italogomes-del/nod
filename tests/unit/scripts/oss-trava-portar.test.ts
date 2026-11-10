import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Manifesto } from "../../../scripts/oss/exportar.mjs";
import { aplicar, patchDoCommit } from "../../../scripts/oss/portar.mjs";
import { arquivosMudados, decidir, ROTULO } from "../../../scripts/oss/trava.mjs";
import { varrer } from "../../../scripts/oss/varrer.mjs";

/**
 * NOD-485 (ADR-161): o gamefik/nod congela. A trava reprova PR que mexe em caminho público; o portar leva ao público um
 * commit que ainda entrou aqui (com as reescritas do manifesto); o varrer confere um clone do público com a lista
 * interna de proibidos. Prova com repos git locais, sem rede.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const tmp = mkdtempSync(join(tmpdir(), "oss-trava-portar-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function g(repo: string, ...args: string[]) {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function escrever(repo: string, arquivos: Record<string, string>) {
  for (const [c, t] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(repo, c)), { recursive: true });
    writeFileSync(join(repo, c), t);
  }
}
const manifesto: Manifesto = {
  versao: 1,
  repoPublico: "dono/publico",
  raizPublica: "oss/publico",
  excluir: ["oss/**", "infra/gcp/**", ".github/workflows/deploy.yml"],
  reescrever: [{ de: "marlon@empresa.com", para: "pessoa@exemplo.com" }],
  proibidos: [{ padrao: "deadbeef-", motivo: "tenant de produção" }],
  travaPermitidos: [723],
};

describe("trava: PR no gamefik/nod que mexe em caminho público", () => {
  it("só caminho privado passa; caminho público trava e lista os arquivos", () => {
    expect(decidir({ arquivos: ["infra/gcp/vm/deploy.sh", ".github/workflows/deploy.yml", "oss/manifesto.json"], manifesto })).toMatchObject({ liberado: true, publicos: [] });
    const r = decidir({ arquivos: ["infra/gcp/config.env", "src/a.ts", "README.md"], manifesto, pr: 900 });
    expect(r).toMatchObject({ liberado: false, publicos: ["src/a.ts", "README.md"] });
  });

  it("os PRs abertos antes do corte e o rótulo de transição passam", () => {
    expect(decidir({ arquivos: ["src/a.ts"], manifesto, pr: 723 })).toMatchObject({ liberado: true, motivo: "PR #723 aberto antes do corte" });
    expect(decidir({ arquivos: ["src/a.ts"], manifesto, pr: 724, rotulos: ["bug", ROTULO] })).toMatchObject({ liberado: true });
    expect(decidir({ arquivos: ["src/a.ts"], manifesto, pr: 724, rotulos: ["transicao"] })).toMatchObject({ liberado: false });
  });

  it("arquivosMudados vê apagado e os dois lados de um rename", () => {
    const repo = join(tmp, "mudados");
    mkdirSync(repo);
    g(repo, "init", "-q", "-b", "main");
    escrever(repo, { "infra/gcp/x.sh": "a\n", "src/velho.ts": "export {};\n", "src/apagar.ts": "x\n" });
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "c1");
    const base = g(repo, "rev-parse", "HEAD");
    g(repo, "mv", "src/velho.ts", "infra/gcp/novo.ts");
    g(repo, "rm", "-q", "src/apagar.ts");
    g(repo, "commit", "-qm", "c2");
    const arquivos = arquivosMudados(repo, base);
    expect(arquivos.sort()).toEqual(["infra/gcp/novo.ts", "src/apagar.ts", "src/velho.ts"]);
    // Mover um arquivo público para caminho privado ainda mexe no público (o arquivo some de lá).
    expect(decidir({ arquivos, manifesto }).liberado).toBe(false);
  });

  it("o CLI lê o manifesto do BASE: o PR que afrouxa o manifesto (excluir ** ou o próprio número) segue travado", () => {
    const repo = join(tmp, "trava-base");
    mkdirSync(repo);
    g(repo, "init", "-q", "-b", "main");
    escrever(repo, { "oss/manifesto.json": JSON.stringify(manifesto), "src/a.ts": "export {};\n" });
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "c1");
    const base = g(repo, "rev-parse", "HEAD");
    escrever(repo, { "oss/manifesto.json": JSON.stringify({ ...manifesto, excluir: ["**"], travaPermitidos: [901] }), "src/a.ts": "export const x = 1;\n" });
    g(repo, "commit", "-qam", "afrouxa");
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(RAIZ, "scripts/oss/trava.mjs"), "--repo", repo, "--base", base, ...args], { encoding: "utf8" });
    const r = cli("--pr", "901");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("src/a.ts");
    expect(cli("--pr", "723").status).toBe(0);
    // Base sem travaPermitidos: a trava ainda não entrou na main (o PR que a cria) e libera.
    const semTrava = join(tmp, "trava-sem");
    mkdirSync(semTrava);
    g(semTrava, "init", "-q", "-b", "main");
    const { travaPermitidos: _t, ...antigo } = manifesto;
    escrever(semTrava, { "oss/manifesto.json": JSON.stringify(antigo), "src/a.ts": "export {};\n" });
    g(semTrava, "add", "-A");
    g(semTrava, "commit", "-qm", "c1");
    const b0 = g(semTrava, "rev-parse", "HEAD");
    escrever(semTrava, { "src/a.ts": "export const y = 2;\n" });
    g(semTrava, "commit", "-qam", "c2");
    const r0 = spawnSync(process.execPath, [join(RAIZ, "scripts/oss/trava.mjs"), "--repo", semTrava, "--base", b0], { encoding: "utf8" });
    expect(r0.status).toBe(0);
    expect(r0.stdout).toContain("ainda não está no base");
  });

  it("o manifesto real libera os 4 PRs abertos em 10/11 e o ci.yml roda a trava em PR", () => {
    const real = JSON.parse(readFileSync(join(RAIZ, "oss/manifesto.json"), "utf8")) as Manifesto;
    expect(real.travaPermitidos).toEqual([723, 725, 698, 677]);
    const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/^ {2}oss-trava:$/m);
    // O script roda a partir do base (worktree), não do PR: o PR não troca a regra que o julga.
    expect(ci).toContain('git worktree add --detach "$RUNNER_TEMP/base" "$BASE"');
    expect(ci).toContain('node "$T" --repo "$GITHUB_WORKSPACE" --base "$BASE" --head "$(git rev-parse HEAD)"');
  });
});

describe("portar: um merge do privado vira patch no público", () => {
  function privadoComDoisCommits() {
    const repo = join(tmp, "privado");
    mkdirSync(repo);
    g(repo, "init", "-q", "-b", "main");
    escrever(repo, {
      "oss/manifesto.json": JSON.stringify(manifesto),
      "oss/publico/LICENSE": "Apache\n",
      "src/a.ts": "export const a = 1;\n",
      "infra/gcp/config.env": "PROJETO=real\n",
    });
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "c1");
    escrever(repo, { "src/a.ts": "export const a = 2;\n", "src/novo.ts": "export const dono = 'marlon@empresa.com';\n", "infra/gcp/config.env": "PROJETO=outro\n" });
    g(repo, "add", "-A");
    g(repo, "commit", "-qm", "c2 (o merge de um PR antigo)");
    return repo;
  }
  function publicoDoPrimeiroCommit() {
    const pub = join(tmp, "publico");
    mkdirSync(pub);
    g(pub, "init", "-q", "-b", "main");
    escrever(pub, { LICENSE: "Apache\n", "src/a.ts": "export const a = 1;\n", "src/so-no-publico.ts": "export {};\n" });
    g(pub, "add", "-A");
    g(pub, "commit", "-qm", "export + um commit só do público");
    return pub;
  }

  it("leva só o que é público, já reescrito, e preserva o que só existe no público", () => {
    const repo = privadoComDoisCommits();
    const pub = publicoDoPrimeiroCommit();
    const patch = patchDoCommit({ repo, ref: "HEAD" });
    expect(patch).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(patch).not.toMatch(/antes\/|depois\//);
    expect(patch).not.toContain("infra/gcp");
    expect(patch).not.toContain("marlon@empresa.com");
    aplicar(pub, patch);
    expect(readFileSync(join(pub, "src/a.ts"), "utf8")).toBe("export const a = 2;\n");
    expect(readFileSync(join(pub, "src/novo.ts"), "utf8")).toBe("export const dono = 'pessoa@exemplo.com';\n");
    expect(readFileSync(join(pub, "src/so-no-publico.ts"), "utf8")).toBe("export {};\n");
  });

  it("o patch que não cabe no público lança e não aplica nada", () => {
    const pub = join(tmp, "publico-divergente");
    mkdirSync(pub);
    g(pub, "init", "-q", "-b", "main");
    escrever(pub, { LICENSE: "Apache\n", "src/a.ts": "export const a = 99;\n" });
    g(pub, "add", "-A");
    g(pub, "commit", "-qm", "divergiu");
    const patch = patchDoCommit({ repo: join(tmp, "privado"), ref: "HEAD" });
    expect(() => aplicar(pub, patch)).toThrow(/não aplica no público/);
    expect(readFileSync(join(pub, "src/a.ts"), "utf8")).toBe("export const a = 99;\n");
    expect(g(pub, "status", "--porcelain")).toBe("");
  });
});

describe("varrer: um clone do público contra a lista interna", () => {
  it("acha o proibido nos arquivos novos ainda não commitados e no ref; limpo depois de tirar", () => {
    const pub = join(tmp, "varrer");
    mkdirSync(pub);
    g(pub, "init", "-q", "-b", "main");
    escrever(pub, { "src/a.ts": "export {};\n" });
    g(pub, "add", "-A");
    g(pub, "commit", "-qm", "c1");
    const m = join(tmp, "manifesto-varrer.json");
    writeFileSync(m, JSON.stringify(manifesto));
    expect(varrer(pub, { manifestoPath: m, gitleaks: false }).limpo).toBe(true);
    escrever(pub, { "src/b.ts": `const t = "${"deadbeef"}-1";\n` });
    const r = varrer(pub, { manifestoPath: m, gitleaks: false });
    expect(r.limpo).toBe(false);
    expect(r.proibidos[0]).toMatchObject({ arquivo: "src/b.ts", linha: 1, motivo: "tenant de produção" });
    g(pub, "add", "-A");
    g(pub, "commit", "-qm", "c2");
    expect(varrer(pub, { manifestoPath: m, gitleaks: false, ref: "HEAD~1" }).limpo).toBe(true);
    expect(varrer(pub, { manifestoPath: m, gitleaks: false, ref: "HEAD" }).limpo).toBe(false);
  });
});
