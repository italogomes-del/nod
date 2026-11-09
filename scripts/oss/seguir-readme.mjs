#!/usr/bin/env node
/**
 * ADA-287: segue a seção "Rodar local" do README público AO PÉ DA LETRA numa pasta limpa e prova que o nod sobe
 * (critério "uma pessoa de fora consegue rodar o nod local seguindo o README").
 *
 * Os comandos saem do próprio README: cada bloco ```bash passo=<nome> é um passo. A ordem é a do README:
 *   clonar → instalar → banco-docker | banco-proprio → subir → conferir
 *
 * O que o script troca, e só isso (cada troca é impressa):
 *   1. A URL do `git clone` vira um repositório git local montado do commit atual (HEAD) com oss/publico/ por cima
 *      da raiz, como o export da ADA-282 fará. Assim o teste vale antes de o repo público existir.
 *   2. Portas: a máquina é dividida com outros processos, então a API, a web e o Postgres vão para portas livres
 *      (NOD_API_PORT, NOD_WEB_PORT e as DATABASE_URL* pelo ambiente, que ganha do .env). É o ajuste que o README
 *      manda fazer em "Porta ocupada" e no "Sem Docker".
 *   3. Sem `mise` no PATH, as linhas que começam com `mise ` são puladas, como o README diz.
 *   4. Banco: com Docker roda o passo banco-docker; sem Docker roda o banco-proprio contra um Postgres 16
 *      descartável (initdb numa pasta temporária, superusuário postgres com trust), que é o "Postgres seu" do README.
 *
 * Uso: node scripts/oss/seguir-readme.mjs [--banco docker|proprio] [--readme oss/publico/README.md]
 *                                         [--pasta /tmp/x] [--manter] [--prazo-s 240]
 * Saída 0 = /api/saude respondeu 200 seguindo o README. Qualquer outra = o README não basta (o passo é impresso).
 * O ambiente do pai que aponta para outro banco ou servidor (DATABASE_URL*, NOD_*, COMPOSE_*) não passa para os passos.
 * --pasta precisa não existir ou estar vazia: no fim (sem --manter) a pasta inteira é apagada. Com Docker, a 5434
 * precisa estar livre e o compose roda com um projeto próprio, derrubado (com o volume) no fim. Ctrl+C e SIGTERM
 * também limpam: o grupo do servidor morre (SIGKILL se ignorar o SIGTERM), o Postgres para e a pasta some.
 */
/* eslint-disable no-console -- script de terminal: o relatório é a saída */
import { setTimeout as esperar } from "node:timers/promises";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const URL_PUBLICA = "https://github.com/marlonwlv/nod.git";
export const ORDEM = ["clonar", "instalar", "banco-docker", "banco-proprio", "subir", "conferir"];

/** Aspas simples de shell: o caminho vira um argumento só, sem expansão. */
export const aspas = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Lê os blocos ```bash passo=<nome> do README, na ordem em que aparecem. Erra (com a frase) se faltar um passo,
 * se um passo aparecer duas vezes ou se a ordem não for a de ORDEM: o README é o roteiro, então ele precisa estar
 * inteiro.
 * @param {string} texto
 * @returns {{ nome: string, comandos: string[] }[]}
 */
export function extrairPassos(texto) {
  const passos = [];
  const re = /^```bash[ \t]+passo=([a-z-]+)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  for (const m of texto.matchAll(re)) {
    const comandos = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (comandos.length === 0) throw new Error(`passo ${m[1]} sem comando`);
    passos.push({ nome: m[1], comandos });
  }
  const nomes = passos.map((p) => p.nome);
  for (const n of nomes) {
    if (!ORDEM.includes(n)) throw new Error(`passo desconhecido no README: ${n}`);
    if (nomes.indexOf(n) !== nomes.lastIndexOf(n)) throw new Error(`passo repetido no README: ${n}`);
  }
  for (const n of ORDEM) if (!nomes.includes(n)) throw new Error(`falta o passo ${n} no README`);
  const posicoes = nomes.map((n) => ORDEM.indexOf(n));
  if (posicoes.some((p, i) => i > 0 && p < posicoes[i - 1])) throw new Error(`passos fora de ordem no README: ${nomes.join(" → ")}`);
  return passos;
}

/**
 * Monta o roteiro a partir dos passos e das trocas permitidas (cabeçalho). Puro, para o teste conferir que nada além
 * das trocas declaradas muda.
 * @param {{ nome: string, comandos: string[] }[]} passos
 * @param {{ origem: string, banco: "docker" | "proprio", temMise: boolean, portaApi: number, portaPg: number }} o
 */
export function montarRoteiro(passos, o) {
  const de = (nome) => passos.find((p) => p.nome === nome).comandos;
  const trocas = [];
  const trocarPorta = (c) => c.replaceAll("127.0.0.1:5434", `127.0.0.1:${o.portaPg}`);
  const clonar = de("clonar").map((c) => {
    if (!c.includes(URL_PUBLICA)) return c;
    trocas.push(`git clone: ${URL_PUBLICA} → ${o.origem}`);
    return c.replace(URL_PUBLICA, aspas(o.origem));
  });
  if (!clonar.some((c) => c.startsWith("git clone"))) throw new Error("o passo clonar não tem git clone");
  const instalar = de("instalar").filter((c) => {
    if (o.temMise || !c.startsWith("mise ")) return true;
    trocas.push(`sem mise: pulei "${c}"`);
    return false;
  });
  const banco = (o.banco === "docker" ? de("banco-docker") : de("banco-proprio")).map((c) => {
    const novo = trocarPorta(c);
    if (novo !== c) trocas.push(`porta do Postgres: 5434 → ${o.portaPg}`);
    return novo;
  });
  const conferir = de("conferir").map((c) => {
    const novo = c.replaceAll("127.0.0.1:8888", `127.0.0.1:${o.portaApi}`);
    if (novo !== c) trocas.push(`porta da API: 8888 → ${o.portaApi}`);
    return novo;
  });
  return { preparar: [...clonar, ...instalar, ...banco], subir: de("subir"), conferir, trocas };
}

/** O ambiente dos passos: o do pai sem o que aponta para outro banco ou servidor, mais as portas desta rodada. */
export function ambienteLimpo(pai, o) {
  const env = {};
  for (const [k, v] of Object.entries(pai)) {
    if (/^(DATABASE_URL|NOD_|PG[A-Z]*$|npm_|COMPOSE_)/.test(k)) continue;
    env[k] = v;
  }
  const pg = (u, b) => `postgres://${u}:nod@127.0.0.1:${o.portaPg}/${b}`;
  return {
    ...env,
    NOD_API_PORT: String(o.portaApi),
    NOD_WEB_PORT: String(o.portaWeb),
    NOD_HOME: o.nodHome,
    DATABASE_URL: pg("nod_app", "nod"),
    DATABASE_URL_DONO: pg("nod_dono", "nod"),
    DATABASE_URL_TEST: pg("nod_app", "nod_test"),
    ...(o.projetoCompose ? { COMPOSE_PROJECT_NAME: o.projetoCompose } : {}),
  };
}

/** A pasta da rodada: nova ou vazia, porque o fim apaga tudo nela. Devolve o caminho absoluto, já criado. */
export function prepararPasta(pasta) {
  const abs = resolve(pasta);
  if (existsSync(abs) && readdirSync(abs).length > 0) throw new Error(`--pasta ${abs} não está vazia; o fim apagaria o que tem nela`);
  mkdirSync(abs, { recursive: true });
  return abs;
}

/** Com Docker o README usa a 5434 fixa: se ela já tem dono, a rodada mexeria no banco de outra pessoa. */
export function exigirPortaLivre(porta) {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.once("error", () => erro(new Error(`porta ${porta} ocupada: com Docker o README usa a ${porta}; libere-a ou rode com --banco proprio`)));
    s.listen(porta, "127.0.0.1", () => s.close(() => ok(undefined)));
  });
}

/** Uma tentativa do passo conferir, com prazo: um curl pendurado não segura o script. */
export function conferirUmaVez(comandos, env, prazoMs) {
  const r = spawnSync("bash", ["-c", comandos.join("\n")], { env, encoding: "utf8", timeout: prazoMs, killSignal: "SIGKILL" });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim() };
}

/** Derruba o grupo do processo (detached): SIGTERM, espera até prazoMs e manda SIGKILL em quem sobrar. */
export async function encerrarGrupo(filho, prazoMs) {
  if (!filho?.pid) return;
  const sinal = (s) => {
    try {
      process.kill(-filho.pid, s);
      return true;
    } catch {
      return false; // o grupo já saiu
    }
  };
  if (!sinal("SIGTERM")) return;
  const saiu = filho.exitCode !== null || filho.signalCode !== null ? Promise.resolve() : new Promise((ok) => filho.once("exit", ok));
  await Promise.race([saiu, esperar(prazoMs)]);
  // o líder pode ter saído e deixado netos no grupo: o SIGKILL vai para o grupo todo
  sinal("SIGKILL");
  await Promise.race([saiu, esperar(prazoMs)]);
}

function portaLivre() {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.unref();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const tem = (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const log = (s) => console.log(`[seguir-readme] ${s}`);

/** Snapshot do commit atual com oss/publico/ por cima da raiz, num repositório git próprio (o "repo público"). */
function montarOrigem(pasta) {
  // termina em /nod.git como a URL pública, para o `git clone` criar a mesma pasta `nod` que o README espera
  const origem = join(pasta, "origem", "nod.git");
  mkdirSync(origem, { recursive: true });
  const tar = execFileSync("git", ["-C", RAIZ, "archive", "--format=tar", "HEAD"], { maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", origem], { input: tar });
  const publico = join(origem, "oss/publico");
  // oss/publico vai inteira, como no export da ADA-282 (texto só interno mora fora dela, em oss/)
  cpSync(publico, origem, { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", origem, ...a], { stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=seguir-readme", "-c", "user.email=seguir-readme@exemplo.com", "commit", "-q", "--no-verify", "-m", "snapshot");
  return origem;
}

/** Postgres 16 descartável: o "Postgres seu" do README, com superusuário postgres e trust só em 127.0.0.1. */
function subirPostgres(pasta, porta) {
  const dados = join(pasta, "pg");
  execFileSync("initdb", ["-D", dados, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-instructions"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dados, "-l", join(pasta, "pg.log"), "-w", "-o", `-p ${porta} -k ${aspas(pasta)} -c listen_addresses=127.0.0.1`, "start"], { stdio: "ignore" });
  return () => spawnSync("pg_ctl", ["-D", dados, "-m", "fast", "stop"], { stdio: "ignore" });
}

function rodar(comandos, cwd, env) {
  const r = spawnSync("bash", ["-euo", "pipefail", "-c", comandos.join("\n")], { cwd, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`passo falhou (saída ${r.status}):\n${comandos.join("\n")}`);
}

async function principal() {
  const args = process.argv.slice(2);
  const opt = (n, padrao) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : padrao;
  };
  const readme = resolve(RAIZ, opt("readme", "oss/publico/README.md"));
  const banco = opt("banco", tem("docker") ? "docker" : "proprio");
  if (banco !== "docker" && banco !== "proprio") throw new Error(`--banco ${banco}: use docker ou proprio`);
  const prazoMs = Number(opt("prazo-s", "240")) * 1000;
  const pastaOpt = opt("pasta");
  const pasta = pastaOpt ? prepararPasta(pastaOpt) : mkdtempSync(join(tmpdir(), "seguir-readme-"));
  const manter = args.includes("--manter");

  const limpezas = [];
  let servidor;
  let encerrando;
  // idempotente: o finally e o handler de sinal podem chamar os dois; cada limpeza que falha não segura as outras
  const encerrar = () =>
    (encerrando ??= (async () => {
      await encerrarGrupo(servidor, 5000);
      for (const f of limpezas.reverse()) {
        try {
          f();
        } catch (e) {
          log(`limpeza falhou: ${e.message}`);
        }
      }
      if (!manter) rmSync(pasta, { recursive: true, force: true, maxRetries: 3 });
    })());
  const aoSinal = (s) => {
    log(`recebi ${s}: limpando`);
    void encerrar().finally(() => process.exit(s === "SIGINT" ? 130 : 143));
  };
  process.once("SIGINT", aoSinal);
  process.once("SIGTERM", aoSinal);

  try {
    const passos = extrairPassos(readFileSync(readme, "utf8"));
    const [portaApi, portaWeb, portaPgLivre] = await Promise.all([portaLivre(), portaLivre(), portaLivre()]);
    const portaPg = banco === "docker" ? 5434 : portaPgLivre;
    if (banco === "docker") await exigirPortaLivre(portaPg);
    const projetoCompose = banco === "docker" ? `seguir-readme-${randomBytes(4).toString("hex")}` : undefined;
    const origem = montarOrigem(pasta);
    const roteiro = montarRoteiro(passos, { origem, banco, temMise: tem("mise"), portaApi, portaPg });
    const env = ambienteLimpo(process.env, { portaApi, portaWeb, portaPg, nodHome: join(pasta, "nod-home"), projetoCompose });
    log(`pasta ${pasta} · banco ${banco} · API ${portaApi} · web ${portaWeb} · Postgres ${portaPg}`);
    for (const t of roteiro.trocas) log(`troca: ${t}`);
    if (projetoCompose) log(`troca: COMPOSE_PROJECT_NAME=${projetoCompose} (derrubado com o volume no fim)`);

    const app = join(pasta, "nod");
    if (banco === "proprio") limpezas.push(subirPostgres(pasta, portaPg));
    else limpezas.push(() => spawnSync("docker", ["compose", "down", "-v"], { cwd: app, env, stdio: "ignore" }));
    rodar(roteiro.preparar, pasta, env);
    if (!existsSync(join(app, "package.json"))) throw new Error("depois do clonar não existe nod/package.json");
    log(`subindo: ${roteiro.subir.join(" && ")}`);
    servidor = spawn("bash", ["-euo", "pipefail", "-c", roteiro.subir.join("\n")], { cwd: app, env, stdio: "inherit", detached: true });
    const ate = Date.now() + prazoMs;
    while (Date.now() < ate) {
      if (servidor.exitCode !== null || servidor.signalCode !== null) {
        throw new Error(`o servidor saiu com ${servidor.exitCode ?? servidor.signalCode} antes de ficar saudável`);
      }
      const r = conferirUmaVez(roteiro.conferir, env, Math.max(1000, Math.min(15_000, ate - Date.now())));
      if (r.ok) {
        log(`OK: ${roteiro.conferir.join(" ")} → ${r.saida.slice(0, 200)}`);
        return 0;
      }
      await esperar(2000);
    }
    throw new Error(`/api/saude não respondeu 200 em ${prazoMs / 1000} s`);
  } finally {
    await encerrar();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`[seguir-readme] FALHOU: ${e.message}`);
      process.exit(1);
    },
  );
}
