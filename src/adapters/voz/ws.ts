import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { FECHAMENTOS_VOZ, MENSAGEM_MAX_BYTES } from "../../contracts/voz.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * Os dois canais WebSocket da ligação (definido em 2026-10-04, ADR-071), no MESMO servidor HTTP do nod (upgrade em
 * node:http, sem porta nova). As regras de autenticação são as do roteador (roteador.ts): a mídia é rota de tenant
 * (cookie da sessão, tenant do caminho igual ao da sessão) e, além disso, exige `Origin` do mesmo host — o navegador
 * manda cookie em WebSocket de qualquer origem; o cérebro é rota interna (sem `Origin`, token de turno no Bearer).
 *
 * O ditado (ADR-095, `/api/t/:tenant/voz/v1/ditado`) segue as regras da mídia.
 *
 * `ws` é a única dependência nova de runtime (ADR-071): servidor WebSocket em JS puro, sem nativo. O cliente do Mac usa
 * o `WebSocket` global do Node/Electron.
 */

/** O que o orquestrador enxerga de um canal: dá para testar sem socket nenhum (canal falso). */
export interface CanalVoz {
  enviarJson(msg: object): void;
  enviarBinario(dados: Uint8Array): void;
  fechar(codigo: number, motivo?: string): void;
  aoMensagem(fn: (m: { texto: string } | { binario: Uint8Array }) => void): void;
  aoFechar(fn: (codigo: number) => void): void;
  /** Bytes ainda na fila de saída (controle de fluxo da voz). */
  pendente(): number;
}

export type IdentidadeCerebro = Escopo & { turnoId: string; agenteId: string };

export type DepsCanaisVoz = {
  resolverEscopo(req: IncomingMessage): Escopo | null;
  autorizarTokenTurno(token: string): IdentidadeCerebro | null;
  /** A ligação do turno-cérebro (do plano guardado com o token); null = o turno não é de ligação. */
  ligacaoDoTurno(turnoId: string): string | null;
  /** Primeira mensagem `ola` da mídia: anexa o canal à ligação, ou devolve o código de fechamento. */
  anexarMidia(p: { escopo: Escopo; ligacaoId: string; retomar: boolean; canal: CanalVoz }): number | null;
  anexarCerebro(p: { identidade: IdentidadeCerebro; ligacaoId: string; canal: CanalVoz }): number | null;
  /** ADR-095: o `ola` do ditado chegou; a composição autoriza (permissão, consentimento) e abre o ditado ou recusa. */
  anexarDitado(p: { escopo: Escopo; canal: CanalVoz }): void;
};

const MIDIA = /^\/api\/t\/([^/]+)\/voz\/v1\/midia$/;
const CEREBRO = /^\/api\/interno\/voz\/v1\/cerebro$/;
const DITADO = /^\/api\/t\/([^/]+)\/voz\/v1\/ditado$/;
/** definido em 2026-10-04: o `ola` da mídia tem de chegar em 5 s, senão a conexão fecha. */
export const PRAZO_OLA_MS = 5_000;

export function canalDeSocket(ws: WebSocket): CanalVoz {
  return {
    enviarJson(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    enviarBinario(dados) {
      if (ws.readyState === ws.OPEN) ws.send(dados, { binary: true });
    },
    fechar(codigo, motivo) {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(codigo, motivo);
    },
    aoMensagem(fn) {
      ws.on("message", (dados: RawData, binario: boolean) => {
        const buf = Array.isArray(dados) ? Buffer.concat(dados) : Buffer.from(dados as ArrayBuffer);
        fn(binario ? { binario: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) } : { texto: buf.toString("utf8") });
      });
    },
    aoFechar(fn) {
      ws.on("close", (codigo: number) => fn(codigo));
    },
    pendente: () => ws.bufferedAmount,
  };
}

function recusar(socket: Duplex, status: number): void {
  const textos: Record<number, string> = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found" };
  socket.write(`HTTP/1.1 ${status} ${textos[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** `Origin` do mesmo host que o `Host` do pedido (o Caddy e o proxy do Vite preservam o Host). */
export function origemDoMesmoHost(req: IncomingMessage): boolean {
  const origem = req.headers.origin;
  const host = req.headers.host;
  if (!origem || !host) return false;
  try {
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

export function lerJson(texto: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(texto);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type CanaisVoz = { fechar(): Promise<void> };

/** Liga o upgrade dos três caminhos (mídia, cérebro e ditado) ao servidor HTTP. Qualquer outro caminho de upgrade é recusado com 404. */
export function anexarCanaisVoz(server: Server, deps: DepsCanaisVoz): CanaisVoz {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MENSAGEM_MAX_BYTES, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const caminho = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const midia = MIDIA.exec(caminho);
    if (midia) {
      const escopo = deps.resolverEscopo(req);
      if (!escopo) return recusar(socket, 401);
      if (escopo.tenantId !== midia[1]) return recusar(socket, 404);
      if (!origemDoMesmoHost(req)) return recusar(socket, 403);
      wss.handleUpgrade(req, socket, head, (ws) => aceitarMidia(ws, escopo));
      return;
    }
    // ADR-095: o ditado é rota de tenant como a mídia — mesmas três conferências.
    const ditado = DITADO.exec(caminho);
    if (ditado) {
      const escopo = deps.resolverEscopo(req);
      if (!escopo) return recusar(socket, 401);
      if (escopo.tenantId !== ditado[1]) return recusar(socket, 404);
      if (!origemDoMesmoHost(req)) return recusar(socket, 403);
      wss.handleUpgrade(req, socket, head, (ws) => aceitarDitado(ws, escopo));
      return;
    }
    if (CEREBRO.test(caminho)) {
      if (req.headers.origin !== undefined) return recusar(socket, 403);
      const auth = req.headers.authorization ?? "";
      const identidade = auth.startsWith("Bearer ") ? deps.autorizarTokenTurno(auth.slice(7)) : null;
      if (!identidade) return recusar(socket, 401);
      const ligacaoId = deps.ligacaoDoTurno(identidade.turnoId);
      if (!ligacaoId) return recusar(socket, 404);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const canal = canalDeSocket(ws);
        const codigo = deps.anexarCerebro({ identidade, ligacaoId, canal });
        if (codigo !== null) canal.fechar(codigo);
      });
      return;
    }
    recusar(socket, 404);
  });

  function aceitarMidia(ws: WebSocket, escopo: Escopo): void {
    const canal = canalDeSocket(ws);
    let anexada = false;
    const prazo = setTimeout(() => {
      if (!anexada) canal.fechar(FECHAMENTOS_VOZ.versao, "sem ola");
    }, PRAZO_OLA_MS);
    // O primeiro `ola` decide; depois disso, quem trata as mensagens é a ligação (o handler abaixo some).
    const primeira = (dados: RawData, binario: boolean) => {
      if (anexada) return;
      ws.off("message", primeira);
      clearTimeout(prazo);
      const msg = binario ? null : lerJson(Buffer.isBuffer(dados) ? dados.toString("utf8") : String(dados));
      if (!msg || msg.t !== "ola" || typeof msg.ligacaoId !== "string") {
        canal.fechar(FECHAMENTOS_VOZ.versao, "ola invalido");
        return;
      }
      if (msg.v !== 1) {
        canal.fechar(FECHAMENTOS_VOZ.versao, "versao");
        return;
      }
      anexada = true;
      const codigo = deps.anexarMidia({ escopo, ligacaoId: msg.ligacaoId, retomar: msg.retomar === true, canal });
      if (codigo !== null) canal.fechar(codigo);
    };
    ws.on("message", primeira);
    ws.on("error", (e) => log("aviso", "voz_midia_erro_socket", { erro: e.name }));
  }

  function aceitarDitado(ws: WebSocket, escopo: Escopo): void {
    const canal = canalDeSocket(ws);
    const prazo = setTimeout(() => canal.fechar(FECHAMENTOS_VOZ.versao, "sem ola"), PRAZO_OLA_MS);
    const primeira = (dados: RawData, binario: boolean) => {
      ws.off("message", primeira);
      clearTimeout(prazo);
      const msg = binario ? null : lerJson(Buffer.isBuffer(dados) ? dados.toString("utf8") : String(dados));
      if (!msg || msg.t !== "ola") return canal.fechar(FECHAMENTOS_VOZ.versao, "ola invalido");
      if (msg.v !== 1) return canal.fechar(FECHAMENTOS_VOZ.versao, "versao");
      deps.anexarDitado({ escopo, canal });
    };
    ws.on("message", primeira);
    ws.on("error", (e) => log("aviso", "voz_ditado_erro_socket", { erro: e.name }));
  }

  return {
    async fechar() {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
