import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Transacao, Tx } from "../../src/shared/types.ts";
import { aplicarAtualizacaoRotina } from "../../src/use-cases/aplicar-proposta-rotina.ts";
import { ativarRotina } from "../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../src/use-cases/criar-rotina.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { executarRotinaAgora } from "../../src/use-cases/executar-rotina-agora.ts";
import { atualizarRotinaPeloAgente, listarRotinasDoAgente } from "../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsSobre, rotinaValida } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
// quinta 01/10/2026 09:00 em São Paulo; a rotina do Dev roda de 20 em 20 minutos.
const JANELA = Date.parse("2026-10-01T09:00:00-03:00");
const AGORA = JANELA + 30_000;
const SEGUINTE = "2026-10-01T12:20:00.000Z"; // 09:20 em São Paulo

/** O Dev 1, a conversa própria e a rotina de retomar trabalho (flag ligado por padrão neste arquivo). */
async function cenario(trx: Tx, soComPendencia = true) {
  const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/20 * * * *", fusoIana: TZ, instrucao: "retome o que ficou pela metade", fonte: "suas pendências", entregavel: "o trabalho retomado", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "encerre sem novidade", proximaExecucao: JANELA, soComPendencia });
  if (!rotina) throw new Error("rotina não criada");
  const pendencia = (texto: string, aPartirDe: number | null = null) => repos.pendencias.criar({ agenteId, conversaId, turnoId: null, texto, aPartirDe, cuidado: false, profundidade: 0 });
  return { agenteId, conversaId, deps, repos, rotina, pendencia };
}

const turnosDa = async (repos: Repos, conversaId: string) => (await repos.turnos.listarDaConversa(conversaId)).length;

/**
 * Item 7 da ADR-066 (0045): a rotina do Dev só acorda para retomar o que ele deixou pela metade. Sem pendência
 * visível (ADR-064) a janela agendada passa sem turno de modelo: uma execução 'sem_novidade'/'sem_pendencia', a
 * agenda anda, nada no chat. "Executar agora" da pessoa roda sempre.
 */
describeIntegracao("rotina só com pendência (item 7 da ADR-066)", () => {
  it("(a) com o flag e sem pendência: nenhum turno, UMA execução sem_novidade/sem_pendencia sem turno, reagenda, nada no chat; o tick separa da rotina comum", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const mensagensAntes = (await c.repos.mensagens.listarDaConversa(c.conversaId)).length;
      const r = await dispararRotina(c.deps, { rotina: c.rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher", aFazer: true });
      if (!("semPendencia" in r.data)) throw new Error(`deveria passar sem turno: ${JSON.stringify(r.data)}`);
      expect(new Date(r.data.proximaExecucao).toISOString()).toBe(SEGUINTE);
      expect(await turnosDa(c.repos, c.conversaId)).toBe(0);
      const execucoes = await c.repos.rotinaExecucoes.listar(c.rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId, e.instanteAgendado])).toEqual([["sem_novidade", "sem_pendencia", null, JANELA]]);
      expect(new Date((await c.repos.rotinas.buscar(c.rotina.id))?.proximaExecucao ?? 0).toISOString()).toBe(SEGUINTE);
      // A janela foi reivindicada (ADR-011 inalterado) e ficou sem turno, como a bloqueada.
      expect((await c.repos.rotinaJanelas.listar(c.rotina.id)).map((j) => [j.instanteAgendado, j.turnoId])).toEqual([[JANELA, null]]);
      expect((await c.repos.mensagens.listarDaConversa(c.conversaId)).length).toBe(mensagensAntes);
      // O evento é o da execução silenciosa: o frame 'rotina.executou' faz a web reler a lista e o histórico.
      expect(r.events?.map((e) => [e.kind, e.dados.rotinaId, e.dados.desfecho, e.dados.motivo])).toEqual([["rotina_executou", c.rotina.id, "sem_novidade", "sem_pendencia"]]);

      // Pelo agendador: a rotina com o flag cai em semPendencia e grava o evento no outbox; a comum dispara.
      const comum = await c.repos.rotinas.criar({ agenteId: c.agenteId, conversaId: c.conversaId, cron: "*/20 * * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA + 20 * 60_000 });
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: c.deps.services, useCases: c.deps.useCases, agora: () => JANELA + 20 * 60_000 + 30_000, aFazer: true };
      const tick = await tickPessoa(MARLON, tx, opcoes);
      expect(tick).toMatchObject({ disparadas: [comum?.id], semPendencia: [c.rotina.id], bloqueadas: [], falhas: [] });
      expect(await turnosDa(c.repos, c.conversaId)).toBe(1);
      const [outbox] = await trx<{ n: number }[]>`select count(*)::int as n from events where kind = 'rotina_executou' and dados->>'rotinaId' = ${c.rotina.id} and dados->>'motivo' = 'sem_pendencia'`;
      expect(outbox?.n).toBe(1);
      expect((await c.repos.rotinaExecucoes.listar(c.rotina.id)).map((e) => e.motivo)).toEqual(["sem_pendencia", "sem_pendencia"]);
    });
  });

  it("(b) com uma pendência visível: o turno de rotina normal nasce, ligado à janela, sem execução registrada ainda", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.pendencia("Retomar o PR #475 depois do parecer do Chico");
      const r = await dispararRotina(c.deps, { rotina: c.rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher", aFazer: true });
      if (!("turno" in r.data)) throw new Error(`deveria disparar: ${JSON.stringify(r.data)}`);
      expect(r.data.turno).toMatchObject({ origem: "rotina", estado: "pendente", agenteId: c.agenteId, profundidade: 0 });
      expect(new Date(r.data.proximaExecucao).toISOString()).toBe(SEGUINTE);
      expect((await c.repos.rotinaJanelas.listar(c.rotina.id)).map((j) => j.turnoId)).toEqual([r.data.turno.id]);
      expect(await c.repos.rotinaExecucoes.listar(c.rotina.id)).toEqual([]);
      expect(r.events?.map((e) => e.kind)).toEqual(["trabalho_mudou", "turno_criado"]);
    });
  });

  it("(c) pendência com a_partir_de no futuro e pendência já feita não contam: a janela passa sem turno; vencida a hora, conta", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.pendencia("Cobrar o Dev 2 às 10h", AGORA + 3_600_000);
      const feita = await c.pendencia("Ler as 13 tasks");
      await c.repos.pendencias.resolver(feita?.id ?? "", { estado: "feita", por: "bot", turnoId: null, motivo: "li todas", agora: AGORA });
      const r = await dispararRotina(c.deps, { rotina: c.rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher", aFazer: true });
      expect("semPendencia" in r.data).toBe(true);
      expect(await turnosDa(c.repos, c.conversaId)).toBe(0);

      // Às 10:00:30 a pendência das 10h já aparece para o bot: a janela das 10h vira turno.
      const dez = Date.parse("2026-10-01T10:00:00-03:00");
      const { deps } = depsSobre(trx, MARLON, { agora: () => dez + 30_000 });
      const rotina = await c.repos.rotinas.buscar(c.rotina.id);
      const r2 = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: dez, machineId: randomUUID(), executor: "catcher", aFazer: true });
      expect("turno" in r2.data).toBe(true);
    });
  });

  it("2026-10-06: com o \"A fazer\" desligado (sem aFazer) a rotina só com pendência não acorda nem com pendência visível", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      await c.pendencia("Retomar o PR #475 depois do parecer do Chico");
      const r = await dispararRotina(c.deps, { rotina: c.rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      expect("semPendencia" in r.data).toBe(true);
      expect(await turnosDa(c.repos, c.conversaId)).toBe(0);
    });
  });

  it("(d) 'Executar agora' da pessoa roda mesmo sem pendência e não mexe na agenda", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await executarRotinaAgora(c.deps, { rotinaId: c.rotina.id, executor: "catcher" });
      expect(r.data.turnoId).toBeTruthy();
      expect(r.data.bloqueio).toBeNull();
      expect(await turnosDa(c.repos, c.conversaId)).toBe(1);
      expect(await c.repos.rotinaExecucoes.listar(c.rotina.id)).toEqual([]);
      expect((await c.repos.rotinas.buscar(c.rotina.id))?.proximaExecucao).toBe(JANELA);
    });
  });

  it("(e) atualizar_rotina só com o flag vira proposta e, aplicada, liga; repetir o valor é entrada_invalida; desligar volta; listar mostra só quando ligado", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx, false);
      const turno = await c.repos.turnos.enfileirar({ executor: "catcher", conversaId: c.conversaId, agenteId: c.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "só acorde com pendência", entradaConfianca: "confiavel", modelo: "m" });
      const ctx = contexto(c.agenteId, c.conversaId, turno?.id);
      expect((await listarRotinasDoAgente(c.deps, ctx)).data.rotinas[0]).not.toHaveProperty("so_com_pendencia");

      const r = await atualizarRotinaPeloAgente(c.deps, { ...ctx, rotina_id: c.rotina.id, so_com_pendencia: true });
      if ("erro" in r.data) throw new Error(`erro inesperado: ${r.data.erro}`);
      expect((await c.repos.rotinas.buscar(c.rotina.id))?.soComPendencia).toBe(false);
      const proposta = await c.repos.propostas.buscar(r.data.proposta_id);
      expect(proposta).toMatchObject({ kind: "rotina_atualizacao", estado: "pendente", payload: { rotinaId: c.rotina.id, soComPendencia: true } });
      expect((await c.repos.decisoes.buscar(r.data.proposta_id))?.frase).toContain("passa a acordar só com pendência aberta");

      const aplicada = await aplicarAtualizacaoRotina(c.deps, { propostaId: r.data.proposta_id });
      expect(aplicada.data.rotina).toMatchObject({ soComPendencia: true, cron: "*/20 * * * *", instrucao: "retome o que ficou pela metade", fonte: "suas pendências" });
      const linha = (await c.repos.mensagens.listarDaConversa(c.conversaId)).find((m) => m.kind === "sistema" && m.texto.startsWith("Rotina atualizada."));
      expect(linha?.texto).toContain("Só acorda quando o bot tem pendência aberta");
      expect((await listarRotinasDoAgente(c.deps, ctx)).data.rotinas[0]).toMatchObject({ id: c.rotina.id, so_com_pendencia: true });

      expect((await atualizarRotinaPeloAgente(c.deps, { ...ctx, rotina_id: c.rotina.id, so_com_pendencia: true })).data).toEqual({ erro: "entrada_invalida" });

      // Mudar outro campo não desliga o flag (ausente no payload = fica como está).
      const instrucao = await atualizarRotinaPeloAgente(c.deps, { ...ctx, rotina_id: c.rotina.id, instrucao: "retome o PR mais antigo primeiro" });
      if ("erro" in instrucao.data) throw new Error(`erro inesperado: ${instrucao.data.erro}`);
      expect((await c.repos.propostas.buscar(instrucao.data.proposta_id))?.payload).not.toHaveProperty("soComPendencia");
      expect((await aplicarAtualizacaoRotina(c.deps, { propostaId: instrucao.data.proposta_id })).data.rotina).toMatchObject({ soComPendencia: true, instrucao: "retome o PR mais antigo primeiro" });

      const desliga = await atualizarRotinaPeloAgente(c.deps, { ...ctx, rotina_id: c.rotina.id, so_com_pendencia: false });
      if ("erro" in desliga.data) throw new Error(`erro inesperado: ${desliga.data.erro}`);
      expect((await c.repos.decisoes.buscar(desliga.data.proposta_id))?.frase).toContain("volta a acordar em toda janela");
      expect((await aplicarAtualizacaoRotina(c.deps, { propostaId: desliga.data.proposta_id })).data.rotina.soComPendencia).toBe(false);
    });
  });

  it("criar_rotina leva o flag pela proposta até a rotina; sem ele, a coluna nasce false (DEFAULT da 0045)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 2" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "crie a rotina", entradaConfianca: "confiavel", modelo: "m" });
      const ctx = contexto(agenteId, conversaId, turno?.id);
      const com = await criarRotina(deps, { ...ctx, ...rotinaValida({ cron: "*/20 * * * *" }), so_com_pendencia: true });
      if ("erro" in com.data) throw new Error(`erro inesperado: ${com.data.erro}`);
      expect((await repos.propostas.buscar(com.data.proposta_id))?.payload).toMatchObject({ kind: "rotina", soComPendencia: true });
      expect((await ativarRotina(deps, { propostaId: com.data.proposta_id })).data.rotina.soComPendencia).toBe(true);
      const sem = await criarRotina(deps, { ...ctx, ...rotinaValida() });
      if ("erro" in sem.data) throw new Error(`erro inesperado: ${sem.data.erro}`);
      expect((await repos.propostas.buscar(sem.data.proposta_id))?.payload).not.toHaveProperty("soComPendencia");
      expect((await ativarRotina(deps, { propostaId: sem.data.proposta_id })).data.rotina.soComPendencia).toBe(false);
      const [coluna] = await trx<{ column_default: string; is_nullable: string }[]>`
        select column_default, is_nullable from information_schema.columns where table_name = 'rotinas' and column_name = 'so_com_pendencia'`;
      expect(coluna).toEqual({ column_default: "false", is_nullable: "NO" });
    });
  });
});
