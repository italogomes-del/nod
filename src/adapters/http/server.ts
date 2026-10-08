import { pathToFileURL } from "node:url";
import { log } from "../../obs/log.ts";
import { boot } from "./boot.ts";

/**
 * Ponto de entrada do servidor (`npm start`, Dockerfile, scripts/dev.mjs): carrega o .env e sobe o
 * app inteiro por boot.ts (partições → compor → listen → registry → laços). `criarServidor`/`listen`
 * moram em servidor.ts e são reexportados daqui para os testes que sobem só o roteador.
 */
export { criarServidor, listen, type OpcoesServidor } from "./servidor.ts";

/** definido em 2026-10-05: teto do `fechar()` depois da drenagem (o compose dá 11 min no total; a drenagem usa até 10). */
const FECHAMENTO_MAX_MS = 30_000;

/**
 * SIGINT/SIGTERM: o primeiro chama `encerrar` (a drenagem); o segundo, qualquer um dos dois, sai na hora com 130.
 * revisto em 2026-10-08 (revisão do épico #188, X7): antes os ouvintes saíam no primeiro sinal e o segundo caía no
 * padrão do Node, que mata o processo SEM o evento `exit` — e os grupos de processo `detached` dos turnos (processo.ts)
 * ficavam órfãos. `process.exit` roda o `exit`, que os leva. Devolve quem tira os ouvintes (os testes).
 */
export function ouvirSinaisDeEncerramento(encerrar: (sinal: string) => void, sair: (codigo: number) => void = (codigo) => process.exit(codigo)): () => void {
  let recebido = false;
  const ouvinte = (sinal: string) => () => {
    if (recebido) {
      log("aviso", "segundo_sinal", { sinal });
      sair(130);
      return;
    }
    recebido = true;
    log("info", "sinal_recebido", { sinal });
    encerrar(sinal);
  };
  const aoSigint = ouvinte("SIGINT");
  const aoSigterm = ouvinte("SIGTERM");
  process.on("SIGINT", aoSigint);
  process.on("SIGTERM", aoSigterm);
  return () => {
    process.removeListener("SIGINT", aoSigint);
    process.removeListener("SIGTERM", aoSigterm);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const servidor = await boot();
  // SIGTERM e depois Ctrl+C (ou o contrário) também é "segundo sinal".
  ouvirSinaisDeEncerramento(() => {
    // definido em 2026-10-04 (ADR-071), revisto em 2026-10-05 (NOD-175): drenagem — recusa ligação nova, a ponte para de
    // entregar turno novo e espera as ligações e os turnos com token vivo até NOD_DRENAGEM_MAX_MS (padrão 10 min; o
    // compose dá stop_grace_period de 11 min). Sem nada vivo, fecha na hora como antes. Segundo sinal: sai com 130.
    servidor
      .drenar({ prazoMs: Number(process.env.NOD_DRENAGEM_MAX_MS) || 600_000 })
      .then(() => {
        // definido em 2026-10-05 (medido em produção): se o fechamento travar, o processo sai mesmo assim, antes de o
        // compose precisar do SIGKILL. A drenagem já terminou; o que falta fechar não vale um serviço meio no ar.
        setTimeout(() => { log("aviso", "fechamento_demorou", { ms: FECHAMENTO_MAX_MS }); process.exit(1); }, FECHAMENTO_MAX_MS).unref();
        return servidor.fechar();
      })
      .then(() => process.exit(0), () => process.exit(1));
  });
}
