import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { listen } from "../../src/adapters/http/server.ts";
import type { Rota } from "../../src/adapters/http/roteador.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";

/** Servidor real em porta 0, sem banco: saúde, sessão stub, escopo da URL e rotas internas. */
const rotasDeTeste: Rota[] = [
  { metodo: "GET", padrao: /^\/eco$/, async handler(ctx) { ctx.json(200, { escopo: ctx.escopo }); } },
  { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)$/, async handler(ctx) { ctx.json(200, { id: ctx.params.id }); } },
  { metodo: "GET", padrao: /^\/nomes\/(?<nome>[^/]+)$/, async handler(ctx) { ctx.json(200, { nome: ctx.params.nome }); } },
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
      sessao: { modo: "stub", pessoas: async () => [{ tenantId: TENANT_LEAPY, id: PESSOA_MARLON, nome: "Marlon" }] },
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

    // Login de desenvolvimento (NOD_LOGIN=stub, ADR-030): a tela lista as pessoas do cadastro e entra por id.
    const modo = await fetch(`${base}/api/sessao/modo`);
    expect(await modo.json()).toEqual({ modo: "stub", pessoas: [{ id: PESSOA_MARLON, nome: "Marlon" }] });
    const entrar = await fetch(`${base}/api/sessao/entrar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pessoaId: PESSOA_MARLON }),
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

    const params = await fetch(`${base}/api/t/${TENANT_LEAPY}/nomes/abc%20d`, { headers: jar });
    expect(await params.json()).toEqual({ nome: "abc d" });
    // EMENDA-L9 §2: grupo `id` fora do formato uuid é rota inexistente (404), nunca 22P02 → 500.
    expect((await fetch(`${base}/api/t/${TENANT_LEAPY}/agentes/abc%20d`, { headers: jar })).status).toBe(404);
    const uuid = await fetch(`${base}/api/t/${TENANT_LEAPY}/agentes/00000000-0000-4000-8000-000000000000`, { headers: jar });
    expect(await uuid.json()).toEqual({ id: "00000000-0000-4000-8000-000000000000" });

    const cookieForjado = { cookie: `${jar.cookie.slice(0, -4)}xxxx` };
    expect((await fetch(`${base}/api/t/${TENANT_LEAPY}/eco`, { headers: cookieForjado })).status).toBe(401);
  });

  it("pessoa fora do cadastro (ou o nome antigo 'marlon') ao entrar → 400 entrada_invalida sem detalhe", async () => {
    for (const corpo of [{ pessoaId: "00000000-0000-4000-8000-000000000000" }, { pessoa: "marlon" }]) {
      const r = await fetch(`${base}/api/sessao/entrar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ codigo: "entrada_invalida", mensagem: "entrada inválida" });
    }
  });

  it("stub sem ninguém no cadastro: a lista vem vazia e ninguém entra", async () => {
    const vazio = await listen(0, "127.0.0.1", { rotas: rotasDeTeste, segredoSessao: "s", sessao: { modo: "stub" } });
    try {
      const u = `http://127.0.0.1:${vazio.port}`;
      expect(await (await fetch(`${u}/api/sessao/modo`)).json()).toEqual({ modo: "stub", pessoas: [] });
      const r = await fetch(`${u}/api/sessao/entrar`, { method: "POST", body: JSON.stringify({ pessoaId: PESSOA_MARLON }) });
      expect(r.status).toBe(400);
    } finally {
      await vazio.close();
    }
  });

  it("no modo stub as rotas do Google não existem", async () => {
    expect((await fetch(`${base}/api/sessao/google`, { redirect: "manual" })).status).toBe(404);
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

  it("recusa NOD_HOST fora de 127.0.0.1 com o login de desenvolvimento (stub)", () => {
    expect(() => listen(0, "0.0.0.0")).toThrow(/NOD_HOST=0.0.0.0 recusado/);
    expect(() => listen(0, "0.0.0.0", { sessao: { modo: "stub" } })).toThrow(/NOD_HOST=0.0.0.0 recusado/);
  });
});
