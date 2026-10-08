import { describe, expect, it } from "vitest";
import { decidirPedidoParado, DESISTIR_SEM_SINAL_MS, MAX_QUEDAS_POR_PEDIDO, RETOMAR_ATE_MS, type PedidoParado } from "../../../src/domain/pedido-parado.ts";

/** A regra de src/domain/pedido-parado.ts (2026-10-08): o que fazer com um pedido a colega que parou sem voltar. */
const AGORA = Date.parse("2026-10-08T15:00:00Z");
const legivel = (m: string) => `<${m}>`;
const base: PedidoParado = {
  tarefaId: "tarefa",
  trabalhoColegaId: "colega",
  estadoColega: "falhou",
  ultimoTurnoId: "ultimo",
  ultimoMotivo: "executor_indisponivel",
  quedaEm: AGORA - 60_000,
  quedas: 1,
  cardRetomar: null,
  sinalDepoisDaQueda: false,
  textoFinal: null,
  turnoDoTextoFinal: null,
};
const decidir = (p: Partial<PedidoParado>) => decidirPedidoParado({ ...base, ...p }, AGORA, legivel);

describe("decidirPedidoParado", () => {
  it("terminou: entrega a fala final; sem fala, avisa que terminou sem resposta", () => {
    expect(decidir({ estadoColega: "terminado", textoFinal: "feito", turnoDoTextoFinal: "t9" })).toEqual({ tipo: "entregar_resultado", turnoId: "t9", texto: "feito" });
    expect(decidir({ estadoColega: "terminado" })).toEqual({ tipo: "avisar_falha", motivo: "terminou sem resposta" });
  });

  it("parado: avisa", () => {
    expect(decidir({ estadoColega: "parado" })).toMatchObject({ tipo: "avisar_falha" });
  });

  it("caiu por infraestrutura: espera o sinal de volta e retoma, contando a tentativa", () => {
    expect(decidir({})).toEqual({ tipo: "esperar" });
    expect(decidir({ sinalDepoisDaQueda: true })).toEqual({ tipo: "retomar", turnoId: "ultimo", tentativa: 2 });
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", estadoColega: "precisa_de_voce", cardRetomar: { id: "c", aberto: true }, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });

  it(`com ${MAX_QUEDAS_POR_PEDIDO} quedas, ou sem sinal em 30 min, desiste e avisa`, () => {
    expect(decidir({ quedas: MAX_QUEDAS_POR_PEDIDO, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: `<executor_indisponivel> (caiu ${MAX_QUEDAS_POR_PEDIDO} vezes)` });
    expect(decidir({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS - 1 })).toMatchObject({ tipo: "avisar_falha" });
    expect(decidir({ quedaEm: AGORA - DESISTIR_SEM_SINAL_MS + 1 })).toEqual({ tipo: "esperar" });
  });

  it("queda de mais de 2 h não é retomada, mesmo com as máquinas de volta: avisa", () => {
    expect(decidir({ quedaEm: AGORA - RETOMAR_ATE_MS - 1, sinalDepoisDaQueda: true })).toEqual({ tipo: "avisar_falha", motivo: "<executor_indisponivel>, e já faz mais de 2 h" });
    expect(decidir({ quedaEm: AGORA - RETOMAR_ATE_MS + 1, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "retomar" });
  });

  it("o \"Retomar\" que a pessoa já resolveu é dela: não retoma por cima", () => {
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", cardRetomar: { id: "c", aberto: false }, sinalDepoisDaQueda: true })).toMatchObject({ tipo: "avisar_falha" });
    expect(decidir({ ultimoMotivo: "maquina_sem_contato", estadoColega: "precisa_de_voce", cardRetomar: { id: "c", aberto: false } })).toEqual({ tipo: "esperar" });
  });

  it("precisa de você por outra decisão: espera (o vencimento de 24 h já avisa); falhou por outro motivo: avisa com o motivo", () => {
    expect(decidir({ estadoColega: "precisa_de_voce", ultimoMotivo: null })).toEqual({ tipo: "esperar" });
    expect(decidir({ ultimoMotivo: "trabalho_incompleto" })).toEqual({ tipo: "avisar_falha", motivo: "<trabalho_incompleto>" });
  });
});
