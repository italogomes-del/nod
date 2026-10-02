import { describe, expect, it, vi } from "vitest";
import { criarPonteHttp, urlServidor } from "../../src/adapters/executor/ponte-http.ts";
import { versaoAceita } from "../../src/domain/versao-app.ts";
import { entrega, falas, inventario, sinais, trechos } from "../../src/adapters/http/rotas/ponte-validacao.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../src/shared/constantes.ts";

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
  it("renovação leva texto e ferramentas NA ORDEM, juntando texto seguido, esvazia a fila e não mistura turnos", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "Próximo "); c.delta("x", "lote."); c.ferramenta("x", "mcp__nod__gmail__search_threads"); c.delta("x", "44 processados.");
    c.delta("outro", "de outro turno");
    const pedido = { turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] };
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "Próximo lote." }, { ferramenta: "mcp__nod__gmail__search_threads" }, { texto: "44 processados." }]);
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body)).trechos).toEqual([]);
    // Pool de laços: cada turno renova só o próprio texto.
    await c.ponte.renovar({ ...pedido, turnoId: "outro" });
    expect(JSON.parse(String(f.mock.calls[2]?.[1]?.body)).trechos).toEqual([{ texto: "de outro turno" }]);
  });
  it("fila acima de 16k de texto descarta o mais antigo", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "a".repeat(10_000)); c.ferramenta("x", "Bash"); c.delta("x", "b".repeat(10_000));
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
  it("servidor: a lista de tarefas do bot passa validada; fora do formato ou acima de 50, o trecho some", () => {
    const tarefas = [{ id: "1", titulo: "Ler o diff", estado: "feita" }, { id: "2", titulo: "Checar SQL", estado: "andamento" }];
    expect(trechos([{ tarefas }])).toEqual([{ tarefas }]);
    expect(trechos([{ tarefas: [{ id: "1", titulo: "x", estado: "concluida" }] }, { texto: "ok" }])).toEqual([{ texto: "ok" }]);
    expect(trechos([{ tarefas: Array.from({ length: 51 }, (_, i) => ({ id: String(i), titulo: "t", estado: "pendente" })) }])).toEqual([]);
  });
  it("ADR-067: falas da sessão viva — seq inteiro ≥ 1 e texto dentro do teto; fora do formato a renovação é recusada (o executor reenvia)", () => {
    expect(falas(undefined)).toEqual([]);
    expect(falas([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }])).toEqual([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }]);
    for (const ruim of [[{ seq: 0, texto: "x" }], [{ seq: 1.5, texto: "x" }], [{ seq: 1 }], [{ seq: 1, texto: "x".repeat(TEXTO_ENTREGA_MAX_CHARS + 1) }], "x", Array.from({ length: 51 }, (_, i) => ({ seq: i + 1, texto: "t" }))]) {
      expect(() => falas(ruim), JSON.stringify(ruim).slice(0, 60)).toThrow();
    }
  });
});
