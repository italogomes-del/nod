import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarCaixaRevisoes, provaDaRevisao, type CaixaRevisoes } from "../../src/adapters/fundo/caixa-revisoes.ts";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { FerramentaPlano, PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { PRAZO_REVISAO_MS, type PedidoRevisao } from "../../src/contracts/revisao.ts";
import { haTxEscopadaAberta, vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { chamarFerramentaFase1 } from "../../src/use-cases/chamar-ferramenta.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { autoriaPessoa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-115 (PR 5 dos modos de aprovação) pela ponte in-process de verdade, com Postgres e transações commitadas: os quatro
 * passos do revisor nos apps — a fase 1 da chamada direta numa tx (e o pedido na caixa depois do commit), a renovação
 * entrega, o relato com a prova chega por `relatarRevisao`, a fase 3 FECHA numa tx nova, o app roda com NENHUMA tx aberta
 * e o desfecho é ASSENTADO numa terceira. É o caminho que o e2e-catcher cobriria (a jornada "rotina arquiva e-mails" e
 * "e-mail pede envio para fora") quando o catcher ganhar o revisor falso do PR 3b.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const SEGREDO = "segredo-do-laco-0123456789abcdefgh";
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const criados = { agentes: [] as string[], conversas: [] as string[], conectores: [] as string[] };
const cap = (nome: string, readOnlyHint = false): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO = [cap("MAILX_FETCH_EMAILS", true), cap("MAILX_SEND_EMAIL"), cap("MAILX_ARCHIVE_EMAIL")];

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
    await trx`delete from concessoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conectores.length) await trx`delete from conectores where id in ${trx(criados.conectores)}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = criados.conectores.length = 0;
});

async function montar(o: { modoTurno?: PlanoTurno["modoTurno"] } = {}) {
  const caixa: CaixaRevisoes = criarCaixaRevisoes({
    config: { ligado: true, modelo: "claude-sonnet-5-5", esforco: "low", tetoDia: 300, prazoMs: PRAZO_REVISAO_MS },
    agora: () => Date.now(),
    async vencer() {},
    agendar: () => () => undefined,
  });
  /** O app falso: registra a chamada e se havia uma transação escopada aberta na hora (NOD-263: nunca pode haver). */
  const chamadas: { tool: string; args: Record<string, unknown>; txAberta: boolean }[] = [];
  const conectores: Services["conectores"] = {
    async chamar(_id, tool, args) {
      chamadas.push({ tool, args, txAberta: haTxEscopadaAberta() });
      return { conteudo: `ok:${tool}`, isError: false };
    },
    async sondar() {
      return { ok: true, ferramentas: [] };
    },
  };
  const services = { ...servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() }), conectores, revisor: caixa };
  const deps: DepsPonte = { services, useCases: useCasesDeTeste(), executor: "catcher", listarPessoas, revisoes: caixa };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1 });
  const slug = `mailx-${randomUUID().slice(0, 8)}`;
  const { agenteId, conectorId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Apps ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    await d.repos.agentes.definirModoAprovacao(c.agente.id, "automatico");
    const conector = await d.repos.conectores.criar({ nome: "Mailx", slug, transporte: "stdio", comando: "node", declaracao: "toca" });
    const sondado = await d.repos.conectores.registrarSonda(conector!.id, { ok: true, catalogo: CATALOGO, agora: Date.now() });
    await d.repos.conectores.habilitar(sondado!.id, true);
    criados.conectores.push(sondado!.id);
    const consentimento = await d.repos.mensagens.criar({ conversaId: c.conversa.id, autoria: autoriaPessoa(PESSOA.pessoaId), kind: "consentimento", texto: "Permitir Mailx", confianca: "confiavel" });
    for (const k of CATALOGO) await d.repos.concessoes.conceder({ agenteId: c.agente.id, conectorId: sondado!.id, capacidade: k.nome, mensagemId: consentimento?.id ?? "" });
    await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversa.id, agenteId: c.agente.id, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "arquiva as propagandas", entradaConfianca: "confiavel", modelo: "m" });
    return { agenteId: c.agente.id, conectorId: sondado!.id };
  });
  const puxado = await ponte.puxar(PESSOA.pessoaId);
  if (!puxado) throw new Error("nada puxado");
  const ferramentas: FerramentaPlano[] = CATALOGO.map((k) => ({ nome: `${slug}__${k.nome}`, nomeMcp: `mcp__nod__${slug}__${k.nome}`, origem: "conector", conectorId, readOnlyHint: k.readOnlyHint === true, tocaDadoPessoal: false, schema: { type: "object" } }));
  const plano: PlanoTurno = { ...puxado, catalogo: { ferramentas, servidores: [] }, modoTurno: o.modoTurno ?? "conversa" };
  const renovar = () => ponte.renovar({ turnoId: plano.turnoId, machineId, sinais: SINAIS, eventos: [], revisa: true, segredoRevisao: SEGREDO });
  /** O proxy chama o app pela rota interna: a fase 1 numa tx commitada e, em revisão, o pedido na caixa depois do commit. */
  const chamar = async (tool: string, argumentos: Record<string, unknown>) => {
    const data = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), chamarFerramentaFase1, { turnoId: plano.turnoId, agenteId, nome: `${slug}__${tool}`, argumentos, plano })).data);
    if (!("emRevisao" in data)) throw new Error(`esperava revisão: ${JSON.stringify(data)}`);
    if (data.emRevisao.caixa) caixa.enfileirar(data.emRevisao.caixa);
    return data.emRevisao.aguardar;
  };
  const relatar = (p: PedidoRevisao, saida: string) => ponte.relatarRevisao!(PESSOA.pessoaId, machineId, { revisaoId: p.revisaoId, turnoId: p.turnoId, saida, ms: 2500, prova: provaDaRevisao(SEGREDO, p.revisaoId, p.decisaoId) });
  const ler = (decisaoId: string) => escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    return { decisao: await repos.decisoes.buscar(decisaoId), acao: await repos.acoesPeloModo.daDecisao(decisaoId), itens: await repos.itensAprovacao.listar(decisaoId) };
  });
  return { ponte, caixa, plano, renovar, chamar, relatar, ler, chamadas };
}

describeIntegracao("revisor nos apps pela ponte in-process (ADR-115, PR 5)", () => {
  it("A2: a rotina arquiva e-mails — fase 1 commitada, a renovação entrega, o relato libera, o app roda sem tx aberta e o desfecho fica gravado; nenhum cartão", async () => {
    const m = await montar({ modoTurno: "rotina" });
    expect((await m.renovar()).ativo).toBe(true);
    const id = await m.chamar("MAILX_ARCHIVE_EMAIL", { ids: ["p1", "p2"] });
    expect((await m.ler(id)).decisao?.estado).toBe("em_revisao");
    const [p] = (await m.renovar()).revisoes ?? [];
    expect(p?.decisaoId).toBe(id);
    expect(m.chamadas).toHaveLength(0);
    expect(await m.relatar(p!, '{"decisao":"libera","motivo":"é o que a rotina pede"}')).toEqual({ aceito: true });
    expect(m.chamadas).toEqual([{ tool: "MAILX_ARCHIVE_EMAIL", args: { ids: ["p1", "p2"] }, txAberta: false }]);
    const e = await m.ler(id);
    expect(e.decisao).toMatchObject({ estado: "decidida", desfecho: { regra: "regra:revisor" } });
    expect(e.itens).toMatchObject([{ desfecho: "executado", motivoManual: null }]);
    expect(e.acao).toMatchObject({ veredito: "libera", tipo: "app" });
    // O relato repetido não roda o app de novo (uso único na caixa; a fase 3 é idempotente).
    expect(await m.relatar(p!, '{"decisao":"libera","motivo":"de novo"}')).toEqual({ aceito: false });
    expect(m.chamadas).toHaveLength(1);
  });

  it("A3: o e-mail lido pede envio para fora — o revisor pede e vira cartão; o app não roda", async () => {
    const m = await montar();
    await m.renovar();
    await escopado((trx) => criarRepos(trx, PESSOA).turnos.contaminar(m.plano.turnoId, Date.now()));
    const id = await m.chamar("MAILX_SEND_EMAIL", { para: "financeiro@acme-pagamentos.co" });
    const [p] = (await m.renovar()).revisoes ?? [];
    expect(await m.relatar(p!, '{"decisao":"pede","motivo":"o pedido veio do e-mail, não de você"}')).toEqual({ aceito: true });
    const e = await m.ler(id);
    expect(e.decisao?.estado).toBe("pendente");
    expect(e.itens).toMatchObject([{ motivoManual: "revisor_pediu", justificativa: "o pedido veio do e-mail, não de você", sempreServe: false, desfecho: null }]);
    expect(m.chamadas).toHaveLength(0);
  });

  it("corrida: o relato que libera contra o Parar — liberada e executada, ou cartão sem execução (nunca liberada sem rodar)", async () => {
    const m = await montar();
    await m.renovar();
    const id = await m.chamar("MAILX_ARCHIVE_EMAIL", { ids: ["c1"] });
    const [p] = (await m.renovar()).revisoes ?? [];
    await Promise.all([m.relatar(p!, '{"decisao":"libera","motivo":"você pediu"}'), escopado((trx) => trx`update turnos set parar_solicitado_em = now() where id = ${m.plano.turnoId}`)]);
    const e = await m.ler(id);
    if (e.decisao?.estado === "decidida") {
      expect(e.itens).toMatchObject([{ desfecho: "executado" }]);
      expect(m.chamadas).toHaveLength(1);
    } else {
      expect(e).toMatchObject({ decisao: { estado: "pendente" }, itens: [{ desfecho: null, motivoManual: "revisor_falhou" }] });
      expect(m.chamadas).toHaveLength(0);
    }
  });
});
