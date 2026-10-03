import { describe, expect, it } from "vitest";
import { FalhaPareamento, parearPeloNavegador, urlDePareamento } from "../../../desktop/parear.ts";
import { desafioDe } from "../../../src/services/pareamento-maquina.ts";

/** O "navegador" do teste: lê o pedido da URL que o app abriu e chama o retorno no 127.0.0.1. */
function navegador(responder: (pedido: URL) => string | null) {
  return async (url: string) => {
    const pedido = new URL(url);
    const codigo = responder(pedido);
    const porta = pedido.searchParams.get("porta");
    const estado = codigo === null ? "estado-errado-estado-errado" : pedido.searchParams.get("estado") ?? "";
    void fetch(`http://127.0.0.1:${porta}/retorno?estado=${encodeURIComponent(estado)}&codigo=${encodeURIComponent(codigo ?? "x")}`);
  };
}

describe("pareamento pelo navegador, lado do app (ADR-069)", () => {
  it("a URL leva porta, estado, desafio e nome, e não leva verificador", () => {
    const u = new URL(urlDePareamento("https://nod.acme.com.br", { porta: 50000, estado: "e".repeat(32), desafio: "d".repeat(43), nome: "MacBook" }));
    expect(u.origin).toBe("https://nod.acme.com.br");
    expect(Object.fromEntries(u.searchParams)).toEqual({ "parear-mac": "1", porta: "50000", estado: "e".repeat(32), desafio: "d".repeat(43), nome: "MacBook" });
  });

  it("recebe o código no 127.0.0.1 e troca com o verificador cujo sha256 é o desafio da URL", async () => {
    let desafio = "";
    let enviado: { codigo: string; verificador: string } | null = null;
    const chave = await parearPeloNavegador({
      servidor: "https://nod.acme.com.br",
      nome: "MacBook",
      abrir: navegador((p) => { desafio = p.searchParams.get("desafio") ?? ""; return "c".repeat(43); }),
      fetchImpl: (async (url: URL, init: RequestInit) => {
        expect(String(url)).toBe("https://nod.acme.com.br/api/pareamento/trocar");
        enviado = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ chave: "a.b" }), { status: 201 });
      }) as typeof fetch,
    });
    expect(chave).toBe("a.b");
    expect(enviado!.codigo).toBe("c".repeat(43));
    expect(desafioDe(enviado!.verificador)).toBe(desafio);
  });

  it("retorno com estado errado não conta: sem o certo, o prazo vence", async () => {
    await expect(parearPeloNavegador({ servidor: "https://nod.acme.com.br", nome: "MacBook", abrir: navegador(() => null), prazoMs: 300 })).rejects.toEqual(new FalhaPareamento("sem_resposta"));
  });

  it("troca recusada pelo servidor vira 'recusado'", async () => {
    await expect(parearPeloNavegador({
      servidor: "https://nod.acme.com.br",
      nome: "MacBook",
      abrir: navegador(() => "c".repeat(43)),
      fetchImpl: (async () => new Response("{}", { status: 400 })) as typeof fetch,
    })).rejects.toEqual(new FalhaPareamento("recusado"));
  });
});
