import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * X7 (revisão do épico #188): o segundo sinal sai por `process.exit(130)`, que roda o `exit` — é ele que mata os
 * grupos `detached` dos turnos (processo.ts). Antes o segundo sinal caía no padrão do Node, que mata sem o `exit`.
 */
it("primeiro sinal drena; o segundo sai com 130 passando pelo gancho `exit`", { timeout: 20_000 }, async () => {
  const script = fileURLToPath(new URL("../../fixtures/sinais-servidor.ts", import.meta.url));
  const filho = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  filho.stdout.setEncoding("utf8");
  filho.stdout.on("data", (d: string) => (saida += d));
  const esperar = async (cond: () => boolean) => {
    const fim = Date.now() + 15_000;
    while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
    return cond();
  };
  const fim = new Promise<{ codigo: number | null; sinal: string | null }>((r) => filho.on("exit", (codigo, sinal) => r({ codigo, sinal })));
  expect(await esperar(() => saida.includes("pronto"))).toBe(true);
  filho.kill("SIGTERM");
  expect(await esperar(() => saida.includes("drenando SIGTERM"))).toBe(true);
  filho.kill("SIGINT");
  expect(await fim).toEqual({ codigo: 130, sinal: null });
  expect(saida).toContain("exit 130");
});
