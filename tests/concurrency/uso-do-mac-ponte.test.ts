import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, USO_VALE_MS, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarTrabalhosVivos } from "../../src/adapters/fundo/trabalhos-vivos.ts";
import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { LeituraMemoria, NivelPressao, OrigemTrabalho } from "../../src/contracts/trabalho.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ESPACO_FUNDO_MS } from "../../src/domain/memoria-mac.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-085 pela ponte in-process de verdade (revisão do #209): a leitura que vem no `puxar` decide, no MESMO puxar, se
 * trabalho novo em segundo plano sai; o "uso do Mac" da pessoa vale; logo depois de um começar, o próximo espera a vez;
 * e a mudança do processador vira o evento do frame. Postgres e transações commitadas, como trabalhos-revisao-ponte.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from preferencias where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const leitura = (processador: NivelPressao, memoria: NivelPressao = "verde"): LeituraMemoria => ({ nivel: memoria, totalMb: 800, porTurno: [], processador: { nivel: processador, carga: processador === "verde" ? 0.3 : processador === "amarela" ? 0.8 : 1.4 } });

async function montar(uso?: UsoDoMac) {
  let relogio = Date.now();
  const vivos = criarTrabalhosVivos(() => relogio);
  const deps: DepsPonte = {
    services, useCases, executor: "local", listarPessoas, agora: () => relogio,
    registrarMemoria: (p, m, l) => vivos.registrarMemoria(p, m, l),
    pressaoDaMaquina: (m) => vivos.daMaquina(m),
    desfazerMemoria: (p, m) => vivos.desfazer(p, m),
    usoTrocadoEm: (p) => vivos.usoTrocadoEm(p),
    esquecerMaquina: (m) => vivos.esquecerMaquina(m),
  };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO } });
  const { agenteId, conversaId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rui ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    if (uso) await d.repos.preferencias.gravar({ usoDoMac: uso });
    return { agenteId: c.agente.id, conversaId: c.conversa.id };
  });
  /** Um trabalho com um turno na fila. */
  const tarefa = (origem: OrigemTrabalho, titulo: string) => escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const { trabalho } = await criarTrabalho(d, { agenteId, conversaId, titulo, origem });
    const t = await d.repos.turnos.enfileirar({ conversaId, agenteId, origem: origem === "rotina" ? "rotina" : "conversa", trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: titulo, entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
    return t!.id;
  });
  const puxar = async (l?: LeituraMemoria) => (await ponte.puxar(PESSOA.pessoaId, l))?.turnoId ?? null;
  const eventosDePressao = () => escopado(async (trx) => trx<{ dados: Record<string, unknown> }[]>`select dados from events where owner_id = ${PESSOA.pessoaId} and kind = 'pressao_memoria' order by created_at`);
  return { ponte, machineId, tarefa, puxar, eventosDePressao, gravarUso: async (u: UsoDoMac, avisar = true) => {
    await escopado((trx) => criarRepos(trx, PESSOA).preferencias.gravar({ usoDoMac: u }));
    // A rota PUT preferencias avisa depois de gravar (rotas/raio-x.ts); sem o aviso, vale o cache de USO_VALE_MS.
    if (avisar) vivos.trocouUsoDoMac(PESSOA.pessoaId);
  }, avancar: (ms: number) => (relogio += ms) };
}

describeIntegracao("uso do Mac pela ponte (ADR-085, revisão do #209)", () => {
  it("processador cheio no puxar: a task da pessoa sai, a rotina espera; o Mac alivia e, no espaço seguinte, a rotina sai", async () => {
    const m = await montar();
    const rotina = await m.tarefa("rotina", "Verificar o Slack");
    const daPessoa = await m.tarefa("pessoa", "Liberar espaço");
    expect(await m.puxar(leitura("vermelha"))).toBe(daPessoa);
    expect(await m.puxar(leitura("vermelha"))).toBeNull();
    expect(await m.puxar(leitura("verde"))).toBe(rotina);
  });

  it("'O quanto precisar' não segura nada; 'Pouco' segura já no processador apertando", async () => {
    const livre = await montar("livre");
    const r1 = await livre.tarefa("rotina", "Rotina A");
    expect(await livre.puxar(leitura("vermelha", "vermelha"))).toBe(r1);

    const pouco = await montar("pouco");
    const r2 = await pouco.tarefa("rotina", "Rotina B");
    expect(await pouco.puxar(leitura("amarela"))).toBeNull();
    // Gravada por fora da rota (sem aviso), a troca espera o cache de USO_VALE_MS; pela rota, vale na hora.
    await pouco.gravarUso("equilibrado", false);
    expect(await pouco.puxar(leitura("amarela"))).toBeNull();
    await pouco.gravarUso("equilibrado");
    expect(await pouco.puxar(leitura("amarela"))).toBe(r2);
    expect(USO_VALE_MS).toBe(30_000);
  });

  it("o espaço: com o Mac folgado, duas rotinas não começam na mesma leitura — a segunda espera ESPACO_FUNDO_MS", async () => {
    const m = await montar();
    const a = await m.tarefa("rotina", "Rotina A");
    const b = await m.tarefa("rotina", "Rotina B");
    const daPessoa = await m.tarefa("pessoa", "Responder o e-mail");
    // A da pessoa passa na frente (a ordem de sempre) e não conta como trabalho em segundo plano.
    expect(await m.puxar(leitura("verde"))).toBe(daPessoa);
    expect(await m.puxar(leitura("verde"))).toBe(a);
    expect(await m.puxar(leitura("verde"))).toBeNull();
    m.avancar(ESPACO_FUNDO_MS + 1);
    expect(await m.puxar(leitura("verde"))).toBe(b);
  });

  it("sem leitura do Mac (app antigo), nada é segurado nem espaçado", async () => {
    const m = await montar();
    const a = await m.tarefa("rotina", "Rotina A");
    const b = await m.tarefa("rotina", "Rotina B");
    expect(await m.puxar()).toBe(a);
    expect(await m.puxar()).toBe(b);
  });

  it("a mudança só do processador vira o evento do frame (com o processador); o Mac desconectado não segura mais", async () => {
    const m = await montar();
    const rotina = await m.tarefa("rotina", "Rotina A");
    expect(await m.puxar(leitura("verde"))).toBe(rotina);
    m.avancar(ESPACO_FUNDO_MS + 1);
    await m.puxar(leitura("vermelha"));
    const eventos = await m.eventosDePressao();
    expect(eventos.at(-1)?.dados).toMatchObject({ nivel: "verde", processador: "vermelha" });

    const outra = await m.tarefa("rotina", "Rotina B");
    expect(await m.puxar()).toBeNull();
    await m.ponte.desconectar(m.machineId);
    await m.ponte.conectar({ machineId: m.machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO } });
    expect(await m.puxar()).toBe(outra);
  });
});
