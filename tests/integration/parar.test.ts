import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("parar (E5.4/E8) no Postgres: estado persistido, faixa e bloqueio do despacho", () => {
  it("pendente é interrompido na hora; despachando recebe {ativo:false} na renovação e o interruptor é chamado; faixa com contagens", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const b = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const rodando = (await executar(deps, enviarMensagem, { conversaId: a.conversa.id, texto: "roda", inventario: PRONTO })).data.turno;
      const esperando = (await executar(deps, enviarMensagem, { conversaId: b.conversa.id, texto: "espera", inventario: PRONTO })).data.turno;
      const maquina = randomUUID();
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId).toBe(rodando.id);
      const sigterm = vi.fn(async () => undefined);
      deps.services.interruptor.registrar(rodando.id, sigterm);

      const { data: faixa, events } = await executar(deps, parar, { conversaId: null });
      expect(faixa).toEqual({ interrompidas: 2, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
      expect(sigterm).toHaveBeenCalledTimes(1);
      expect(await deps.repos.turnos.buscar(esperando.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect(await deps.repos.turnos.buscar(rodando.id)).toMatchObject({ estado: "despachando" });
      expect(await deps.repos.turnos.renovarLease(rodando.id, maquina, {}, Date.now())).toEqual({ ativo: false });
      expect(events.map((e) => e.kind)).toEqual(["turno_interrompido", "parada"]);
      const paradas = await trx<{ n: number }[]>`select count(*)::int as n from paradas where pessoa_id = ${MARLON.pessoaId} and encerrada_em is null and conversa_id is null`;
      expect(paradas[0]?.n).toBe(1);
    });
  });

  it("nada rodando → faixa escrita; parada da conversa bloqueia só ela; falar de novo libera", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const b = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const { data: faixa } = await executar(deps, parar, { conversaId: a.conversa.id });
      expect(faixa.nadaRodando).toBe(true);
      expect((await deps.repos.mensagens.ultimaDaConversa(a.conversa.id))).toMatchObject({ kind: "parada", texto: "Nada estava rodando. Nenhum turno foi interrompido.", payload: { kind: "parada", interrompidas: 0, nadaRodando: true } });

      // turno de rotina em A nasce depois da parada: fica bloqueado; B despacha normalmente
      await deps.repos.turnos.enfileirar({ conversaId: a.conversa.id, agenteId: a.agente.id, origem: "rotina", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "rotina", entradaConfianca: "confiavel", modelo: "m" });
      const emB = (await executar(deps, enviarMensagem, { conversaId: b.conversa.id, texto: "oi b", inventario: PRONTO })).data.turno;
      expect((await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano?.turnoId).toBe(emB.id);
      const bloqueado = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(bloqueado).toMatchObject({ plano: null, motivo: "parada_ativa" });
      expect(bloqueado.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });

      await executar(deps, enviarMensagem, { conversaId: a.conversa.id, texto: "voltei", inventario: PRONTO });
      expect(await deps.repos.paradas.ativa(MARLON.pessoaId, a.conversa.id)).toBe(false);
      const liberado = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data;
      expect(liberado.plano?.entrada.texto).toBe("voltei");
    });
  });

  it("frames pendentes do outbox são cancelados (E8.3) e a parada em si ainda sai", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
      const antes = await deps.repos.outbox.pendentes();
      expect(antes.length).toBeGreaterThanOrEqual(2);
      const { events } = await executar(deps, parar, { conversaId: a.conversa.id });
      const depois = await deps.repos.outbox.pendentes();
      expect(depois.map((p) => p.tipo).sort()).toEqual(["mensagem_criada", "parada"]);
      const cancelados = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where owner_id = ${MARLON.pessoaId} and cancelado_em is not null and id in ${trx(antes.map((p) => p.id))}`;
      expect(cancelados[0]?.n).toBe(antes.length);
      expect(events.find((e) => e.kind === "parada")?.dados.frames_cancelados).toBe(antes.length);
    });
  });
});
