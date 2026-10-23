import { describe, expect, it } from "vitest";
import { MODELO_MAIS_POTENTE } from "../../../src/contracts/modelos.ts";
import { raciociniosDoModelo } from "../../../src/domain/inteligencia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * NOD-293 (B7, 2026-10-20): a guia no "auto" troca o modelo pelo mais potente da IA (MODELO_MAIS_POTENTE) depois que o
 * raciocínio foi validado contra o recomendado. O "max" que o recomendado do Codex aceita não vale no mais potente dele:
 * o plano tem de levar um raciocínio que o modelo trocado aceita, nunca o "max" cru.
 */
describe("NOD-293 (B7): a guia no mais potente não leva um raciocínio que o modelo não aceita", () => {
  const pronto = { estado: "pronto" as const, versao: "fake", em: Date.now() };

  it("Codex com 'max' escolhido no recomendado: no gpt-6-astra o plano sai com o médio", async () => {
    const maisPotente = MODELO_MAIS_POTENTE["codex-cli"]!;
    expect(raciociniosDoModelo("codex-cli", maisPotente)).not.toContain("max");
    const { deps } = depsEmMemoria(MARLON);
    const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Guia" });
    await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "auto", escolhas: { "codex-cli": { raciocinio: "max" } } } });
    await deps.repos.onboarding.definirGuia(bot.agente.id);
    const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
    expect(agente.modelo).toBe("auto");
    const turno = (await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: agente.id, origem: "conversa", prazoEm: Date.now() + 86_400_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" }))!;
    const { data } = await executar(deps, emitirPlanoTurno, { turnoId: turno.id, machineId: "maquina-1", executor: "local", harnesses: { "codex-cli": pronto } });
    expect(data.entrada.modelo).toBe(maisPotente);
    expect(data.entrada.esforco).toBe("medium");
  });
});
