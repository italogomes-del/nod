import { execFileSync, spawn, spawnSync } from "node:child_process";

// Sobe API (8888) e web (5274). Se o mise existir, envelopa para garantir o Node pinado
// (nvm/asdf ganham do mise quando ativos no shell — ver AGENTS.md).
const temMise = spawnSync("mise", ["--version"], { stdio: "ignore" }).status === 0;
const prefixo = temMise ? ["mise", "exec", "--"] : [];

/**
 * Os dois filhos e os descendentes deles no MESMO grupo (definido em 2026-10-09, ADR-089, #217): npm, tsx, o servidor e
 * o Vite. Os bots nascem em grupo próprio (processo.ts) e ficam de fora — quem os leva é o `exit` do servidor. A busca
 * parte dos filhos, não deste processo, para não incluir o próprio `ps`. null = sem `ps`.
 */
function arvore() {
  try {
    const linhas = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 10_000 })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number));
    const meuGrupo = linhas.find(([pid]) => pid === process.pid)?.[2];
    const filhos = new Map();
    for (const [pid, ppid, pgid] of linhas) {
      if (pgid !== meuGrupo) continue;
      if (!filhos.has(ppid)) filhos.set(ppid, []);
      filhos.get(ppid).push(pid);
    }
    // Só o filho que ainda está vivo e é nosso: o pid de quem já saiu pode ser de outro programa.
    const raizes = [api.pid, web.pid].filter((r) => r !== undefined && linhas.some(([pid, ppid]) => pid === r && ppid === process.pid));
    const todos = [...raizes];
    const fila = [...raizes];
    while (fila.length > 0) {
      for (const f of filhos.get(fila.shift()) ?? []) {
        todos.push(f);
        fila.push(f);
      }
    }
    return todos;
  } catch {
    return null;
  }
}

// definido em 2026-10-08: se um dos dois morre, o outro vai junto. Antes o dev.mjs saía quando a API morria e o Vite
// ficava órfão servindo a página com o proxy para uma 8888 morta — toda tela dizia "Algo deu errado" e nada religava.
// revisto em 2026-10-09 (ADR-089, #217): o sinal vai à árvore inteira, não só ao npx/mise da ponta — quem está no meio
// pode não repassar, e o servidor que não recebe sinal não roda o `exit` que leva os grupos dos bots. O SIGHUP (terminal
// fechado) entra no mesmo caminho. O servidor trata o mesmo sinal repetido em menos de 3 s como eco (server.ts).
// revisto em 2026-10-09 (revisão do #223): o SIGINT NÃO é repassado — o Ctrl+C do terminal já chega ao grupo inteiro, e
// o repasse (depois de um `ps` que sob carga leva segundos) virava "segundo sinal" no servidor e pulava a drenagem.
// `sinal` null = só marca a saída e espera os filhos.
let saindo = false;
function encerrar(codigo, sinal = "SIGTERM") {
  if (saindo) return;
  saindo = true;
  process.exitCode = codigo;
  if (sinal === null) return;
  const pids = arvore();
  if (pids === null) {
    api.kill(sinal);
    web.kill(sinal);
  } else {
    for (const pid of pids) {
      try {
        process.kill(pid, sinal);
      } catch {
        // já saiu
      }
    }
  }
}

function run(args, extra = {}) {
  const [cmd, ...rest] = [...prefixo, ...args];
  const child = spawn(cmd, rest, { stdio: "inherit", ...extra });
  child.on("exit", (code, sinal) => encerrar(code ?? (sinal ? 1 : 0)));
  return child;
}

const apiPort = process.env.NOD_API_PORT ?? "8888";
const webPort = process.env.NOD_WEB_PORT ?? "5274";

// revisto em 2026-10-09 (revisão do #223): `node` direto, como o `npm start` (o Node 24 tira os tipos). O tsx repassava o
// sinal ao servidor e, sem confirmação em ~60 ms, mandava SIGKILL (relaySignalToChild): sem drenagem e sem o `exit` que
// leva os grupos dos bots.
const api = run(["node", "src/adapters/http/server.ts"], {
  env: { ...process.env, NOD_API_PORT: apiPort },
});
const web = run(["npx", "vite", "--host", "127.0.0.1", "--port", webPort], {
  env: { ...process.env, NOD_API_PORT: apiPort },
});

process.on("SIGINT", () => encerrar(130, null));
process.on("SIGTERM", () => encerrar(143, "SIGTERM"));
process.on("SIGHUP", () => encerrar(129, "SIGHUP"));
