import { errosDoSchema } from "../../../src/use-cases/chamar-ferramenta.ts";
import { expect, it } from "vitest";
import { paraJsonSchema, sondarConector } from "../../../src/adapters/mcp-proxy/probe.ts";
import { lerRespostaHttp } from "../../../src/adapters/mcp-proxy/resposta-http.ts";
import { criarConectoresVivos } from "../../../src/services/conectores-vivos.ts";

it("HTTP recebe apenas credenciais cadastradas, pagina ferramentas e ignora notificações SSE", async () => {
  const chamadas: string[] = [];
  const f: typeof fetch = async (_url, init) => {
    const h = new Headers(init?.headers);
    expect(h.get("authorization")).toBe("Bearer token-do-conector");
    expect(h.has("PATH")).toBe(false);
    expect(h.has("HOME")).toBe(false);
    expect(h.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(init?.redirect).toBe("error");
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { cursor?: string } };
    chamadas.push(q.method);
    if (!q.id) return new Response(null, { status: 202 });
    const result = q.method === "initialize" ? {} : q.params?.cursor ? { tools: [{ name: "escrever", inputSchema: { type: "object" } }] } : { tools: [{ name: "ler", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }], nextCursor: "pagina2" };
    return new Response(`data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: q.id, result })}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "sessao" } });
  };
  const r = await sondarConector({ nome: "remoto", transporte: "http", url: "https://example.com/mcp", env: { Authorization: "Bearer token-do-conector" } }, { fetchImpl: f, ambiente: { HOME: "/segredo", PATH: "/usr/bin", ANTHROPIC_API_KEY: "chave-da-assinatura" } });
  expect(r).toMatchObject({ ok: true, ferramentas: [{ nome: "ler", readOnlyHint: true }, { nome: "escrever", readOnlyHint: false }] });
  expect(chamadas).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list"]);
});

it("resposta HTTP grande é interrompida antes de chegar ao modelo", async () => {
  await expect(lerRespostaHttp(new Response("x".repeat(1_048_577)), 1)).rejects.toThrow("resposta_mcp_grande");
});

it("resposta grande de tools/call volta como erro da ferramenta, não como conector fora", async () => {
  const f: typeof fetch = async (_url, init) => {
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (!q.id) return new Response(null, { status: 202 });
    if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
    const texto = "x".repeat(1_100_000);
    return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: texto }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  const vivos = criarConectoresVivos({ agora: () => 0, fetchImpl: f, carregar: async () => ({ nome: "gmail", transporte: "http", url: "https://backend.composio.dev/mcp" }) });
  const r = await vivos.chamar("c1", "GMAIL_FETCH_EMAILS", { max_results: 20 });
  expect(r.isError).toBe(true);
  expect(r.conteudo).toMatch(/^resposta_mcp_grande: .*menos itens/);
  expect(vivos.vivos()).toBe(1);
  await vivos.fechar();
});

it("meta-executores Composio não entram no catálogo concedível", async () => {
  const f: typeof fetch = async (_url, init) => {
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
    if (!q.id) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: q.id, result: q.method === "initialize" ? {} : { tools: [{ name: "COMPOSIO_MULTI_EXECUTE_TOOL" }, { name: "SLACK_SEND_MESSAGE" }] } });
  };
  const r = await sondarConector({ nome: "slack", transporte: "http", url: "https://app.composio.dev/mcp" }, { fetchImpl: f });
  expect(r).toMatchObject({ ok: true, ferramentas: [{ nome: "SLACK_SEND_MESSAGE", readOnlyHint: false }] });
});

it("preserva parâmetros opcionais e nullable dos MCPs remotos", () => {
  const schema = paraJsonSchema({ type: "object", properties: { text: { anyOf: [{ type: "string" }, { type: "null" }] }, channel: { type: "string" } }, required: ["channel"] });
  expect(errosDoSchema(schema, { channel: "C1", text: "Olá" })).toEqual([]);
  expect(errosDoSchema(schema, { channel: "C1", text: null })).toEqual([]);
  expect(errosDoSchema(schema, { channel: "C1" })).toEqual([]);
  expect(errosDoSchema(schema, { channel: "C1", text: 42 }).length).toBeGreaterThan(0);
  expect(errosDoSchema(schema, { text: "Olá" }).length).toBeGreaterThan(0);
});
