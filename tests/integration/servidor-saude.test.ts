import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { listen } from "../../src/adapters/http/server.ts";
import type { Rota } from "../../src/adapters/http/roteador.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";

/** Servidor real em porta 0, sem banco: saúde, sessão stub, escopo da URL e rotas internas. */
const rotasDeTeste: Rota[] = [
  { metodo: "GET", padrao: /^\/eco$/, async handler(ctx) { ctx.json(200, { escopo: ctx.escopo }); } },
  { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)$/, async handler(ctx) { ctx.json(200, { id: ctx.params.id }); } },
  { metodo: "GET", padrao: /^\/explode$/, async handler() { throw new ErroDeDominio("nao_encontrado"); } },
  { metodo: "GET", padrao: /^\/plano$/, interno: true, async handler(ctx) { ctx.json(200, { turnoId: ctx.params.turnoId, escopo: ctx.escopo }); } },
];

describe("servidor: saúde, sessão e roteador", () => {
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", {
      rotas: rotasDeTeste,
      segredoSessao: "segredo-de-teste",
      autorizarTokenTurno: (token) =>
        token === "token-bom" ? { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON, turnoId: "t1", agenteId: "a1" } : null,
    });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
  });
  afterAll(() => close());

  it("GET /api/saude → {ok:true}", async () => {
    const r = await fetch(`${base}/api/saude`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("sessão ausente → 401; tenant da URL ≠ sessão → 404; casando → o handler recebe o escopo", async () => {
    expect((await fetch(`${base}/api/t/${TENANT_LEAPY}/eco`)).status).toBe(401);

    const entrar = await fetch(`${base}/api/sessao/entrar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pessoa: "marlon" }),
    });
    expect(entrar.status).toBe(200);
    const cookie = entrar.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const jar = { cookie: cookie.split(";")[0] ?? "" };

    expect((await fetch(`${base}/api/t/00000000-0000-4000-8000-000000000000/eco`, { headers: jar })).status).toBe(404);
    const ok = await fetch(`${base}/api/t/${TENANT_LEAPY}/eco`, { headers: jar });
    expect(await ok.json()).toEqual({ escopo: { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON } });
    const sessao = await fetch(`${base}/api/sessao`, { headers: jar });
    expect(await sessao.json()).toEqual({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON });

    const params = await fetch(`${base}/api/t/${TENANT_LEAPY}/agentes/abc%20d`, { headers: jar });
    expect(await params.json()).toEqual({ id: "abc d" });

    const cookieForjado = { cookie: `${jar.cookie.slice(0, -4)}xxxx` };
    expect((await fetch(`${base}/api/t/${TENANT_LEAPY}/eco`, { headers: cookieForjado })).status).toBe(401);
  });

  it("pessoa desconhecida ao entrar → 400 entrada_invalida sem detalhe", async () => {
    const r = await fetch(`${base}/api/sessao/entrar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pessoa: "intruso" }),
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ codigo: "entrada_invalida", mensagem: "entrada inválida" });
  });

  it("rota interna: Origin → 403 antes do token; sem token → 401; com token → identidade do token", async () => {
    expect((await fetch(`${base}/api/interno/plano`, { headers: { origin: "http://evil", authorization: "Bearer token-bom" } })).status).toBe(403);
    expect((await fetch(`${base}/api/interno/plano`)).status).toBe(401);
    expect((await fetch(`${base}/api/interno/plano`, { headers: { authorization: "Bearer token-ruim" } })).status).toBe(401);
    const r = await fetch(`${base}/api/interno/plano`, { headers: { authorization: "Bearer token-bom" } });
    expect(await r.json()).toEqual({ turnoId: "t1", escopo: { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON } });
  });

  it("rota desconhecida → 404 JSON", async () => {
    const r = await fetch(`${base}/api/nada`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as { codigo: string }).codigo).toBe("nao_encontrado");
  });

  it("recusa NOD_HOST fora de 127.0.0.1 enquanto a sessão for stub", () => {
    expect(() => listen(0, "0.0.0.0")).toThrow(/NOD_HOST=0.0.0.0 recusado/);
  });
});
