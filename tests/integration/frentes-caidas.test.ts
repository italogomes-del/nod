import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import { MAX_QUEDAS_POR_PEDIDO, RETOMAR_ATE_MS } from "../../src/domain/pedido-parado.ts";
import { PERGUNTA_DA_QUEDA } from "../../src/domain/retorno-do-lote.ts";
import { cuidarDasFrentesCaidas, REGRA_FRENTE_CAIU } from "../../src/use-cases/frentes-caidas.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O varredor da ADR-084 cobre as frentes de lote (definido em 2026-10-12, ADR-099 itens 5 e 8, I9). Em 11/10 de manhã,
 * 14 tasks do Ze 1 caíram com a VM sem memória e ficaram esperando alguém apertar "Retomar". Agora a frente que cai por
 * infraestrutura volta sozinha quando as máquinas voltam; na terceira queda ela fecha `falhou`, o lote fecha e o dono
 * acorda com o motivo para perguntar à pessoa como seguir.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turnoDaConversa = async (texto = "conserte o login e a CI") =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const abrir = async (dono: Turno) => {
    const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login." }, { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." }] });
    if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
    return { loteId: r.data.lote_id, ids: r.data.frentes.map((f) => f.trabalho_id) };
  };
  /** O turno aberto mais novo da frente (o primeiro, ou a retomada). */
  const turnoVivo = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId)).filter((t) => t.estado === "pendente" || t.estado === "despachando").at(-1)!;
  /** A queda como o varredor de lease a deixa: interrompido por máquina sem contato, o card "Retomar" e a frente relida. */
  const cair = async (trabalhoId: string) => {
    const t = await turnoVivo(trabalhoId);
    await repos.turnos.interromper(t.id, "maquina_sem_contato");
    const card = await repos.decisoes.criar({ tipo: "retomar_turno", agenteId: t.agenteId, conversaId: t.conversaId, turnoId: t.id, prazoDecisaoEm: Date.now() + 86_400_000, frase: "O turno parou." });
    await sincronizarTrabalho(deps, trabalhoId);
    return { turno: t, card: card! };
  };
  /** Um turno da pessoa conclui depois da queda: as máquinas voltaram. */
  const sinalDeVida = async () => repos.turnos.assentar((await turnoDaConversa("oi")).id, { estado: "concluido" });
  const terminar = async (trabalhoId: string, feito: string) => {
    const t = await turnoVivo(trabalhoId);
    await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito });
    await repos.turnos.assentar(t.id, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  const retomadasDoDono = async (dono: Turno) => (await repos.turnos.listarDaConversa(dono.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === dono.id);
  const estado = async (id: string) => (await repos.trabalhos.buscar(id))?.estado;
  return { ada, deps, repos, turnoDaConversa, abrir, cair, sinalDeVida, terminar, retomadasDoDono, estado, turnoVivo };
}

describeIntegracao("frentes de lote que caem: o varredor retoma e, na 3ª queda, o dono pergunta (ADR-099, I9)", () => {
  it("cai 3 vezes → 2 retomadas sozinhas → a frente fecha falhou, o lote fecha e o dono acorda com o motivo e a pergunta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [login, ci] = ids as [string, string];
      await m.terminar(login, "Login corrigido");

      for (let queda = 1; queda < MAX_QUEDAS_POR_PEDIDO; queda++) {
        const { card } = await m.cair(ci);
        expect(await m.estado(ci)).toBe("precisa_de_voce");
        // Sem sinal de que as máquinas voltaram: espera.
        expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
        await m.sinalDeVida();
        expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [ci], fechadas: [] });
        expect(await m.estado(ci)).toBe("rodando");
        expect((await m.repos.decisoes.buscar(card.id))?.estado).not.toBe("pendente");
        const retomada = await m.turnoVivo(ci);
        expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: ci, estado: "pendente" });
        expect(retomada.entradaTexto).toContain("devolver_resumo");
        const aviso = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.turnoId === retomada.id && x.kind === "sistema");
        expect(aviso).toHaveLength(1);
        expect(aviso[0]!.texto).toMatch(new RegExp(`^A frente CI vermelha caiu \\(.+\\) e foi retomada sozinha quando as máquinas voltaram: tentativa ${queda + 1} de ${MAX_QUEDAS_POR_PEDIDO}\\.$`));
        // Nenhum retorno ao dono enquanto a frente segue retomável.
        expect(await m.retomadasDoDono(dono)).toHaveLength(0);
      }

      const { card } = await m.cair(ci);
      await m.sinalDeVida();
      const r = await cuidarDasFrentesCaidas(m.deps);
      expect(r.data).toEqual({ retomadas: [], fechadas: [ci] });
      expect(await m.estado(ci)).toBe("falhou");
      expect(await m.repos.decisoes.buscar(card.id)).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_FRENTE_CAIU } });
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).not.toBeNull();

      const [retorno, ...mais] = await m.retomadasDoDono(dono);
      expect(mais).toHaveLength(0);
      expect(retorno).toMatchObject({ estado: "pendente", trabalhoId: null });
      expect(retorno!.entradaTexto).toContain(PERGUNTA_DA_QUEDA);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json.map((f) => [f.titulo, f.estado])).toEqual([["Login no Safari", "terminado"], ["CI vermelha", "falhou"]]);
      expect(json[1]!.motivo).toMatch(/\(caiu 3 vezes\)$/);
      expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["decisao_decidida", "trabalho_mudou", "turno_criado"]));

      // Idempotente: a frente fechada sai da consulta.
      expect((await cuidarDasFrentesCaidas(m.deps)).data).toEqual({ retomadas: [], fechadas: [] });
    });
  });

  it("a frente que cai de vez com outras ainda rodando: o dono acorda na hora só com ela; o lote fecha quando a última acaba", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });
      const [login, ci] = ids as [string, string];
      // Caiu e as máquinas não voltaram em 30 min: o varredor desiste já na primeira queda.
      await m.cair(ci);
      const depois = { ...m.deps, agora: () => Date.now() + 31 * 60_000 };
      expect((await cuidarDasFrentesCaidas(depois)).data).toEqual({ retomadas: [], fechadas: [ci] });
      const [agora] = await m.retomadasDoDono(dono);
      expect(agora!.entradaTexto).toContain('A frente "CI vermelha" deste pedido caiu; falta 1.');
      expect(agora!.entradaTexto).toContain(PERGUNTA_DA_QUEDA);
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();

      await m.terminar(login, "Login corrigido");
      const retornos = await m.retomadasDoDono(dono);
      expect(retornos).toHaveLength(2);
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId).toBe(retornos[1]!.id);
    });
  });

  it("queda velha (mais de 2 h) não retoma; frente sem lote (a task de antes) fica com a pessoa, como hoje", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono);
      const [login, ci] = ids as [string, string];
      // Frente sem lote: o "Retomar" continua só da pessoa.
      await trx`update trabalhos set lote_id = null where id = ${login}`;
      await m.cair(login);
      await m.cair(ci);
      await m.sinalDeVida();
      const tarde = { ...m.deps, agora: () => Date.now() + RETOMAR_ATE_MS + 60_000 };
      expect((await cuidarDasFrentesCaidas(tarde)).data).toEqual({ retomadas: [], fechadas: [ci] });
      expect(await m.estado(login)).toBe("precisa_de_voce");
      expect(await m.estado(ci)).toBe("falhou");
    });
  });
});
