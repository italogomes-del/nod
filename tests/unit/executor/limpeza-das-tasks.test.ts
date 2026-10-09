import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../../src/contracts/ponte.ts";
import { contarOrfas, criarExecutarComando, iniciarLimpezaDasTasks, limparPastas, montagensDoDocker, type ExecutarComando } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

// Cada teste cria repositórios git de verdade e roda `git worktree add/remove` (vários processos por teste). medido em
// 2026-10-09: 0,3–1,1 s por teste com load ~195 (uptime); o padrão de 5 s do projeto unit fica perto demais sob carga maior.
vi.setConfig({ testTimeout: 60_000 });

/** Git sem a configuração da pessoa (hooks, assinatura) e com autor fixo: o teste não depende do Mac de quem roda. */
const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
let clone: string;

/**
 * `gh` e `docker` falsos (nunca os do Mac); o git é o de verdade. `merged`: branches com PR mergeado; `montagens`:
 * a saída do Docker (null = não respondeu; undefined = sem Docker instalado).
 */
function executor(o: { merged?: string[]; montagens?: string[] | null } = {}): { executar: ExecutarComando; chamadas: string[] } {
  const real = criarExecutarComando(ENV_GIT, home);
  const chamadas: string[] = [];
  const executar: ExecutarComando = async (bin, args, op) => {
    chamadas.push([bin, ...args].join(" "));
    if (bin === "gh") {
      const branch = args[args.indexOf("--head") + 1]!;
      return { codigo: 0, stdout: JSON.stringify((o.merged ?? []).includes(branch) ? [{ number: 1 }] : []), stderr: "" };
    }
    if (bin === "docker") {
      if (o.montagens === undefined) return { codigo: -1, stdout: "", stderr: "" };
      if (o.montagens === null) return { codigo: -2, stdout: "", stderr: "" };
      if (args[0] === "ps") return { codigo: 0, stdout: "abc123\n", stderr: "" };
      return { codigo: 0, stdout: `${JSON.stringify(o.montagens.map((s) => ({ Type: "bind", Source: s })))}\n`, stderr: "" };
    }
    return real(bin, args, op);
  };
  return { executar, chamadas };
}

/** Uma worktree do clone em `~/nod/<rel>`, com um node_modules ignorado dentro (o peso real da #216). */
async function worktree(rel: string, branch: string): Promise<string> {
  const destino = join(home, "nod", rel);
  await mkdir(join(destino, ".."), { recursive: true });
  git(clone, "worktree", "add", destino, "-b", branch);
  await mkdir(join(destino, "node_modules", "pacote"), { recursive: true });
  await writeFile(join(destino, "node_modules", "pacote", "index.js"), "x".repeat(10_000));
  return destino;
}

const listaDoClone = () => git(clone, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-limpeza-")));
  clone = join(home, "code", "acme");
  await mkdir(clone, { recursive: true });
  git(clone, "init", "-q", "-b", "main");
  await writeFile(join(clone, ".gitignore"), "node_modules/\n");
  await writeFile(join(clone, "README.md"), "acme\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const encerrada = (pasta: string, trabalhoId = "t-1"): PastaParaLimpar => ({ trabalhoId, pasta, quando: "encerrada" });

describe("limpeza das pastas de task no Mac (ADR-088)", () => {
  it("task encerrada: a worktree limpa sai (com o node_modules), a pasta vazia sai e o clone esquece a worktree", async () => {
    const wt = await worktree("Dev 1/fix-filtros-abc123/acme", "feat/filtros");
    const { executar } = executor();
    const r = await limparPastas([encerrada("Dev 1/fix-filtros-abc123")], { home, executar, livre: async () => 0 });
    expect(r).toMatchObject({ pastas: 1, removidas: 1, pastasApagadas: 1, puladas: {} });
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(home, "nod", "Dev 1", "fix-filtros-abc123"))).toBe(false);
    expect(existsSync(join(home, "nod", "Dev 1"))).toBe(true);
    expect(listaDoClone()).toBe(1);
    // A branch fica no clone: o trabalho commitado não se perde.
    expect(git(clone, "branch", "--list", "feat/filtros")).toContain("feat/filtros");
  });

  it("worktree suja (arquivo alterado ou novo) não sai: o git recusa sem --force e ela fica, registrada", async () => {
    const alterada = await worktree("Dev 1/task-a-aaaaaa/acme", "feat/a");
    await writeFile(join(alterada, "README.md"), "mudou\n");
    const nova = await worktree("Dev 1/task-b-bbbbbb/acme", "feat/b");
    await writeFile(join(nova, "rascunho.txt"), "não commitado\n");
    const { executar, chamadas } = executor();
    const r = await limparPastas([encerrada("Dev 1/task-a-aaaaaa", "t-a"), encerrada("Dev 1/task-b-bbbbbb", "t-b")], { home, executar, livre: async () => 0 });
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { suja: 2 } });
    expect(existsSync(join(alterada, "README.md"))).toBe(true);
    expect(existsSync(join(nova, "rascunho.txt"))).toBe(true);
    expect(chamadas.some((c) => c.includes("--force") || / -f( |$)/.test(c))).toBe(false);
  });

  it("encerrada há menos de 3 dias: só sai a worktree cujo PR foi mergeado", async () => {
    const mergeada = await worktree("Dev 2/pr-mergeado-cccccc/acme", "feat/mergeada");
    const aberta = await worktree("Dev 2/pr-aberto-dddddd/acme", "feat/aberta");
    const { executar } = executor({ merged: ["feat/mergeada"] });
    const r = await limparPastas(
      [{ trabalhoId: "t-c", pasta: "Dev 2/pr-mergeado-cccccc", quando: "so_com_pr_mergeado" }, { trabalhoId: "t-d", pasta: "Dev 2/pr-aberto-dddddd", quando: "so_com_pr_mergeado" }],
      { home, executar, livre: async () => 0 },
    );
    expect(r).toMatchObject({ removidas: 1, pastasApagadas: 1, puladas: { pr_nao_mergeado: 1 } });
    expect(existsSync(mergeada)).toBe(false);
    expect(existsSync(aberta)).toBe(true);
  });

  it("pasta vazia de task encerrada sai; pasta com arquivo que não é worktree fica", async () => {
    await mkdir(join(home, "nod", "Elis", "vazia-eeeeee", "sub"), { recursive: true });
    await writeFile(join(home, "nod", "Elis", "vazia-eeeeee", ".DS_Store"), "");
    await mkdir(join(home, "nod", "Elis", "com-relatorio-ffffff"), { recursive: true });
    await writeFile(join(home, "nod", "Elis", "com-relatorio-ffffff", "relatorio.md"), "resultado\n");
    const { executar } = executor();
    const r = await limparPastas([encerrada("Elis/vazia-eeeeee", "t-e"), encerrada("Elis/com-relatorio-ffffff", "t-f")], { home, executar });
    expect(r).toMatchObject({ pastas: 2, removidas: 0, pastasApagadas: 1 });
    expect(existsSync(join(home, "nod", "Elis", "vazia-eeeeee"))).toBe(false);
    expect(existsSync(join(home, "nod", "Elis", "com-relatorio-ffffff", "relatorio.md"))).toBe(true);
  });

  it("bind mount de container dentro da worktree a protege (o init do nod-postgres do diário)", async () => {
    const wt = await worktree("Eng 1/nod-169-task-111111/nod", "feat/169");
    await mkdir(join(wt, "infra", "postgres", "init"), { recursive: true });
    const { executar } = executor({ montagens: [join(wt, "infra", "postgres", "init"), "/var/lib/docker/volumes/x/_data"] });
    const r = await limparPastas([encerrada("Eng 1/nod-169-task-111111")], { home, executar });
    expect(r).toMatchObject({ removidas: 0, puladas: { montagem: 1 } });
    expect(existsSync(join(wt, "infra", "postgres", "init"))).toBe(true);
  });

  it("Docker sem resposta: a worktree com arquivo de compose fica (não se sabe o que está montado); a sem compose sai", async () => {
    const comCompose = await worktree("Ze 1/com-compose-222222/acme", "feat/compose");
    await writeFile(join(comCompose, "docker-compose.yml"), "services: {}\n");
    git(comCompose, "add", "docker-compose.yml");
    git(comCompose, "commit", "-q", "-m", "compose");
    const semCompose = await worktree("Ze 1/sem-compose-333333/acme", "feat/sem");
    const { executar } = executor({ montagens: null });
    const r = await limparPastas([encerrada("Ze 1/com-compose-222222", "t-1"), encerrada("Ze 1/sem-compose-333333", "t-2")], { home, executar, livre: async () => 0 });
    expect(r).toMatchObject({ removidas: 1, puladas: { compose_sem_docker: 1 } });
    expect(existsSync(comCompose)).toBe(true);
    expect(existsSync(semCompose)).toBe(false);
  });

  it("nada fora de ~/nod/<bot>/<slug>: a raiz do bot, link para fora e caminho com .. são recusados", async () => {
    const naRaiz = await worktree("Dev 1/nod-169", "feat/raiz");
    const fora = join(home, "fora");
    await mkdir(fora, { recursive: true });
    await writeFile(join(fora, "importante.txt"), "não apague\n");
    await symlink(fora, join(home, "nod", "Dev 1", "link-444444"));
    const { executar } = executor();
    const r = await limparPastas([encerrada("Dev 1"), encerrada("Dev 1/../../fora"), encerrada("Dev 1/link-444444"), encerrada("Dev 1/nao-existe-555555")], { home, executar });
    expect(r.puladas.fora_da_pasta).toBe(3);
    expect(r.removidas).toBe(0);
    expect(existsSync(naRaiz)).toBe(true);
    expect(await readdir(fora)).toEqual(["importante.txt"]);
  });

  it("clone inteiro (pasta .git) dentro da task não é apagado: só worktree sai", async () => {
    const dentro = join(home, "nod", "Dev 3", "clonou-666666", "acme");
    await mkdir(join(dentro, ".."), { recursive: true });
    git(home, "clone", "-q", clone, dentro);
    const { executar } = executor();
    const r = await limparPastas([encerrada("Dev 3/clonou-666666")], { home, executar });
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { clone: 1 } });
    expect(existsSync(join(dentro, ".git"))).toBe(true);
  });

  it("as worktrees na raiz do bot são só contadas, nunca removidas", async () => {
    await worktree("Tarsila/qa-194", "qa/194");
    await worktree("Tarsila/task-777777/acme", "qa/195");
    const agora = Date.now();
    expect(await contarOrfas(home, agora)).toEqual({ orfas: 1, paradas: 0 });
    expect(await contarOrfas(home, agora + 3 * 24 * 3_600_000)).toEqual({ orfas: 1, paradas: 1 });
  });

  it("a passada pede a lista à ponte, limpa e relata; ponte antiga (sem a rota) não faz nada", async () => {
    await worktree("Dev 1/fix-888888/acme", "feat/888");
    const relatos: RelatoLimpeza[] = [];
    const ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza"> = { pastasParaLimpar: async () => [encerrada("Dev 1/fix-888888")], relatarLimpeza: async (_p, r) => { relatos.push(r); } };
    const { executar } = executor();
    const limpeza = iniciarLimpezaDasTasks({ ponte, pessoaId: "p", home, executar, primeiraMs: 10 ** 9, livre: async () => 0 });
    const r = await limpeza.passada();
    limpeza.parar();
    expect(r).toMatchObject({ removidas: 1, pastasApagadas: 1 });
    expect(relatos).toHaveLength(1);
    const antiga = iniciarLimpezaDasTasks({ ponte: {}, pessoaId: "p", home, executar, primeiraMs: 10 ** 9 });
    expect(await antiga.passada()).toBeNull();
    antiga.parar();
  });

  it("montagens do Docker: sem Docker = nenhuma; Docker travado = desconhecidas (null); só bind conta", async () => {
    expect(await montagensDoDocker(executor().executar)).toEqual([]);
    expect(await montagensDoDocker(executor({ montagens: null }).executar)).toBeNull();
    expect(await montagensDoDocker(executor({ montagens: ["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"] }).executar)).toEqual(["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"]);
  });
});
