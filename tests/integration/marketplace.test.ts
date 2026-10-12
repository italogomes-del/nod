import { expect, it } from "vitest";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import type { ResultadoSonda } from "../../src/contracts/servicos.ts";
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
  const srv = await servidorDeTeste([...rotasMarketplace({ dentro: memoria.dentro, cifrar: cifra, decifrar: (s) => decifrar(s, chave), fetchImpl: fakeFetch }), ...rotasConectores({ dentro: memoria.dentro, cifrar: cifra, decifrar: (s) => decifrar(s, chave), fetchImpl: fakeFetch })]);
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

/**
 * NOD-208: logo depois do fixarConta a sessão do Composio pode ainda não expor o toolkit. O verificar repete a
 * sonda com espera crescente (0, 2, 4, 8 s) e não começa tentativa nova depois do teto de 20 s. Relógio e
 * espera falsos: o teste não dorme.
 */
async function montarVerificar(sonda: (n: number) => ResultadoSonda, custoDaSondaMs = 0) {
  const chave = chaveDe("teste-composio-local");
  const cifra = (s: string) => cifrar(s, chave);
  let agora = 0;
  let sondas = 0;
  const esperas: number[] = [];
  // Cada tentativa numa transação própria e a espera fora de qualquer uma (não segura conexão do pool).
  let tx = 0;
  let abertas = 0;
  let esperouDentro = false;
  const txDasSondas: number[] = [];
  const memoria = dentroEmMemoria({ services: servicosDeTeste({ sonda: () => {
    sondas += 1;
    txDasSondas.push(tx);
    agora += custoDaSondaMs;
    return sonda(sondas);
  } }) });
  const fakeFetch: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/toolkits?limit=1")) return Response.json({ items: [] });
    if (u.endsWith("/session")) return Response.json({ session_id: "trs_teste", mcp: { url: "https://app.composio.dev/tool_router/v3/trs_teste/mcp" } });
    if (u.endsWith("/link")) return Response.json({ redirect_url: "https://app.composio.dev/link/lt_teste", connected_account_id: "ca_teste" });
    if (u.endsWith("/connected_accounts/ca_teste")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "slack" } });
    if (u.endsWith("/session/trs_teste") && init?.method === "PATCH") return Response.json({});
    throw new Error("endpoint inesperado");
  };
  let userId = "";
  const dentro = (async (escopo, fn) => {
    tx += 1;
    abertas += 1;
    try { return await memoria.dentro(escopo, fn); } finally { abertas -= 1; }
  }) as typeof memoria.dentro;
  const esperar = async (ms: number) => { if (abertas > 0) esperouDentro = true; esperas.push(ms); agora += ms; };
  const op = { dentro, cifrar: cifra, decifrar: (s: string) => decifrar(s, chave), fetchImpl: fakeFetch, esperar, agora: () => agora };
  const srv = await servidorDeTeste([...rotasMarketplace(op), ...rotasConectores(op)]);
  const sessao = await srv.entrar("marlon");
  userId = `nod:${sessao.tenantId}:${sessao.pessoaId}`;
  expect((await srv.chamar(sessao, "POST", "marketplace/configurar", { chave: "ak_segredo" })).status).toBe(200);
  expect((await srv.chamar(sessao, "POST", "marketplace/slack/conectar")).status).toBe(200);
  return { srv, sessao, memoria, esperas, sondas: () => sondas, agora: () => agora, txDasSondas, esperouDentro: () => esperouDentro };
}

const FERRAMENTA_SLACK = { nome: "SLACK_SEND_MESSAGE", descricao: "Envia mensagem", readOnlyHint: false, schema: { type: "object" as const } };

it("NOD-208: catálogo vazio na 1ª sonda e real na 2ª → conectado e conector habilitado", async () => {
  const m = await montarVerificar((n) => n === 1 ? { ok: false, motivo: "conector_indisponivel" } : { ok: true, ferramentas: [FERRAMENTA_SLACK] });
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    expect(m.sondas()).toBe(2);
    expect(m.esperas).toEqual([2_000]);
    expect(m.memoria.banco.conectores[0]).toMatchObject({ habilitado: true, ultimaFalha: null });
  } finally { await m.srv.close(); }
});

it("NOD-208: sonda vazia em todas → falhou depois das 4 tentativas, dentro do teto de 20 s", async () => {
  const m = await montarVerificar(() => ({ ok: false, motivo: "conector_indisponivel" }));
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    expect(m.sondas()).toBe(4);
    expect(m.esperas).toEqual([2_000, 4_000, 8_000]);
    expect(new Set(m.txDasSondas).size).toBe(4);
    expect(m.esperouDentro()).toBe(false);
    expect(m.agora()).toBeLessThanOrEqual(20_000);
    expect(m.memoria.banco.conectores[0]?.habilitado).toBe(false);
  } finally { await m.srv.close(); }
});

it("NOD-208: prazo na 1ª sonda e ok na 2ª → conectado; só prazo, para antes de passar do teto", async () => {
  const m = await montarVerificar((n) => n === 1 ? { ok: false, motivo: "timeout_transporte" } : { ok: true, ferramentas: [FERRAMENTA_SLACK] }, 8_000);
  try {
    expect(await (await m.srv.chamar(m.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: true });
    expect(m.sondas()).toBe(2);
  } finally { await m.srv.close(); }
  const lenta = await montarVerificar(() => ({ ok: false, motivo: "timeout_transporte" }), 8_000);
  try {
    expect(await (await lenta.srv.chamar(lenta.sessao, "POST", "marketplace/slack/verificar")).json()).toMatchObject({ conectado: false, falhou: true });
    // 0–8 s, espera 2, 10–18 s; a 3ª começaria aos 22 s: não começa.
    expect(lenta.sondas()).toBe(2);
    expect(lenta.agora()).toBeLessThanOrEqual(20_000);
  } finally { await lenta.srv.close(); }
});
