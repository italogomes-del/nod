import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, entradaDaVoltaDaCota } from "../../src/domain/cota-da-ia.ts";
import { INTELIGENCIA_PADRAO } from "../../src/domain/inteligencia.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { definirInteligenciaDoBot } from "../../src/use-cases/inteligencia.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0080 (ADR-108): os avisos de troca de IA no Postgres — um aberto por bot (índice único parcial), o fechar condicional,
 * o "levar" que só mexe nas tasks pendentes do bot na IA que parou, o `levarTasks` do PUT da inteligência, a conta nova
 * na fila e a guarda E1 do despacho.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const HORA = 3_600_000;
const pronto: Inventario = { estado: "pronto", versao: "2.1.296", em: AGORA };
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string, corporativa = false): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa, logadaEm: AGORA - 60_000, apelidoSugerido: apelido });

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
  await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, inteligencia: INTELIGENCIA_PADRAO });
  const agora = () => AGORA;
  const deps = depsSobre(repos, MARLON, { agora, trx });
  /** Uma task com a sessão no Claude e um turno pendente dela. */
  const task = async (o: { sessao?: "claude-cli" | null; agente?: string; conversa?: string; entrada?: string; acordarEm?: number | null; harness?: PreferenciaHarness } = {}) => {
    const t = await repos.trabalhos.criar({ agenteId: o.agente ?? agenteId, conversaId: o.conversa ?? conversaId, titulo: "A1", origem: "pessoa", rotinaId: null, forma: "frente" });
    if (o.sessao !== null) await repos.trabalhos.atualizarSessao(t!.id, "sessao-1", o.sessao ?? "claude-cli", "local");
    const turno = await repos.turnos.enfileirar({ executor: "local", conversaId: o.conversa ?? conversaId, agenteId: o.agente ?? agenteId, origem: "retomada", prazoEm: AGORA + 86_400_000, profundidade: 0, entradaTexto: o.entrada ?? entradaDaVoltaDaCota("Claude Code"), entradaConfianca: "confiavel", modelo: "auto", harness: o.harness ?? "auto", trabalhoId: t!.id, acordarEm: o.acordarEm === undefined ? AGORA + HORA : o.acordarEm });
    return { trabalhoId: t!.id, turnoId: turno!.id };
  };
  return { repos, deps, agenteId, conversaId, task };
}

describeIntegracao("trocas de IA (0080, ADR-108)", () => {
  it("um aviso aberto por bot: abrir de novo atualiza o mesmo; o fechar é condicional (o segundo não fecha); fechado, nasce outro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const nova = { agenteId: m.agenteId, conversaId: m.conversaId, iaDe: "claude-cli" as const, iaPara: "codex-cli" as const, recomendacao: "levar" as const, voltaEm: AGORA + 16 * HORA, aplicarEm: AGORA + 600_000, fixo: false, agora: AGORA };
      const a = await m.repos.trocasDeIa.abrir(nova);
      expect(a.nova).toBe(true);
      const b = await m.repos.trocasDeIa.abrir({ ...nova, voltaEm: AGORA + 17 * HORA, aplicarEm: AGORA + 900_000, agora: AGORA + 60_000 });
      expect(b.nova).toBe(false);
      expect(b.troca.id).toBe(a.troca.id);
      // O prazo do "levar" não recomeça com a segunda task.
      expect(b.troca).toMatchObject({ voltaEm: AGORA + 17 * HORA, aplicarEm: AGORA + 600_000 });
      // Virou "esperar": sem prazo.
      expect((await m.repos.trocasDeIa.abrir({ ...nova, recomendacao: "esperar", aplicarEm: null })).troca.aplicarEm).toBeNull();
      expect(await m.repos.trocasDeIa.fechar(a.troca.id, "esperar", AGORA)).toMatchObject({ decisao: "esperar" });
      expect(await m.repos.trocasDeIa.fechar(a.troca.id, "levar", AGORA)).toBeNull();
      expect(await m.repos.trocasDeIa.abertaDoAgente(m.agenteId)).toBeNull();
      const c = await m.repos.trocasDeIa.abrir(nova);
      expect(c.nova).toBe(true);
      expect(c.troca.id).not.toBe(a.troca.id);
      // O índice único parcial barra um segundo aberto escrito por fora do `abrir`.
      await expect(trx.savepoint((s) => s`insert into trocas_de_ia (tenant_id, owner_id, agente_id, conversa_id, ia_de, recomendacao) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${m.agenteId}, ${m.conversaId}, 'claude-cli', 'esperar')`)).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("volta_ao_fixo vai com o fechar e a restauração acontece uma vez; paraVarrer vê abertos e os que ainda devolvem o fixo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const { troca } = await m.repos.trocasDeIa.abrir({ agenteId: m.agenteId, conversaId: m.conversaId, iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", voltaEm: null, aplicarEm: null, fixo: true, agora: AGORA });
      const fixa = { ...INTELIGENCIA_PADRAO, modo: "fixa" as const, fixa: "claude-cli" as const };
      expect((await m.repos.trocasDeIa.fechar(troca.id, "outra_ia", AGORA, fixa))?.voltaAoFixo).toEqual(fixa);
      expect((await m.repos.trocasDeIa.paraVarrer()).map((t) => t.id)).toEqual([troca.id]);
      expect(await m.repos.trocasDeIa.marcarRestaurada(troca.id, AGORA)).toBe(true);
      expect(await m.repos.trocasDeIa.marcarRestaurada(troca.id, AGORA)).toBe(false);
      expect(await m.repos.trocasDeIa.paraVarrer()).toEqual([]);
    });
  });

  it("'levar' reescreve só os pendentes do bot com trabalho na IA que parou e só zera acordar_em das esperas da cota", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const cota = await m.task();
      const meChame = await m.task({ entrada: "[nod] Você pediu para ser chamado às 16:00.", acordarEm: AGORA + 5 * HORA });
      const fixoNoClaude = await m.task({ sessao: null, harness: "claude-cli" });
      const semSessao = await m.task({ sessao: null });
      const conversa = await m.repos.turnos.enfileirar({ executor: "local", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "claude-cli" });
      const outro = await agenteComConversa(trx, MARLON, { nome: "Outro" });
      const doOutro = await m.task({ agente: outro.agenteId, conversa: outro.conversaId });
      expect(await m.repos.turnos.contarTasksNaIa(m.agenteId, "claude-cli")).toBe(3);
      const ids = await m.repos.turnos.levarTasksDoBot({ agenteId: m.agenteId, iaDe: "claude-cli", harness: "codex-cli", modelo: "auto", entradaDaVolta: `${ENTRADA_DA_VOLTA_DA_COTA}Claude Code … passou este trabalho para o Codex.` });
      expect(ids.sort()).toEqual([cota.turnoId, meChame.turnoId, fixoNoClaude.turnoId].sort());
      const ver = async (id: string) => (await m.repos.turnos.buscar(id))!;
      expect(await ver(cota.turnoId)).toMatchObject({ harness: "codex-cli", modelo: "auto", acordarEm: null });
      expect((await ver(cota.turnoId)).entradaTexto).toMatch(/passou este trabalho para o Codex/);
      expect(await ver(meChame.turnoId)).toMatchObject({ harness: "codex-cli", acordarEm: AGORA + 5 * HORA, entradaTexto: "[nod] Você pediu para ser chamado às 16:00." });
      expect(await ver(semSessao.turnoId)).toMatchObject({ harness: "auto", acordarEm: AGORA + HORA });
      expect(await ver(conversa!.id)).toMatchObject({ harness: "claude-cli" });
      expect(await ver(doOutro.turnoId)).toMatchObject({ harness: "auto", acordarEm: AGORA + HORA });
      // acordar as esperas da cota (R6 a / voltou): só as da cota, do bot.
      const outraCota = await m.task();
      expect(await m.repos.turnos.acordarEsperasDaCota(m.agenteId, "claude-cli")).toBe(1);
      expect(await ver(outraCota.turnoId)).toMatchObject({ acordarEm: null, harness: "auto" });
    });
  });

  it("PUT inteligência com levarTasks: true leva as tasks; sem ele, só daqui em diante", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.task();
      await definirInteligenciaDoBot(m.deps, { agenteId: m.agenteId, pedido: { modo: "fixa", fixa: "codex-cli" } });
      expect(await m.repos.turnos.buscar(t.turnoId)).toMatchObject({ harness: "auto", acordarEm: AGORA + HORA });
      const r = await definirInteligenciaDoBot(m.deps, { agenteId: m.agenteId, pedido: { modo: "fixa", fixa: "codex-cli", levarTasks: true } });
      expect(r.data.tasksLevadas).toBe(1);
      expect(await m.repos.turnos.buscar(t.turnoId)).toMatchObject({ harness: "codex-cli", acordarEm: null });
    });
  });

  it("conta nova (ADR-108): a 1ª pessoal de cada IA nasce na fila; a 2ª do Claude e a corporativa nascem fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const vm = (await m.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      await m.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Leapy", true), anuncio(2, "claude-cli", "Pessoal"), anuncio(3, "codex-cli", "Pessoal"), anuncio(4, "claude-cli", "Reserva")], AGORA);
      expect((await m.repos.contasIa.listar()).contas.map((c) => [c.apelido, c.ia, c.entraNaTrocaAutomatica])).toEqual([
        ["Leapy", "claude-cli", false], ["Pessoal", "claude-cli", true], ["Pessoal", "codex-cli", true], ["Reserva", "claude-cli", false],
      ]);
    });
  });

  it("E1: a task do Automático com sessão no Claude sem conta do Claude utilizável não sai no Codex — volta a esperar e o aviso nasce", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.inventario.registrar("claude-cli", pronto);
      const vm = (await m.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) }))!.id;
      await m.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal")], AGORA);
      const [cPessoal] = (await m.repos.contasIa.listar()).contas;
      await m.repos.contasIa.marcarLimite(cPessoal!.id, AGORA + 2 * HORA);
      const t = await m.task({ entrada: "faz a A1", acordarEm: null });
      const r = await despacharTurno(m.deps, { machineId: vm, executor: "local", inventario: pronto, harnessesProntos: ["claude-cli", "codex-cli"] });
      expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await m.repos.turnos.buscar(t.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
      const volta = (await m.repos.turnos.doTrabalho(t.trabalhoId)).find((x) => x.retomaTurnoId === t.turnoId);
      expect(volta).toMatchObject({ estado: "pendente", acordarEm: AGORA + 2 * HORA, harness: "auto" });
      expect(await m.repos.trocasDeIa.abertaDoAgente(m.agenteId)).toMatchObject({ iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "levar" });
      const linha = (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "troca_de_ia");
      expect(linha?.payload).toMatchObject({ kind: "troca_de_ia", tasks: 1, agenteId: m.agenteId });
    });
  });
});
