import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { aplicarRecalculo, planejarRecalculo, somaPorDia, totalPorDia } from "../../scripts/recalcular-custo-bifurcado.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-291 (C14): o recálculo do custo das cópias de sessão gravadas com o total inteiro. Só simula por padrão; grava com
 * --aplicar (aplicarRecalculo), só depois do OK do Marlon nos números.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;

describeIntegracao("scripts/recalcular-custo-bifurcado.ts", () => {
  it("acha a cópia antiga pela sessão do trabalho da conversa, simula a soma por dia e só grava ao aplicar", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
      const mae = `mae-${randomUUID()}`;
      const copia = `copia-${randomUUID()}`;
      const base = Date.UTC(2026, 9, 8, 15, 0, 0);
      /** Um turno já assentado como o código antigo gravava: custo, total da sessão e o gasto. */
      const turno = async (o: { sessao: string; total: number; custo: number; em: number; trabalhoId?: string }) => {
        const t = await repos.turnos.enfileirar({ executor: "local", conversaId, agenteId, origem: o.trabalhoId ? "retomada" : "conversa", prazoEm: o.em + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId: o.trabalhoId ?? null });
        await repos.turnos.assentar(t!.id, { estado: "concluido", custoUsd: o.custo, sessaoCli: o.sessao, custoSessaoUsd: o.total });
        await trx`update turnos set criado_em = ${new Date(o.em)} where id = ${t!.id}`;
        await repos.gastos.registrar({ turnoId: t!.id, executor: "local", tokensEntrada: 1, tokensSaida: 1, custoUsd: o.custo, modelo: "m", em: o.em + 60_000 });
        return t!.id;
      };
      const totalAntesDoTeste = (await totalPorDia(trx, "America/Sao_Paulo", ["2026-10-08"])).get("2026-10-08") ?? 0;
      // A mãe na conversa; a rede promove o trabalho com a sessão dela; a conversa segue numa cópia (gravou o total).
      await turno({ sessao: mae, total: 162.55, custo: 162.55, em: base });
      const w = await repos.trabalhos.criar({ agenteId, conversaId, titulo: "Frente", origem: "pessoa" });
      await trx`update trabalhos set sessao_cli = ${mae} where id = ${w!.id}`;
      const copiaId = await turno({ sessao: copia, total: 164.22, custo: 164.22, em: base + HORA });
      // O segundo turno da cópia já estava certo (diferença para o total dela).
      await turno({ sessao: copia, total: 165, custo: 0.78, em: base + 2 * HORA });
      // A mãe segue no trabalho depois da cópia: não entra no anterior.
      await turno({ sessao: mae, total: 300, custo: 137.45, em: base + 3 * HORA, trabalhoId: w!.id });

      const rs = (await planejarRecalculo(trx, "America/Sao_Paulo")).filter((r) => r.sessaoMae === mae);
      expect(rs).toEqual([{ turnoId: copiaId, sessaoMae: mae, dia: "2026-10-08", totalSessao: 164.22, anteriorDaMae: 162.55, custoAtual: 164.22, custoNovo: 1.67 }]);
      const [dia] = somaPorDia(rs);
      expect(dia).toMatchObject({ dia: "2026-10-08", turnos: 1, antes: 164.22, depois: 1.67 });
      expect(dia?.diferenca).toBeCloseTo(-162.55, 7);
      // O total do dia soma TODOS os gastos do dia (não só os recalculados): os 4 turnos deste teste.
      const totalDoDia = (await totalPorDia(trx, "America/Sao_Paulo", ["2026-10-08"])).get("2026-10-08") ?? 0;
      expect(totalDoDia - totalAntesDoTeste).toBeCloseTo(162.55 + 164.22 + 0.78 + 137.45, 6);
      expect(await totalPorDia(trx, "America/Sao_Paulo", [])).toEqual(new Map());
      // Simular não grava.
      expect((await repos.turnos.buscar(copiaId))?.custoUsd).toBe(164.22);

      expect(await aplicarRecalculo(trx, rs)).toBe(1);
      expect((await repos.turnos.buscar(copiaId))?.custoUsd).toBe(1.67);
      expect((await repos.gastos.doTurno(copiaId))[0]?.custoUsd).toBe(1.67);
      // Idempotente: aplicado, não sobra o que recalcular.
      expect((await planejarRecalculo(trx, "America/Sao_Paulo")).filter((r) => r.sessaoMae === mae)).toEqual([]);
    });
  });

  // Re-QA do #346 (Tarsila, 2026-10-17): o modo vem SÓ do `--aplicar`. Sem ele, o script de verdade (o processo, não as
  // funções) simula e diz que nada foi gravado — é a trava do "só depois do OK do Marlon".
  it("rodado sem --aplicar, o processo só simula e diz que nada foi gravado", () => {
    const url = process.env.DATABASE_URL_TEST;
    expect(url).toBeTruthy();
    const r = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/recalcular-custo-bifurcado.ts", import.meta.url)), "--fuso=UTC"], {
      encoding: "utf8", timeout: 60_000, cwd: tmpdir(), env: { ...process.env, DATABASE_URL: url },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("SIMULAÇÃO (nada gravado)");
    expect(r.stdout).toContain("Nada foi gravado.");
    expect(r.stdout).not.toContain("APLICANDO");
    expect(r.stdout).not.toContain("Aplicados:");
  });

  // Re-QA do #346 (Tarsila, 2026-10-17): aplicar troca só a linha de gastos que tinha o custo antigo — outra linha do mesmo
  // turno (um segundo registro de gasto) fica como estava.
  it("aplicar mexe só no gasto com o custo antigo; outro gasto do mesmo turno fica intacto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
      const mae = `mae-${randomUUID()}`;
      const base = Date.UTC(2026, 9, 8, 15, 0, 0);
      const turno = async (o: { sessao: string; total: number; em: number }) => {
        const t = await repos.turnos.enfileirar({ executor: "local", conversaId, agenteId, origem: "conversa", prazoEm: o.em + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
        await repos.turnos.assentar(t!.id, { estado: "concluido", custoUsd: o.total, sessaoCli: o.sessao, custoSessaoUsd: o.total });
        await trx`update turnos set criado_em = ${new Date(o.em)} where id = ${t!.id}`;
        await repos.gastos.registrar({ turnoId: t!.id, executor: "local", tokensEntrada: 1, tokensSaida: 1, custoUsd: o.total, modelo: "m", em: o.em + 60_000 });
        return t!.id;
      };
      await turno({ sessao: mae, total: 10, em: base });
      const copiaId = await turno({ sessao: `copia-${randomUUID()}`, total: 12, em: base + HORA });
      await repos.turnos.registrarSessaoOrigem(copiaId, mae);
      await repos.gastos.registrar({ turnoId: copiaId, executor: "local", tokensEntrada: 1, tokensSaida: 1, custoUsd: 0.5, modelo: "m", em: base + HORA + 120_000 });

      const rs = (await planejarRecalculo(trx, "UTC")).filter((r) => r.turnoId === copiaId);
      expect(rs).toMatchObject([{ anteriorDaMae: 10, custoAtual: 12, custoNovo: 2 }]);
      expect(await aplicarRecalculo(trx, rs)).toBe(1);
      const custos = (await repos.gastos.doTurno(copiaId)).map((g) => g.custoUsd).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(custos).toEqual([0.5, 2]);
    });
  });
});
