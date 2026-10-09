import { iniciarProcesso, registrarGruposEm } from "../../src/adapters/executor/processo.ts";

/**
 * ADR-089 (#217): um "servidor" que anota os grupos em arquivo e abre um bot com um neto no mesmo grupo — o `claude -p`
 * com o `while … sleep` do Bash. tests/unit/executor/grupos-orfaos.test.ts o mata com SIGKILL (o `exit` não roda) e
 * confere que o boot seguinte leva o grupo.
 */
const arquivo = process.argv[2] ?? "";
registrarGruposEm(arquivo);
const BOT = `
const { spawn } = require("node:child_process");
const neto = spawn("sleep", ["300"], { stdio: "ignore" });
process.stdout.write("neto " + neto.pid + "\\n");
setInterval(() => {}, 1000);
`;
const bot = iniciarProcesso({
  bin: process.execPath,
  args: ["-e", BOT],
  env: { PATH: process.env.PATH ?? "" },
  cwd: process.cwd(),
  aoLinha: (linha) => {
    if (linha.startsWith("neto ")) process.stdout.write(`bot ${bot.pid} ${linha}\n`);
  },
});
setInterval(() => undefined, 1_000);
