import { describe, expect, it } from "vitest";
import type { PayloadPropostaPasta } from "../../../src/contracts/conversa.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { retomarAposPasta } from "../../../src/use-cases/retomar-apos-pasta.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

/**
 * definido em 2026-09-25 (card de pasta simplificado): permitir a pasta deixa na conversa o registro
 * `pasta_aberta` — o card some e a linha "leapy aberta para Dev 1" fica — em todos os caminhos de saída,
 * inclusive quando não há turno para retomar.
 */
async function preparar(candidatas: PayloadPropostaPasta["candidatas"], comTurno = true) {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const turno = comTurno
    ? await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10_000, profundidade: 0, entradaTexto: "mostra a árvore do PR #466", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" })
    : null;
  const proposta = await deps.repos.propostas.criar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, payload: { kind: "pasta", ...(turno ? { turnoId: turno.id } : {}), candidatas, motivo: "Para montar a árvore", buscaTermo: "leapy" } });
  if (!proposta) throw new Error("proposta");
  const registros = () => banco.mensagens.filter((m) => m.payload?.kind === "pasta_aberta");
  return { deps, bot, proposta, registros };
}

describe("retomar depois de abrir a pasta", () => {
  it("grava o registro com o nome e o local da candidata escolhida e retoma o turno", async () => {
    const { deps, bot, proposta, registros } = await preparar([{ caminho: "/Users/m/code/leapy", nome: "leapy", git: true, onde: "code", modificadoEm: 1 }]);
    const r = await retomarAposPasta(deps, { proposta, pasta: "/Users/m/code/leapy" });
    expect(r.data.turnoId).toBeTruthy();
    expect(registros()).toEqual([expect.objectContaining({ kind: "sistema", texto: "Pasta do projeto aberta para o agente.", payload: { kind: "pasta_aberta", propostaId: proposta.id, agenteId: bot.agente.id, pasta: "/Users/m/code/leapy", nome: "leapy", onde: "code" } })]);
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
  });

  it("sem turno a retomar, o registro fica igual, com o nome tirado do caminho", async () => {
    const { deps, proposta, registros } = await preparar([], false);
    const r = await retomarAposPasta(deps, { proposta, pasta: "/Users/m/code/leapy/" });
    expect(r.data.turnoId).toBeNull();
    // Candidata desconhecida (escolha manual) não tem `onde`: o payload o omite e a web tira do caminho.
    expect(registros().map((m) => m.payload)).toEqual([{ kind: "pasta_aberta", propostaId: proposta.id, agenteId: proposta.agenteId, pasta: "/Users/m/code/leapy/", nome: "leapy" }]);
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada"]);
  });

  it("proposta já decidida não grava registro de novo", async () => {
    const { deps, proposta, registros } = await preparar([{ caminho: "/Users/m/leapy", nome: "leapy", git: false }]);
    await retomarAposPasta(deps, { proposta, pasta: "/Users/m/leapy" });
    await expect(retomarAposPasta(deps, { proposta, pasta: "/Users/m/leapy" })).rejects.toThrow();
    expect(registros()).toHaveLength(1);
  });
});
