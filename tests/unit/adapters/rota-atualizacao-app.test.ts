import { afterEach, describe, expect, it, vi } from "vitest";
import { rotasAtualizacaoApp } from "../../../src/adapters/http/rotas/atualizacao-app.ts";

/** NOD-132 (ADR-149): a URL assinada nunca vai para log (gatilho de reversão), nem quando a assinatura falha. */
const SEGREDO = "X-Goog-Signature=SEGREDO123";
const config = { versao: "1.1.0", bucket: "b", sha256: { arm64: "a1".repeat(32), x64: "b2".repeat(32) } };

function chamar(assinar: (o: string) => Promise<string>) {
  const [rota] = rotasAtualizacaoApp({ config, assinar, versaoMinima: "1.0.0" });
  const resposta: { status?: number; corpo?: unknown } = {};
  const ctx = {
    req: { url: "/atualizacao?arch=x64", headers: { "x-nod-versao": "1.0.0" } },
    res: { setHeader: () => undefined, writeHead: (s: number) => { resposta.status = s; return { end: () => undefined }; } },
    json: (s: number, c: unknown) => { resposta.status = s; resposta.corpo = c; },
  };
  return { feito: rota!.handler(ctx as never), resposta };
}

describe("rota do feed da atualização: o log nunca leva a URL assinada", () => {
  afterEach(() => vi.restoreAllMocks());

  it("anunciada: a resposta tem a URL, o log não", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => { linhas.push(l); });
    const { feito, resposta } = chamar(async (o) => `https://storage.googleapis.com/b/${o}?${SEGREDO}`);
    await feito;
    expect(resposta.status).toBe(200);
    expect(JSON.stringify(resposta.corpo)).toContain("SEGREDO123");
    expect(linhas.some((l) => l.includes("atualizacao_app_anunciada"))).toBe(true);
    expect(linhas.join("\n")).not.toMatch(/SEGREDO123|storage\.googleapis|X-Goog/);
  });

  it("falha ao assinar: o log leva só o começo da mensagem, sem stack nem a URL que veio no erro", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => { linhas.push(l); });
    const { feito, resposta } = chamar(async () => { throw new Error(`sign_blob_403 ${"x".repeat(60)} https://storage.googleapis.com/b/o?${SEGREDO}`); });
    await feito;
    expect(resposta.status).toBe(503);
    const tudo = linhas.join("\n");
    expect(tudo).toContain("atualizacao_app_assinatura_falhou");
    expect(tudo).toContain("sign_blob_403");
    expect(tudo).not.toMatch(/SEGREDO123|storage\.googleapis|at .*\.ts/);
  });
});
