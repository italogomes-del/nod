import { describe, expect, it, vi } from "vitest";
import { criarPonteHttp, urlServidor } from "../../src/adapters/executor/ponte-http.ts";
import { versaoAceita } from "../../src/domain/versao-app.ts";
import { entrega, inventario, sinais, trechos } from "../../src/adapters/http/rotas/ponte-validacao.ts";

describe("desktop: fronteiras HTTP", () => {
  it("só aceita HTTPS sem credenciais ou caminhos; loopback exige opção de desenvolvimento", () => {
    expect(urlServidor("https://nod.example")).toBe("https://nod.example");
    for (const u of ["http://nod.example", "http://127.0.0.1:8888", "https://user:secret@nod.example", "file:///tmp/a", "https://nod.example/api", "https://nod.example/?token=x"]) expect(() => urlServidor(u)).toThrow();
    expect(urlServidor("http://127.0.0.1:8888", true)).toBe("http://127.0.0.1:8888");
  });
  it("compara versões numericamente e recusa entradas malformadas", () => {
    expect(versaoAceita("0.10.0", "0.2.0")).toBe(true);
    for (const v of [undefined, ["0.2.0"], "0.1.9", "0.2.0-beta", "wat"]) expect(versaoAceita(v, "0.2.0")).toBe(false);
  });
  it("manda só bearer da máquina e versão, recusa redirect, nunca Origin", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ plano: null }), { headers: { "x-nod-versao-minima": "0.1.0" } }));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f });
    expect(await c.ponte.puxar("id-ignorado")).toBeNull();
    expect(f).toHaveBeenCalledWith("https://nod.example/api/maquina/puxar", expect.objectContaining({ redirect: "error", body: "{}", headers: { authorization: "Bearer test-only", "content-type": "application/json", "x-nod-versao": "0.1.0" } }));
  });
  it.each([401, 426, 503])("renovação que falha (%i) manda abortar o CLI", async (status) => {
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })) });
    expect((await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [] })).ativo).toBe(false);
  });
  it("não confia no relógio nem em prosa do inventário remoto", () => {
    expect(inventario({ estado: "ausente", em: Infinity, motivo: "segredo" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    expect(() => sinais({ attempted: "true" })).toThrow();
    expect(() => entrega({ resultado: { desfecho: "inventado" }, fala: {}, seqLocal: -1 }, "x")).toThrow();
  });
  it("renovação leva texto e ferramentas NA ORDEM, juntando texto seguido, e esvazia a fila", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("Próximo "); c.delta("lote."); c.ferramenta("mcp__nod__gmail__search_threads"); c.delta("44 processados.");
    const pedido = { turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] };
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "Próximo lote." }, { ferramenta: "mcp__nod__gmail__search_threads" }, { texto: "44 processados." }]);
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body)).trechos).toEqual([]);
  });
  it("fila acima de 16k de texto descarta o mais antigo", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("a".repeat(10_000)); c.ferramenta("Bash"); c.delta("b".repeat(10_000));
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    const enviados = JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos as { texto?: string }[];
    expect(enviados.reduce((n, t) => n + (t.texto?.length ?? 0), 0)).toBe(16_000);
    expect(enviados.at(-1)?.texto).toBe("b".repeat(10_000));
  });
  it("servidor: trecho fora do formato cai sozinho; acima do teto, nada passa", () => {
    expect(trechos([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }, { ferramenta: "rm -rf /" }, { texto: "a", ferramenta: "b" }, 3])).toEqual([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }]);
    expect(trechos([{ texto: "a".repeat(9_000) }, { texto: "b".repeat(9_000) }])).toEqual([]);
    expect(trechos("texto")).toEqual([]);
  });
});
