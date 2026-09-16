import { spawn } from "node:child_process";

function run(cmd, args, extra = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...extra });
  child.on("exit", (code) => {
    if (code && code !== 0) process.exit(code);
  });
  return child;
}

const api = run("npx", ["tsx", "http/server.ts"], {
  env: { ...process.env, PORT: "8787", NOD_DATA_DIR: process.env.NOD_DATA_DIR ?? "./data" },
});
const web = run("npx", ["vite", "--host", "0.0.0.0", "--port", "5173"]);

function stop() {
  api.kill();
  web.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
