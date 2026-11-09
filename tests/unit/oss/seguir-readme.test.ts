import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ambienteLimpo,
  conferirUmaVez,
  encerrarGrupo,
  exigirPortaLivre,
  extrairPassos,
  montarRoteiro,
  prepararPasta,
  URL_PUBLICA,
} from "../../../scripts/oss/seguir-readme.mjs";

/**
 * ADA-287: o script que segue o README público ao pé da letra. As partes puras (ler os passos, montar o roteiro só
 * com as trocas declaradas, limpar o ambiente) rodam sempre; a execução completa (npm ci + subir o app + /api/saude)
 * só com NOD_SEGUIR_README=1, porque leva minutos e precisa de Postgres 16 (Docker ou initdb no PATH).
 */
const RAIZ = join(import.meta.dirname, "../../..");
const README = readFileSync(join(RAIZ, "oss/publico/README.md"), "utf8");

const bloco = (nome: string, corpo: string) => "```bash passo=" + nome + "\n" + corpo + "\n```\n";
const minimo = (extra: Partial<Record<string, string>> = {}) =>
  ["clonar", "instalar", "banco-docker", "banco-proprio", "subir", "conferir"]
    .map((n) => bloco(n, extra[n] ?? `echo ${n}`))
    .join("\n");

describe("extrairPassos", () => {
  it("lê os seis passos do README público, na ordem", () => {
    expect(extrairPassos(README).map((p) => p.nome)).toEqual(["clonar", "instalar", "banco-docker", "banco-proprio", "subir", "conferir"]);
  });

  it("ignora bloco bash sem passo= e linhas de comentário", () => {
    const texto = "```bash\nnpm run check\n```\n" + minimo({ instalar: "# comentário\nnpm ci" });
    const passos = extrairPassos(texto);
    expect(passos).toHaveLength(6);
    expect(passos[1]).toEqual({ nome: "instalar", comandos: ["npm ci"] });
  });

  it.each([
    ["falta um passo", minimo().replace(/```bash passo=subir[\s\S]*?```\n/, ""), /falta o passo subir/],
    ["passo repetido", minimo() + bloco("conferir", "echo de novo"), /repetido/],
    ["passo desconhecido", minimo() + bloco("deploy", "echo"), /desconhecido/],
    ["fora de ordem", bloco("instalar", "a") + bloco("clonar", "b") + minimo().replace(/```bash passo=(clonar|instalar)[\s\S]*?```\n/g, ""), /fora de ordem/],
    ["passo vazio", minimo({ subir: "# só comentário" }), /sem comando/],
  ])("recusa README com %s", (_caso, texto, erro) => {
    expect(() => extrairPassos(texto)).toThrow(erro);
  });
});

describe("montarRoteiro", () => {
  const passos = extrairPassos(README);
  const base = { origem: "/tmp/origem/nod.git", banco: "proprio" as const, temMise: true, portaApi: 41000, portaPg: 42000 };

  it("só troca a URL do clone e as portas; o resto é o README literal", () => {
    const r = montarRoteiro(passos, base);
    const literal = (n: string) => passos.find((p) => p.nome === n)!.comandos;
    expect(r.preparar[0]).toBe(`git clone '/tmp/origem/nod.git'`);
    expect(literal("clonar")[0]).toBe(`git clone ${URL_PUBLICA}`);
    expect(r.preparar.slice(1, 1 + literal("clonar").length - 1 + literal("instalar").length)).toEqual([...literal("clonar").slice(1), ...literal("instalar")]);
    expect(r.subir).toEqual(literal("subir"));
    expect(r.subir.join("\n")).toContain("NOD_LOGIN=stub npm run dev");
    expect(r.conferir).toEqual(["curl -fsS http://127.0.0.1:41000/api/saude"]);
    expect(r.preparar.join("\n")).toContain("127.0.0.1:42000");
    expect(r.preparar.join("\n")).not.toContain("5434");
    expect(r.trocas).toEqual(expect.arrayContaining([expect.stringMatching(/git clone/), expect.stringMatching(/5434 → 42000/), expect.stringMatching(/8888 → 41000/)]));
  });

  it("com Docker usa o passo banco-docker e não toca na porta", () => {
    const r = montarRoteiro(passos, { ...base, banco: "docker", portaPg: 5434 });
    expect(r.preparar).toContain("npm run dev:setup");
    expect(r.preparar.join("\n")).not.toContain("01_roles.sql");
  });

  it("sem mise pula só as linhas do mise, como o README diz", () => {
    const r = montarRoteiro(passos, { ...base, temMise: false });
    expect(r.preparar.some((c) => c.startsWith("mise "))).toBe(false);
    expect(r.preparar).toContain("npm ci");
    expect(r.trocas.some((t) => t.startsWith("sem mise"))).toBe(true);
  });

  it("recusa clonar sem git clone", () => {
    const texto = minimo({ clonar: "cp -r /x nod" });
    expect(() => montarRoteiro(extrairPassos(texto), base)).toThrow(/git clone/);
  });
});

describe("ambienteLimpo", () => {
  it("não deixa o banco nem o servidor do pai vazarem para os passos", () => {
    const env = ambienteLimpo(
      { PATH: "/bin", HOME: "/h", DATABASE_URL: "postgres://prod", NOD_EXECUTOR: "claude-cli", NOD_LOGIN: "google", PGPASSWORD: "x", npm_config_x: "y" },
      { portaApi: 1, portaWeb: 2, portaPg: 3, nodHome: "/tmp/h" },
    );
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h", NOD_API_PORT: "1", NOD_WEB_PORT: "2", NOD_HOME: "/tmp/h" });
    expect(env.DATABASE_URL).toBe("postgres://nod_app:nod@127.0.0.1:3/nod");
    expect(env.DATABASE_URL_TEST).toBe("postgres://nod_app:nod@127.0.0.1:3/nod_test");
    expect(env).not.toHaveProperty("NOD_EXECUTOR");
    expect(env).not.toHaveProperty("NOD_LOGIN");
    expect(env).not.toHaveProperty("PGPASSWORD");
    expect(env).not.toHaveProperty("npm_config_x");
  });
});

describe.runIf(process.env.NOD_SEGUIR_README === "1")("execução completa (NOD_SEGUIR_README=1)", () => {
  it("seguindo o README numa pasta limpa, o /api/saude responde 200", () => {
    const r = spawnSync("node", [join(RAIZ, "scripts/oss/seguir-readme.mjs")], { encoding: "utf8", timeout: 20 * 60_000 });
    expect(r.stdout + r.stderr).toMatch(/\[seguir-readme\] OK: curl/);
    expect(r.status).toBe(0);
  }, 20 * 60_000);
});

describe("revisão: segurança e limpeza do seguir-readme", () => {
  const passos = extrairPassos(README);
  const base = { origem: "/tmp/origem/nod.git", banco: "proprio" as const, temMise: true, portaApi: 41000, portaPg: 42000 };

  it("a origem do clone vai entre aspas: pasta com espaço ou $(...) não quebra nem executa nada", () => {
    const origem = "/tmp/a b/$(touch pwned)'x/nod.git";
    const r = montarRoteiro(passos, { ...base, origem });
    const eco = spawnSync("bash", ["-c", r.preparar[0]!.replace(/^git clone /, "printf '%s' ")], { encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "aspas-")) });
    expect(eco.stdout).toBe(origem);
  });

  it("--pasta que já existe com conteúdo é recusada (o fim apaga a pasta inteira)", () => {
    const cheia = mkdtempSync(join(tmpdir(), "cheia-"));
    writeFileSync(join(cheia, "importante.txt"), "não apague");
    expect(() => prepararPasta(cheia)).toThrow(/não está vazia/);
    expect(existsSync(join(cheia, "importante.txt"))).toBe(true);
    const nova = join(cheia, "nova");
    expect(prepararPasta(nova)).toBe(nova);
    expect(existsSync(nova)).toBe(true);
    rmSync(cheia, { recursive: true, force: true });
  });

  it("o conferir tem prazo por tentativa: um curl pendurado não segura o script além do prazo", () => {
    const t0 = Date.now();
    expect(conferirUmaVez(["sleep 20"], process.env, 300).ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("encerrarGrupo mata o grupo inteiro, mesmo quem ignora SIGTERM", async () => {
    const filho = spawn("bash", ["-c", "trap '' TERM; sleep 60 & echo $!; wait"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const neto = Number(await new Promise<string>((ok) => filho.stdout.once("data", (d: Buffer) => ok(d.toString()))));
    await encerrarGrupo(filho, 300);
    await new Promise((ok) => setTimeout(ok, 200));
    expect(vivo(neto)).toBe(false);
    expect(filho.exitCode !== null || filho.signalCode !== null).toBe(true);
  });

  it("com Docker, o compose ganha um projeto próprio e o ambiente do pai não escolhe outro", () => {
    const env = ambienteLimpo({ PATH: "/bin", COMPOSE_PROJECT_NAME: "nod", COMPOSE_FILE: "/x.yml" }, { portaApi: 1, portaWeb: 2, portaPg: 5434, nodHome: "/h", projetoCompose: "seguir-readme-abc" });
    expect(env.COMPOSE_PROJECT_NAME).toBe("seguir-readme-abc");
    expect(env).not.toHaveProperty("COMPOSE_FILE");
  });

  it("com Docker, recusa rodar se a 5434 já tem dono (seria o banco de outra pessoa)", async () => {
    const s = createServer();
    await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
    const porta = (s.address() as { port: number }).port;
    await expect(exigirPortaLivre(porta)).rejects.toThrow(/ocupada/);
    await new Promise((ok) => s.close(ok));
    await expect(exigirPortaLivre(porta)).resolves.toBeUndefined();
  });

  it.runIf(spawnSync("initdb", ["--version"]).status === 0)(
    "SIGTERM no meio do subir derruba o servidor, para o Postgres e apaga a pasta",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "sinal-"));
      const readme = join(dir, "README.md");
      const pasta = join(dir, "rodada");
      const pid = join(dir, "sleep.pid");
      writeFileSync(
        readme,
        [
          bloco("clonar", `git clone ${URL_PUBLICA}\ncd nod`),
          bloco("instalar", "true"),
          bloco("banco-docker", "true"),
          bloco("banco-proprio", "true"),
          bloco("subir", `sleep 300 & echo $! > ${pid}; wait`),
          bloco("conferir", "false"),
        ].join("\n"),
      );
      const script = spawn("node", [join(RAIZ, "scripts/oss/seguir-readme.mjs"), "--readme", readme, "--pasta", pasta, "--banco", "proprio", "--prazo-s", "120"], { stdio: "ignore" });
      const ate = Date.now() + 90_000;
      while (!existsSync(pid) && Date.now() < ate) await new Promise((ok) => setTimeout(ok, 200));
      const sleepPid = Number(readFileSync(pid, "utf8"));
      script.kill("SIGTERM");
      const codigo = await new Promise<number | null>((ok) => script.once("exit", ok));
      expect(codigo).not.toBe(0);
      expect(vivo(sleepPid)).toBe(false);
      expect(existsSync(pasta)).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    },
    120_000,
  );
});

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
