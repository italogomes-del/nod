import { spawn, spawnSync } from "node:child_process";

// Sobe API (8888) e web (5274). Se o mise existir, envelopa para garantir o Node pinado
// (nvm/asdf ganham do mise quando ativos no shell — ver AGENTS.md).
const temMise = spawnSync("mise", ["--version"], { stdio: "ignore" }).status === 0;
const prefixo = temMise ? ["mise", "exec", "--"] : [];

function run(args, extra = {}) {
  const [cmd, ...rest] = [...prefixo, ...args];
  const child = spawn(cmd, rest, { stdio: "inherit", ...extra });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exit(code);
  });
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

function stop() {
  api.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
