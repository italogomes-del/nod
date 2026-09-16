import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATALOGO_CONECTORES } from "../core/catalogo-conectores.ts";
import { chaveDe, healthCheckDecifra } from "../db/cifra.ts";
import { caminhoPadrao, Store, TENANT_LOCAL } from "../db/store.ts";
import { confirmarProposta, criarAgenteNovo, tratarMensagem } from "./conversa.ts";

const PORT = Number(process.env.PORT ?? 8787);

function key() {
  const k = chaveDe(process.env.NOD_CREDENTIAL_KEY ?? "0".repeat(64));
  healthCheckDecifra(k);
  return k;
}

function store(): Store {
  return new Store(caminhoPadrao(process.env.NOD_DATA_DIR ?? "./data"));
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function snapshotPublico(s: Awaited<ReturnType<Store["load"]>>) {
  return {
    tenantId: s.tenantId,
    pessoa: s.pessoa,
    agentes: s.agentes,
    rotinas: s.rotinas,
    concessoes: s.concessoes.map((c) => ({ ...c })),
    catalogo: CATALOGO_CONECTORES,
    mensagens: s.mensagens,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/api/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && path === "/api/frota") {
    const s = await store().load();
    json(res, 200, snapshotPublico(s));
    return;
  }

  if (method === "POST" && path === "/api/agentes") {
    const agente = await store().tx((s) => criarAgenteNovo(s, Date.now()));
    const s = await store().load();
    json(res, 201, { agente, snapshot: snapshotPublico(s) });
    return;
  }

  const msg = path.match(/^\/api\/agentes\/([^/]+)\/mensagens$/);
  if (method === "POST" && msg) {
    const agenteId = decodeURIComponent(msg[1] ?? "");
    const payload = (await body(req)) as { texto?: string };
    const texto = String(payload.texto ?? "").trim();
    if (!texto) {
      json(res, 400, { erro: "texto vazio" });
      return;
    }
    try {
      await store().tx((s) => {
        const agente = s.agentes.find((a) => a.id === agenteId && a.tenantId === TENANT_LOCAL);
        if (!agente) throw Object.assign(new Error("agente não encontrado"), { code: 404 });
        tratarMensagem(s, agente, texto, key(), Date.now());
      });
    } catch (e) {
      const err = e as Error & { code?: number };
      json(res, err.code === 404 ? 404 : 400, { erro: err.message });
      return;
    }
    json(res, 200, snapshotPublico(await store().load()));
    return;
  }

  const conf = path.match(/^\/api\/agentes\/([^/]+)\/propostas\/([^/]+)\/confirmar$/);
  if (method === "POST" && conf) {
    const agenteId = decodeURIComponent(conf[1] ?? "");
    const propostaId = decodeURIComponent(conf[2] ?? "");
    const extra = (await body(req)) as {
      declaracao?: "toca" | "nao-toca" | "nao-declarou";
      capacidadesLigadas?: string[];
    };
    try {
      await store().tx((s) => {
        const agente = s.agentes.find((a) => a.id === agenteId);
        if (!agente) throw Object.assign(new Error("agente não encontrado"), { code: 404 });
        confirmarProposta(s, agente, propostaId, key(), Date.now(), extra);
      });
    } catch (e) {
      const err = e as Error & { code?: number };
      json(res, err.code === 404 ? 404 : 400, { erro: err.message });
      return;
    }
    json(res, 200, snapshotPublico(await store().load()));
    return;
  }

  const rec = path.match(/^\/api\/agentes\/([^/]+)\/propostas\/([^/]+)\/recusar$/);
  if (method === "POST" && rec) {
    const agenteId = decodeURIComponent(rec[1] ?? "");
    try {
      await store().tx((s) => {
        const agente = s.agentes.find((a) => a.id === agenteId);
        if (!agente) throw Object.assign(new Error("agente não encontrado"), { code: 404 });
        tratarMensagem(s, agente, "não", key(), Date.now());
      });
    } catch (e) {
      const err = e as Error & { code?: number };
      json(res, err.code === 404 ? 404 : 400, { erro: err.message });
      return;
    }
    json(res, 200, snapshotPublico(await store().load()));
    return;
  }

  if (process.env.NOD_STATIC_DIR && method === "GET") {
    const file = path === "/" ? "/index.html" : path;
    try {
      const buf = await readFile(join(process.env.NOD_STATIC_DIR, file));
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json",
      };
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      res.end(buf);
      return;
    } catch {
      if (extname(file) === "") {
        const buf = await readFile(join(process.env.NOD_STATIC_DIR, "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(buf);
        return;
      }
    }
  }

  json(res, 404, { erro: "não encontrado" });
}

export function listen(port = PORT, host = "0.0.0.0"): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(err);
      json(res, 500, { erro: "falha interna" });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      process.stderr.write(`nod http em :${p}\n`);
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
  void listen();
}
