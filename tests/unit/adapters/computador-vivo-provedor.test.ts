import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { conectarVivoDoProvedor, urlDoAcessoVivo } from "../../../src/adapters/computador/vivo-provedor.ts";

describe("relay da tela ao vivo de provedor externo", () => {
  it("anexa o token só no servidor e preserva os parâmetros da sessão", () => {
    const u = urlDoAcessoVivo({ tipo: "vnc_websocket", url: "wss://edge.orgo.ai/ws/websockify?display=bot-a", token: "segredo com espaço", validoAte: 2_000 }, 1_000);
    expect(u.origin).toBe("wss://edge.orgo.ai");
    expect(u.searchParams.get("display")).toBe("bot-a");
    expect(u.searchParams.get("token")).toBe("segredo com espaço");
  });

  it("recusa acesso vencido, ws sem TLS e credencial embutida na URL", () => {
    expect(() => urlDoAcessoVivo({ tipo: "vnc_websocket", url: "wss://edge.orgo.ai/ws", token: "x", validoAte: 999 }, 1_000)).toThrowError(expect.objectContaining({ motivo: "sem_resposta" }));
    expect(() => urlDoAcessoVivo({ tipo: "vnc_websocket", url: "ws://edge.orgo.ai/ws", token: "x", validoAte: null })).toThrowError(expect.objectContaining({ motivo: "sem_resposta" }));
    expect(() => urlDoAcessoVivo({ tipo: "vnc_websocket", url: "wss://user:pass@edge.orgo.ai/ws", token: "x", validoAte: null })).toThrowError(expect.objectContaining({ motivo: "sem_resposta" }));
  });

  it("erro tardio do WebSocket encerra a conexão sem derrubar o processo", async () => {
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1,
      CONNECTING: 0,
      readyState: 0,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
    });
    const pendente = conectarVivoDoProvedor(
      { tipo: "vnc_websocket", url: "wss://edge.orgo.ai/ws", token: "x", validoAte: null },
      { criar: () => ws as never },
    );
    ws.readyState = ws.OPEN;
    ws.emit("open");
    await pendente;
    expect(() => ws.emit("error", new Error("socket caiu"))).not.toThrow();
    expect(ws.terminate).toHaveBeenCalledOnce();
  });
});
