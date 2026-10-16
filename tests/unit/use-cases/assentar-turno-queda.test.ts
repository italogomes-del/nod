import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { LEASE_MS } from "../../../src/shared/constantes.ts";
import { assentarTurno, REGRA_ENTREGA_TARDIA } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { interromperPorMaquina } from "../../../src/use-cases/interromper-por-maquina.ts";
import { enfileirarRetomada } from "../../../src/use-cases/enfileirar-retomada.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.parse("2026-09-24T03:10:00-03:00");
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const base = { sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
const cortado: ResultadoTurno = { ...base, desfecho: "interrompido", texto: "Vou verificar seus e-mails" };
const pronto: ResultadoTurno = { ...base, desfecho: "sucesso", texto: "Resumo: 3 e-mails novos." };

/**
 * ADR-045: o Mac dormiu no meio do turno; ao acordar a renovação volta {ativo:false} (lease vencido), o
 * laço mata o CLI e ENTREGA antes de o varredor passar. Essa entrega termina igual ao varredor.
 */
async function cenario(tipo: "rotina" | "conversa") {
  let agora = T0;
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" });
  let turnoId: string;
  let rotinaId: string | null = null;
  if (tipo === "rotina") {
    const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "*/30 * * * *", fusoIana: "UTC", instrucao: "e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: T0 });
    const r = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: T0, machineId: "m", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("sem turno");
    turnoId = r.data.turno.id;
    rotinaId = rotina!.id;
  } else {
    const t = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "resume meus e-mails", entradaConfianca: "confiavel", modelo: "m" });
    turnoId = t!.id;
  }
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (resultado: ResultadoTurno) => executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado });
  const passar = (ms: number) => {
    agora = T0 + ms;
  };
  return { deps, banco, bot, turnoId, rotinaId, antes, entregar, passar };
}

describe("assentarTurno: entrega depois de o Mac cair (ADR-045)", () => {
  it("rotina: lease vencido e entrega cortada → interrompida no histórico, NADA na conversa (nem a fala), sem decisão, UM aviso", async () => {
    const c = await cenario("rotina");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(cortado);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    expect(c.banco.mensagens).toHaveLength(c.antes);
    expect(c.banco.decisoes).toEqual([]);
    expect(c.banco.execucoes.map((e) => [e.rotinaId, e.desfecho, e.motivo])).toEqual([[c.rotinaId, "interrompida", "maquina_sem_contato"]]);
    expect(c.banco.incidentes).toMatchObject([{ rotinas: 1, conversas: 0, comecouEm: T0, voltouEm: T0 + LEASE_MS + 20_000 }]);
    expect(r.events.filter((e) => e.kind === "turno_interrompido")).toHaveLength(1);
  });

  it("conversa: lease vencido e entrega cortada → fala parcial, UMA linha de sistema com o Mac e UM Retomar (não duas linhas)", async () => {
    const c = await cenario("conversa");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(cortado);
    expect(r.data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => [m.kind, m.parcial])).toEqual([["texto", true], ["sistema", false]]);
    expect(novas[1]?.texto).toContain("seu Mac parou de responder");
    expect(c.banco.decisoes.map((d) => [d.tipo, d.turnoId])).toEqual([["retomar_turno", c.turnoId]]);
    expect(c.banco.incidentes).toMatchObject([{ rotinas: 0, conversas: 1 }]);
    expect(r.events.filter((e) => e.kind === "turno_interrompido")).toHaveLength(1);
  });

  it("sucesso depois do lease vencido é trabalho terminado: concluído, com a fala, sem aviso", async () => {
    const c = await cenario("rotina");
    c.passar(LEASE_MS + 20_000);
    const r = await c.entregar(pronto);
    expect(r.data.turno).toMatchObject({ estado: "concluido" });
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.texto)).toEqual(["Resumo: 3 e-mails novos."]);
    expect(c.banco.incidentes).toEqual([]);
  });

  it("entrega TARDIA de rotina já derrubada pelo varredor: a fala cortada não entra; o sucesso tardio entra (o entregável não se perde)", async () => {
    const cortada = await cenario("rotina");
    cortada.passar(LEASE_MS + 20_000);
    const [vencido] = await cortada.deps.repos.turnos.vencidos(cortada.deps.agora());
    await interromperPorMaquina(cortada.deps, { turnos: [vencido!] });
    const tardia = await cortada.entregar(cortado);
    expect(tardia.data.tardia).toBe(true);
    expect(cortada.banco.mensagens).toHaveLength(cortada.antes);
    expect(cortada.banco.execucoes).toHaveLength(1);

    // NOD-264 (E8): sem retomada criada, o sucesso tardio conclui o turno e a fala entra inteira.
    const pronta = await cenario("rotina");
    pronta.passar(LEASE_MS + 20_000);
    const [outro] = await pronta.deps.repos.turnos.vencidos(pronta.deps.agora());
    await interromperPorMaquina(pronta.deps, { turnos: [outro!] });
    const r = await pronta.entregar(pronto);
    expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido", motivoInterrupcao: null } });
    expect(pronta.banco.mensagens.slice(pronta.antes).map((m) => [m.texto, m.parcial])).toEqual([["Resumo: 3 e-mails novos.", false]]);
  });

  describe("NOD-264 (E8): sucesso tardio depois da queda", () => {
    it("conversa sem retomada: concluído, fala inteira e o Retomar fecha por entrega_tardia_com_sucesso", async () => {
      const c = await cenario("conversa");
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      expect(c.banco.decisoes.map((d) => [d.tipo, d.estado])).toEqual([["retomar_turno", "pendente"]]);
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "concluido" } });
      expect(c.banco.mensagens.slice(c.antes).filter((m) => m.kind === "texto").map((m) => [m.texto, m.parcial])).toEqual([["Resumo: 3 e-mails novos.", false]]);
      expect(c.banco.decisoes.map((d) => [d.tipo, d.estado, d.desfecho])).toEqual([["retomar_turno", "decidida", expect.objectContaining({ tipo: "decidida_por_regra", regra: REGRA_ENTREGA_TARDIA })]]);
      expect(r.events.filter((e) => e.kind === "decisao_decidida").map((e) => e.dados.regra)).toEqual([REGRA_ENTREGA_TARDIA]);
      expect(r.events.filter((e) => e.kind === "turno_encerrado")).toHaveLength(1);
    });

    it("com retomada já na fila: fica como hoje — turno interrompido, fala parcial, retomada intacta", async () => {
      const c = await cenario("conversa");
      c.passar(LEASE_MS + 20_000);
      const [vencido] = await c.deps.repos.turnos.vencidos(c.deps.agora());
      await interromperPorMaquina(c.deps, { turnos: [vencido!] });
      const original = await c.deps.repos.turnos.buscar(c.turnoId);
      const retomada = await enfileirarRetomada(c.deps, { original: original!, prazoEm: c.deps.agora() + 86_400_000, entradaTexto: "continue", reenvios: 1 });
      expect(retomada.turno).not.toBeNull();
      const r = await c.entregar(pronto);
      expect(r.data).toMatchObject({ tardia: true, turno: { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" } });
      expect(c.banco.mensagens.slice(c.antes).filter((m) => m.kind === "texto").map((m) => m.parcial)).toEqual([true]);
      expect((await c.deps.repos.turnos.buscar(retomada.turno!.id))?.estado).toBe("pendente");
    });
  });
});
