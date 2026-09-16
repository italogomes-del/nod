import { describe, expect, it } from "vitest";
import { montarItens } from "../../../src/domain/aprovacao-item.ts";
import { redigirDesfechoAprovacao } from "../../../src/domain/aprovacao-desfecho.ts";

const destino = { conector: "exemplo", ferramenta: "enviar_email", argumentos: {} };

describe("redigirDesfechoAprovacao", () => {
  it("diz o que NÃO saiu, item a item", () => {
    const itens = montarItens({ tenantId: "t", decisaoId: "d", agora: 0, propostas: [
      { texto: "ana", destino, origemSensivel: false },
      { texto: "bia", destino, origemSensivel: false },
      { texto: "caio", destino, origemSensivel: true },
    ] });
    itens[0]!.desfecho = "executado";
    itens[1]!.desfecho = "retirado_pela_pessoa";
    itens[2]!.desfecho = "sensivel_nao_aprovado";
    expect(redigirDesfechoAprovacao({ itens, aprovadorNome: "Marlon", agora: 0 })).toBe("Marlon aprovou 1 de 3; não enviado: bia (retirado pela pessoa); caio (sensível, não aprovado).");
  });
  it("todos executados termina sem 'não enviado'", () => {
    const itens = montarItens({ tenantId: "t", decisaoId: "d", agora: 0, propostas: [{ texto: "ana", destino, origemSensivel: false }] });
    itens[0]!.desfecho = "executado";
    expect(redigirDesfechoAprovacao({ itens, aprovadorNome: "Ana", agora: 0 })).toBe("Ana aprovou 1 de 1.");
  });
});
