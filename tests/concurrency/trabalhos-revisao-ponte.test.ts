import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Revisão do épico #188 (2026-10-08) pela ponte in-process de verdade, com Postgres e transações commitadas (como
 * sessao-viva.test.ts): a rede de 2 min (S15, S17), o recado da task em duas fases (S18, S19) e os mapas da ponte
 * (S20, S21). A máquina, o relógio e o plano são do teste; o resto é o código de produção.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const base = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
/** O plano do teste: o de deps-l6 (montarPlano) no papel do Claude Code, e com `bifurcar` quando o teste pede. */
const forcar = { bifurcar: false };
const services: Services = {
  ...base,
  planos: {
    ...base.planos,
    async emitir(trx, turnoId, machineId): Promise<PlanoTurno> {
      const p = await base.planos.emitir(trx, turnoId, machineId);
      return { ...p, harness: "claude-cli", ...(forcar.bifurcar ? { entrada: { ...p.entrada, sessaoCli: p.entrada.sessaoCli ?? "sessao-da-conversa", bifurcar: true } } : {}) };
    },
  },
};
const useCases = useCasesDeTeste();

afterEach(async () => {
  forcar.bifurcar = false;
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from turno_diagnosticos where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from pendencias where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const resultado = (r: Partial<ResultadoTurno> = {}): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [], ...r });

/** Um bot com conversa, a ponte com relógio do teste e a rede de 2 min em 1 s; a máquina anuncia o que o teste disser. */
async function montar(o: { capacidades?: boolean } = {}) {
  let relogio = Date.now();
  const deps: DepsPonte = { services, useCases, executor: "local", listarPessoas, agora: () => relogio, fezFerramenta: () => true, redeMs: 1_000 };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  const conectar = (capacidades: boolean) => ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO }, ...(capacidades ? { capacidades: { "claude-cli": CAPACIDADES_HARNESS["claude-cli"] } } : {}) });
  await conectar(o.capacidades === true);
  const { agenteId, conversaId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services: base });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rui ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    return { agenteId: c.agente.id, conversaId: c.conversa.id };
  });
  const falar = (texto: string) => escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services: base }), enviarMensagem, { conversaId, texto, inventario: PRONTO, executor: "local" })).data.turno.id);
  const ler = <T>(fn: (r: ReturnType<typeof criarRepos>) => Promise<T>) => escopado((trx) => fn(criarRepos(trx, PESSOA)));
  const renovar = (turnoId: string, extra: Record<string, unknown> = {}) => ponte.renovar({ turnoId, machineId, sinais: SINAIS, eventos: [], ...extra });
  return { ponte, machineId, agenteId, conversaId, falar, ler, renovar, conectar, avancar: (ms: number) => (relogio += ms) };
}

describeIntegracao("revisão #188 pela ponte: a rede de 2 min", () => {
  it("S15: a máquina que não anunciou bifurcaSessao não promove; anunciada, promove", async () => {
    const m = await montar();
    await m.falar("monte o relatório");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    expect(plano?.harness).toBe("claude-cli");
    m.avancar(2_000);
    expect((await m.renovar(plano!.turnoId)).ativo).toBe(true);
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeNull();

    await m.conectar(true);
    await m.renovar(plano!.turnoId);
    const promovido = await m.ler((r) => r.turnos.buscar(plano!.turnoId));
    expect(promovido?.trabalhoId).toBeTruthy();
    expect(await m.ler((r) => r.trabalhos.buscar(promovido!.trabalhoId!))).toMatchObject({ origem: "rede", sessaoExecutor: null });
  });

  it("S15: o turno que devia bifurcar e voltou recusado faz a conversa largar a sessão (o próximo plano sai em sessão nova, sem bifurcar)", async () => {
    const m = await montar({ capacidades: true });
    await m.ler((r) => r.conversas.atualizarSessaoCli(m.conversaId, "sessao-da-conversa", "local", "claude-cli"));
    forcar.bifurcar = true;
    await m.falar("e agora?");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    expect(plano?.entrada.bifurcar).toBe(true);
    await m.ponte.entregar({ turnoId: plano!.turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: resultado({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", texto: "" }) });
    expect((await m.ler((r) => r.conversas.buscar(m.conversaId)))?.sessaoCli).toBeNull();
  });

  it("S17: com mensagem oferecida e ainda não confirmada, a rede não promove; confirmada, promove", async () => {
    const m = await montar({ capacidades: true });
    await m.falar("monte o relatório");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    const segunda = await m.falar("inclua setembro");
    m.avancar(2_000);
    const oferta = await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    expect(oferta.mensagensIds).toEqual([segunda]);
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeNull();
    // Renovação seguinte sem a confirmação: a mensagem segue no ar, e nada de promover.
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeNull();
    // Confirmada (o CLI recebeu e vai responder neste turno): agora promove.
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [segunda] });
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeTruthy();
  });
});
