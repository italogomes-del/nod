import { pathToFileURL } from "node:url";
import { log } from "../../obs/log.ts";
import { boot } from "./boot.ts";

/**
 * Ponto de entrada do servidor (`npm start`, Dockerfile, scripts/dev.mjs): carrega o .env e sobe o
 * app inteiro por boot.ts (partições → compor → listen → registry → laços). `criarServidor`/`listen`
 * moram em servidor.ts e são reexportados daqui para os testes que sobem só o roteador.
 */
export { criarServidor, listen, type OpcoesServidor } from "./servidor.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const servidor = await boot();
  const encerrar = (sinal: string) => {
    // SIGTERM e depois Ctrl+C (ou o contrário) também é "segundo sinal": sem ouvinte, o padrão do Node mata.
    process.removeListener("SIGINT", aoSigint);
    process.removeListener("SIGTERM", aoSigterm);
    log("info", "sinal_recebido", { sinal });
    // definido em 2026-10-04 (ADR-071), revisto em 2026-10-05 (NOD-175): drenagem — recusa ligação nova, a ponte para de
    // entregar turno novo e espera as ligações e os turnos com token vivo até NOD_DRENAGEM_MAX_MS (padrão 10 min; o
    // compose dá stop_grace_period de 11 min). Sem nada vivo, fecha na hora como antes. Segundo sinal: o padrão mata.
    servidor
      .drenar({ prazoMs: Number(process.env.NOD_DRENAGEM_MAX_MS) || 600_000 })
      .then(() => servidor.fechar())
      .then(() => process.exit(0), () => process.exit(1));
  };
  const aoSigint = () => encerrar("SIGINT");
  const aoSigterm = () => encerrar("SIGTERM");
  process.once("SIGINT", aoSigint);
  process.once("SIGTERM", aoSigterm);
}
