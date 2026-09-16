import { describe, expect, it } from "vitest";
import { montarItens } from "../../../src/domain/aprovacao-item.ts";
import { classificarOrigem } from "../../../src/domain/dado-pessoal.ts";

const agora = 1;

describe("montarItens", () => {
  it("item que toca dado de aprendiz nasce desmarcado — caso adversarial", () => {
    const origem = classificarOrigem(
      { conectorId: "gmail", fonte: "responsavel", concessaoId: "c", declaracao: "toca" },
      agora,
    );
    const itens = montarItens({
      tenantId: "t",
      decisaoId: { tenantId: "t", id: "d1" },
      propostas: [{ texto: "Responder a Maria", destino: "gmail" }],
      origem,
      agora,
    });
    expect(itens).toHaveLength(1);
    expect(itens[0]?.nasceDesmarcado).toBe(true);
    expect(itens[0]?.estado).toBe("proposto");
  });

  it("origem não toca também nasce proposta, sem forçar marcado", () => {
    const origem = classificarOrigem(
      { conectorId: "github", fonte: "pr", concessaoId: "c", declaracao: "nao-toca" },
      agora,
    );
    const itens = montarItens({
      tenantId: "t",
      decisaoId: { tenantId: "t", id: "d1" },
      propostas: [{ texto: "Reverter PR", destino: "github" }],
      origem,
      agora,
    });
    expect(itens[0]?.nasceDesmarcado).toBe(false);
  });
});
