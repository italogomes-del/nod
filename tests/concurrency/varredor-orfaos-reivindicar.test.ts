import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-219: o varredor de órfãos (`turnos.encerrarOrfao`) e uma máquina (`turnos.reivindicar`) sobre o MESMO pendente, em
 * duas conexões reais. O UPDATE condicional (`estado = 'pendente'`) não pode encerrar o turno que a máquina acabou de
 * reivindicar, e a máquina não pode levar o turno que o varredor está encerrando. Pessoa própria do arquivo; limpeza
 * por id, como os outros testes de concorrência.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], turnos: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function umPendente(): Promise<{ agenteId: string; turnoId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const turnoId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Orfao", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  criados.turnos.push(turnoId);
  return { agenteId, turnoId };
}

/** A geração do agente sobe (o que excluir e restaurar fazem): para o banco, o pendente vira impossível de rodar. */
const subirGeracao = (agenteId: string) => escopado(async (trx) => trx`update agentes set geracao_execucao = geracao_execucao + 1 where id = ${agenteId}`);
const estadoDo = (turnoId: string) => escopado(async (trx) => (await criarRepos(trx, PESSOA).turnos.buscar(turnoId))?.estado);

/** Espera um pouco e diz se a promessa já resolveu — a outra conexão deve estar parada na trava da linha. */
async function aindaEsperando(p: Promise<unknown>, ms = 300): Promise<boolean> {
  let pronto = false;
  void p.then(() => (pronto = true), () => (pronto = true));
  await new Promise((r) => setTimeout(r, ms));
  return !pronto;
}

/** Abre uma tx que faz `primeiro` e só commita quando `liberar` é chamado. */
function seguraAberta<T>(primeiro: (trx: Tx) => Promise<T>): { feito: Promise<T>; commit: Promise<void>; liberar: () => void } {
  let liberar = () => {};
  const solta = new Promise<void>((r) => (liberar = r));
  let avisar: (v: T) => void = () => {};
  const feito = new Promise<T>((r) => (avisar = r));
  const commit = db
    .begin(async (trx) => {
      await vincularEscopo(trx, PESSOA);
      avisar(await primeiro(trx));
      await solta;
    })
    .then(() => undefined);
  return { feito, commit, liberar };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`delete from turnos where id in ${trx(criados.turnos)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.turnos.length = 0;
});

describeIntegracao("concorrência: varredor de órfãos × reivindicar sobre o mesmo pendente (NOD-219)", () => {
  it("sem disputa: a geração subiu, o pendente sai como interrompido; e o reivindicar já não o pegava", async () => {
    const { agenteId, turnoId } = await umPendente();
    await subirGeracao(agenteId);
    expect(await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))).toBeNull();
    const fechado = await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.encerrarOrfao(turnoId, Date.now()));
    expect(fechado).toMatchObject({ id: turnoId, estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
  });

  it("a máquina reivindica primeiro (sem commit) e a geração sobe: o encerrarOrfao espera a linha e, depois do commit, não toca no turno", async () => {
    const { agenteId, turnoId } = await umPendente();
    const maquina = seguraAberta((trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    const reivindicado: Turno | null = await maquina.feito;
    expect(reivindicado?.id).toBe(turnoId);
    // Com a linha travada pela máquina, a geração sobe (outra conexão) e o varredor tenta encerrar.
    await subirGeracao(agenteId);
    const varredor = escopado(async (trx) => criarRepos(trx, PESSOA).turnos.encerrarOrfao(turnoId, Date.now()));
    expect(await aindaEsperando(varredor), "o UPDATE do varredor devia esperar a linha travada").toBe(true);
    maquina.liberar();
    await maquina.commit;
    expect(await varredor).toBeNull();
    expect(await estadoDo(turnoId)).toBe("despachando");
  });

  it("o varredor encerra primeiro (sem commit): a máquina pula a linha travada e, depois do commit, o turno fica interrompido", async () => {
    const { agenteId, turnoId } = await umPendente();
    await subirGeracao(agenteId);
    const varredor = seguraAberta((trx) => criarRepos(trx, PESSOA).turnos.encerrarOrfao(turnoId, Date.now()));
    expect((await varredor.feito)?.estado).toBe("interrompido");
    const maquina = await escopado(async (trx) => criarRepos(trx, PESSOA).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    expect(maquina).toBeNull();
    varredor.liberar();
    await varredor.commit;
    expect(await estadoDo(turnoId)).toBe("interrompido");
  });
});
