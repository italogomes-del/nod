import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro, type PedidoLote } from "../../src/use-cases/quadro.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-442: o quadro-agente no Postgres. Um lote por chamada (tudo ou nada), as tarefas com responsável começam sozinhas
 * (turno de delegacao na conversa própria do bot), a meta fecha com o resumo, e o Desfazer volta à foto do antes.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-10-31T12:00:00Z");

async function montar(trx: Tx, o: { experimento?: boolean } = {}) {
  const sufixo = Math.random().toString(36).slice(2, 7);
  const ana = await agenteComConversa(trx, MARLON, { nome: `Ana ${sufixo}` });
  const beto = await agenteComConversa(trx, MARLON, { nome: `Beto ${sufixo}` });
  const relogio = { agora: AGORA };
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio.agora });
  if (o.experimento !== false) await repos.preferencias.gravar({ experimentos: { quadro: true } });
  const lote = (p: Partial<PedidoLote> & Pick<PedidoLote, "ops">) => aplicarLoteQuadro(deps, { autor: { tipo: "agente", agenteId: ana.agenteId }, executor: "catcher", limite: "total", ...p });
  return { ana, beto, anaNome: `Ana ${sufixo}`, betoNome: `Beto ${sufixo}`, deps, repos, lote, relogio };
}

describeIntegracao("quadro-agente (NOD-442)", () => {
  it("experimento desligado: nada grava", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { experimento: false });
      await m.repos.preferencias.gravar({ experimentos: { quadro: false } });
      const r = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "x" }] });
      expect(r.data).toMatchObject({ ok: false, erro: "experimento_desligado" });
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).toBeNull();
    });
  });

  it("cria o quadro com as tarefas num lote só; a do Beto começa sozinha na conversa dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }, { tipo: "criar_tarefa", titulo: "Tela de login", agente: m.betoNome, status: "afazer" }, { tipo: "criar_tarefa", titulo: "Copy" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const q = r.data.quadro!;
      expect(q).toMatchObject({ agenteId: m.ana.agenteId, meta: "Lançar login", prazo: "2026-11-06", feitas: 0, total: 2 });
      expect(q.tarefas.map((t) => [t.titulo, t.status, t.agenteNome, t.execucao])).toEqual([["Tela de login", "fazendo", m.betoNome, "fila"], ["Copy", "backlog", null, null]]);
      expect(r.data.comecaram).toHaveLength(1);
      const turno = await m.repos.turnos.buscar(r.data.comecaram[0]!.turnoId);
      expect(turno).toMatchObject({ agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, origem: "delegacao", estado: "pendente", entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON });
      expect(turno?.entradaTexto).toContain(`tarefa: ${q.tarefas[0]!.id}`);
      expect(r.events?.map((e) => e.kind)).toEqual(["quadro_mudou", "turno_criado"]);
      expect(r.data.lote?.resumo).toBe("Criou o quadro, criou 2 tarefas");
      expect(q.ultimoLote?.id).toBe(r.data.lote?.id);
    });
  });

  it("um bot que é quadro pode ser responsável por tarefa de outro quadro: começa na conversa dele e o quadro dele não muda (NOD-415, critério 10)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const doBeto = await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, ops: [{ tipo: "criar_quadro", meta: null }, { tipo: "criar_tarefa", titulo: "Revisar copy" }] });
      if (!doBeto.data.ok) throw new Error(doBeto.data.detalhe);
      const antes = await m.repos.quadros.tarefas(doBeto.data.quadro!.id);
      const r = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "Lançar" }, { tipo: "criar_tarefa", titulo: "Tela", agente: m.betoNome, status: "afazer" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.quadro!.tarefas.map((t) => [t.titulo, t.status, t.agenteNome])).toEqual([["Tela", "fazendo", m.betoNome]]);
      const turno = await m.repos.turnos.buscar(r.data.comecaram[0]!.turnoId);
      expect(turno).toMatchObject({ agenteId: m.beto.agenteId, conversaId: m.beto.conversaId, origem: "delegacao" });
      expect(await m.repos.quadros.tarefas(doBeto.data.quadro!.id)).toEqual(antes);
    });
  });

  it("tudo ou nada: uma ação inválida não grava nem o quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "x" }, { tipo: "criar_tarefa", titulo: "a", agente: "Ninguém Existe", status: "afazer" }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida", detalhe: expect.stringContaining("ação 2") });
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).toBeNull();
    });
  });

  it("qualquer bot mexe no quadro de outro pelo nome do anfitrião; PR → revisão; feito fecha a meta com o resumo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M", prazo: "2026-11-06" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const beto = { tipo: "agente", agenteId: m.beto.agenteId } as const;
      const pr = await m.lote({ autor: beto, quadro: m.anaNome, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", pr_url: "https://github.com/gamefik/nod/pull/700" }] });
      expect(pr.data).toMatchObject({ ok: true, comecaram: [], quadro: { tarefas: [{ status: "revisao" }], cumpridoEm: null } });
      const feito = await m.lote({ autor: beto, quadro: m.anaNome, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "feito" }] });
      if (!feito.data.ok) throw new Error(feito.data.detalhe);
      expect(feito.data.quadro).toMatchObject({ cumpridoEm: AGORA, feitas: 1, total: 1, resumo: `1 de 1 tarefas feitas, no prazo (sex, 06/11). Feito por ${m.betoNome}. PRs: #700.` });
      // Sair de feito reabre a meta.
      const volta = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "revisao" }] });
      expect(volta.data).toMatchObject({ ok: true, quadro: { cumpridoEm: null, resumo: null } });
    });
  });

  it("meta opcional (NOD-415, ADR-141): nasce sem meta no fluxo contínuo, nunca cumpre; ganha meta, o feito antes não conta, cumpre; tirar a meta reabre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const pessoa = { autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId } as const;
      const c = await m.lote({ ...pessoa, ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "T1" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      expect(c.data.quadro).toMatchObject({ meta: null, prazo: null, cumpridoEm: null });
      const feito = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "feito" }] });
      expect(feito.data).toMatchObject({ ok: true, quadro: { meta: null, cumpridoEm: null, resumo: null } });
      // A meta vem depois: T1, feita antes dela, não a cumpre nem entra no "N de M" (revisões 2 e 3).
      m.relogio.agora = AGORA + 60_000;
      const comMeta = await m.lote({ ...pessoa, ops: [{ tipo: "editar_quadro", meta: "Lançar", prazo: "2026-11-06" }, { tipo: "criar_tarefa", titulo: "T2" }] });
      expect(comMeta.data).toMatchObject({ ok: true, quadro: { meta: "Lançar", prazo: "2026-11-06", cumpridoEm: null, feitas: 0, total: 1 } });
      // Renomear T1 (mexe no mudado_em) não a devolve à meta (revisão 3); corrigir o texto da meta não recomeça a contagem.
      m.relogio.agora = AGORA + 120_000;
      const renomeia = await m.lote({ ...pessoa, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", titulo: "T1 (antiga)" }, { tipo: "editar_quadro", meta: "Lançar!" }] });
      expect(renomeia.data).toMatchObject({ ok: true, quadro: { cumpridoEm: null, feitas: 0, total: 1 } });
      m.relogio.agora = AGORA + 180_000;
      const cumpre = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T2", status: "feito" }] });
      expect(cumpre.data).toMatchObject({ ok: true, quadro: { cumpridoEm: AGORA + 180_000, feitas: 1, total: 1 } });
      // Meta NOVA depois de cumprida recomeça: nasce aberta, sem o resumo da anterior, e T2 não conta (revisão 4).
      m.relogio.agora = AGORA + 240_000;
      const nova = await m.lote({ ...pessoa, ops: [{ tipo: "editar_quadro", meta: "Fase 2" }, { tipo: "criar_tarefa", titulo: "T3" }] });
      expect(nova.data).toMatchObject({ ok: true, quadro: { meta: "Fase 2", cumpridoEm: null, resumo: null, feitas: 0, total: 1 } });
      expect((await m.lote({ ...pessoa, ops: [{ tipo: "desfazer" }] })).data).toMatchObject({ ok: true, quadro: { meta: "Lançar!", metaDesde: AGORA + 60_000, cumpridoEm: AGORA + 180_000, feitas: 1, total: 1 } });
      // O Desfazer devolveu também o meta_desde: o lote seguinte mantém a meta cumprida (revisão 5).
      m.relogio.agora = AGORA + 300_000;
      expect((await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T2", descricao: "ok" }] })).data).toMatchObject({ ok: true, quadro: { cumpridoEm: AGORA + 180_000, feitas: 1 } });
      const sem = await m.lote({ ...pessoa, ops: [{ tipo: "editar_quadro", meta: null, prazo: null }] });
      expect(sem.data).toMatchObject({ ok: true, quadro: { meta: null, prazo: null, cumpridoEm: null, resumo: null } });
      expect((await m.repos.quadros.doAgente(m.ana.agenteId))?.meta).toBeNull();
      // O Desfazer do lote devolve a meta.
      const d = await m.lote({ ...pessoa, ops: [{ tipo: "desfazer" }] });
      expect(d.data).toMatchObject({ ok: true, quadro: { meta: "Lançar!", prazo: "2026-11-06" } });
    });
  });

  it("virar quadro e voltar (NOD-415, ADR-141): remover para o turno da tarefa e apaga o quadro; conversa, memória e o bot ficam; dá para virar de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const memoria = await m.repos.memorias.criar({ agenteId: m.ana.agenteId, tipo: "fato", texto: "gosta de resumos curtos", origem: "pessoa" });
      const antes = await m.repos.mensagens.listarDaConversa(m.ana.conversaId);
      const c = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const turnoId = c.data.comecaram[0]!.turnoId;
      const r = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "remover_quadro" }] });
      expect(r.data).toMatchObject({ ok: true, quadro: null, removido: true });
      expect(r.events?.map((e) => e.kind)).toEqual(["quadro_mudou"]);
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).toBeNull();
      expect((await m.repos.turnos.buscar(turnoId))?.estado).not.toMatch(/pendente|despachando/);
      expect(await m.repos.agentes.buscar(m.ana.agenteId)).not.toBeNull();
      expect((await m.repos.memorias.listarDoAgente(m.ana.agenteId)).map((x) => x.id)).toContain(memoria!.id);
      expect((await m.repos.mensagens.listarDaConversa(m.ana.conversaId)).map((x) => x.id)).toEqual(antes.map((x) => x.id));
      expect(await m.repos.conversas.buscarPropriaDoAgente(m.ana.agenteId)).toMatchObject({ id: m.ana.conversaId });
      // Sem quadro, mexer nele recusa; e o bot vira quadro de novo.
      expect((await m.lote({ ops: [{ tipo: "criar_tarefa", titulo: "x" }] })).data).toMatchObject({ ok: false, erro: "sem_quadro" });
      expect((await m.lote({ ops: [{ tipo: "remover_quadro" }] })).data).toMatchObject({ ok: false });
      expect((await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true, quadro: { meta: null } });
    });
  });

  it("remover_quadro: vai sozinho; o lote do bot não apaga na hora (NOD-430: vira o card quadro_exclusao), só o card confirmado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote({ ops: [{ tipo: "criar_quadro" }] });
      await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, ops: [{ tipo: "criar_quadro" }] });
      const limpo = { autorNaConversa: true, origemConfiavel: true } as const;
      expect((await m.lote({ ops: [{ tipo: "remover_quadro", bot: m.anaNome }, { tipo: "criar_tarefa", titulo: "x" }] })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      // Mesmo limpo e com o nome: o bot passa pelo card (gerir_quadro → proporExclusaoDoQuadro, quadro-pedir-a-qualquer-agente.test.ts).
      expect((await m.lote({ ops: [{ tipo: "remover_quadro", bot: m.anaNome }], ...limpo })).data).toMatchObject({ ok: false, detalhe: expect.stringContaining("vira um card") });
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).not.toBeNull();
      expect((await m.lote({ quadro: m.betoNome, ops: [{ tipo: "remover_quadro", bot: m.betoNome }], exclusaoConfirmada: "card-confirmado" })).data).toMatchObject({ ok: true, removido: true });
      expect(await m.repos.quadros.doAgente(m.beto.agenteId)).toBeNull();
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).not.toBeNull();
    });
  });

  it("bloqueio e resposta: voce com pergunta; a resposta volta a Fazendo e abre o turno com a resposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, quadro: m.anaNome, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "voce", pergunta: "Azul ou verde?" }] });
      const r = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "responder", tarefa: "T1", resposta: "Verde" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.quadro?.tarefas[0]).toMatchObject({ status: "fazendo", resposta: "Verde", execucao: "fila" });
      expect(r.data.comecaram).toHaveLength(1);
      const turno = await m.repos.turnos.buscar(r.data.comecaram[0]!.turnoId);
      expect(turno?.entradaTexto).toContain("sua pergunta: Azul ou verde?");
      expect(turno?.entradaTexto).toContain("resposta: Verde");
    });
  });

  it("Com você avisa a pessoa na conversa do responsável, uma vez, como aviso não confiável (revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      const beto = { tipo: "agente", agenteId: m.beto.agenteId } as const;
      const r = await m.lote({ autor: beto, quadro: m.anaNome, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "voce", pergunta: "Azul ou verde?" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      const avisos = async () => (await m.repos.mensagens.listarDaConversa(m.beto.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa");
      expect(await avisos()).toMatchObject([{ texto: `Preciso de você no quadro, em "T1": Azul ou verde?`, confianca: "nao_confiavel", autoria: { autor_tipo: "agente", autor_id: m.beto.agenteId } }]);
      expect(r.events?.find((e) => e.kind === "mensagem_criada")?.dados).toMatchObject({ aviso: true });
      // Continuar em voce (mudar o texto) não avisa de novo.
      await m.lote({ autor: beto, quadro: m.anaNome, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", descricao: "mais" }] });
      expect(await avisos()).toHaveLength(1);
    });
  });

  it("no limite da corrente de bots o lote grava, mas a tarefa fica em A fazer sem abrir turno (ADR-063)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.lote({ profundidade: 3, ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data).toMatchObject({ comecaram: [], seguradas: 1, quadro: { tarefas: [{ status: "afazer", agenteNome: m.betoNome }] } });
      // Abaixo do limite, o turno nasce um degrau acima.
      const ok = await m.lote({ profundidade: 1, ops: [{ tipo: "criar_tarefa", titulo: "T2", agente: m.betoNome, status: "afazer" }] });
      if (!ok.data.ok) throw new Error(ok.data.detalhe);
      expect((await m.repos.turnos.buscar(ok.data.comecaram[0]!.turnoId))?.profundidade).toBe(2);
    });
  });

  it("trocar o responsável cancela o turno que ainda não começou; o novo começa uma vez só", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const velho = c.data.comecaram[0]!.turnoId;
      const r = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.anaNome, status: "afazer" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect((await m.repos.turnos.buscar(velho))?.estado).toBe("interrompido");
      expect(r.data.comecaram).toHaveLength(1);
      expect((await m.repos.turnos.buscar(r.data.comecaram[0]!.turnoId))?.agenteId).toBe(m.ana.agenteId);
      // Cancelar a tarefa também para o turno dela.
      const novo = r.data.comecaram[0]!.turnoId;
      await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "cancelado" }] });
      expect((await m.repos.turnos.buscar(novo))?.estado).toBe("interrompido");
    });
  });

  it("Desfazer com o turno já rodando pede a interrupção dele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", status: "afazer" }] });
      const passou = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.betoNome }] });
      if (!passou.data.ok) throw new Error(passou.data.detalhe);
      const turnoId = passou.data.comecaram[0]!.turnoId;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${turnoId}`;
      const d = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "desfazer" }] });
      if (!d.data.ok) throw new Error(d.data.detalhe);
      expect((await m.repos.turnos.buscar(turnoId))?.pararSolicitadoEm).not.toBeNull();
    });
  });

  it("a retomada do turno da tarefa (ADR-009) segue no quadro: acha o quadro, mostra a execução, para com a troca de mão (revisão rodada 6)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const raiz = c.data.comecaram[0]!.turnoId;
      // O Beto abriu o PR e dorme à espera da CI: a raiz concluiu, a volta está na fila (turno novo com retoma_turno_id).
      await trx`update turnos set estado = 'concluido' where id = ${raiz}`;
      const volta = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.beto.conversaId, agenteId: m.beto.agenteId, origem: "retomada", retomaTurnoId: raiz, prazoEm: AGORA + 600_000, profundidade: 1, entradaTexto: "a CI terminou", entradaConfianca: "confiavel", modelo: "sonnet", acordarEm: AGORA + 60_000 });
      expect((await m.repos.quadros.doTurno(volta!.id))?.id).toBe(c.data.quadro!.id);
      const q = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", descricao: "d" }] });
      expect(q.data).toMatchObject({ ok: true, quadro: { tarefas: [{ status: "fazendo", execucao: "fila" }] } });
      // A pessoa passa a tarefa para a Ana: a volta do Beto sai da fila, e não escreve mais no quadro.
      const passou = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.anaNome }] });
      if (!passou.data.ok) throw new Error(passou.data.detalhe);
      expect((await m.repos.turnos.buscar(volta!.id))?.estado).toBe("interrompido");
      const tarde = await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, turnoId: volta!.id, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "feito" }] });
      expect(tarde.data).toMatchObject({ ok: false, detalhe: expect.stringContaining("foi parado") });
    });
  });

  it("revisão 3 do PR #622: mandar para o Backlog com passagem para o turno vivo e apaga a execução", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const turnoId = c.data.comecaram[0]!.turnoId;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${turnoId}`;
      const pessoa = { autor: { tipo: "pessoa" } as const, anfitriaoId: m.ana.agenteId };
      const r = await m.lote({ ...pessoa, ops: [{ tipo: "definir_passagem", coluna: "backlog", agente: m.betoNome }, { tipo: "mudar_tarefa", tarefa: "T1", status: "backlog" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect(r.data.quadro?.tarefas[0]).toMatchObject({ status: "backlog", agenteNome: m.betoNome, execucao: null });
      expect(await m.repos.turnos.buscar(turnoId)).toMatchObject({ pararSolicitadoEm: expect.any(Number) });
    });
  });

  it("o Desfazer não devolve a Fazendo um turno que já recebeu o Parar (revisão rodada 6)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const turnoId = c.data.comecaram[0]!.turnoId;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${turnoId}`;
      const passou = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.anaNome }] });
      if (!passou.data.ok) throw new Error(passou.data.detalhe);
      expect(await m.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "despachando", pararSolicitadoEm: expect.any(Number) });
      const d = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "desfazer" }] });
      if (!d.data.ok) throw new Error(d.data.detalhe);
      expect(d.data.quadro?.tarefas[0]).toMatchObject({ agenteNome: m.betoNome, status: "afazer", turnoId: null });
    });
  });

  it("desfazer uma passagem de mão devolve a tarefa a A fazer, sem o turno antigo já parado (revisão rodada 3)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const passou = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.anaNome }] });
      if (!passou.data.ok) throw new Error(passou.data.detalhe);
      const d = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "desfazer" }] });
      if (!d.data.ok) throw new Error(d.data.detalhe);
      expect(d.data.quadro?.tarefas[0]).toMatchObject({ titulo: "T1", agenteNome: m.betoNome, status: "afazer", turnoId: null });
      expect((await m.repos.turnos.buscar(passou.data.comecaram[0]!.turnoId))?.estado).toBe("interrompido");
      // E recomeça a pedido.
      const de = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer" }] });
      if (!de.data.ok) throw new Error(de.data.detalhe);
      expect(de.data.comecaram.map((x) => x.agenteId)).toEqual([m.beto.agenteId]);
    });
  });

  it("voltar a tarefa rodando para A fazer, com o mesmo bot, interrompe o turno antigo antes do novo (codex, rodada 2)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const velho = c.data.comecaram[0]!.turnoId;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${velho}`;
      const r = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "backlog" }, { tipo: "mudar_tarefa", tarefa: "T1", status: "afazer" }] });
      if (!r.data.ok) throw new Error(r.data.detalhe);
      expect((await m.repos.turnos.buscar(velho))?.pararSolicitadoEm).not.toBeNull();
      expect(r.data.comecaram.map((x) => x.turnoId)).not.toContain(velho);
    });
  });

  it("Desfazer volta à foto do antes e cancela o turno que ainda não começou; desfazer a criação apaga o quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const passou = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T1", agente: m.betoNome, titulo: "T1 novo" }, { tipo: "criar_tarefa", titulo: "T2" }] });
      if (!passou.data.ok) throw new Error(passou.data.detalhe);
      const turnoId = passou.data.comecaram[0]!.turnoId;
      const d = await m.lote({ autor: { tipo: "pessoa" }, anfitriaoId: m.ana.agenteId, ops: [{ tipo: "desfazer", lote: passou.data.lote!.id }] });
      if (!d.data.ok) throw new Error(d.data.detalhe);
      expect(d.data.quadro?.tarefas.map((t) => [t.titulo, t.status, t.agenteId])).toEqual([["T1", "afazer", null]]);
      expect((await m.repos.turnos.buscar(turnoId))?.estado).toBe("interrompido");
      // A pilha não volta duas casas: o último lote agora está desfeito.
      expect((await m.lote({ ops: [{ tipo: "desfazer" }] })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
      // Um lote novo, e o Desfazer de um lote velho é recusado.
      const novo = await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "T1", status: "backlog" }] });
      expect((await m.lote({ ops: [{ tipo: "desfazer", lote: c.data.lote!.id }] })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(novo.data.ok).toBe(true);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T1", agente: m.betoNome, status: "afazer" }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const d = await m.lote({ ops: [{ tipo: "desfazer" }] });
      expect(d.data).toMatchObject({ ok: true, quadro: null, desfeito: true });
      expect(await m.repos.quadros.doAgente(m.ana.agenteId)).toBeNull();
      expect((await m.repos.turnos.buscar(c.data.comecaram[0]!.turnoId))?.estado).toBe("interrompido");
    });
  });

  it("excluir e desfazer devolve a tarefa com o mesmo id; importar do Linear não duplica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const c = await m.lote({ ops: [{ tipo: "criar_quadro", meta: "M" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-1", titulo: "Um", url: "https://linear.app/gamefik/issue/NOD-1" }] }] });
      if (!c.data.ok) throw new Error(c.data.detalhe);
      const id = c.data.quadro!.tarefas[0]!.id;
      await m.lote({ ops: [{ tipo: "importar_linear", itens: [{ identificador: "nod-1", titulo: "Um (novo)" }, { identificador: "NOD-2", titulo: "Dois" }] }] });
      expect((await m.repos.quadros.tarefas(c.data.quadro!.id)).map((t) => [t.linearId, t.titulo])).toEqual([["NOD-1", "Um (novo)"], ["NOD-2", "Dois"]]);
      await m.lote({ ops: [{ tipo: "mudar_tarefa", tarefa: "NOD-1", excluir: true }] });
      expect(await m.repos.quadros.tarefa(id)).toBeNull();
      await m.lote({ ops: [{ tipo: "desfazer" }] });
      expect(await m.repos.quadros.tarefa(id)).toMatchObject({ id, titulo: "Um (novo)" });
    });
  });

  it("sem referência: o quadro do próprio bot, senão o único da pessoa; com dois, pede qual", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Limpa os quadros de outros testes que já tenham ficado no banco (cada teste roda sob rollback; isto é cinto).
      const antes = (await m.repos.quadros.listar()).length;
      await m.lote({ ops: [{ tipo: "criar_quadro", meta: "A" }] });
      const doBeto = await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, ops: [{ tipo: "criar_tarefa", titulo: "x" }] });
      if (antes === 0) expect(doBeto.data).toMatchObject({ ok: true, quadro: { meta: "A" } });
      await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, ops: [{ tipo: "criar_quadro", meta: "B" }] });
      const pessoa = await m.lote({ autor: { tipo: "pessoa" }, ops: [{ tipo: "criar_tarefa", titulo: "y" }] });
      expect(pessoa.data).toMatchObject({ ok: false, erro: "sem_quadro" });
      const proprio = await m.lote({ autor: { tipo: "agente", agenteId: m.beto.agenteId }, ops: [{ tipo: "criar_tarefa", titulo: "z" }] });
      expect(proprio.data).toMatchObject({ ok: true, quadro: { meta: "B" } });
    });
  });
});
