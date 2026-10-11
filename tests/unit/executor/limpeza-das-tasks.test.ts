import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PastaParaLimpar, PonteInterna, RelatoLimpeza } from "../../../src/contracts/ponte.ts";
import { contarOrfas, criarExecutarComando, iniciarLimpezaDasTasks, limparPastas, modoDaLimpeza, montagensDoDocker, prefixoDeFundo, travarLimpeza, type ExecutarComando, type OpcoesLimpeza } from "../../../src/adapters/executor/limpeza-das-tasks.ts";

// Cada teste cria repositórios git de verdade e roda `git worktree add/remove` (vários processos por teste). medido em
// 2026-10-09: 0,3–1,1 s por teste com load ~195 (uptime); o padrão de 5 s do projeto unit fica perto demais sob carga maior.
vi.setConfig({ testTimeout: 60_000 });

/** Git sem a configuração da pessoa (hooks, assinatura) e com autor fixo: o teste não depende do Mac de quem roda. */
const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();

let home: string;
let clone: string;

/**
 * `gh`, `docker`, `npm` e `pnpm` falsos (nunca os do Mac); o git e o du são os de verdade. `merged`: branch → o HEAD com que o PR foi
 * mergeado (`"atual"` = o HEAD de agora da branch); `montagens`: a saída do Docker (null = não respondeu; undefined = sem
 * Docker instalado).
 */
function executor(o: { merged?: Record<string, string>; montagens?: string[] | null } = {}): { executar: ExecutarComando; chamadas: string[] } {
  // Sem o prefixo de prioridade baixa: o teste é da lógica, não do escalonador da máquina (o prefixo tem testes próprios).
  const real = criarExecutarComando(ENV_GIT, home, []);
  const chamadas: string[] = [];
  const executar: ExecutarComando = async (bin, args, op) => {
    chamadas.push([op?.fundo ? "[fundo]" : "", bin, ...args].filter(Boolean).join(" "));
    if (bin === "gh") {
      const branch = args[args.indexOf("--head") + 1]!;
      const oid = o.merged?.[branch];
      const head = oid === "atual" ? git(clone, "rev-parse", branch).trim() : oid;
      return { codigo: 0, stdout: JSON.stringify(head ? [{ number: 1, headRefOid: head }] : []), stderr: "" };
    }
    if (bin === "npm" || bin === "pnpm") return { codigo: 0, stdout: "", stderr: "" };
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

/** As opções de sempre: Docker sem montagens (o teste do Docker passa as dele) e o espaço livre fixo. */
const opcoes = (o: Partial<OpcoesLimpeza> & { executar: ExecutarComando }): OpcoesLimpeza => ({ home, montagens: async () => [], livre: async () => 0, ...o });

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
  await writeFile(join(clone, ".gitignore"), "node_modules/\ndist/\n*.log\n.claude/\nbackups/\n.env\noutput/\n");
  await writeFile(join(clone, "README.md"), "acme\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const encerrada = (pasta: string, trabalhoId = "t-1"): PastaParaLimpar => ({ trabalhoId, pasta, quando: "encerrada" });

describe("limpeza das pastas de task no Mac (ADR-088)", () => {
  it("task encerrada: a worktree limpa sai (com node_modules, também o de pacote do monorepo, dist e log), a pasta vazia sai e o clone esquece a worktree", async () => {
    const wt = await worktree("Dev 1/fix-filtros-abc123/acme", "feat/filtros");
    await mkdir(join(wt, "dist"), { recursive: true });
    await writeFile(join(wt, "dist", "app.js"), "x");
    await writeFile(join(wt, "npm-debug.log"), "x");
    await mkdir(join(wt, "packages", "web", "node_modules", "react"), { recursive: true });
    await writeFile(join(wt, "packages", "web", "node_modules", "react", "index.js"), "x");
    // O pacote tem arquivo rastreado (num monorepo de verdade); sem isso o git recolhe `packages/` inteira como ignorada.
    await writeFile(join(wt, "packages", "web", "package.json"), "{}\n");
    git(wt, "add", "packages/web/package.json");
    git(wt, "commit", "-q", "-m", "pacote");
    const r = await limparPastas([encerrada("Dev 1/fix-filtros-abc123")], opcoes(executor()));
    expect(r).toMatchObject({ pastas: 1, removidas: 1, pastasApagadas: 1, puladas: {} });
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(home, "nod", "Dev 1", "fix-filtros-abc123"))).toBe(false);
    expect(existsSync(join(home, "nod", "Dev 1"))).toBe(true);
    expect(listaDoClone()).toBe(1);
    // A branch fica no clone: o trabalho commitado não se perde.
    expect(git(clone, "branch", "--list", "feat/filtros")).toContain("feat/filtros");
  });

  it("worktree suja (arquivo alterado ou novo) não sai, e nenhuma chamada usa --force nem prune", async () => {
    const alterada = await worktree("Dev 1/task-a-aaaaaa/acme", "feat/a");
    await writeFile(join(alterada, "README.md"), "mudou\n");
    const nova = await worktree("Dev 1/task-b-bbbbbb/acme", "feat/b");
    await writeFile(join(nova, "rascunho.txt"), "não commitado\n");
    const { executar, chamadas } = executor();
    const r = await limparPastas([encerrada("Dev 1/task-a-aaaaaa", "t-a"), encerrada("Dev 1/task-b-bbbbbb", "t-b")], opcoes({ executar }));
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { suja: 2 } });
    expect(existsSync(join(alterada, "README.md"))).toBe(true);
    expect(existsSync(join(nova, "rascunho.txt"))).toBe(true);
    expect(chamadas.some((c) => c.includes("--force") || / -f( |$)/.test(c) || c.includes("prune"))).toBe(false);
  });

  it("revisão #225 (1): worktree com outra worktree suja ou clone aninhados em pasta IGNORADA não sai", async () => {
    const comWorktree = await worktree("Eng 1/agentes-cccccc/acme", "feat/agentes");
    const agente = join(comWorktree, ".claude", "worktrees", "agent-1");
    await mkdir(join(agente, ".."), { recursive: true });
    git(clone, "worktree", "add", agente, "-b", "agent-1");
    await writeFile(join(agente, "README.md"), "trabalho do agente, não commitado\n");
    const comClone = await worktree("Eng 1/clone-dddddd/acme", "feat/clone");
    git(home, "clone", "-q", clone, join(comClone, ".claude", "clone"));
    await writeFile(join(comClone, ".claude", "clone", "nota.txt"), "só aqui\n");
    const r = await limparPastas([encerrada("Eng 1/agentes-cccccc", "t-c"), encerrada("Eng 1/clone-dddddd", "t-d")], opcoes(executor()));
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { aninhado: 2 } });
    expect(await readFile(join(agente, "README.md"), "utf8")).toContain("não commitado");
    expect(await readFile(join(comClone, ".claude", "clone", "nota.txt"), "utf8")).toBe("só aqui\n");
  });

  it("revisão #225 (1 e 2ª revisão): arquivo ignorado que não se refaz (backup, .env, output/, .env dentro de dist/) segura a worktree", async () => {
    const comBackup = await worktree("Dev 2/backup-eeeeee/acme", "feat/backup");
    await mkdir(join(comBackup, "backups", "local"), { recursive: true });
    await writeFile(join(comBackup, "backups", "local", "nod.dump"), "dados");
    const comEnv = await worktree("Dev 2/env-ffffff/acme", "feat/env");
    await writeFile(join(comEnv, ".env"), "SEGREDO=1\n");
    const comOutput = await worktree("Dev 2/output-121212/acme", "feat/output");
    await mkdir(join(comOutput, "output"), { recursive: true });
    await writeFile(join(comOutput, "output", "relatorio.csv"), "a,b\n");
    const comEnvNoDist = await worktree("Dev 2/dist-env-131313/acme", "feat/dist-env");
    await mkdir(join(comEnvNoDist, "dist"), { recursive: true });
    await writeFile(join(comEnvNoDist, "dist", "app.js"), "x");
    await writeFile(join(comEnvNoDist, "dist", ".env.production"), "SEGREDO=2\n");
    const r = await limparPastas(
      [encerrada("Dev 2/backup-eeeeee", "t-e"), encerrada("Dev 2/env-ffffff", "t-f"), encerrada("Dev 2/output-121212", "t-o"), encerrada("Dev 2/dist-env-131313", "t-d")],
      opcoes(executor()),
    );
    expect(r).toMatchObject({ removidas: 0, puladas: { ignorado_valioso: 4 } });
    expect(existsSync(join(comBackup, "backups", "local", "nod.dump"))).toBe(true);
    expect(existsSync(join(comEnv, ".env"))).toBe(true);
    expect(existsSync(join(comOutput, "output", "relatorio.csv"))).toBe(true);
    expect(existsSync(join(comEnvNoDist, "dist", ".env.production"))).toBe(true);
  });

  it("revisão #225 (2): commit com HEAD solto (fora de branch, remoto ou tag) segura a worktree", async () => {
    const wt = await worktree("Dev 3/solto-111111/acme", "feat/solto");
    git(wt, "checkout", "-q", "--detach");
    await writeFile(join(wt, "novo.txt"), "commit sem branch\n");
    git(wt, "add", "novo.txt");
    git(wt, "commit", "-q", "-m", "solto");
    const sha = git(wt, "rev-parse", "HEAD").trim();
    const r = await limparPastas([encerrada("Dev 3/solto-111111")], opcoes(executor()));
    expect(r).toMatchObject({ removidas: 0, puladas: { head_solto: 1 } });
    expect(git(wt, "rev-parse", "HEAD").trim()).toBe(sha);
  });

  it("encerrada há menos de 3 dias: só sai a worktree cujo PR foi mergeado com o HEAD que está aqui", async () => {
    const mergeada = await worktree("Dev 2/pr-mergeado-cccccc/acme", "feat/mergeada");
    const aberta = await worktree("Dev 2/pr-aberto-dddddd/acme", "feat/aberta");
    // Branch reaproveitada: o PR mergeado tinha outro HEAD, e o commit novo não está em PR nenhum.
    const reaproveitada = await worktree("Dev 2/reaproveitada-999999/acme", "feat/reaproveitada");
    const headAntigo = git(reaproveitada, "rev-parse", "HEAD").trim();
    await writeFile(join(reaproveitada, "depois.txt"), "depois do merge\n");
    git(reaproveitada, "add", "depois.txt");
    git(reaproveitada, "commit", "-q", "-m", "depois");
    const { executar } = executor({ merged: { "feat/mergeada": "atual", "feat/reaproveitada": headAntigo } });
    const curta = (trabalhoId: string, pasta: string): PastaParaLimpar => ({ trabalhoId, pasta, quando: "so_com_pr_mergeado" });
    const r = await limparPastas([curta("t-c", "Dev 2/pr-mergeado-cccccc"), curta("t-d", "Dev 2/pr-aberto-dddddd"), curta("t-r", "Dev 2/reaproveitada-999999")], opcoes({ executar }));
    expect(r).toMatchObject({ removidas: 1, pastasApagadas: 1, puladas: { pr_nao_mergeado: 2 } });
    expect(existsSync(mergeada)).toBe(false);
    expect(existsSync(aberta)).toBe(true);
    expect(existsSync(reaproveitada)).toBe(true);
  });

  it("pasta vazia de task encerrada sai; pasta com arquivo que não é worktree fica", async () => {
    await mkdir(join(home, "nod", "Elis", "vazia-eeeeee", "sub"), { recursive: true });
    await writeFile(join(home, "nod", "Elis", "vazia-eeeeee", ".DS_Store"), "");
    await mkdir(join(home, "nod", "Elis", "com-relatorio-ffffff"), { recursive: true });
    await writeFile(join(home, "nod", "Elis", "com-relatorio-ffffff", "relatorio.md"), "resultado\n");
    const r = await limparPastas([encerrada("Elis/vazia-eeeeee", "t-e"), encerrada("Elis/com-relatorio-ffffff", "t-f")], opcoes(executor()));
    expect(r).toMatchObject({ pastas: 2, removidas: 0, pastasApagadas: 1 });
    expect(existsSync(join(home, "nod", "Elis", "vazia-eeeeee"))).toBe(false);
    expect(existsSync(join(home, "nod", "Elis", "com-relatorio-ffffff", "relatorio.md"))).toBe(true);
  });

  it("bind mount de container dentro da worktree a protege (o init do nod-postgres do diário)", async () => {
    const wt = await worktree("Eng 1/nod-169-task-111111/nod", "feat/169");
    await mkdir(join(wt, "infra", "postgres", "init"), { recursive: true });
    const { executar } = executor({ montagens: [join(wt, "infra", "postgres", "init"), "/var/lib/docker/volumes/x/_data"] });
    const r = await limparPastas([encerrada("Eng 1/nod-169-task-111111")], opcoes({ executar, montagens: undefined }));
    expect(r).toMatchObject({ removidas: 0, puladas: { montagem: 1 } });
    expect(existsSync(join(wt, "infra", "postgres", "init"))).toBe(true);
  });

  it("revisão #225 (3): a montagem citada por um link ou com outra caixa ainda protege", async () => {
    const porLink = await worktree("Eng 2/link-222222/nod", "feat/link");
    await mkdir(join(porLink, "infra", "init"), { recursive: true });
    await symlink(porLink, join(home, "atalho"));
    const porCaixa = await worktree("Eng 2/caixa-333333/nod", "feat/caixa");
    await mkdir(join(porCaixa, "infra", "init"), { recursive: true });
    const montagens = [join(home, "atalho", "infra", "init"), join(porCaixa, "infra", "init").toUpperCase()];
    const r = await limparPastas([encerrada("Eng 2/link-222222", "t-l"), encerrada("Eng 2/caixa-333333", "t-c")], opcoes({ ...executor(), montagens: async () => montagens }));
    expect(r).toMatchObject({ removidas: 0, puladas: { montagem: 2 } });
    expect(existsSync(join(porLink, "infra", "init"))).toBe(true);
    expect(existsSync(join(porCaixa, "infra", "init"))).toBe(true);
  });

  it("revisão #225 (4, 2ª revisão): Docker instalado e sem resposta adia a passada inteira — nada sai", async () => {
    const limpa = await worktree("Ze 1/limpa-222222/acme", "feat/limpa");
    await mkdir(join(home, "nod", "Ze 1", "vazia-444444"), { recursive: true });
    const { executar, chamadas } = executor();
    const r = await limparPastas([encerrada("Ze 1/limpa-222222", "t-1"), encerrada("Ze 1/vazia-444444", "t-3")], opcoes({ executar, montagens: async () => null }));
    expect(r).toMatchObject({ adiada: true, pastas: 0, removidas: 0, pastasApagadas: 0 });
    expect(existsSync(limpa)).toBe(true);
    expect(existsSync(join(home, "nod", "Ze 1", "vazia-444444"))).toBe(true);
    expect(chamadas.some((c) => c.startsWith("git "))).toBe(false);
  });

  it("revisão #225 (4): sem o binário do Docker mas com o app ou o socket, as montagens são desconhecidas", async () => {
    const { executar } = executor();
    expect(await montagensDoDocker(executar, home, async () => false)).toEqual([]);
    expect(await montagensDoDocker(executar, home, async (c) => c === "/Applications/Docker.app")).toBeNull();
    expect(await montagensDoDocker(executar, home, async (c) => c === join(home, ".docker", "run", "docker.sock"))).toBeNull();
    expect(await montagensDoDocker(executor({ montagens: null }).executar, home, async () => false)).toBeNull();
    expect(await montagensDoDocker(executor({ montagens: ["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"] }).executar, home)).toEqual(["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"]);
  });

  it("revisão #225 (5): turno vivo na pasta, ou o servidor que não reconfirma, seguram a pasta inteira", async () => {
    const emUso = await worktree("Dev 1/em-uso-555555/acme", "feat/uso");
    const desoferecida = await worktree("Dev 1/reaberta-666666/acme", "feat/reaberta");
    const r = await limparPastas([encerrada("Dev 1/em-uso-555555", "t-u"), encerrada("Dev 1/reaberta-666666", "t-r")], opcoes({
      ...executor(),
      emUso: (pasta) => pasta === "Dev 1/em-uso-555555",
      reconfirmar: async (p) => p.trabalhoId !== "t-r",
    }));
    expect(r).toMatchObject({ removidas: 0, pastasApagadas: 0, puladas: { em_uso: 1, nao_reconfirmada: 1 } });
    expect(existsSync(emUso)).toBe(true);
    expect(existsSync(desoferecida)).toBe(true);
  });

  it("revisão #225 (5): uma passada por Mac — a trava em arquivo recusa a segunda e retoma a de um processo morto", async () => {
    await mkdir(join(home, "nod"), { recursive: true });
    const soltar = await travarLimpeza(home, Date.now());
    expect(soltar).not.toBeNull();
    expect(await travarLimpeza(home, Date.now())).toBeNull();
    await soltar!();
    expect(existsSync(join(home, "nod", ".limpeza.lock"))).toBe(false);
    await writeFile(join(home, "nod", ".limpeza.lock"), JSON.stringify({ pid: 2 ** 22 + 12345, em: Date.now() }));
    const retomada = await travarLimpeza(home, Date.now());
    expect(retomada).not.toBeNull();
    await retomada!();
    // 2ª revisão: trava vazia ou ilegível vale como viva por 30 s; depois disso é retomada (renomeada antes de apagar).
    await writeFile(join(home, "nod", ".limpeza.lock"), "");
    expect(await travarLimpeza(home, Date.now())).toBeNull();
    const retomaIlegivel = await travarLimpeza(home, Date.now() + 31_000);
    expect(retomaIlegivel).not.toBeNull();
    await retomaIlegivel!();
    // Nada fica para trás: nem o temporário do link nem a vencida renomeada.
    expect((await readdir(join(home, "nod"))).filter((n) => n.startsWith(".limpeza"))).toEqual([]);
  });

  it("revisão #225 (9): simular confere tudo, não apaga nada e conta o que sairia, com o tamanho", async () => {
    const limpa = await worktree("Dev 4/limpa-777777/acme", "feat/limpa");
    const suja = await worktree("Dev 4/suja-888888/acme", "feat/suja");
    await writeFile(join(suja, "rascunho.txt"), "x\n");
    await mkdir(join(home, "nod", "Dev 4", "vazia-999999"), { recursive: true });
    const { executar, chamadas } = executor();
    const r = await limparPastas([encerrada("Dev 4/limpa-777777", "t-1"), encerrada("Dev 4/suja-888888", "t-2"), encerrada("Dev 4/vazia-999999", "t-3")], opcoes({ executar, simular: true }));
    expect(r).toMatchObject({ simulada: true, removidas: 1, pastasApagadas: 2, puladas: { suja: 1 } });
    expect(r.estimadoBytes).toBeGreaterThan(0);
    expect(existsSync(limpa)).toBe(true);
    expect(existsSync(join(home, "nod", "Dev 4", "vazia-999999"))).toBe(true);
    expect(chamadas.some((c) => c.includes("worktree remove"))).toBe(false);
    expect(modoDaLimpeza({ NOD_LIMPEZA_TASKS: "simular" })).toBe("simular");
    expect(modoDaLimpeza({ NOD_LIMPEZA_TASKS: "desligada" })).toBe("desligada");
    // ADR-096: o padrão, sem nada no ambiente, é apagar; `simular` e `desligada` só valem escritos por extenso.
    expect(modoDaLimpeza({})).toBe("ligada");
    expect(modoDaLimpeza({ NOD_LIMPEZA_TASKS: "qualquer" })).toBe("ligada");
    expect(modoDaLimpeza({ NOD_LIMPEZA_TASKS: " Simular " })).toBe("simular");
    expect(modoDaLimpeza({ NOD_LIMPEZA_TASKS: "ligada" })).toBe("ligada");
  });

  it("nada fora de ~/nod/<bot>/<slug>: a raiz do bot, link para fora e caminho com .. são recusados", async () => {
    const naRaiz = await worktree("Dev 1/nod-169", "feat/raiz");
    const fora = join(home, "fora");
    await mkdir(fora, { recursive: true });
    await writeFile(join(fora, "importante.txt"), "não apague\n");
    await symlink(fora, join(home, "nod", "Dev 1", "link-444444"));
    const r = await limparPastas([encerrada("Dev 1"), encerrada("Dev 1/../../fora"), encerrada("Dev 1/link-444444"), encerrada("Dev 1/nao-existe-555555")], opcoes(executor()));
    expect(r.puladas.fora_da_pasta).toBe(3);
    expect(r.removidas).toBe(0);
    expect(existsSync(naRaiz)).toBe(true);
    expect(await readdir(fora)).toEqual(["importante.txt"]);
  });

  it("clone inteiro (pasta .git) dentro da task não é apagado: só worktree sai", async () => {
    const dentro = join(home, "nod", "Dev 3", "clonou-666666", "acme");
    await mkdir(join(dentro, ".."), { recursive: true });
    git(home, "clone", "-q", clone, dentro);
    const r = await limparPastas([encerrada("Dev 3/clonou-666666")], opcoes(executor()));
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

  it("a passada pede a lista à ponte, reconfirma, limpa e relata; ponte antiga (sem a rota) não faz nada", async () => {
    await worktree("Dev 1/fix-888888/acme", "feat/888");
    const relatos: RelatoLimpeza[] = [];
    let pedidos = 0;
    const ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza"> = { pastasParaLimpar: async () => { pedidos++; return [encerrada("Dev 1/fix-888888")]; }, relatarLimpeza: async (_p, r) => { relatos.push(r); } };
    const limpeza = iniciarLimpezaDasTasks({ ...opcoes(executor()), ponte, pessoaId: "p", primeiraMs: 10 ** 9 });
    const r = await limpeza.passada();
    limpeza.parar();
    expect(r).toMatchObject({ removidas: 1, pastasApagadas: 1 });
    expect(pedidos).toBe(2);
    expect(relatos).toHaveLength(1);
    expect(existsSync(join(home, "nod", ".limpeza.lock"))).toBe(false);
    const antiga = iniciarLimpezaDasTasks({ ...opcoes(executor()), ponte: {}, pessoaId: "p", primeiraMs: 10 ** 9 });
    expect(await antiga.passada()).toBeNull();
    antiga.parar();
  });
});

describe("ADR-096: o disco que se cuida", () => {
  it("código com mais de 8 níveis de pasta não é mais `aninhado`: a worktree sai (o caso da VM dos bots em 11/10)", async () => {
    const wt = await worktree("Ze 1/gfk-1923-fatia-5-998a48/acme", "feat/fundo");
    const fundo = join(wt, "packages", "mundo-vivo", "tools", "provas", "vereditos", "mundo", "rondas", "r14-mundo-vivo", "palcos", "um");
    await mkdir(fundo, { recursive: true });
    await writeFile(join(fundo, "palco.json"), "{}\n");
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "fundo");
    const r = await limparPastas([encerrada("Ze 1/gfk-1923-fatia-5-998a48")], opcoes(executor()));
    expect(r).toMatchObject({ removidas: 1, puladas: {} });
    expect(existsSync(wt)).toBe(false);
  });

  it("um repositório de verdade muito fundo, em pasta ignorada, ainda segura a worktree", async () => {
    const wt = await worktree("Ze 1/fundo-com-git-111111/acme", "feat/fundo-git");
    const escondido = join(wt, ".claude", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "repo");
    await mkdir(join(escondido, ".."), { recursive: true });
    git(home, "clone", "-q", clone, escondido);
    const r = await limparPastas([encerrada("Ze 1/fundo-com-git-111111")], opcoes(executor()));
    expect(r).toMatchObject({ removidas: 0, puladas: { aninhado: 1 } });
    expect(existsSync(join(escondido, ".git"))).toBe(true);
  });

  it("o cache de ferramenta dentro de um pacote do monorepo (`packages/x/.turbo/`) sai junto com a worktree", async () => {
    await writeFile(join(clone, ".gitignore"), "node_modules/\n.turbo/\n.expo/\n");
    git(clone, "commit", "-q", "-am", "ignora caches");
    const wt = await worktree("Ze 1/turbo-222222/acme", "feat/turbo");
    for (const pacote of ["packages/auth", "apps/mobile"]) {
      await mkdir(join(wt, pacote), { recursive: true });
      await writeFile(join(wt, pacote, "package.json"), "{}\n");
    }
    git(wt, "add", ".");
    git(wt, "commit", "-q", "-m", "pacotes");
    await mkdir(join(wt, "packages", "auth", ".turbo", "cache"), { recursive: true });
    await writeFile(join(wt, "packages", "auth", ".turbo", "cache", "a.tar"), "x");
    await mkdir(join(wt, "apps", "mobile", ".expo"), { recursive: true });
    await writeFile(join(wt, "apps", "mobile", ".expo", "settings.json"), "{}");
    const r = await limparPastas([encerrada("Ze 1/turbo-222222")], opcoes(executor()));
    expect(r).toMatchObject({ removidas: 1, puladas: {} });
  });

  it("os comandos pesados da limpeza pedem prioridade baixa; os leves não", async () => {
    await worktree("Dev 1/fundo-333333/acme", "feat/prioridade");
    const { executar, chamadas } = executor();
    await limparPastas([encerrada("Dev 1/fundo-333333")], opcoes({ executar }));
    expect(chamadas.find((c) => c.includes(" status "))).toMatch(/^\[fundo\] git /);
    expect(chamadas.find((c) => c.includes("worktree remove"))).toMatch(/^\[fundo\] git /);
    expect(chamadas.find((c) => c.includes("worktree list"))).toMatch(/^git /);
  });

  it("prioridade baixa: ionice + nice no Linux, taskpolicy no macOS, nada sem as ferramentas", () => {
    const tem = (...c: string[]) => (x: string) => c.includes(x);
    // Nunca a classe ociosa (`ionice -c3`, `taskpolicy -b`): com a máquina cheia ela não deixa a limpeza andar.
    expect(prefixoDeFundo("linux", tem("/usr/bin/nice", "/usr/bin/ionice"))).toEqual(["/usr/bin/ionice", "-c", "2", "-n", "7", "/usr/bin/nice", "-n", "10"]);
    expect(prefixoDeFundo("linux", tem("/bin/nice"))).toEqual(["/bin/nice", "-n", "10"]);
    expect(prefixoDeFundo("linux", tem())).toEqual([]);
    expect(prefixoDeFundo("darwin", tem("/usr/sbin/taskpolicy"))).toEqual(["/usr/sbin/taskpolicy", "-c", "utility"]);
    expect(prefixoDeFundo("darwin", tem())).toEqual([]);
    expect(prefixoDeFundo("win32", tem("/usr/bin/nice"))).toEqual([]);
  });

  it("o prefixo de fundo roda o comando de verdade, e o programa ausente atrás dele ainda é `não achou` (-1)", async () => {
    const executar = criarExecutarComando(ENV_GIT, home, ["/usr/bin/env"]);
    const r = await executar("git", ["--version"], { fundo: true });
    expect(r.codigo).toBe(0);
    expect(r.stdout).toContain("git version");
    expect((await executar("programa-que-nao-existe-nod", [], { fundo: true })).codigo).toBe(-1);
    expect((await executar("programa-que-nao-existe-nod", [])).codigo).toBe(-1);
    // O prefixo de verdade desta máquina (taskpolicy no macOS, nice/ionice no Linux) também.
    const daMaquina = criarExecutarComando(ENV_GIT, home);
    expect((await daMaquina("git", ["--version"], { fundo: true })).codigo).toBe(0);
    expect((await daMaquina("programa-que-nao-existe-nod", [], { fundo: true })).codigo).toBe(-1);
  });

  it("disco amarelo dispara a passada apertada: pede com `apertado`, limpa os caches com prioridade baixa e relata; verde não dispara", async () => {
    await worktree("Dev 1/apertada-444444/acme", "feat/apertada");
    const relatos: RelatoLimpeza[] = [];
    const pedidos: unknown[] = [];
    const ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza"> = {
      pastasParaLimpar: async (_p, o) => { pedidos.push(o); return [encerrada("Dev 1/apertada-444444")]; },
      relatarLimpeza: async (_p, r) => { relatos.push(r); },
    };
    const { executar, chamadas } = executor();
    let livreMb = 50 * 1024;
    const limpeza = iniciarLimpezaDasTasks({ ...opcoes({ executar }), ponte, pessoaId: "p", primeiraMs: 10 ** 9, vigiaDoDiscoMs: 10, disco: async () => ({ livreMb, totalMb: 100 * 1024 }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(relatos).toHaveLength(0);
    livreMb = 8 * 1024;
    await vi.waitFor(() => expect(relatos).toHaveLength(1), { timeout: 20_000 });
    limpeza.parar();
    expect(pedidos[0]).toEqual({ apertado: true });
    expect(relatos[0]).toMatchObject({ apertada: true, removidas: 1 });
    expect(chamadas).toContain("[fundo] npm cache clean --force");
    expect(chamadas).toContain("[fundo] pnpm store prune");
    // As worktrees saem antes do prune do pnpm (ele só tira do store o que nenhum projeto usa).
    expect(chamadas.findIndex((c) => c.includes("worktree remove"))).toBeLessThan(chamadas.indexOf("[fundo] pnpm store prune"));
  });

  it("a passada apertada não se repete antes de 30 min, mesmo com o disco ainda amarelo", async () => {
    await mkdir(join(home, "nod"), { recursive: true }); // a trava da passada mora em ~/nod
    let relatos = 0;
    const ponte: Pick<PonteInterna, "pastasParaLimpar" | "relatarLimpeza"> = { pastasParaLimpar: async () => [], relatarLimpeza: async () => { relatos++; } };
    const limpeza = iniciarLimpezaDasTasks({ ...opcoes(executor()), ponte, pessoaId: "p", primeiraMs: 10 ** 9, vigiaDoDiscoMs: 10, disco: async () => ({ livreMb: 1024, totalMb: 100 * 1024 }) });
    await vi.waitFor(() => expect(relatos).toBe(1), { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 100));
    limpeza.parar();
    expect(relatos).toBe(1);
  });
});
