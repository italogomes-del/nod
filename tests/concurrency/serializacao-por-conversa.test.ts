import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * E12.2 / ADR-010: dois turnos da MESMA conversa nunca ficam 'despachando' juntos, mesmo com duas
 * máquinas reivindicando AO MESMO TEMPO. É o teste que o plano manda rodar antes de decidir entre
 * NOT EXISTS puro e o fallback com pg_advisory_xact_lock (riscos do plano). Linhas commitadas;
 * limpeza própria por id.
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas — não há FK): a fila de turnos é
// por pessoa, então dois arquivos de concurrency nunca disputam as mesmas linhas, rode o vitest como rodar.
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
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
    await trx`delete from turno_raio_x where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turno_entregas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turnos where id in ${trx(criados.turnos)}`;
    // ADR-081 (0060): os trabalhos apontam para a conversa (e a rotina) — saem antes dela.
    await trx`delete from trabalhos where conversa_id in ${trx(criados.conversas)}`;
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

describeIntegracao("concorrência: serialização por faixa (conversa ou trabalho, ADR-081)", () => {
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

  it("revisto em 2026-10-07 (ADR-081 §3): o mesmo agente em duas conversas (direta e sala) roda nas duas ao mesmo tempo", async () => {
    const agenteId = randomUUID();
    await conversaComTurnos(1, agenteId);
    await conversaComTurnos(1, agenteId);
    const resultados = await disputaSimultanea();
    expect(resultados.filter((r) => r !== null), `esperava as duas: ${JSON.stringify(resultados)}`).toHaveLength(2);
  });

  it("ADR-081 (#192, critério 1): rotina, pedido de colega e task da pessoa do MESMO bot saem juntos, e a mensagem da conversa sai enquanto os três rodam", async () => {
    const agenteId = randomUUID();
    const colegaId = randomUUID();
    const conversaId = randomUUID();
    const turnos = { rotina: randomUUID(), colega: randomUUID(), pessoa: randomUUID(), conversa: randomUUID() };
    await escopado(async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.agentes.criar({ id: agenteId, nome: "Paralelo", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.agentes.criar({ id: colegaId, nome: "Chico", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      const rotina = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Triagem", origem: "rotina" });
      const colega = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Pedido do Chico", origem: "colega", pedidoPorAgenteId: colegaId });
      const pessoa = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Dashboard de churn", origem: "pessoa" });
      const base = { conversaId, agenteId, prazoEm: Date.now() + 60_000, profundidade: 0 as const, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m" };
      await repos.turnos.enfileirar({ ...base, id: turnos.rotina, origem: "rotina", trabalhoId: rotina?.id ?? null });
      await repos.turnos.enfileirar({ ...base, id: turnos.colega, origem: "delegacao", trabalhoId: colega?.id ?? null });
      await repos.turnos.enfileirar({ ...base, id: turnos.pessoa, origem: "conversa", trabalhoId: pessoa?.id ?? null });
    });
    criados.agentes.push(agenteId, colegaId);
    criados.conversas.push(conversaId);
    criados.turnos.push(turnos.rotina, turnos.colega, turnos.pessoa);
    const lado = () => escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    const tres = (await Promise.all([lado(), lado(), lado()])).map((t) => t?.id ?? null);
    expect(new Set(tres), `os três trabalhos: ${JSON.stringify(tres)}`).toEqual(new Set([turnos.rotina, turnos.colega, turnos.pessoa]));
    await escopado(async (trx) => criarRepos(trx, MARLON).turnos.enfileirar({ id: turnos.conversa, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "e aí?", entradaConfianca: "confiavel", modelo: "m" }));
    criados.turnos.push(turnos.conversa);
    expect((await lado())?.id).toBe(turnos.conversa);
    const vivos = await escopado(async (trx) => criarRepos(trx, MARLON).turnos.vivosDaConversa(conversaId));
    expect(vivos.filter((t) => t.estado === "despachando")).toHaveLength(4);
  });

  it("ADR-081: na fila, a mensagem da pessoa passa na frente da rotina e do pedido de colega", async () => {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const ids = { rotina: randomUUID(), colega: randomUUID(), conversa: randomUUID() };
    await escopado(async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.agentes.criar({ id: agenteId, nome: "Ordem", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      const rotina = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Triagem", origem: "rotina" });
      const colega = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Pedido", origem: "colega" });
      const base = { conversaId, agenteId, prazoEm: Date.now() + 60_000, profundidade: 0 as const, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m" };
      await repos.turnos.enfileirar({ ...base, id: ids.rotina, origem: "rotina", trabalhoId: rotina?.id ?? null });
      await repos.turnos.enfileirar({ ...base, id: ids.colega, origem: "retomada", trabalhoId: colega?.id ?? null });
      await repos.turnos.enfileirar({ ...base, id: ids.conversa, origem: "conversa" });
    });
    criados.agentes.push(agenteId);
    criados.conversas.push(conversaId);
    criados.turnos.push(ids.rotina, ids.colega, ids.conversa);
    const primeiro = await escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    expect(primeiro?.id).toBe(ids.conversa);
  });

  it("ADR-081 (#192, critério 3): o trabalho com depois_de só sai quando o outro termina", async () => {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const turnoDepois = randomUUID();
    let primeiroId = "";
    await escopado(async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.agentes.criar({ id: agenteId, nome: "Depois", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      const primeiro = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Primeiro", origem: "pessoa", estado: "rodando" });
      primeiroId = primeiro?.id ?? "";
      const depois = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Depois", origem: "pessoa", depoisDeTrabalhoId: primeiroId });
      await repos.turnos.enfileirar({ id: turnoDepois, conversaId, agenteId, origem: "conversa", trabalhoId: depois?.id ?? null, prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    });
    criados.agentes.push(agenteId);
    criados.conversas.push(conversaId);
    criados.turnos.push(turnoDepois);
    const reivindicar = () => escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    expect(await reivindicar()).toBeNull();
    await escopado(async (trx) => criarRepos(trx, MARLON).trabalhos.mudarEstado(primeiroId, "terminado", Date.now()));
    expect((await reivindicar())?.id).toBe(turnoDepois);
  });

  it("conversas e agentes DIFERENTES não se bloqueiam: duas máquinas ao mesmo tempo levam um turno cada", async () => {
    await conversaComTurnos(1);
    await conversaComTurnos(1);
    const resultados = await disputaSimultanea();
    expect(resultados.filter((r) => r !== null)).toHaveLength(2);
    expect(new Set(resultados).size).toBe(2);
  });
});
