import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { EXECUCOES_GUARDADAS } from "../../src/shared/constantes.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");

describeIntegracao("scheduler de rotina (ADR-011): relógio injetado, uma janela + um turno por tick, sem duplicar; 21 execuções → 20", () => {
  it("tick com a rotina vencida cria UMA janela e UM turno e reagenda; o tick seguinte não duplica; rotina pausada e futura ficam de fora", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON);
      const vencida = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const pausada = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA, estado: "pausada" });
      const futura = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 9 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA + 3_600_000 });
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => JANELA + 30_000 };
      const tx: Transacao = (fn) => fn(trx);

      const r1 = await tickPessoa(MARLON, tx, opcoes);
      expect(r1).toEqual({ disparadas: [vencida?.id], deOutroProcesso: [], falhas: [] });
      const janelas = await repos.rotinaJanelas.listar(vencida?.id ?? "");
      expect(janelas).toHaveLength(1);
      expect(janelas[0]).toMatchObject({ instanteAgendado: JANELA, machineId: opcoes.machineId, executor: "catcher" });
      const turnos = await repos.turnos.listarDaConversa(conversaId);
      expect(turnos.map((t) => [t.id, t.origem, t.estado])).toEqual([[janelas[0]?.turnoId, "rotina", "pendente"]]);
      expect(new Date((await repos.rotinas.buscar(vencida?.id ?? ""))?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-18T11:00:00.000Z");
      expect((await repos.rotinaJanelas.listar(pausada?.id ?? "")).length + (await repos.rotinaJanelas.listar(futura?.id ?? "")).length).toBe(0);
      const kinds = await trx<{ kind: string }[]>`select kind from events where conversa_id = ${conversaId}`;
      expect(kinds.map((k) => k.kind)).toEqual(["turno_criado"]);

      const r2 = await tickPessoa(MARLON, tx, opcoes);
      expect(r2).toEqual({ disparadas: [], deOutroProcesso: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(vencida?.id ?? "")).toHaveLength(1);
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);

      // Uma janela já reivindicada por outro processo: false, silencioso, sem turno novo.
      await repos.rotinas.reagendar(vencida?.id ?? "", JANELA);
      const r3 = await tickPessoa(MARLON, tx, opcoes);
      expect(r3).toEqual({ disparadas: [], deOutroProcesso: [vencida?.id], falhas: [] });
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);
    });
  });

  it("21 execuções registradas → ficam as 20 mais recentes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      let relogio = JANELA + 30_000;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const tx: Transacao = (fn) => fn(trx);
      const r = await tickPessoa(MARLON, tx, { machineId: randomUUID(), executor: "catcher", services: deps.services, useCases: deps.useCases, agora: () => relogio });
      const turnoId = (await repos.rotinaJanelas.listar(rotina?.id ?? ""))[0]?.turnoId ?? "";
      expect(r.disparadas).toEqual([rotina?.id]);
      for (let i = 0; i < EXECUCOES_GUARDADAS + 1; i++) {
        relogio += 1_000;
        const d = await registrarDesfechoRotina(deps, { turnoId, desfecho: "executou" });
        if (!("execucao" in d.data)) throw new Error("deveria registrar");
      }
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "", 100);
      expect(execucoes).toHaveLength(EXECUCOES_GUARDADAS);
      expect(execucoes[0]?.em).toBe(relogio);
    });
  });
});
