import { interpretar, type MensagemJsonRpc } from "./jsonrpc.ts";

/** definido em 2026-09-17: lê JSON/SSE incrementalmente; notificações de progresso não encerram a resposta. */
export async function lerRespostaHttp(r: Response, id: string | number | null): Promise<Extract<MensagemJsonRpc, { tipo: "resposta" }> | null> {
  if (!r.body) return null;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const sse = r.headers.get("content-type")?.includes("text/event-stream");
  let buffer = "";
  let bytes = 0;
  const interpretarResposta = (texto: string) => {
    const m = interpretar(texto);
    return m.tipo === "resposta" && m.id === id ? m : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 1_048_576) throw new Error("resposta_mcp_grande");
      buffer += decoder.decode(value, { stream: !done });
      if (sse) {
        let fim: RegExpExecArray | null;
        while ((fim = /\r?\n\r?\n/.exec(buffer))) {
          const evento = buffer.slice(0, fim.index);
          buffer = buffer.slice(fim.index + fim[0].length);
          const dados = evento.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
          const resposta = interpretarResposta(dados);
          if (resposta) return resposta;
        }
      }
      if (done) {
        if (!sse) return interpretarResposta(buffer);
        const dados = buffer.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        return interpretarResposta(dados);
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
