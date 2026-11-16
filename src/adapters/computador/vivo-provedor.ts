import { WebSocket, type RawData } from "ws";
import type { AcessoTelaAoVivo } from "../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../domain/computador.ts";
import type { LadoVivo } from "./vivo.ts";

/** O acesso do provedor abre no servidor; a URL e o token VNC nunca chegam ao navegador da pessoa. */
export function urlDoAcessoVivo(a: AcessoTelaAoVivo, agora: number = Date.now()): URL {
  if (a.tipo !== "vnc_websocket" || (a.validoAte !== null && a.validoAte <= agora)) throw new FalhaComputador("sem_resposta", { detalhe: "o acesso à tela ao vivo venceu" });
  let u: URL;
  try { u = new URL(a.url); } catch { throw new FalhaComputador("sem_resposta", { detalhe: "URL inválida da tela ao vivo" }); }
  if (u.protocol !== "wss:" || u.username || u.password) throw new FalhaComputador("sem_resposta", { detalhe: "origem inválida da tela ao vivo" });
  u.searchParams.set("token", a.token);
  return u;
}

export const PRAZO_CONECTAR_VIVO_PROVEDOR_MS = 15_000;

export async function conectarVivoDoProvedor(a: AcessoTelaAoVivo, opcoes: { prazoMs?: number; criar?: (url: string) => WebSocket } = {}): Promise<LadoVivo> {
  const url = urlDoAcessoVivo(a).toString();
  const ws = opcoes.criar?.(url) ?? new WebSocket(url, { perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new FalhaComputador("sem_resposta", { detalhe: "a tela ao vivo do provedor não conectou" })); }, opcoes.prazoMs ?? PRAZO_CONECTAR_VIVO_PROVEDOR_MS);
    timer.unref?.();
    const pronto = () => { clearTimeout(timer); ws.off("error", falhou); resolve(); };
    const falhou = () => { clearTimeout(timer); ws.off("open", pronto); reject(new FalhaComputador("sem_resposta", { detalhe: "a tela ao vivo do provedor não conectou" })); };
    ws.once("open", pronto);
    ws.once("error", falhou);
  });
  // `error` depois do handshake também precisa ter ouvinte: no `ws`, um evento `error` sem ouvinte derruba o processo.
  // `terminate` produz o `close` que o relay já usa para encerrar os dois lados da sessão.
  ws.on("error", () => ws.terminate());
  return {
    enviar(bytes) { if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true }); },
    aoDados(fn) {
      ws.on("message", (dados: RawData, binario: boolean) => {
        if (!binario) return;
        const b = Array.isArray(dados) ? Buffer.concat(dados) : Buffer.from(dados as ArrayBuffer);
        fn(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
      });
    },
    aoFechar(fn) { ws.on("close", fn); },
    fechar(codigo, motivo) { if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(codigo, motivo); },
  };
}
