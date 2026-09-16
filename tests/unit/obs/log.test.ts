import { afterEach, describe, expect, it, vi } from "vitest";
import { executarComContexto } from "../../../src/obs/contexto.ts";
import { log } from "../../../src/obs/log.ts";

describe("log JSON único", () => {
  const saida = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => saida.mockClear());

  it("escreve UMA linha JSON com ts, nivel, evento e o contexto (tenant, pessoa, correlation)", async () => {
    const linha = await executarComContexto({ tenantId: "t1", pessoaId: "p1", correlationId: "c1" }, async () =>
      log("info", "turno_criado", { turno_id: "x" }),
    );
    const obj = JSON.parse(linha);
    expect(obj).toMatchObject({ nivel: "info", evento: "turno_criado", tenant_id: "t1", pessoa_id: "p1", correlation_id: "c1", turno_id: "x" });
    expect(typeof obj.ts).toBe("string");
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0]?.[0]).toBe(linha);
    expect(linha.includes("\n")).toBe(false);
  });

  it("fora de contexto os campos vêm nulos, nunca ausentes", () => {
    const obj = JSON.parse(log("aviso", "sem_contexto"));
    expect(obj).toMatchObject({ tenant_id: null, pessoa_id: null, correlation_id: null });
  });

  it("nunca ecoa o campo texto (canal de vazamento, ADR-002/004)", () => {
    const linha = log("erro", "mensagem_falhou", { texto: "cpf do aprendiz 123", conversa_id: "c" });
    expect(linha).not.toContain("cpf");
    expect(JSON.parse(linha)).not.toHaveProperty("texto");
    expect(JSON.parse(linha).conversa_id).toBe("c");
  });
});
