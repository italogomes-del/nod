import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarClienteComposio } from "../../../src/adapters/integracoes/composio.ts";

// NOD-157: GET é leitura, POST e PATCH são escrita; fetch, relógio e espera falsos.
function cliente(respostas: (number | "rede" | "redirect")[], cabecalhos: Record<string, string> = {}) {
  const restantes = [...respostas];
  const metodos: string[] = [];
  const dormiu: number[] = [];
  const f: typeof fetch = async (_url, init) => {
    metodos.push(String(init?.method));
    const r = restantes.shift() ?? 200;
    if (r === "rede") throw new TypeError("fetch failed");
    if (r === "redirect") throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    return r === 200 ? Response.json({ items: [], session_id: "s1", mcp: { url: "https://backend.composio.dev/mcp/s1" }, redirect_url: "https://connect.composio.dev/x", connected_account_id: "ca1" }) : new Response("x", { status: r, headers: cabecalhos });
  };
  return { c: criarClienteComposio("chave", f, { agora: () => 0, dormir: async (ms) => { dormiu.push(ms); }, aleatorio: () => 0.5 }), metodos, dormiu };
}

describe("cliente do Composio REST: nova tentativa (NOD-157)", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("GET com 503 e depois 200 recupera; GET com rede cortada também", async () => {
    const a = cliente([503]);
    await expect(a.c.validar()).resolves.toBeTruthy();
    expect(a.metodos).toEqual(["GET", "GET"]);
    expect(a.dormiu).toEqual([1_000]);
    const b = cliente(["rede"]);
    await expect(b.c.validar()).resolves.toBeTruthy();
    expect(b.metodos).toEqual(["GET", "GET"]);
  });

  it("POST com 503 não repete; POST com 429 e depois 200 recupera", async () => {
    const a = cliente([503]);
    await expect(a.c.criarSessao("u1", "gmail")).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(a.metodos).toEqual(["POST"]);
    const b = cliente([429]);
    await expect(b.c.criarSessao("u1", "gmail")).resolves.toMatchObject({ id: "s1" });
    expect(b.metodos).toEqual(["POST", "POST"]);
  });

  it("PATCH (fixarConta) é escrita: 503 não repete, 429 repete", async () => {
    const a = cliente([503]);
    await expect(a.c.fixarConta("s1", "gmail", "ca1")).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(a.metodos).toEqual(["PATCH"]);
    const b = cliente([429]);
    await expect(b.c.fixarConta("s1", "gmail", "ca1")).resolves.toBeUndefined();
    expect(b.metodos).toEqual(["PATCH", "PATCH"]);
  });

  it("401 continua integracao_autenticacao sem repetir; 404 também não repete", async () => {
    const a = cliente([401]);
    await expect(a.c.validar()).rejects.toMatchObject({ codigo: "integracao_autenticacao" });
    expect(a.metodos).toEqual(["GET"]);
    const b = cliente([404]);
    await expect(b.c.validar()).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(b.metodos).toEqual(["GET"]);
  });

  it("503 três vezes esgota em 3 chamadas", async () => {
    const a = cliente([503, 503, 503, 503]);
    await expect(a.c.validar()).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(a.metodos).toHaveLength(3);
    expect(a.dormiu).toEqual([1_000, 3_000]);
  });

  it("Retry-After: 2 s é respeitado (segundos e data HTTP); 120 s não repete", async () => {
    const a = cliente([429], { "retry-after": "2" });
    await expect(a.c.criarSessao("u1", "gmail")).resolves.toMatchObject({ id: "s1" });
    expect(a.metodos).toEqual(["POST", "POST"]);
    expect(a.dormiu).toEqual([2_000]);
    const b = cliente([503], { "retry-after": new Date(2_000).toUTCString() });
    await expect(b.c.validar()).resolves.toBeTruthy();
    expect(b.dormiu).toEqual([2_000]);
    const c = cliente([429], { "retry-after": "120" });
    await expect(c.c.criarSessao("u1", "gmail")).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(c.metodos).toEqual(["POST"]);
    expect(c.dormiu).toEqual([]);
  });

  it("redirecionamento recusado (redirect: \"error\") não repete nem em leitura", async () => {
    const a = cliente(["redirect"]);
    await expect(a.c.validar()).rejects.toMatchObject({ codigo: "conector_indisponivel" });
    expect(a.metodos).toEqual(["GET"]);
    expect(a.dormiu).toEqual([]);
  });

  describe("orçamento de 30 s com relógio falso", () => {
    beforeEach(() => { vi.useFakeTimers({ now: 0 }); });
    afterEach(() => { vi.useRealTimers(); });

    it("5xx lento em leitura: o 503 leva 13 s, a segunda tentativa não responde e o total fica em 30 s ou menos", async () => {
      const inicios: number[] = [];
      const abortos: number[] = [];
      const f: typeof fetch = (_url, init) => {
        inicios.push(Date.now());
        const primeira = inicios.length === 1;
        return new Promise((res, rej) => {
          const t = primeira ? setTimeout(() => res(new Response("x", { status: 503 })), 13_000) : undefined;
          init?.signal?.addEventListener("abort", () => { clearTimeout(t); abortos.push(Date.now()); rej(init.signal?.reason); });
        });
      };
      const c = criarClienteComposio("chave", f, { aleatorio: () => 0.5 });
      const r = c.validar().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await r).toMatchObject({ codigo: "conector_indisponivel" });
      expect(inicios).toEqual([0, 14_000]);
      expect(abortos).toEqual([29_000]);
      expect(Date.now()).toBeLessThanOrEqual(30_000);
    });

    it("NOD-208 (revisão): prazoFinal corta o orçamento de 30 s; o PATCH do fixarConta que não responde desiste nele", async () => {
      const abortos: number[] = [];
      const f: typeof fetch = (_url, init) => new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => { abortos.push(Date.now()); rej(init.signal?.reason); });
      });
      const c = criarClienteComposio("chave", f, { aleatorio: () => 0.5, prazoFinal: 5_000 });
      const r = c.fixarConta("trs_x", "slack", "ca_x").catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await r).toMatchObject({ codigo: "conector_indisponivel" });
      expect(abortos).toEqual([5_000]);
    });
  });
});
