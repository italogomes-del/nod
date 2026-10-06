import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Escopo } from "../../shared/types.ts";
import { log } from "../../obs/log.ts";
import { criarEstatico } from "./estatico.ts";
import { criarRoteador, type DepsRoteador, type Rota } from "./roteador.ts";
import { responderMetricas } from "./rotas/metricas.ts";
import { criarRotaSaude } from "./rotas/saude.ts";
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
  autorizarMaquina?: DepsRoteador["autorizarMaquina"];
  autorizarTokenTurno?: DepsRoteador["autorizarTokenTurno"];
  /** Modo de login (ADR-030). Default `stub`, que só escuta em loopback; o boot SEMPRE passa o do NOD_LOGIN. */
  sessao?: OpcoesSessao;
  /**
   * definido em 2026-10-04 (ADR-071): quem trata o upgrade de WebSocket (os canais da ligação por voz), com a mesma
   * resolução de sessão do roteador. Sem isto, nenhum upgrade é aceito.
   */
  upgrade?: (server: Server, resolverEscopo: (req: IncomingMessage) => Escopo | null) => void;
  /** definido em 2026-10-05 (NOD-175): o `select 1` do `/api/saude`. Sem isto, a saúde responde 200 sem olhar o banco. */
  verificarBanco?: () => Promise<unknown>;
}

export function criarServidor(opcoes: OpcoesServidor = {}) {
  const opcoesSessao = opcoes.sessao ?? { modo: "stub" };
  const sessao = criarSessao(segredoEfetivo(opcoesSessao.modo, opcoes.segredoSessao ?? process.env.NOD_SESSAO_SEGREDO), opcoesSessao);
  const rotas: Rota[] = [criarRotaSaude(opcoes.verificarBanco), ...sessao.rotas, ...(opcoes.rotas ?? [])];
  const roteador = criarRoteador(rotas, {
    resolverEscopo: sessao.resolverEscopo,
    autorizarTokenTurno: opcoes.autorizarTokenTurno,
    autorizarMaquina: opcoes.autorizarMaquina,
    fallback: criarEstatico(opcoes.staticDir ?? process.env.NOD_STATIC_DIR),
  });
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/metrics" || req.url?.startsWith("/metrics?"))) {
      responderMetricas(res);
      return;
    }
    roteador(req, res);
  });
  opcoes.upgrade?.(server, sessao.resolverEscopo);
  return server;
}

/**
 * definido em 2026-10-05: ao fechar, as conexões ociosas caem na hora e as ativas ganham este tempo para terminar o
 * pedido em curso. A drenagem (boot.ts) já esperou o que importa (ligações e turnos com token vivo); o que sobra são
 * long-polls e SSE, que o cliente refaz.
 */
export const ESPERA_CONEXOES_ATIVAS_MS = 5_000;

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
            // medido em produção em 2026-10-05: `close` só para de escutar. As conexões keep-alive do Caddy ficavam
            // abertas, o processo não saía (nenhum `nod_encerrado` no log) e o compose o matava no SIGKILL 5 min depois
            // da drenagem, enquanto pedidos antigos ainda entravam por essas conexões e os novos eram recusados.
            server.closeIdleConnections();
            setTimeout(() => server.closeAllConnections(), ESPERA_CONEXOES_ATIVAS_MS).unref();
          }),
      });
    });
  });
}

