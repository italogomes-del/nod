import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarCaixaRevisoes, provaDaRevisao, type CaixaRevisoes } from "../../src/adapters/fundo/caixa-revisoes.ts";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { PRAZO_REVISAO_MS, type PedidoRevisao } from "../../src/contracts/revisao.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-115 (PR 3a dos modos de aprovação) pela ponte in-process de verdade, com Postgres e transações commitadas: o laço
 * anuncia `revisa` e o segredo na renovação, a renovação entrega o pedido, o relato volta por `relatarRevisao` e a fase 3
 * roda numa transação nova sob a trava do turno. E as corridas que o `withRollback` não mostra: o relato contra o
 * varredor e contra o Parar.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const SEGREDO = "segredo-do-laco-0123456789abcdefgh";
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const LIBERA = '{"decisao":"libera","motivo":"você pediu"}';
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from acoes_pelo_modo where owner_id = ${p}`;
    await trx`delete from itens_aprovacao where owner_id = ${p}`;
    await trx`delete from decisao_eventos_varridos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
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

async function montar() {
  const vencidas: string[] = [];
  const caixa: CaixaRevisoes = criarCaixaRevisoes({
    config: { ligado: true, modelo: "claude-sonnet-5-5", esforco: "low", tetoDia: 300, prazoMs: PRAZO_REVISAO_MS },
    agora: () => Date.now(),
    async vencer(p) {
      vencidas.push(p.decisaoId);
    },
    agendar: () => () => undefined,
  });
  const services = { ...servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() }), revisor: caixa };
  const deps: DepsPonte = { services, useCases: useCasesDeTeste(), executor: "catcher", listarPessoas, revisoes: caixa };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1 });
  const { agenteId, conversaId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rev ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    await d.repos.agentes.definirModoAprovacao(c.agente.id, "automatico");
    await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "força o push", entradaConfianca: "confiavel", modelo: "m" });
    return { agenteId: c.agente.id, conversaId: c.conversa.id };
  });
  const puxado = await ponte.puxar(PESSOA.pessoaId);
  if (!puxado) throw new Error("nada puxado");
  const plano: PlanoTurno = { ...puxado, nativas: ["Bash"], modoTurno: "conversa" };
  const renovar = (extra: { revisa?: true; segredoRevisao?: string; revisoesRecebidas?: string[] } = { revisa: true, segredoRevisao: SEGREDO }) =>
    ponte.renovar({ turnoId: plano.turnoId, machineId, sinais: SINAIS, eventos: [], ...extra });
  /** O hook pede, e a "rota" põe o pedido na caixa depois do commit. */
  const pedir = async (comando: string) => {
    const r = await escopado(async (trx) => {
      const d = depsSobreTrx(trx, PESSOA, { services });
      return (await executar(d, autorizarComando, { plano, comando })).data;
    });
    if ("aguardar" in r && r.revisao) caixa.enfileirar(r.revisao);
    return r;
  };
  const relatar = (p: PedidoRevisao, saida = LIBERA) => ponte.relatarRevisao!(PESSOA.pessoaId, machineId, { revisaoId: p.revisaoId, turnoId: p.turnoId, saida, ms: 2500, prova: provaDaRevisao(SEGREDO, p.revisaoId, p.decisaoId) });
  const ler = (decisaoId: string) => escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return { decisao: await repos.decisoes.buscar(decisaoId), acao: await repos.acoesPeloModo.daDecisao(decisaoId), itens: await repos.itensAprovacao.listar(decisaoId) };
  });
  return { ponte, caixa, services, plano, machineId, agenteId, conversaId, renovar, pedir, relatar, ler, vencidas };
}

describeIntegracao("revisor pela ponte in-process (ADR-115, PR 3a)", () => {
  it("revisa pela PonteInterna: o segredo na renovação, o pedido reentregue até confirmar, o relato com a prova libera e a segunda consulta roda", async () => {
    const m = await montar();
    expect((await m.renovar()).ativo).toBe(true);
    expect(m.caixa.revisorDoTurno(m.plano.turnoId)).toEqual({ machineId: m.machineId });
    const r = await m.pedir("git push --force origin feat/login");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    // Reentrega até `revisoesRecebidas` (a resposta perdida não trava).
    const [p1] = (await m.renovar()).revisoes ?? [];
    const [p2] = (await m.renovar()).revisoes ?? [];
    expect(p1?.decisaoId).toBe(r.aguardar);
    expect(p2?.revisaoId).toBe(p1?.revisaoId);
    expect((await m.renovar({ revisa: true, segredoRevisao: SEGREDO, revisoesRecebidas: [p1!.revisaoId] })).revisoes).toBeUndefined();
    // O relato com a prova de outro segredo é ignorado (a renovação com outro segredo envenena o turno: teste abaixo).
    expect(await m.ponte.relatarRevisao!(PESSOA.pessoaId, m.machineId, { revisaoId: p1!.revisaoId, turnoId: m.plano.turnoId, saida: LIBERA, ms: 1, prova: provaDaRevisao("o".repeat(40), p1!.revisaoId, p1!.decisaoId) })).toEqual({ aceito: false });
    expect(await m.ponte.relatarRevisao!(PESSOA.pessoaId, randomUUID(), { revisaoId: p1!.revisaoId, turnoId: m.plano.turnoId, saida: LIBERA, ms: 1, prova: provaDaRevisao(SEGREDO, p1!.revisaoId, p1!.decisaoId) })).toEqual({ aceito: false });
    expect(await m.relatar(p1!)).toEqual({ aceito: true });
    expect(await m.relatar(p1!)).toEqual({ aceito: false });
    const e = await m.ler(r.aguardar);
    expect(e.decisao).toMatchObject({ estado: "decidida", desfecho: { regra: "regra:revisor" } });
    expect(e.acao).toMatchObject({ veredito: "libera", revisorMaquina: m.machineId });
    expect(await m.pedir("git push --force origin feat/login")).toEqual({ permitir: true, porque: "revisor" });
  });

  it("o segredo só se amarra antes do prompt_submitted no banco: um segredo que chega depois (laço antigo + processo do bot, ou o mapa vazio de um reinício) não dá revisor; dois segredos envenenam (revisão do PR 3a)", async () => {
    const tardio = await montar();
    // O laço antigo: a renovação do promptSubmitted sem segredo grava prompt_submitted.
    expect((await tardio.renovar({})).ativo).toBe(true);
    // Depois, um processo do bot com a chave da máquina manda `revisa` e um segredo dele: não amarra.
    await tardio.renovar({ revisa: true, segredoRevisao: "b".repeat(40) });
    expect(tardio.caixa.revisorDoTurno(tardio.plano.turnoId)).toBeNull();
    const r = await tardio.pedir("git push --force origin main");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    expect(r.revisao).toBeUndefined();
    expect(await tardio.ler(r.aguardar)).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "nao_revisado", falha: "sem_revisor" } });

    const dois = await montar();
    await dois.renovar();
    const r2 = await dois.pedir("git push --force origin feat/x");
    if (!("aguardar" in r2) || !r2.revisao) throw new Error(`esperava revisão: ${JSON.stringify(r2)}`);
    expect((await dois.renovar({ revisa: true, segredoRevisao: "o".repeat(40) })).revisoes).toBeUndefined();
    expect(dois.vencidas).toEqual([r2.aguardar]);
    expect((await dois.renovar()).revisoes).toBeUndefined();
    expect(dois.caixa.revisorDoTurno(dois.plano.turnoId)).toBeNull();
  });

  it("sem `revisa` na renovação (app antigo, catcher): a fase 1 manda direto ao cartão", async () => {
    const m = await montar();
    await m.renovar({});
    const r = await m.pedir("git push --force");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    expect(r.revisao).toBeUndefined();
    expect(await m.ler(r.aguardar)).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "nao_revisado", falha: "sem_revisor" } });
  });

  it("corrida: o relato e o varredor na mesma decisão — uma fase 3 só ganha, e o estado bate com o veredito gravado", async () => {
    const m = await montar();
    await m.renovar();
    const r = await m.pedir("git push --force origin corrida");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    const [p] = (await m.renovar()).revisoes ?? [];
    await escopado((trx) => trx`update decisoes set criado_em = now() - interval '5 minutes' where id = ${r.aguardar}`);
    const varrer = () => varrerPessoa(PESSOA, (fn) => escopado(fn), { services: m.services, useCases: useCasesDeTeste(), agora: () => Date.now() });
    await Promise.all([m.relatar(p!), varrer()]);
    const e = await m.ler(r.aguardar);
    if (e.decisao?.estado === "decidida") expect(e.acao).toMatchObject({ veredito: "libera" });
    else expect(e).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "falhou", falha: "prazo" } });
    expect(e.itens).toHaveLength(1);
  });

  it("corrida: o relato que libera contra o Parar — se o Parar entrou antes da trava, cartão; senão, liberada (nunca os dois)", async () => {
    const m = await montar();
    await m.renovar();
    const r = await m.pedir("git push --force origin parar");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    const [p] = (await m.renovar()).revisoes ?? [];
    await Promise.all([m.relatar(p!), escopado((trx) => trx`update turnos set parar_solicitado_em = now() where id = ${m.plano.turnoId}`)]);
    const e = await m.ler(r.aguardar);
    if (e.decisao?.estado === "decidida") expect(e).toMatchObject({ acao: { veredito: "libera", falha: null }, itens: [{ desfecho: "executado" }] });
    else expect(e).toMatchObject({ decisao: { estado: "pendente" }, acao: { veredito: "libera", falha: "turno" }, itens: [{ desfecho: null, motivoManual: "revisor_falhou" }] });
    // Depois do Parar, a renovação nega e não entrega mais nada.
    expect((await m.renovar()).ativo).toBe(false);
  });

  it("a entrega do turno com a revisão em voo: a caixa a vence na hora (cartão), sem esperar o prazo", async () => {
    const m = await montar();
    await m.renovar();
    const r = await m.pedir("git push --force origin fim");
    if (!("aguardar" in r)) throw new Error(`esperava aguardar: ${JSON.stringify(r)}`);
    m.caixa.esquecerTurno(m.plano.turnoId);
    expect(m.vencidas).toEqual([r.aguardar]);
  });
});
