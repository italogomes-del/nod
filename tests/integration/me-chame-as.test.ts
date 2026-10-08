import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Tx } from "../../src/shared/types.ts";
import { meChameAs } from "../../src/use-cases/me-chame-as.ts";
import { criarTrabalho, listarTrabalhos, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-086 (definido em 2026-10-08): "me chame às 16:00". O bot enfileira a retomada do próprio turno com `acordar_em`;
 * o `reivindicar` só a entrega a partir da hora, e até lá a task fica `rodando` sem processo — "volta às 16:05".
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const { trabalho } = await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo: "Acompanhar o CI do PR", origem: "pessoa" });
  const turno = await repos.turnos.enfileirar({ conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: trabalho.id });
  if (!turno) throw new Error("turno");
  const pegar = (agora: number) => repos.turnos.reivindicar({ machineId: randomUUID(), agora });
  return { ...base, deps, repos, trabalho, turno, pegar, ctx: { turnoId: turno.id, agenteId: base.agenteId, conversaId: base.conversaId } };
}

describeIntegracao("me chame às (ADR-086)", () => {
  it("a retomada nasce com acordar_em, no mesmo trabalho; a fila só a entrega na hora; até lá a task fica rodando e diz quando volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.pegar(Date.now()))?.id).toBe(m.turno.id);
      const r = await meChameAs(m.deps, { ...m.ctx, em_minutos: 20, motivo: "ver se o CI do PR #212 passou" });
      expect(r.data).toMatchObject({ ok: true });
      expect(r.data.instrucao).toContain("encerre o turno");
      const acordar = Date.parse(r.data.acordar_em);
      expect(acordar - Date.now()).toBeGreaterThan(19 * 60_000);

      const retomada = (await m.repos.turnos.doTrabalho(m.trabalho.id)).find((t) => t.id !== m.turno.id);
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: m.turno.id, trabalhoId: m.trabalho.id, estado: "pendente", acordarEm: acordar });
      expect(retomada?.entradaTexto).toContain("ver se o CI do PR #212 passou");

      // O turno que combinou a volta termina; a task segue rodando (há volta marcada), sem processo.
      await m.repos.turnos.assentar(m.turno.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, m.trabalho.id);
      expect((await m.repos.trabalhos.buscar(m.trabalho.id))?.estado).toBe("rodando");
      const dto = (await listarTrabalhos(m.deps, {})).data.trabalhos.find((t) => t.id === m.trabalho.id);
      expect(dto).toMatchObject({ estado: "rodando", turnoVivoId: null, acordaEm: acordar });

      // Antes da hora a fila não a entrega; na hora, sim.
      expect(await m.pegar(Date.now())).toBeNull();
      expect((await m.pegar(acordar + 1))?.id).toBe(retomada?.id);
    });
  });

  it("fora de 1–1440 minutos ou sem motivo: recusado; turno de outro bot: não permitido", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (const em_minutos of [0, 1441, -5]) await esperarErro(() => meChameAs(m.deps, { ...m.ctx, em_minutos, motivo: "x" }), "entrada_invalida");
      await esperarErro(() => meChameAs(m.deps, { ...m.ctx, em_minutos: 5, motivo: "   " }), "texto_vazio");
      await esperarErro(() => meChameAs(m.deps, { ...m.ctx, agenteId: randomUUID(), em_minutos: 5, motivo: "x" }), "nao_permitido");
    });
  });
});
