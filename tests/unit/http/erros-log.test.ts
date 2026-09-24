import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { responderErro } from "../../../src/adapters/http/erros.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";

function resposta(): { res: ServerResponse; status: () => number; corpo: () => unknown } {
  let status = 0;
  let corpo = "";
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(d: string) { corpo = d; return res; },
  };
  return { res: res as Pick<ServerResponse, "writeHead" | "end"> as ServerResponse, status: () => status, corpo: () => JSON.parse(corpo) };
}

describe("responderErro registra a recusa no log", () => {
  const saida = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => saida.mockClear());
  const linhas = () => saida.mock.calls.map((c) => JSON.parse(String(c[0])));

  it("4xx de domínio vira linha com código, status, método, rota sem ids e cause; o cliente segue sem o cause", () => {
    const r = resposta();
    const id = "9ad2843f-f636-461d-9134-fabb31f6f14d";
    responderErro(r.res, new ErroDeDominio("entrada_invalida", { cause: "capacidade fora do catálogo do conector" }), {
      metodo: "POST",
      caminho: `/api/t/172e1fdf-428d-48cb-b052-3bd7d2573e18/decisoes/${id}/decidir?x=1`,
    });
    expect(r.status()).toBe(400);
    expect(r.corpo()).toEqual({ codigo: "entrada_invalida", mensagem: "entrada inválida" });
    expect(linhas()).toEqual([expect.objectContaining({
      nivel: "aviso",
      evento: "requisicao_recusada",
      codigo: "entrada_invalida",
      status: 400,
      metodo: "POST",
      rota: "/api/t/:id/decisoes/:id/decidir",
      causa: "capacidade fora do catálogo do conector",
    })]);
  });

  it("cause que não é texto não vai para o log; JSON malformado vira 'json_malformado'", () => {
    responderErro(resposta().res, new ErroDeDominio("nao_permitido", { cause: { segredo: "x" } }));
    responderErro(resposta().res, new ErroDeDominio("entrada_invalida", { cause: new SyntaxError("Unexpected token") }));
    const [a, b] = linhas();
    expect(a).not.toHaveProperty("causa");
    expect(JSON.stringify(a)).not.toContain("segredo");
    expect(b?.causa).toBe("json_malformado");
  });

  it("id malformado do Postgres (22P02) também deixa rastro", () => {
    const r = resposta();
    responderErro(r.res, Object.assign(new Error("invalid input syntax for type uuid: \"abc\""), { code: "22P02" }), { metodo: "GET", caminho: "/api/x" });
    expect(r.status()).toBe(400);
    expect(linhas()[0]).toMatchObject({ evento: "requisicao_recusada", causa: "id_malformado", rota: "/api/x" });
    expect(JSON.stringify(linhas()[0])).not.toContain("abc");
  });
});
