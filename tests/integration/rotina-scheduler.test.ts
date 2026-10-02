import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { tickPessoa } from "../../src/adapters/fundo/scheduler-rotina.ts";
import { EXECUCOES_GUARDADAS } from "../../src/shared/constantes.ts";
import type { Transacao } from "../../src/shared/types.ts";
import { registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
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
      expect(r1).toEqual({ disparadas: [vencida?.id], deOutroProcesso: [], puladas: [], bloqueadas: [], falhas: [] });
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
      expect(r2).toEqual({ disparadas: [], deOutroProcesso: [], puladas: [], bloqueadas: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(vencida?.id ?? "")).toHaveLength(1);
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);

      // ADR-045: o turno da janela ainda está pendente (o Mac dormiu) → a janela vencida de novo é
      // PULADA: só reagenda, sem reivindicar nem enfileirar — as execuções não se empilham. (A das 9h
      // fica de fora: no dia seguinte ela também venceria.)
      await repos.rotinas.atualizarEstado(futura?.id ?? "", "pausada");
      await repos.rotinas.reagendar(vencida?.id ?? "", JANELA + 86_400_000);
      const pulada = await tickPessoa(MARLON, tx, { ...opcoes, agora: () => JANELA + 86_400_000 + 30_000 });
      expect(pulada).toEqual({ disparadas: [], deOutroProcesso: [], puladas: [vencida?.id], bloqueadas: [], falhas: [] });
      expect(await repos.rotinaJanelas.listar(vencida?.id ?? "")).toHaveLength(1);
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);
      expect(new Date((await repos.rotinas.buscar(vencida?.id ?? ""))?.proximaExecucao ?? 0).toISOString()).toBe("2026-09-21T11:00:00.000Z");

      // Uma janela já reivindicada por outro processo (com o turno dela já terminado): false, silencioso, sem turno novo.
      await repos.turnos.assentar(janelas[0]?.turnoId ?? "", { estado: "concluido" });
      await repos.rotinas.reagendar(vencida?.id ?? "", JANELA);
      const r3 = await tickPessoa(MARLON, tx, opcoes);
      expect(r3).toEqual({ disparadas: [], deOutroProcesso: [vencida?.id], puladas: [], bloqueadas: [], falhas: [] });
      expect(await repos.turnos.listarDaConversa(conversaId)).toHaveLength(1);
    });
  });

  it("21 execuções registradas → ficam as 20 mais recentes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      let relogio = JANELA + 30_000;
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      // A cada 5 min: 21 janelas de verdade, cada uma com o seu turno (ADR-045: uma linha POR JANELA — o
      // caso antigo registrava 21 desfechos no mesmo turno, que agora são uma linha só).
      const rotina = await repos.rotinas.criar({ agenteId, conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: JANELA });
      const tx: Transacao = (fn) => fn(trx);
      const opcoes = { machineId: randomUUID(), executor: "catcher" as const, services: deps.services, useCases: deps.useCases, agora: () => relogio };
      for (let i = 0; i < EXECUCOES_GUARDADAS + 1; i++) {
        const r = await tickPessoa(MARLON, tx, opcoes);
        expect(r.disparadas).toEqual([rotina?.id]);
        const janela = (await repos.rotinaJanelas.listar(rotina?.id ?? "")).at(-1);
        const d = await registrarDesfechoRotina(deps, { turnoId: janela?.turnoId ?? "", desfecho: "executou" });
        if (!("execucao" in d.data)) throw new Error("deveria registrar");
        await repos.turnos.assentar(janela?.turnoId ?? "", { estado: "concluido" });
        relogio += 5 * 60_000;
      }
      expect(await repos.rotinaJanelas.listar(rotina?.id ?? "")).toHaveLength(EXECUCOES_GUARDADAS + 1);
      const execucoes = await repos.rotinaExecucoes.listar(rotina?.id ?? "", 100);
      expect(execucoes).toHaveLength(EXECUCOES_GUARDADAS);
      expect(execucoes[0]?.em).toBe(relogio - 5 * 60_000);
    });
  });
});
