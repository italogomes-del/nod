import { spawn, spawnSync } from "node:child_process";

// Sobe API (8888) e web (5274). Se o mise existir, envelopa para garantir o Node pinado
// (nvm/asdf ganham do mise quando ativos no shell — ver AGENTS.md).
const temMise = spawnSync("mise", ["--version"], { stdio: "ignore" }).status === 0;
const prefixo = temMise ? ["mise", "exec", "--"] : [];

// definido em 2026-10-08: se um dos dois morre, o outro vai junto. Antes o dev.mjs saía quando a API morria e o Vite
// ficava órfão servindo a página com o proxy para uma 8888 morta — toda tela dizia "Algo deu errado" e nada religava.
let saindo = false;
function encerrar(codigo) {
  if (saindo) return;
  saindo = true;
  api.kill();
  web.kill();
  process.exitCode = codigo;
}

function run(args, extra = {}) {
  const [cmd, ...rest] = [...prefixo, ...args];
  const child = spawn(cmd, rest, { stdio: "inherit", ...extra });
  child.on("exit", (code, sinal) => encerrar(code ?? (sinal ? 1 : 0)));
  return child;
}

const apiPort = process.env.NOD_API_PORT ?? "8888";
const webPort = process.env.NOD_WEB_PORT ?? "5274";

const api = run(["npx", "tsx", "src/adapters/http/server.ts"], {
  env: { ...process.env, NOD_API_PORT: apiPort },
});
const web = run(["npx", "vite", "--host", "127.0.0.1", "--port", webPort], {
  env: { ...process.env, NOD_API_PORT: apiPort },
});

process.on("SIGINT", () => encerrar(130));
process.on("SIGTERM", () => encerrar(143));
