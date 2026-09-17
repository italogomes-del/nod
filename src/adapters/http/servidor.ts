import { createServer } from "node:http";
import { log } from "../../obs/log.ts";
import { criarEstatico } from "./estatico.ts";
import { criarRoteador, type DepsRoteador, type Rota } from "./roteador.ts";
import { responderMetricas } from "./rotas/metricas.ts";
import { rotaSaude } from "./rotas/saude.ts";
import { criarSessao, exigirConfiguracaoSegura, segredoEfetivo, type OpcoesSessao } from "./sessao.ts";

/**
 * Servidor: roteador + saúde + sessão (google ou stub de desenvolvimento, ADR-030) + estático + as rotas compostas (compor.ts). Sem
 * framework: node:http puro. O ponto de entrada (main) é server.ts, que chama boot.ts — este módulo
 * não importa boot.ts para o ciclo boot → listen não travar o top-level await (medido em 2026-09-16:
 * "Detected unsettled top-level await" e o processo saía sem escutar).
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
  /** Modo de login (ADR-030). Default `stub`, que só escuta em loopback; o boot SEMPRE passa o do NOD_LOGIN. */
  sessao?: OpcoesSessao;
}

export function criarServidor(opcoes: OpcoesServidor = {}) {
  const opcoesSessao = opcoes.sessao ?? { modo: "stub" };
  const sessao = criarSessao(segredoEfetivo(opcoesSessao.modo, opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO), opcoesSessao);
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
  // ADR-030 (E1.5/E1.6): o login de desenvolvimento só escuta em loopback; o login real exige segredo forte.
  exigirConfiguracaoSegura({ modo: opcoes.sessao?.modo ?? "stub", host, segredo: opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO });
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

