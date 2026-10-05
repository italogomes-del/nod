import { errosDoSchema } from "../../../src/use-cases/chamar-ferramenta.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarClienteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";
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

// NOD-157: nova tentativa só no transporte http, com fetch, relógio e espera falsos.
function mcpComFalhas(falhas: (number | "rede" | "lento")[], opcoes: { retryAfter?: string } = {}) {
  const restantes = [...falhas];
  const ids: number[] = [];
  const chamadas: string[] = [];
  const dormiu: number[] = [];
  let t = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
    chamadas.push(q.method);
    if (!q.id) return new Response(null, { status: 202 });
    if (q.method === "tools/call") {
      ids.push(q.id);
      const falha = restantes.shift();
      if (falha === "rede") throw new TypeError("fetch failed");
      if (falha === "lento") throw Object.assign(new Error("abortado"), { name: "AbortError" });
      if (typeof falha === "number") return new Response("falhou", { status: falha, headers: opcoes.retryAfter ? { "retry-after": opcoes.retryAfter } : {} });
      return Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "feito" }] } });
    }
    return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
  };
  const cliente = criarClienteMcp({ nome: "gmail", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl, agora: () => t, dormir: async (ms) => { dormiu.push(ms); t += ms; }, aleatorio: () => 0.5 });
  const chamadasDaFerramenta = () => chamadas.filter((m) => m === "tools/call").length;
  return { cliente, ids, dormiu, chamadasDaFerramenta };
}

describe("nova tentativa nos conectores HTTP (NOD-157)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { logSpy.mockRestore(); });
  const logs = () => logSpy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
  const novasTentativas = () => logs().filter((l) => l["evento"] === "conector_nova_tentativa");

  it("429 e depois 200 dão sucesso com 2 chamadas, ids JSON-RPC distintos e log recuperou", async () => {
    const m = mcpComFalhas([429]);
    expect(await m.cliente.chamar("GMAIL_SEND_EMAIL", {})).toEqual({ conteudo: "feito", isError: false });
    expect(m.chamadasDaFerramenta()).toBe(2);
    expect(new Set(m.ids).size).toBe(2);
    expect(m.dormiu).toEqual([1_000]);
    expect(novasTentativas()).toMatchObject([{ conector: "gmail", ferramenta: "GMAIL_SEND_EMAIL", status: 429, tentativa: 2, espera_ms: 1_000, desfecho: "recuperou" }]);
  });

  it("503 em leitura recupera (1 s e 3 s de espera); 503 em escrita faz 1 chamada só e falha com o status", async () => {
    const leitura = mcpComFalhas([503, 503]);
    expect((await leitura.cliente.chamar("GMAIL_FETCH_EMAILS", {}, { somenteLeitura: true })).conteudo).toBe("feito");
    expect(leitura.chamadasDaFerramenta()).toBe(3);
    expect(leitura.dormiu).toEqual([1_000, 3_000]);

    const escrita = mcpComFalhas([503]);
    await expect(escrita.cliente.chamar("GMAIL_SEND_EMAIL", {})).rejects.toMatchObject({ motivo: "conector_indisponivel", status: 503 });
    expect(escrita.chamadasDaFerramenta()).toBe(1);
    expect(escrita.dormiu).toEqual([]);
  });

  it("erro de rede repete em leitura e não repete em escrita", async () => {
    const leitura = mcpComFalhas(["rede"]);
    await leitura.cliente.chamar("x", {}, { somenteLeitura: true });
    expect(leitura.chamadasDaFerramenta()).toBe(2);
    const escrita = mcpComFalhas(["rede"]);
    await expect(escrita.cliente.chamar("x", {})).rejects.toMatchObject({ motivo: "conector_indisponivel" });
    expect(escrita.chamadasDaFerramenta()).toBe(1);
  });

  it("Retry-After de 2 s é respeitado; de 120 s não repete", async () => {
    const curto = mcpComFalhas([429], { retryAfter: "2" });
    await curto.cliente.chamar("x", {});
    expect(curto.dormiu).toEqual([2_000]);
    // Data HTTP lida pelo relógio injetado, não pelo Date.now.
    const data = mcpComFalhas([429], { retryAfter: new Date(2_000).toUTCString() });
    await data.cliente.chamar("x", {});
    expect(data.dormiu).toEqual([2_000]);
    const longo = mcpComFalhas([429], { retryAfter: "120" });
    await expect(longo.cliente.chamar("x", {})).rejects.toMatchObject({ status: 429 });
    expect(longo.chamadasDaFerramenta()).toBe(1);
  });

  it("429 em escrita recupera", async () => {
    const m = mcpComFalhas([429, 429]);
    expect((await m.cliente.chamar("x", {}, { somenteLeitura: false })).conteudo).toBe("feito");
    expect(m.chamadasDaFerramenta()).toBe(3);
  });

  it("401 e 403 fazem 1 chamada e o erro leva o status; timeout faz 1 chamada", async () => {
    for (const status of [401, 403]) {
      const m = mcpComFalhas([status]);
      await expect(m.cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ status });
      expect(m.chamadasDaFerramenta()).toBe(1);
    }
    const t = mcpComFalhas(["lento"]);
    await expect(t.cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ motivo: "timeout_transporte" });
    expect(t.chamadasDaFerramenta()).toBe(1);
  });

  it("503 três vezes esgota em 3 chamadas e o log diz esgotou", async () => {
    const m = mcpComFalhas([503, 503, 503, 503]);
    await expect(m.cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ status: 503 });
    expect(m.chamadasDaFerramenta()).toBe(3);
    expect(novasTentativas().map((l) => [l["tentativa"], l["desfecho"]])).toEqual([[2, "repetindo"], [3, "esgotou"]]);
  });

  it("não repete quando a próxima espera mais 15 s não cabe nos 30 s", async () => {
    let t = 0;
    let chamadasDaFerramenta = 0;
    const fetchImpl: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      t += 14_000;
      if (q.method !== "tools/call") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
      chamadasDaFerramenta++;
      return new Response("x", { status: 503 });
    };
    const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl, agora: () => t, dormir: async () => undefined });
    await expect(cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ status: 503 });
    expect(chamadasDaFerramenta).toBe(1);
  });

  it("stdio nunca repete (a nova tentativa é só do transporte http)", async () => {
    const cliente = criarClienteMcp({ nome: "local", transporte: "stdio", comando: "/bin/nao-existe-nod-157" });
    await expect(cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ motivo: "conector_indisponivel" });
    expect(novasTentativas()).toEqual([]);
  });

  it("redirecionamento recusado não é corte de rede: leitura não repete", async () => {
    let chamadasDaFerramenta = 0;
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
      chamadasDaFerramenta++;
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    };
    const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl: f, agora: () => 0, dormir: async () => undefined });
    await expect(cliente.chamar("x", {}, { somenteLeitura: true })).rejects.toMatchObject({ motivo: "conector_indisponivel" });
    expect(chamadasDaFerramenta).toBe(1);
  });

  it("initialize e tools/list com 503 se recuperam (são leitura)", async () => {
    const falhas: Record<string, number> = { initialize: 1, "tools/list": 1 };
    const chamadas: string[] = [];
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      chamadas.push(q.method);
      if (!q.id) return new Response(null, { status: 202 });
      if ((falhas[q.method] ?? 0) > 0) {
        falhas[q.method]!--;
        return new Response("x", { status: 503 });
      }
      return Response.json({ jsonrpc: "2.0", id: q.id, result: q.method === "tools/list" ? { tools: [{ name: "t1" }] } : {} });
    };
    const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl: f, agora: () => 0, dormir: async () => undefined, aleatorio: () => 0.5 });
    expect((await cliente.listar()).map((t) => t.name)).toEqual(["t1"]);
    expect(chamadas).toEqual(["initialize", "initialize", "notifications/initialized", "tools/list", "tools/list"]);
    expect(novasTentativas().map((l) => [l["ferramenta"], l["desfecho"]])).toEqual([["initialize", "recuperou"], ["tools/list", "recuperou"]]);
  });

  it("resposta acima de 1 MiB não repete, nem em leitura", async () => {
    let chamadasDaFerramenta = 0;
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
      chamadasDaFerramenta++;
      return new Response("x".repeat(1_100_000), { headers: { "content-type": "application/json" } });
    };
    const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl: f, agora: () => 0, dormir: async () => undefined });
    expect((await cliente.chamar("x", {}, { somenteLeitura: true })).conteudo).toMatch(/^resposta_mcp_grande/);
    expect(chamadasDaFerramenta).toBe(1);
    expect(novasTentativas()).toEqual([]);
  });

  it("o corpo do 429/5xx é descartado antes da nova tentativa", async () => {
    const cancelados: number[] = [];
    let n = 0;
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
      if (++n > 1) return Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "feito" }] } });
      const corpo = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("ocupado")); }, cancel() { cancelados.push(n); } });
      return new Response(corpo, { status: 503 });
    };
    const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", fetchImpl: f, agora: () => 0, dormir: async () => undefined });
    expect((await cliente.chamar("x", {}, { somenteLeitura: true })).conteudo).toBe("feito");
    expect(cancelados).toEqual([1]);
  });

  it("conectores-vivos: chamada que se recupera mantém o cliente e não registra conector_chamada_falhou", async () => {
    let falhas = 1;
    let toolsCall = 0;
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
      toolsCall++;
      if (falhas-- > 0) return new Response("x", { status: 503 });
      return Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "feito" }] } });
    };
    const vivos = criarConectoresVivos({ agora: () => 0, fetchImpl: f, carregar: async () => ({ nome: "gmail", transporte: "http", url: "https://backend.composio.dev/mcp" }) });
    expect((await vivos.chamar("c1", "GMAIL_FETCH_EMAILS", {}, { rotina: false, somenteLeitura: true })).conteudo).toBe("feito");
    expect(toolsCall).toBe(2);
    expect(vivos.vivos()).toBe(1);
    expect(logs().some((l) => l["evento"] === "conector_chamada_falhou")).toBe(false);
    await vivos.fechar();
  });

  describe("orçamento de 30 s com relógio falso", () => {
    beforeEach(() => { vi.useFakeTimers({ now: 0 }); });
    afterEach(() => { vi.useRealTimers(); });

    /** Servidor lento: responde depois de `ms`, ou nunca (null); o aborto do cliente vira AbortError, como no fetch real. */
    function lento(ms: number | null, resposta: () => Response, signal: AbortSignal | null | undefined, abortos: number[]): Promise<Response> {
      return new Promise((res, rej) => {
        const t = ms === null ? undefined : setTimeout(() => res(resposta()), ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); abortos.push(Date.now()); rej(Object.assign(new Error("abortado"), { name: "AbortError" })); });
      });
    }

    it("5xx lento em leitura: o 503 leva 13 s, a segunda tentativa não responde e o total fica em 30 s ou menos", async () => {
      const inicios: number[] = [];
      const abortos: number[] = [];
      const fetchImpl: typeof fetch = async (_u, init) => {
        const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
        if (!q.id) return new Response(null, { status: 202 });
        if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
        inicios.push(Date.now());
        return lento(inicios.length === 1 ? 13_000 : null, () => new Response("x", { status: 503 }), init?.signal, abortos);
      };
      const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", timeoutMs: 15_000, fetchImpl, aleatorio: () => 0.5 });
      const r = cliente.chamar("x", {}, { somenteLeitura: true }).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await r).toMatchObject({ motivo: "timeout_transporte" });
      expect(inicios).toEqual([0, 14_000]);
      expect(abortos).toEqual([29_000]);
      expect(Date.now()).toBeLessThanOrEqual(30_000);
    });

    it("initialize com 503 aos 13 s recupera aos 28,25 s: o tools/call de 14 s é cortado e o total fica em 30 s, não 42,25 s", async () => {
      const abortos: number[] = [];
      let inicializacoes = 0;
      let chamadaEm: number | undefined;
      const fetchImpl: typeof fetch = async (_u, init) => {
        const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
        if (!q.id) return new Response(null, { status: 202 });
        if (q.method === "initialize") {
          inicializacoes++;
          return inicializacoes === 1
            ? lento(13_000, () => new Response("x", { status: 503 }), init?.signal, abortos)
            : lento(28_250 - Date.now(), () => Response.json({ jsonrpc: "2.0", id: q.id, result: {} }), init?.signal, abortos);
        }
        chamadaEm = Date.now();
        return lento(14_000, () => Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [] } }), init?.signal, abortos);
      };
      const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", timeoutMs: 15_000, fetchImpl, aleatorio: () => 0.5 });
      const r = cliente.chamar("x", {}, { somenteLeitura: true }).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await r).toMatchObject({ motivo: "timeout_transporte" });
      expect(inicializacoes).toBe(2);
      expect(chamadaEm).toBe(28_250);
      expect(abortos).toEqual([30_000]);
      expect(Date.now()).toBeLessThanOrEqual(30_000);
    });

    it("o prazo de cada requisição é cortado ao que sobra: tools/list paginado e lento para aos 30 s, não aos 36 s", async () => {
      const abortos: number[] = [];
      let pagina = 0;
      const fetchImpl: typeof fetch = async (_u, init) => {
        const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
        if (!q.id) return new Response(null, { status: 202 });
        if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
        pagina++;
        return lento(12_000, () => Response.json({ jsonrpc: "2.0", id: q.id, result: { tools: [{ name: `t${pagina}` }], nextCursor: `c${pagina}` } }), init?.signal, abortos);
      };
      const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", timeoutMs: 15_000, fetchImpl });
      const r = cliente.listar().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await r).toMatchObject({ motivo: "timeout_transporte" });
      expect(pagina).toBe(3);
      expect(abortos).toEqual([30_000]);
    });

    it("envio de arquivo (orcamentoMs: null) mantém o prazo próprio, sem o corte de 30 s", async () => {
      const abortos: number[] = [];
      const fetchImpl: typeof fetch = async (_u, init) => {
        const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
        if (!q.id) return new Response(null, { status: 202 });
        if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} });
        return lento(40_000, () => Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "enviado" }] } }), init?.signal, abortos);
      };
      const cliente = criarClienteMcp({ nome: "g", transporte: "http", url: "https://backend.composio.dev/mcp", timeoutMs: 600_000, orcamentoMs: null, fetchImpl });
      const r = cliente.chamar("x", {});
      await vi.runAllTimersAsync();
      expect((await r).conteudo).toBe("enviado");
      expect(abortos).toEqual([]);
    });
  });

  it("conector_chamada_falhou leva o status HTTP e o cliente é descartado só no fim", async () => {
    const f: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (!q.id) return new Response(null, { status: 202 });
      return q.method === "initialize" ? Response.json({ jsonrpc: "2.0", id: q.id, result: {} }) : new Response("x", { status: 401 });
    };
    const vivos = criarConectoresVivos({ agora: () => 0, fetchImpl: f, carregar: async () => ({ nome: "gmail", transporte: "http", url: "https://backend.composio.dev/mcp" }) });
    await expect(vivos.chamar("c1", "GMAIL_FETCH_EMAILS", {}, { rotina: false, somenteLeitura: true })).rejects.toMatchObject({ status: 401 });
    expect(logs().find((l) => l["evento"] === "conector_chamada_falhou")).toMatchObject({ ferramenta: "GMAIL_FETCH_EMAILS", status: 401 });
    expect(vivos.vivos()).toBe(0);
  });
});
