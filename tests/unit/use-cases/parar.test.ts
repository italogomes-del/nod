import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { parar } from "../../../src/use-cases/parar.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describe("parar (E5.4/E8.1/E8.2/E8.3): estado persistido, faixa honesta, nunca catch vazio", () => {
  it("pendente é interrompido na hora (parado_pela_pessoa); faixa conta; mensagem 'parada' e evento", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data: enviado } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
    const { data: faixa, events } = await executar(deps, parar, { conversaId: criado.conversa.id });
    expect(faixa).toEqual({ interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(await deps.repos.turnos.buscar(enviado.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect(events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada", "parada"]);
    const ultima = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
    expect(ultima).toMatchObject({ kind: "parada", payload: { kind: "parada", interrompidas: 1, nadaRodando: false } });
  });

  it("despachando: pede interrupção (renovar → {ativo:false}) e dispara o interruptor registrado", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
    const maquina = randomUUID();
    const { data: d } = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    const turnoId = d.plano?.turnoId ?? "";
    const sigterm = vi.fn(async () => undefined);
    deps.services.interruptor.registrar(turnoId, sigterm);

    const { data: faixa } = await executar(deps, parar, { conversaId: null });
    expect(sigterm).toHaveBeenCalledTimes(1);
    expect(faixa).toMatchObject({ interrompidas: 1, naoInterrompidas: [], nadaRodando: false });
    expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, Date.now())).toEqual({ ativo: false });
    expect((await deps.repos.turnos.buscar(turnoId))?.pararSolicitadoEm).not.toBeNull();
    expect(deps.services.interruptor.registrados()).toEqual([]);
  });

  it("falha do interruptor vira naoInterrompidas com motivo (nunca silenciada); sem processo registrado também", async () => {
    const { deps } = depsEmMemoria();
    const a = await executar(deps, criarAgente, { dono: "pessoa" });
    const b = await executar(deps, criarAgente, { dono: "pessoa" });
    await executar(deps, enviarMensagem, { conversaId: a.data.conversa.id, texto: "oi", inventario: PRONTO });
    await executar(deps, enviarMensagem, { conversaId: b.data.conversa.id, texto: "oi", inventario: PRONTO });
    const maquina = randomUUID();
    const t1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
    const t2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
    deps.services.interruptor.registrar(t1, async () => {
      throw new RangeError("processo já morreu");
    });

    const { data: faixa } = await executar(deps, parar, { conversaId: null });
    expect(faixa.interrompidas).toBe(0);
    expect(faixa.naoInterrompidas).toEqual(
      expect.arrayContaining([
        { turnoId: t1, motivo: "RangeError" },
        { turnoId: t2, motivo: "sem_processo_neste_servidor_aguarda_renovacao_do_lease" },
      ]),
    );
    expect(faixa.nadaRodando).toBe(false);
  });

  it("nada rodando: faixa diz isso por escrito, não fica vazia", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data: faixa } = await executar(deps, parar, { conversaId: criado.conversa.id });
    expect(faixa).toEqual({ interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true });
    expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toBe("Nada estava rodando. Nenhum turno foi interrompido.");
  });

  it("parada aberta bloqueia o despacho; consulta que FALHA (null) também é parada; falar de novo libera (E8.1)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await executar(deps, parar, { conversaId: null });
    await deps.repos.turnos.enfileirar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "rotina", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "rotina", entradaConfianca: "confiavel", modelo: "m" });
    const bloqueado = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    expect(bloqueado.data).toMatchObject({ plano: null, motivo: "parada_ativa" });
    expect((await deps.repos.turnos.pendentesDaPessoa()).map((t) => t.estado)).toEqual(["pendente"]);

    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "voltei", inventario: PRONTO });
    const liberado = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    expect(liberado.data.plano).not.toBeNull();

    const original = deps.repos.paradas.ativa;
    deps.repos.paradas.ativa = async () => null;
    const falha = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    expect(falha.data).toMatchObject({ plano: null, motivo: "parada_ativa" });
    deps.repos.paradas.ativa = original;
  });

  it("frames ainda não entregues do outbox são cancelados; os da própria parada saem depois (E8.3)", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    expect((await deps.repos.outbox.pendentes()).length).toBe(2);
    const { events } = await executar(deps, parar, { conversaId: criado.conversa.id });
    const pendentes = await deps.repos.outbox.pendentes();
    expect(pendentes.map((p) => p.tipo).sort()).toEqual(["mensagem_criada", "parada"]);
    expect(banco.outbox.filter((o) => o.canceladoEm !== null)).toHaveLength(2);
    expect(events.find((e) => e.kind === "parada")?.dados).toMatchObject({ frames_cancelados: 2, nada_rodando: true });
  });
});
