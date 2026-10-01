import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasPendencias } from "../../src/adapters/http/rotas/pendencias.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { RespostaPendencias } from "../../src/contracts/pendencia.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { anotarPendencia, concluirPendencia, descartarPendencia, descartarPendenciaPelaPessoa, fazerPendenciaAgora, listarPendencias } from "../../src/use-cases/pendencias.ts";
import { semNovidade } from "../../src/use-cases/sem-novidade.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste as servicosL5 } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** O Chico, a conversa própria dele e um turno de conversa de Marlon (quem anota é sempre um turno). */
async function cenario(trx: Tx, escopo: Escopo = MARLON) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo, { nome: "Chico" });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "Tech Lead" });
  const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "acione os devs agora", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
  if (!turno) throw new Error("turno não criado");
  const deps = depsSobreTrx(trx, escopo);
  const ctx = { turnoId: turno.id, agenteId, conversaId };
  const anotar = async (texto: string, extra: { a_partir_de?: string; turnoId?: string } = {}) => {
    const r = await executar(deps, anotarPendencia, { ...ctx, texto, ...extra });
    if (!r.data.ok) throw new Error(`anotar falhou: ${r.data.erro}`);
    return r.data.pendencia_id;
  };
  return { repos, deps, agenteId, conversaId, turno, ctx, anotar };
}

/**
 * Pendências do bot (ADR-064, 0044) no Postgres de verdade: as três ferramentas, as duas ações da pessoa, a lista no
 * plano do turno de profundidade 0 (e fora da delegação) e a RLS — outra pessoa do tenant não vê nem mexe.
 */
describeIntegracao("pendências do bot (ADR-064)", () => {
  it("anotar grava aberta na conversa própria, com o turno, sem duplicar; o evento do agente vai ao outbox", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = await c.anotar("Cobrar do Dev 1 o parecer do PR #475", { a_partir_de: new Date(Date.now() + 30 * 60_000).toISOString() });
      expect(await c.anotar("  cobrar do dev 1 o parecer do PR #475 ")).toBe(id);
      const [p] = await c.repos.pendencias.abertasDoAgente(c.agenteId);
      expect(p).toMatchObject({ id, conversaId: c.conversaId, turnoId: c.turno.id, estado: "aberta", cuidado: false, profundidade: 0, resolvidaEm: null });
      expect(p?.aPartirDe).toBeGreaterThan(Date.now());
      const [outbox] = await trx<{ n: number }[]>`select count(*)::int as n from events where kind = 'agente_atualizado' and dados->>'acao' = 'pendencia_anotada' and dados->>'pendencia_id' = ${id}`;
      expect(outbox?.n).toBe(1);
      // As constraints são a última camada: texto grande, estado fora da lista e resolução pela metade.
      await expectRejected(trx, () => trx`insert into pendencias (tenant_id, owner_id, agente_id, conversa_id, texto) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${c.agenteId}, ${c.conversaId}, ${"x".repeat(501)})`, "23514");
      await expectRejected(trx, () => trx`update pendencias set estado = 'adiada' where id = ${id}`, "23514");
      await expectRejected(trx, () => trx`update pendencias set estado = 'feita' where id = ${id}`, "23514");
    });
  });

  it("concluir e descartar pelo bot: linha de sistema na conversa, turno que resolveu gravado; de outro bot é 'não encontrada'", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const outro = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const a = await c.anotar("Cobrar do Dev 1 o parecer do PR #475");
      const b = await c.anotar("Ler as outras 13 tasks");
      expect((await executar(c.deps, concluirPendencia, { ...c.ctx, id: a, como: "o Dev 1 mandou o parecer: pedir mudanças" })).data).toEqual({ ok: true });
      expect((await executar(c.deps, descartarPendencia, { ...c.ctx, agenteId: outro.agenteId, id: b, por_que: "não é minha" })).data).toEqual({ ok: false, erro: "pendencia_nao_encontrada" });
      expect((await executar(c.deps, descartarPendencia, { ...c.ctx, id: b, por_que: "o Milton já leu todas" })).data).toEqual({ ok: true });
      expect((await executar(c.deps, concluirPendencia, { ...c.ctx, id: b, como: "de novo" })).data).toEqual({ ok: false, erro: "pendencia_ja_resolvida" });
      const linhas = await trx<{ estado: string; resolvida_por: string; resolvida_no_turno_id: string; motivo: string }[]>`
        select estado, resolvida_por, resolvida_no_turno_id, motivo from pendencias where agente_id = ${c.agenteId} order by criado_em`;
      expect(linhas).toEqual([
        { estado: "feita", resolvida_por: "bot", resolvida_no_turno_id: c.turno.id, motivo: "o Dev 1 mandou o parecer: pedir mudanças" },
        { estado: "descartada", resolvida_por: "bot", resolvida_no_turno_id: c.turno.id, motivo: "o Milton já leu todas" },
      ]);
      const sistema = (await c.repos.mensagens.listarDaConversa(c.conversaId)).filter((m) => m.kind === "sistema").map((m) => m.texto);
      expect(sistema).toEqual(["Feito: Cobrar do Dev 1 o parecer do PR #475. O Dev 1 mandou o parecer: pedir mudanças.", "Descartei: Ler as outras 13 tasks. O Milton já leu todas."]);
      expect(await c.repos.pendencias.resolvidasNoTurno(c.turno.id)).toBe(2);
      // Na rotina, quem resolveu uma pendência teve novidade: sem_novidade responde ok e não marca o turno.
      await semNovidade(c.deps, { ...c.ctx, motivo: "nada_mudou" });
      expect((await c.repos.turnos.buscar(c.turno.id))?.semNovidadeMotivo ?? null).toBeNull();
    });
  });

  it("a pessoa descarta: 'Você descartou: …' na conversa; Fazer agora vira a fala dela, turno de conversa em profundidade 0, e segura o duplo clique", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const a = await c.anotar("Ler as outras 13 tasks.");
      const b = await c.anotar("Cobrar do Dev 1 o parecer do PR #475");
      const descarte = await executar(c.deps, descartarPendenciaPelaPessoa, { agenteId: c.agenteId, pendenciaId: a });
      expect(descarte.data.pendencia).toMatchObject({ estado: "descartada", resolvidaPor: "pessoa" });
      expect(descarte.data.mensagem).toMatchObject({ kind: "sistema", texto: "Você descartou: Ler as outras 13 tasks", autoria: { autor_tipo: "pessoa" } });
      await esperarErro(() => descartarPendenciaPelaPessoa(c.deps, { agenteId: c.agenteId, pendenciaId: a }), "estado_invalido");

      const feito = await executar(c.deps, fazerPendenciaAgora, { agenteId: c.agenteId, pendenciaId: b });
      expect(feito.data.mensagem).toMatchObject({ conversaId: c.conversaId, kind: "texto", texto: "Fazer agora: Cobrar do Dev 1 o parecer do PR #475", autoria: { autor_tipo: "pessoa" } });
      expect(feito.data.turno).toMatchObject({ conversaId: c.conversaId, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" });
      await esperarErro(() => fazerPendenciaAgora(c.deps, { agenteId: c.agenteId, pendenciaId: b }), "estado_invalido");
      expect(await c.repos.pendencias.buscar(b)).toMatchObject({ estado: "aberta", pedidaEm: expect.any(Number) });
    });
  });

  it("a pendência anotada num turno de entrada não confiável sai com cuidado, e o Fazer agora leva a ressalva na fala", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const deFora = await c.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem: "rotina", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "varredura", entradaConfianca: "nao_confiavel", modelo: "claude-haiku-4-5-20251001" });
      const id = await c.anotar("Responder o que o e-mail pediu", { turnoId: deFora?.id ?? "" });
      expect(await c.repos.pendencias.buscar(id)).toMatchObject({ cuidado: true });
      const feito = await executar(c.deps, fazerPendenciaAgora, { agenteId: c.agenteId, pendenciaId: id });
      expect(feito.data.mensagem).toMatchObject({ texto: "Fazer agora: Responder o que o e-mail pediu (anotada depois de ler conteúdo de fora: confira na fonte antes de agir)", autoria: { autor_tipo: "pessoa" } });
    });
  });

  it("RLS: Ana não vê, não resolve, não pede e não grava pendência no bot de Marlon", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const id = await c.anotar("Cobrar do Dev 1 o parecer do PR #475");
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.pendencias.buscar(id)).toBeNull();
      expect(await daAna.pendencias.abertasDoAgente(c.agenteId)).toEqual([]);
      expect(await daAna.pendencias.resolver(id, { estado: "descartada", por: "pessoa", turnoId: null, motivo: null, agora: Date.now() })).toBeNull();
      expect(await daAna.pendencias.marcarPedida(id, Date.now(), 0)).toBeNull();
      const [visiveis] = await trx<{ n: number }[]>`select count(*)::int as n from pendencias where id = ${id}`;
      expect(visiveis?.n).toBe(0);
      const anaDeps = depsSobreTrx(trx, ANA);
      await esperarErro(() => descartarPendenciaPelaPessoa(anaDeps, { agenteId: c.agenteId, pendenciaId: id }), "nao_encontrado");
      await esperarErro(() => fazerPendenciaAgora(anaDeps, { agenteId: c.agenteId, pendenciaId: id }), "nao_encontrado");
      await expectRejected(trx, () => trx`insert into pendencias (tenant_id, owner_id, agente_id, conversa_id, texto) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${c.agenteId}, ${c.conversaId}, 'sequestro')`, "42501");
      await vincularEscopo(trx, MARLON);
      expect(await c.repos.pendencias.buscar(id)).toMatchObject({ estado: "aberta" });
    });
  });

  it("o plano do turno de profundidade 0 leva a lista (sem a de hora futura); a delegação não leva, mas anota na conversa própria", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.anotar("Cobrar do Dev 1 o parecer do PR #475");
      await c.anotar("Revisar de novo o PR #475 depois das mudanças", { a_partir_de: new Date(Date.now() + 3_600_000).toISOString() });
      const agora = () => Date.now();
      const l5 = depsSobre(c.repos, MARLON, { services: servicosL5({ agora }), agora, trx });
      const plano = async (origem: "conversa" | "rotina" | "delegacao", profundidade: 0 | 1) => {
        const t = await c.repos.turnos.enfileirar({ conversaId: c.conversaId, agenteId: c.agenteId, origem, prazoEm: agora() + 60_000, profundidade, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
        return (await emitirPlanoTurno(l5, { turnoId: t?.id ?? "", machineId: randomUUID() })).data;
      };

      const conversa = await plano("conversa", 0);
      expect(conversa.promptSistema).toContain("Suas pendências abertas");
      expect(conversa.promptSistema).toContain("Cobrar do Dev 1 o parecer do PR #475");
      expect(conversa.promptSistema).not.toContain("Revisar de novo o PR #475");
      expect(conversa.promptSistema).not.toContain("Numa rotina, resolver uma pendência é novidade");
      expect(conversa.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["anotar_pendencia", "concluir_pendencia", "descartar_pendencia"]));

      const rotina = await plano("rotina", 0);
      expect(rotina.promptSistema).toContain("Numa rotina, resolver uma pendência é novidade");

      const delegacao = await plano("delegacao", 1);
      expect(delegacao.promptSistema).not.toContain("Suas pendências abertas");
      const nomes = delegacao.catalogo.ferramentas.map((f) => f.nome);
      expect(nomes).toContain("anotar_pendencia");
      expect(nomes).not.toContain("concluir_pendencia");
      expect(delegacao.promptSistema).toContain("Pendências: vai deixar algo para depois?");

      // O turno do pedido de colega anota; a pendência mora na conversa própria do bot e guarda a profundidade.
      const colega = await agenteComConversa(trx, MARLON, { nome: "Clarice" });
      const noColega = await c.repos.turnos.enfileirar({ conversaId: colega.conversaId, agenteId: c.agenteId, origem: "delegacao", prazoEm: agora() + 60_000, profundidade: 3, entradaTexto: "pede ao Dev 3", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      const id = await c.anotar("Pedir ao Dev 3 que confira a 86ajtj1xk", { turnoId: noColega?.id ?? "" });
      expect(await c.repos.pendencias.buscar(id)).toMatchObject({ conversaId: c.conversaId, turnoId: noColega?.id, profundidade: 3 });
    });
  });

  it("listar devolve só as abertas do bot, da mais nova para a mais antiga", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const a = await c.anotar("primeira");
      const b = await c.anotar("segunda");
      const d = await c.anotar("terceira");
      await executar(c.deps, concluirPendencia, { ...c.ctx, id: b, como: "feito" });
      expect((await executar(c.deps, listarPendencias, { agenteId: c.agenteId })).data.pendencias.map((p) => p.id)).toEqual([d, a]);
    });
  });
});

/** As rotas da pessoa sobre o servidor-de-teste: SAVEPOINT dentro do withRollback, escopo da sessão a cada requisição. */
describeIntegracao("rotas das pendências (ADR-064)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasPendencias(deps));
  });
  afterAll(() => servidor.close());

  it("GET lista; Descartar 200; Fazer agora 201 e o segundo 409; Ana e id malformado recebem 404", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const c = await cenario(trx);
      const a = await c.anotar("Ler as outras 13 tasks");
      const b = await c.anotar("Cobrar do Dev 1 o parecer do PR #475");
      const marlon = await servidor.entrar("marlon");

      const lista = await servidor.chamar(marlon, "GET", `agentes/${c.agenteId}/pendencias`);
      expect(lista.status).toBe(200);
      expect(((await lista.json()) as RespostaPendencias).pendencias.map((p) => p.id)).toEqual([b, a]);

      const descartar = await servidor.chamar(marlon, "POST", `agentes/${c.agenteId}/pendencias/${a}/descartar`);
      expect(descartar.status).toBe(200);
      expect(await descartar.json()).toMatchObject({ ok: true, ids: { pendencia: a, mensagem: expect.any(String) } });
      const fazer = await servidor.chamar(marlon, "POST", `agentes/${c.agenteId}/pendencias/${b}/fazer-agora`);
      expect(fazer.status).toBe(201);
      expect(await fazer.json()).toMatchObject({ ok: true, ids: { mensagem: expect.any(String), turno: expect.any(String) } });
      expect((await servidor.chamar(marlon, "POST", `agentes/${c.agenteId}/pendencias/${b}/fazer-agora`)).status).toBe(409);
      expect((await servidor.chamar(marlon, "POST", `agentes/${c.agenteId}/pendencias/nao-e-uuid/descartar`)).status).toBe(404);

      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "POST", `agentes/${c.agenteId}/pendencias/${b}/descartar`)).status).toBe(404);
      await vincularEscopo(trx, MARLON);
      expect(await c.repos.pendencias.buscar(b)).toMatchObject({ estado: "aberta" });
      trxAtual = null;
    });
  });
});
