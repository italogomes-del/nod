import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardarEApagar, temProcessoVivo, vencerGuardados, type OpcoesGuardar } from "../../../src/adapters/executor/guardar-antes-de-apagar.ts";
import { criarExecutarComando, limparOrfas, type ExecutarComando } from "../../../src/adapters/executor/limpeza-das-tasks.ts";
import { GUARDADO_VENCE_APERTADO_MS, GUARDADO_VENCE_MS, ORFA_SAI_APERTADO_MS, ORFA_SAI_MS, pedacoDeRef } from "../../../src/domain/guardado.ts";

// Repositórios git de verdade, `tar` e `rm` de verdade (vários processos por teste). medido em 2026-10-11: 0,2–0,9 s por
// teste com load ~40; o padrão de 5 s do projeto unit fica perto demais sob carga maior.
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();
const DIA = 24 * 3_600_000;

let home: string;
let raiz: string;
let clone: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-guardar-")));
  raiz = join(home, "nod");
  clone = join(home, "code", "acme");
  await mkdir(clone, { recursive: true });
  git(clone, "init", "-q", "-b", "main");
  await writeFile(join(clone, ".gitignore"), "node_modules/\n.env\n");
  await writeFile(join(clone, "README.md"), "acme\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Sem o prefixo de prioridade baixa: o teste é da lógica, não do escalonador da máquina. */
const executarReal = (): ExecutarComando => criarExecutarComando(ENV_GIT, home, []);
const opcoes = (o: Partial<OpcoesGuardar> = {}): OpcoesGuardar => ({ raiz, executar: executarReal(), montagens: [], livre: async () => 0, agora: () => 1, ...o });

async function worktree(rel: string, branch: string): Promise<string> {
  const destino = join(raiz, rel);
  await mkdir(join(destino, ".."), { recursive: true });
  git(clone, "worktree", "add", destino, "-b", branch);
  return destino;
}

describe("ADR-096 §4: guardar antes de apagar", () => {
  it("um `*.pid` de processo vivo segura a pasta (o Postgres de teste do bot); o de processo morto não", async () => {
    const pasta = join(raiz, "Ze 1", "qa-pg-aaaaaa");
    await mkdir(join(pasta, "pgdata"), { recursive: true });
    await writeFile(join(pasta, "pgdata", "postmaster.pid"), `${process.ppid}\n/tmp\n`);
    expect(await temProcessoVivo(pasta)).toBe(true);
    const r = await guardarEApagar(pasta, "t-1", opcoes());
    expect(r.motivo).toBe("processo_vivo");
    expect(existsSync(join(pasta, "pgdata", "postmaster.pid"))).toBe(true);
    // pid que não existe (o maior possível no Linux e no macOS fica abaixo disto).
    await writeFile(join(pasta, "pgdata", "postmaster.pid"), "4194304999\n");
    expect(await temProcessoVivo(pasta)).toBe(false);
  });

  it("guardado acima do teto: a pasta fica inteira e nenhum arquivo sobra", async () => {
    const pasta = join(raiz, "Ze 1", "grande-bbbbbb");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x".repeat(50_000));
    const r = await guardarEApagar(pasta, "t-2", opcoes({ maxBytes: 10 }));
    expect(r.motivo).toBe("grande_demais");
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
  });

  it("o `tar` que falha (ou um guardado que não se lê) não apaga nada nem deixa `.parcial`", async () => {
    const wt = await worktree("Ze 1/falha-cccccc/acme", "feat/falha");
    await writeFile(join(wt, "rascunho.txt"), "não commitado\n");
    const real = executarReal();
    const chamadas: string[] = [];
    const falhaNaConferencia: ExecutarComando = async (bin, args, o) => {
      chamadas.push([bin, ...args].join(" "));
      if (bin === "tar" && args[0] === "-tzf") return { codigo: 2, stdout: "", stderr: "corrompido" };
      return real(bin, args, o);
    };
    const r = await guardarEApagar(join(raiz, "Ze 1", "falha-cccccc"), "t-3", opcoes({ executar: falhaNaConferencia }));
    expect(r.motivo).toBe("erro");
    expect(existsSync(join(wt, "rascunho.txt"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
    expect(chamadas.some((c) => c.includes("worktree remove") || c.startsWith("rm "))).toBe(false);
  });

  it("montagem de container dentro da pasta, ou worktree travada, seguram a pasta", async () => {
    const wt = await worktree("Eng 1/montada-dddddd/acme", "feat/montada");
    await mkdir(join(wt, "infra", "init"), { recursive: true });
    expect((await guardarEApagar(join(raiz, "Eng 1", "montada-dddddd"), "t-4", opcoes({ montagens: [join(wt, "infra", "init")] }))).motivo).toBe("montagem");
    git(clone, "worktree", "lock", wt);
    expect((await guardarEApagar(join(raiz, "Eng 1", "montada-dddddd"), "t-4", opcoes())).motivo).toBe("travada");
    expect(existsSync(wt)).toBe(true);
  });

  it("nunca fora de `~/nod/<bot>/<x>`: a raiz, o bot inteiro e a pasta escondida são recusados", async () => {
    await mkdir(join(raiz, "Ze 1", ".escondida"), { recursive: true });
    for (const alvo of [raiz, join(raiz, "Ze 1"), join(raiz, "Ze 1", ".escondida"), join(home, "code")]) {
      expect((await guardarEApagar(alvo, "t", opcoes())).motivo, alvo).toBe("fora_da_pasta");
    }
    expect(existsSync(join(home, "code", "acme", ".git"))).toBe(true);
  });

  it("ADR-119 §8: o clone da máquina (`~/nod/.clones`) nunca é pasta de task", async () => {
    const bare = join(raiz, ".clones", "acme", "app.git");
    await mkdir(bare, { recursive: true });
    git(bare, "init", "-q", "--bare");
    for (const alvo of [join(raiz, ".clones"), join(raiz, ".clones", "acme"), bare]) {
      expect((await guardarEApagar(alvo, "t", opcoes())).motivo, alvo).toBe("fora_da_pasta");
    }
    expect(existsSync(join(bare, "HEAD"))).toBe(true);
  });

  it("o guardado vence em 30 dias, ou em 7 com o disco apertado; o `.parcial` esquecido sai em 1 dia", async () => {
    const pasta = join(raiz, ".guardado", "Ze 1");
    await mkdir(pasta, { recursive: true });
    const agora = Date.now();
    const criar = async (nome: string, idade: number) => {
      await writeFile(join(pasta, nome), "x");
      const t = (agora - idade) / 1000;
      await utimes(join(pasta, nome), t, t);
    };
    await criar("velho.tar.gz", GUARDADO_VENCE_MS + DIA);
    await criar("semana.tar.gz", GUARDADO_VENCE_APERTADO_MS + DIA);
    await criar("novo.tar.gz", DIA);
    await criar("morto.tar.gz.parcial", 2 * DIA);
    await criar("anotacao.txt", GUARDADO_VENCE_MS + DIA);
    expect(await vencerGuardados(raiz, agora, false)).toBe(2);
    expect((await readdir(pasta)).sort()).toEqual(["anotacao.txt", "novo.tar.gz", "semana.tar.gz"]);
    expect(await vencerGuardados(raiz, agora, true)).toBe(1);
    expect((await readdir(pasta)).sort()).toEqual(["anotacao.txt", "novo.tar.gz"]);
  });

  it("o nome da referência é seguro para o git", () => {
    for (const [nome, ref] of [["acme", "acme"], ["acme/.claude/worktrees/agent-1", "acme-.claude-worktrees-agent-1"], ["Zé 1", "Ze-1"], ["..", "x"], ["a.lock", "a-lock"], ["", "x"]] as const) expect(pedacoDeRef(nome), nome).toBe(ref);
    for (const nome of ["acme/.claude/worktrees/agent-1", "Zé 1", "a b c", "a.lock"]) git(clone, "check-ref-format", `refs/nod/guardado/t/${pedacoDeRef(nome)}`);
  });
});

describe("ADR-096 §4: as órfãs da raiz do bot", () => {
  const o = (extra: Partial<Parameters<typeof limparOrfas>[0]> = {}) => ({ home, executar: executarReal(), montagens: async () => [], livre: async () => 0, ...extra });

  it("parada há 30 dias: a limpa sai pelo git (a branch fica); a suja é guardada antes; a recente fica", async () => {
    const limpa = await worktree("Tarsila/qa-194", "qa/194");
    const suja = await worktree("Tarsila/qa-195", "qa/195");
    await writeFile(join(suja, "notas.md"), "achados do QA\n");
    const agora = Date.now();
    expect(await limparOrfas(o(), agora + DIA, false)).toMatchObject({ removidas: 0, guardadas: 0 });
    const r = await limparOrfas(o(), agora + ORFA_SAI_MS + DIA, false);
    expect(r).toMatchObject({ removidas: 1, guardadas: 1 });
    expect(existsSync(limpa)).toBe(false);
    expect(existsSync(suja)).toBe(false);
    expect(git(clone, "branch", "--list", "qa/194")).toContain("qa/194");
    expect(execFileSync("tar", ["-xzOf", join(raiz, ".guardado", "Tarsila", "qa-195.tar.gz"), "qa-195/notas.md"]).toString()).toBe("achados do QA\n");
    expect(git(clone, "rev-parse", "refs/nod/guardado/orfa/qa-195").trim()).toBe(git(clone, "rev-parse", "qa/195").trim());
  });

  it("com o disco apertado, 7 dias bastam; com um turno daquele bot rodando, nada sai; pasta de task não é órfã", async () => {
    const orfa = await worktree("Dev 1/nod-200", "feat/200");
    await worktree("Dev 1/task-abcdef/nod", "feat/task");
    const agora = Date.now() + ORFA_SAI_APERTADO_MS + DIA;
    expect(await limparOrfas(o({ emUso: (p) => p === "Dev 1" || p.startsWith("Dev 1/") }), agora, true)).toMatchObject({ removidas: 0 });
    expect(existsSync(orfa)).toBe(true);
    expect(await limparOrfas(o(), agora, false)).toMatchObject({ removidas: 0 });
    const r = await limparOrfas(o(), agora, true);
    expect(r).toMatchObject({ removidas: 1, guardadas: 0 });
    expect(existsSync(orfa)).toBe(false);
    expect(existsSync(join(raiz, "Dev 1", "task-abcdef", "nod"))).toBe(true);
  });

  it("Docker instalado e mudo: nenhuma órfã sai", async () => {
    const orfa = await worktree("Dev 1/nod-201", "feat/201");
    const r = await limparOrfas(o({ montagens: async () => null }), Date.now() + ORFA_SAI_MS + DIA, false);
    expect(r).toMatchObject({ removidas: 0, guardadas: 0 });
    expect(existsSync(orfa)).toBe(true);
  });
});
