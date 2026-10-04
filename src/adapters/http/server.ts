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
    log("info", "sinal_recebido", { sinal });
    // definido em 2026-10-04 (ADR-071): drenagem — com ligação viva, avisa e espera ela acabar até NOD_DRENAGEM_MAX_MS
    // (padrão 10 min; o compose dá stop_grace_period de 11 min). Sem ligação, fecha na hora como antes.
    const voz = servidor.app.voz;
    const prazo = Date.now() + (Number(process.env.NOD_DRENAGEM_MAX_MS) || 600_000);
    voz.iniciarDrenagem();
    const esperar = async () => {
      while (voz.vivas() > 0 && Date.now() < prazo) await new Promise((r) => setTimeout(r, 1_000));
      log("info", "drenagem_concluida", { vivas: voz.vivas() });
    };
    esperar().then(() => servidor.fechar()).then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGINT", () => encerrar("SIGINT"));
  process.once("SIGTERM", () => encerrar("SIGTERM"));
}
