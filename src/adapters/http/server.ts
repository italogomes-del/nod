import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { log } from "../../obs/log.ts";
import { criarEstatico } from "./estatico.ts";
import { criarRoteador, type DepsRoteador, type Rota } from "./roteador.ts";
import { responderMetricas } from "./rotas/metricas.ts";
import { rotaSaude } from "./rotas/saude.ts";
import { criarSessao } from "./sessao.ts";

/**
 * Servidor: roteador + saúde + sessão stub + estático + as rotas compostas (compor.ts), subidas
 * por boot.ts quando este arquivo é o main. Sem framework: node:http puro.
 *
 * `GET /metrics` na RAIZ — definido em 2026-09-16 (EMENDA-L9 §3, opção a): o Prometheus raspa
 * `/metrics` por convenção e o roteador só casa públicas sob `/api`; a resposta é montada aqui,
 * antes do roteador, e a Rota da L8 continua servindo `/api/metrics`. A tabela ROTAS fica com "/metrics".
 */
export interface OpcoesServidor {
  rotas?: Rota[];
  segredoSessao?: string;
  staticDir?: string;
  autorizarTokenTurno?: DepsRoteador["autorizarTokenTurno"];
}

export function criarServidor(opcoes: OpcoesServidor = {}) {
  const sessao = criarSessao(opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO ?? "dev-sem-segredo");
  const rotas: Rota[] = [rotaSaude, ...sessao.rotas, ...(opcoes.rotas ?? [])];
  const roteador = criarRoteador(rotas, {
    resolverEscopo: sessao.resolverEscopo,
    autorizarTokenTurno: opcoes.autorizarTokenTurno,
    fallback: criarEstatico(opcoes.staticDir ?? process.env.NOD_STATIC_DIR),
  });
  return createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/metrics" || req.url?.startsWith("/metrics?"))) {
      responderMetricas(res);
      return;
    }
    roteador(req, res);
  });
}

export function listen(
  port = Number(process.env.NOD_API_PORT ?? 8888),
  host = process.env.NOD_HOST ?? "127.0.0.1",
  opcoes: OpcoesServidor = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  // Sessão stub por cookie só é aceitável em loopback (riscos do plano; ADR-019/021).
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`NOD_HOST=${host} recusado: enquanto a sessão for stub por cookie o servidor só escuta em 127.0.0.1`);
  }
  const server = criarServidor(opcoes);
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      log("info", "http_escutando", { host, porta: p });
      resolve({
        port: p,
        close: () =>
          new Promise((r, j) => {
            server.close((e) => (e ? j(e) : r()));
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  // Import tardio: boot.ts importa `listen` daqui; o ciclo só existiria com import estático.
  const { boot } = await import("./boot.ts");
  const servidor = await boot();
  const encerrar = (sinal: string) => {
    log("info", "sinal_recebido", { sinal });
    servidor.fechar().then(() => process.exit(0), () => process.exit(1));
  };
  process.once("SIGINT", () => encerrar("SIGINT"));
  process.once("SIGTERM", () => encerrar("SIGTERM"));
}
