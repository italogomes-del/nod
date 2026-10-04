import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarEstatico } from "../../../src/adapters/http/estatico.ts";

/** definido em 2026-10-04 (ADR-070): as fontes da web saem com o tipo certo e com cache. */
function chamar(dir: string, url: string): Promise<{ servido: boolean; cabecalhos: Record<string, string> }> {
  const cabecalhos: Record<string, string> = {};
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = url;
  const res = new ServerResponse(req);
  res.writeHead = ((_s: number, h: Record<string, string>) => { Object.assign(cabecalhos, h); return res; }) as typeof res.writeHead;
  res.end = (() => res) as typeof res.end;
  return criarEstatico(dir)(req, res).then((servido) => ({ servido, cabecalhos }));
}

describe("estático", () => {
  const dir = mkdtempSync(join(tmpdir(), "nod-estatico-"));
  mkdirSync(join(dir, "fontes"));
  writeFileSync(join(dir, "fontes", "geist.woff2"), "x");
  writeFileSync(join(dir, "index.html"), "<html></html>");

  it("woff2 sai como font/woff2, com uma semana de cache", async () => {
    const r = await chamar(dir, "/fontes/geist.woff2");
    expect(r.servido).toBe(true);
    expect(r.cabecalhos["content-type"]).toBe("font/woff2");
    expect(r.cabecalhos["cache-control"]).toBe("public, max-age=604800");
  });

  it("o resto continua sem cache explícito", async () => {
    const r = await chamar(dir, "/");
    expect(r.cabecalhos["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.cabecalhos["cache-control"]).toBeUndefined();
  });
});
