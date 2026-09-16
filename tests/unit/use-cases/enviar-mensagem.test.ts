import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../../src/use-cases/enviar-mensagem.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describe("enviarMensagem: mensagem + turno + outbox na mesma tx (ADR-010), localidade honesta (ADR-022)", () => {
  it("grava a mensagem da pessoa, o turno pendente com prazo e os eventos no outbox", async () => {
    const relogio = () => 1_000_000;
    const { deps, banco } = depsEmMemoria(undefined, { relogio });
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    banco.outbox.length = 0;
    const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: " oi ", prazoMs: 5_000, inventario: PRONTO });
    expect(data.mensagem).toMatchObject({ kind: "texto", texto: "oi", confianca: "confiavel", autoria: { autor_tipo: "pessoa" } });
    expect(data.turno).toMatchObject({ estado: "pendente", origem: "conversa", entradaTexto: "oi", prazoEm: 1_005_000, profundidade: 0, modelo: criado.agente.modelo });
    expect(data.negacao).toBeNull();
    expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
    expect(banco.outbox.map((o) => o.tipo)).toEqual(["mensagem_criada", "turno_criado"]);
  });

  it("texto vazio → texto_vazio; conversa inexistente → nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
    await esperarErro(() => enviarMensagem(deps, { conversaId: data.conversa.id, texto: "   " }), "texto_vazio");
    await esperarErro(() => enviarMensagem(deps, { conversaId: randomUUID(), texto: "oi" }), "nao_encontrado");
  });

  it("sem inventário 'pronto' o turno NASCE interrompido executor_indisponivel com negação renderizável (E9.3, ADR-029)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi" });
    expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
    expect(data.negacao).toMatchObject({ kind: "negacao", payload: { kind: "negacao", classe: "plano_ausente", terminal: true } });
    expect(data.negacao?.texto).toContain("executor indisponível");
    expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_interrompido", "mensagem_criada"]);
    expect(await deps.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
  });

  it("2ª mensagem não é reivindicada até a 1ª assentar; enquanto isso é renderizável como 'na fila' (EMENDA 13)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const m1 = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO });
    const m2 = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO });
    const maquina = randomUUID();

    const d1 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d1.data.plano?.turnoId).toBe(m1.data.turno.id);
    expect(d1.data.plano?.entrada.texto).toBe("primeira");
    const d2 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d2.data).toMatchObject({ plano: null, motivo: "fila_vazia" });
    const lida = (await lerConversa(deps, { conversaId: criado.conversa.id })).data;
    expect(lida.turnosPendentes).toEqual([{ id: m2.data.turno.id, motivo: "agente_ocupado_em", conversaId: criado.conversa.id }]);
    expect(lida.mensagens.map((m) => m.texto)).toEqual([expect.stringContaining("identidade"), "primeira", "segunda"]);

    await executar(deps, assentarTurno, {
      turnoId: m1.data.turno.id,
      machineId: maquina,
      seqLocal: 1,
      fala: { tipo: "texto", texto: "resposta" },
      resultado: { desfecho: "sucesso", texto: "resposta", sessaoCli: "s1", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] },
    });
    const d3 = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d3.data.plano?.turnoId).toBe(m2.data.turno.id);
    // a 2ª leva --resume: a sessão do CLI ficou na conversa ao assentar a 1ª
    expect(d3.data.plano?.entrada.sessaoCli).toBe("s1");
  });

  it("falar de novo encerra a parada aberta da conversa (E5.4/E8.1)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await deps.repos.paradas.ativar({ conversaId: criado.conversa.id, agora: Date.now() });
    expect(await deps.repos.paradas.ativa(deps.escopo.pessoaId, criado.conversa.id)).toBe(true);
    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "voltei", inventario: PRONTO });
    expect(await deps.repos.paradas.ativa(deps.escopo.pessoaId, criado.conversa.id)).toBe(false);
  });
});
