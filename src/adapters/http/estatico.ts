import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  // definido em 2026-10-04 (ADR-070): as fontes da web (web/public/fontes) e a licença que vai junto.
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve o bundle da web (NOD_STATIC_DIR) com fallback para index.html em rotas sem extensão. */
export function criarEstatico(dir: string | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (!dir || req.method !== "GET") return false;
    const caminho = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const arquivo = normalize(caminho === "/" ? "/index.html" : caminho);
    if (arquivo.includes("..")) return false;
    try {
      const buf = await readFile(join(dir, arquivo));
      // A fonte não muda entre deploys do mesmo nome de arquivo: uma semana de cache poupa ~80 KB por abertura.
      const cache = extname(arquivo) === ".woff2" ? { "cache-control": "public, max-age=604800" } : {};
      res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream", ...cache });
      res.end(buf);
      return true;
    } catch {
      if (extname(arquivo) !== "") return false;
      try {
        const buf = await readFile(join(dir, "index.html"));
        res.writeHead(200, { "content-type": TIPOS[".html"] });
        res.end(buf);
        return true;
      } catch {
        return false;
      }
    }
  };
}
