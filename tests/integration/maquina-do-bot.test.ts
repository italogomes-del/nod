import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-090: onde o bot trabalha. O `reivindicar` só entrega o turno à máquina do bot (ou ao padrão da pessoa, ou à
 * máquina "desta vez"), e uma chave que não vale mais (revogada, que nunca existiu) vale como "qualquer máquina": a fila
 * nunca prende um turno numa máquina que não pode aparecer.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ze" });
  const { repos } = depsSobre(trx, MARLON);
  const chave = async (nome: string) => {
    const c = await repos.maquinaTokens.criar({ nome, prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    if (!c) throw new Error("chave");
    return c.id;
  };
  const mac = await chave("MacBook");
  const vm = await chave("vm-sp");
  const enfileirar = async () => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "roda os testes", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: null });
    if (!t) throw new Error("turno");
    return t;
  };
  const puxar = (machineId: string) => repos.turnos.reivindicar({ machineId, agora: Date.now() });
  return { ...base, repos, mac, vm, enfileirar, puxar };
}

describeIntegracao("onde o bot trabalha (ADR-090)", () => {
  it("bot preso à VM: o Mac não leva o turno, a VM leva", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect(await m.repos.agentes.definirMaquina([m.agenteId], m.vm)).toHaveLength(1);
      const t = await m.enfileirar();
      expect(await m.puxar(m.mac)).toBeNull();
      const levado = await m.puxar(m.vm);
      expect(levado?.id).toBe(t.id);
      expect(levado?.machineId).toBe(m.vm);
    });
  });

  it("sem máquina no bot vale o padrão da pessoa; sem padrão, qualquer máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.definirMaquinaPadrao(m.vm);
      const t = await m.enfileirar();
      expect(await m.puxar(m.mac)).toBeNull();
      expect((await m.puxar(m.vm))?.id).toBe(t.id);

      await m.repos.preferencias.definirMaquinaPadrao(null);
      const t2 = await m.enfileirar();
      // A conversa serializa: o primeiro turno ainda está despachando, então o segundo espera. Termina o primeiro.
      await m.repos.turnos.interromper(t.id, "parado_pela_pessoa");
      expect((await m.puxar(m.mac))?.id).toBe(t2.id);
    });
  });

  it("a máquina do bot ganha do padrão da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.definirMaquinaPadrao(m.vm);
      await m.repos.agentes.definirMaquina([m.agenteId], m.mac);
      const t = await m.enfileirar();
      expect(await m.puxar(m.vm)).toBeNull();
      expect((await m.puxar(m.mac))?.id).toBe(t.id);
    });
  });

  it("chave revogada ou que nunca existiu vale como qualquer máquina: o turno não fica preso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      await m.repos.maquinaTokens.revogar(m.vm, Date.now());
      const t = await m.enfileirar();
      expect((await m.puxar(m.mac))?.id).toBe(t.id);

      await m.repos.turnos.interromper(t.id, "parado_pela_pessoa");
      await m.repos.agentes.definirMaquina([m.agenteId], randomUUID());
      const t2 = await m.enfileirar();
      expect((await m.puxar(m.mac))?.id).toBe(t2.id);
    });
  });

  it('"rodar em outra desta vez": só os turnos pendentes da conversa, e só aquela vez', async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const t = await m.enfileirar();
      expect(await m.repos.turnos.rodarDestaVez(m.conversaId, m.mac)).toBe(1);
      expect(await m.puxar(m.vm)).toBeNull();
      expect((await m.puxar(m.mac))?.id).toBe(t.id);

      // O próximo turno volta a ir para a VM do bot.
      await m.repos.turnos.interromper(t.id, "parado_pela_pessoa");
      const t2 = await m.enfileirar();
      expect(await m.puxar(m.mac)).toBeNull();
      expect((await m.puxar(m.vm))?.id).toBe(t2.id);
    });
  });

  it('NOD-314: "rodar em outra desta vez" da task muda só os pendentes dela e não muda a máquina do bot', async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const w = await m.repos.trabalhos.criar({ agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Task", origem: "pessoa" });
      if (!w) throw new Error("trabalho");
      const daTask = await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faz a task", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: w.id });
      if (!daTask) throw new Error("turno");
      const solto = await m.enfileirar();
      expect(await m.repos.turnos.rodarDestaVezDoTrabalho(w.id, m.mac)).toEqual({ movidos: 1, jaNela: 0 });
      // QA do NOD-314: o 2º clique não move nada e diz que já iam para lá.
      expect(await m.repos.turnos.rodarDestaVezDoTrabalho(w.id, m.mac)).toEqual({ movidos: 0, jaNela: 1 });
      expect(await m.repos.turnos.rodarDestaVezDoTrabalho(randomUUID(), m.mac)).toEqual({ movidos: 0, jaNela: 0 });
      expect((await m.repos.turnos.buscar(daTask.id))?.maquinaDestaVez).toBe(m.mac);
      const destaVez = await trx<{ id: string; maquina_desta_vez: string | null }[]>`select id, maquina_desta_vez from turnos where id in (${daTask.id}, ${solto.id})`;
      expect(Object.fromEntries(destaVez.map((r) => [r.id, r.maquina_desta_vez]))).toEqual({ [daTask.id]: m.mac, [solto.id]: null });
      const [agente] = await trx<{ maquina_id: string | null }[]>`select maquina_id from agentes where id = ${m.agenteId}`;
      expect(agente?.maquina_id).toBe(m.vm);
    });
  });

  it("cada nível só vale com a chave viva: chave do bot vencida cai no padrão; desta vez revogada cai na máquina do bot", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.preferencias.definirMaquinaPadrao(m.mac);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      await trx`update maquina_tokens set expira_em = now() - interval '1 minute' where id = ${m.vm}`;
      const t = await m.enfileirar();
      expect((await m.puxar(m.mac))?.id).toBe(t.id);

      await m.repos.turnos.interromper(t.id, "parado_pela_pessoa");
      await trx`update maquina_tokens set expira_em = null where id = ${m.vm}`;
      const t2 = await m.enfileirar();
      await m.repos.turnos.rodarDestaVez(m.conversaId, m.mac);
      await m.repos.maquinaTokens.revogar(m.mac, Date.now());
      expect(await m.puxar(m.mac)).toBeNull();
      expect((await m.puxar(m.vm))?.id).toBe(t2.id);
    });
  });

  it("a máquina-alvo pega o turno mesmo sem a IA pronta (o despacho recusa nomeando a IA); outra máquina pronta não leva", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.agentes.definirMaquina([m.agenteId], m.vm);
      const t = await m.enfileirar();
      const pessoa = ["claude-cli"];
      expect(await m.repos.turnos.reivindicar({ machineId: m.mac, agora: Date.now(), harnessesProntos: ["claude-cli"], harnessesProntosPessoa: pessoa })).toBeNull();
      expect((await m.repos.turnos.reivindicar({ machineId: m.vm, agora: Date.now(), harnessesProntos: [], harnessesProntosPessoa: pessoa }))?.id).toBe(t.id);
    });
  });
});
