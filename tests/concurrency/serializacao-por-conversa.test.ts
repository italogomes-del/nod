import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * E12.2 / ADR-010: dois turnos da MESMA conversa nunca ficam 'despachando' juntos, mesmo com duas
 * máquinas reivindicando AO MESMO TEMPO. É o teste que o plano manda rodar antes de decidir entre
 * NOT EXISTS puro e o fallback com pg_advisory_xact_lock (riscos do plano). Linhas commitadas;
 * limpeza própria por id.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas — não há FK): a fila de turnos é
// por pessoa, então dois arquivos de concurrency nunca disputam as mesmas linhas, rode o vitest como rodar.
const MARLON = { tenantId: TENANT_LEAPY, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], turnos: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, MARLON);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function conversaComTurnos(quantos: number, agenteId = randomUUID()): Promise<{ conversaId: string; turnos: string[] }> {
  const conversaId = randomUUID();
  const turnos = Array.from({ length: quantos }, () => randomUUID());
  await escopado(async (trx) => {
    const repos = criarRepos(trx, MARLON);
    if (!criados.agentes.includes(agenteId)) {
      await repos.agentes.criar({ id: agenteId, nome: "Serial", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      criados.agentes.push(agenteId);
    }
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    for (const id of turnos) {
      await repos.turnos.enfileirar({ id, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    }
  });
  criados.conversas.push(conversaId);
  criados.turnos.push(...turnos);
  return { conversaId, turnos };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`delete from turno_entregas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turnos where id in ${trx(criados.turnos)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.turnos.length = 0;
});

/**
 * Duas conexões reivindicam AO MESMO TEMPO e commitam. Antes da trava por pessoa (medido em
 * 2026-09-16, ver turnosRepo.reivindicar) a forma "segurar as duas abertas até ambas tentarem"
 * mostrou a sobreposição; com a trava essa forma seria um deadlock por construção (a segunda espera
 * o commit da primeira), então aqui as duas commitam e a simultaneidade está no disparo.
 */
async function disputaSimultanea(): Promise<(string | null)[]> {
  const lado = () => escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
  const [a, b] = await Promise.all([lado(), lado()]);
  return [a?.id ?? null, b?.id ?? null];
}

describeIntegracao("concorrência: serialização por conversa e por agente", () => {
  it("dois turnos pendentes da mesma conversa, duas máquinas AO MESMO TEMPO: sai um só; o segundo só depois de assentar o primeiro", async () => {
    const { conversaId, turnos } = await conversaComTurnos(2);
    const resultados = await disputaSimultanea();
    const ganhos = resultados.filter((r): r is string => r !== null);
    expect(ganhos, `sobreposição: ${JSON.stringify(resultados)}`).toHaveLength(1);
    const despachando = await escopado(async (trx) => criarRepos(trx, MARLON).turnos.vivosDaConversa(conversaId));
    expect(despachando.filter((t) => t.estado === "despachando").map((t) => t.id)).toEqual(ganhos);

    // Enquanto o primeiro roda, ninguém pega o segundo.
    expect(await escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))).toBeNull();
    await escopado(async (trx) => criarRepos(trx, MARLON).turnos.assentar(ganhos[0] ?? "", { estado: "concluido" }));
    const segundo = await escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    expect(turnos).toContain(segundo?.id);
    expect(segundo?.id).not.toBe(ganhos[0]);
  });

  it("o mesmo agente em duas conversas, duas máquinas ao mesmo tempo: sai um só (EMENDA 13)", async () => {
    const agenteId = randomUUID();
    await conversaComTurnos(1, agenteId);
    await conversaComTurnos(1, agenteId);
    const resultados = await disputaSimultanea();
    expect(resultados.filter((r) => r !== null), `sobreposição: ${JSON.stringify(resultados)}`).toHaveLength(1);
  });

  it("conversas e agentes DIFERENTES não se bloqueiam: duas máquinas ao mesmo tempo levam um turno cada", async () => {
    await conversaComTurnos(1);
    await conversaComTurnos(1);
    const resultados = await disputaSimultanea();
    expect(resultados.filter((r) => r !== null)).toHaveLength(2);
    expect(new Set(resultados).size).toBe(2);
  });
});
