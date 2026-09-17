import { expect, it } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { dentroEmMemoria, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";

it("login Composio só habilita após conta ativa, confere o dono, cifra a chave e não concede ferramentas", async () => {
  const chave = chaveDe("teste-composio-local");
  const cifra = (s: string) => cifrar(s, chave);
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => ({ ok: true, ferramentas: [{ nome: "SLACK_SEND_MESSAGE", descricao: "Envia mensagem", readOnlyHint: false, schema: { type: "object" } }] }) }) });
  let ativo = false;
  let userId = "";
  let contaUserId = "";
  const chamadas: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("ak_segredo");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    chamadas.push({ url: u, method: init?.method ?? "GET", body });
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) {
      userId = String(body?.user_id); contaUserId = userId;
      expect(body).toMatchObject({ toolkits: { enable: ["slack"] }, preload: { tools: "all" }, search: { enable: false }, execute: { enable_multi_execute: false }, workbench: { enable: false } });
      return Response.json({ session_id: "trs_teste", mcp: { url: "https://app.composio.dev/tool_router/v3/trs_teste/mcp" } });
    }
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/lt_teste", connected_account_id: "ca_teste" });
    if (u.endsWith("/connected_accounts/ca_teste")) return Response.json({ status: ativo ? "ACTIVE" : "INITIALIZING", user_id: contaUserId, toolkit: { slug: "slack" } });
    if (u.endsWith("/session/trs_teste") && init?.method === "PATCH") {
      expect(body).toEqual({ connected_accounts: { slack: ["ca_teste"] } });
      return Response.json({});
    }
    throw new Error("endpoint inesperado");
  };
  const srv = await servidorDeTeste([...rotasMarketplace({ dentro: memoria.dentro, cifrar: cifra, decifrar: (s) => decifrar(s, chave), fetchImpl: fakeFetch }), ...rotasConectores({ dentro: memoria.dentro, cifrar: cifra })]);
  try {
    const sessao = await srv.entrar("marlon");
    expect((await srv.chamar(sessao, "POST", "marketplace/slack/conectar")).status).toBe(409);
    expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_segredo" })).status).toBe(200);
    expect([...memoria.banco.composioChaves.values()][0]).not.toContain("ak_segredo");
    const inicio = await srv.chamar(sessao, "POST", "marketplace/slack/conectar");
    expect(inicio.status).toBe(200);
    expect(await inicio.json()).toMatchObject({ url: "https://app.composio.dev/link/lt_teste" });
    expect(memoria.banco.conectores[0]?.habilitado).toBe(false);
    expect(userId).toBe(`nod:${sessao.tenantId}:${sessao.pessoaId}`);
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toEqual({ conectado: false });
    ativo = true; contaUserId = "outro_usuario";
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toEqual({ conectado: false });
    contaUserId = userId;
    expect(await (await srv.chamar(sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    const lista = await (await srv.chamar(sessao, "GET", "conectores")).text();
    expect(lista).not.toContain("ak_segredo");
    expect(lista).not.toContain("envCifrado");
    expect(memoria.banco.concessoes).toHaveLength(0);
    expect(chamadas.some((r) => r.method === "PATCH")).toBe(true);
  } finally { await srv.close(); }
});
