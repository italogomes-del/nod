import type { IncomingMessage, ServerResponse } from "node:http";

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

/** definido em 2026-09-16: 1 MiB de corpo é folga para qualquer rota do nod; acima disso é abuso. */
const CORPO_MAX = 1_048_576;

export async function lerCorpo(req: IncomingMessage): Promise<unknown> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.length;
    if (total > CORPO_MAX) throw new SyntaxError("corpo grande demais");
    pedacos.push(buf);
  }
  if (pedacos.length === 0) return {};
  return JSON.parse(Buffer.concat(pedacos).toString("utf8"));
}

export function lerCookies(req: IncomingMessage): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const par of (req.headers.cookie ?? "").split(";")) {
    const i = par.indexOf("=");
    if (i === -1) continue;
    saida[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return saida;
}
