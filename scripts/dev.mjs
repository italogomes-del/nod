import { spawn } from "node:child_process";

function run(cmd, args, extra = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...extra });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exit(code);
  });
  return child;
}

const apiPort = process.env.NOD_API_PORT ?? "8787";
const webPort = process.env.NOD_WEB_PORT ?? "5173";

const api = run("npx", ["tsx", "http/server.ts"], {
  env: { ...process.env, PORT: apiPort, NOD_DATA_DIR: process.env.NOD_DATA_DIR ?? "./data" },
});
const web = run("npx", ["vite", "--host", "0.0.0.0", "--port", webPort], {
  env: { ...process.env, NOD_API_PORT: apiPort },
});

function stop() {
  api.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
