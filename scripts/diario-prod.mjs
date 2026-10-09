import { spawn, spawnSync } from "node:child_process";

// `npm run diario:prod` (definido em 2026-10-09, #218): o Nod diário sem o modo de desenvolvimento. Gera o bundle da web
// (`npm run build` → dist/web) e sobe só a API, que serve a página pelo NOD_STATIC_DIR (estatico.ts) na própria porta
// (8888). Sem Vite nem tsx: nada vigia arquivo nem recompila a cada edição de outra sessão na mesma pasta. O
// `npm run dev` continua sendo o modo de quem desenvolve. Como o dev.mjs, envelopa no mise quando ele existe.
const temMise = spawnSync("mise", ["--version"], { stdio: "ignore" }).status === 0;
const prefixo = temMise ? ["mise", "exec", "--"] : [];
const comando = (args) => {
  const [cmd, ...rest] = [...prefixo, ...args];
  return { cmd, rest };
};

const build = comando(["npm", "run", "build"]);
const feito = spawnSync(build.cmd, build.rest, { stdio: "inherit" });
if (feito.status !== 0) process.exit(feito.status ?? 1);

const servidor = comando(["node", "src/adapters/http/server.ts"]);
const api = spawn(servidor.cmd, servidor.rest, {
  stdio: "inherit",
  env: { ...process.env, NOD_API_PORT: process.env.NOD_API_PORT ?? "8888", NOD_STATIC_DIR: process.env.NOD_STATIC_DIR ?? "dist/web" },
});
api.on("exit", (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));

// O Ctrl+C do terminal já chega à API (mesmo grupo de processos) e ela drena os turnos (server.ts): repassar o SIGINT
// seria um segundo sinal, que a faz sair na hora. O SIGTERM de fora (kill) é repassado uma vez.
process.on("SIGINT", () => undefined);
process.on("SIGTERM", () => api.kill("SIGTERM"));
