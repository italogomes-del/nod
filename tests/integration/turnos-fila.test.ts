import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { assentarTurno, desfechoDaEntrega } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (texto: string, extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "sucesso",
  texto,
  sessaoCli: "sessao-1",
  sinais: SINAIS,
  custoUsd: 0.0207631,
  tokens: { entrada: 120, saida: 30, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
});
const interrompido = (extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "interrompido",
  texto: "parte da resp",
  sessaoCli: null,
  sinais: { ...SINAIS, producedOutput: true },
  custoUsd: null,
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
});

describeIntegracao("fila de turnos (ADR-010): enviar → despachar → assentar, tudo transacional", () => {
  it("enviar-mensagem grava mensagem + turno + outbox e o ROLLBACK derruba os três", async () => {
    const ids = await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data, events } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      expect(await deps.repos.mensagens.buscar(data.mensagem.id)).not.toBeNull();
      expect(await deps.repos.turnos.buscar(data.turno.id)).toMatchObject({ estado: "pendente" });
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where evento_id in ${trx(events.map((e) => e.id))}`;
      expect(outbox[0]?.n).toBe(2);
      return { mensagem: data.mensagem.id, turno: data.turno.id, eventos: events.map((e) => e.id) };
    });
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      expect(await deps.repos.mensagens.buscar(ids.mensagem)).toBeNull();
      expect(await deps.repos.turnos.buscar(ids.turno)).toBeNull();
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where evento_id in ${trx(ids.eventos)}`;
      expect(outbox[0]?.n).toBe(0);
    });
  });

  it("2ª mensagem não é reivindicada até a 1ª assentar; a fila é visível como 'na fila'; a 2ª leva --resume", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const m1 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO })).data;
      const maquina = randomUUID();
      // A 2ª chega com a 1ª já rodando (duas pendentes juntas seriam lidas num turno só: fila-lida-junta).
      const d1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      const m2 = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO })).data;
      expect(d1.plano).toMatchObject({ turnoId: m1.turno.id, machineId: maquina, tokenDeTurno: `tok-${m1.turno.id}`, entrada: { texto: "primeira", sessaoCli: null } });
      expect((await deps.repos.turnos.buscar(m1.turno.id))?.estado).toBe("despachando");
      expect((await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data).toMatchObject({ plano: null, motivo: "fila_vazia" });
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.turnosPendentes).toEqual([{ id: m2.turno.id, motivo: "agente_ocupado_em", conversaId: criado.conversa.id }]);

      const a1 = (await executar(deps, assentarTurno, { turnoId: m1.turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "resposta 1" }, resultado: sucesso("resposta 1") })).data;
      expect(a1.turno).toMatchObject({ estado: "concluido", custoUsd: 0.0207631, sinais: SINAIS, leaseAte: null, motivoInterrupcao: null });
      expect(a1.mensagem).toMatchObject({ kind: "texto", texto: "resposta 1", parcial: false, autoria: { autor_tipo: "agente", autor_id: criado.agente.id, conta_de_execucao: MARLON.pessoaId, machine_id: maquina } });
      expect((await deps.repos.gastos.doTurno(m1.turno.id)).map((g) => [g.custoUsd, g.tokensEntrada, g.tokensSaida])).toEqual([[0.0207631, 120, 30]]);
      expect((await deps.repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toBe("sessao-1");

      const d2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      expect(d2.plano).toMatchObject({ turnoId: m2.turno.id, entrada: { texto: "segunda", sessaoCli: "sessao-1" } });
      expect((await lerConversa(deps, { conversaId: criado.conversa.id })).data.mensagens.map((m) => m.texto)).toEqual([expect.stringContaining("identidade"), "primeira", "segunda", "resposta 1"]);
    });
  });

  it("assentar rotina ou colega não substitui a sessão interativa salva", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await deps.repos.conversas.atualizarSessaoCli(criado.conversa.id, "sessao-interativa", "local");
      for (const origem of ["rotina", "peer"] as const) {
        const turno = await deps.repos.turnos.enfileirar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, origem, prazoEm: Date.now() + 600_000, profundidade: origem === "peer" ? 1 : 0, entradaTexto: "teste", entradaConfianca: "nao_confiavel", modelo: criado.agente.modelo });
        const maquina = randomUUID();
        const plano = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano;
        expect(plano?.turnoId).toBe(turno?.id);
        await executar(deps, assentarTurno, { turnoId: turno?.id ?? "", machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("feito", { sessaoCli: "sessao-de-fundo" }) });
        expect((await deps.repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toBe("sessao-interativa");
      }
    });
  });

  it("entrega é idempotente por (turno, seq_local): repetir não grava mensagem nem gasto de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const entrega = { turnoId, machineId: maquina, seqLocal: 7, fala: { tipo: "texto" as const, texto: "resp" }, resultado: sucesso("resp") };
      const primeira = (await executar(deps, assentarTurno, entrega)).data;
      const segunda = (await executar(deps, assentarTurno, entrega)).data;
      expect(primeira.duplicada).toBe(false);
      expect(segunda).toMatchObject({ duplicada: true, turno: null, mensagem: null });
      expect((await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId)).toHaveLength(1);
      expect(await deps.repos.gastos.doTurno(turnoId)).toHaveLength(1);
      await esperarErro(() => assentarTurno(deps, { ...entrega, seqLocal: 8, machineId: randomUUID() }), "nao_permitido");
    });
  });

  it("interrompido sem motivo: parado_pela_pessoa se a pessoa pediu, senão pelo sinal de saída; fala fica parcial; falha técnica guarda motivo_falha", async () => {
    expect(desfechoDaEntrega({ pararSolicitadoEm: 1, leaseAte: null }, interrompido(), 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", motivoFalha: null });
    const mudo = { ...interrompido(), sinais: { ...interrompido().sinais, producedOutput: false } };
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, mudo, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, interrompido({ motivoInterrupcao: "sessao_rejeitada" }), 0)).toMatchObject({ motivoInterrupcao: "sessao_rejeitada" });
    // definido em 2026-09-18 (ADR-040): quem produziu saída e não concluiu não é 'sem_progresso'.
    // O motivo_falha continua guardando o subtipo técnico, inclusive erro_max_turns da sonda.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, { ...sucesso(""), desfecho: "falha", motivoFalha: "erro_max_turns" }, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "trabalho_incompleto", motivoFalha: "erro_max_turns" });
    const semSaida = { ...sucesso(""), desfecho: "falha" as const, motivoFalha: "erro_execucao" as const, sinais: { ...sucesso("").sinais, producedOutput: false } };
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, semSaida, 0)).toEqual({ estado: "interrompido", motivoInterrupcao: "sem_progresso", motivoFalha: "erro_execucao" });
    // interrompido() já vem com producedOutput: quem falou antes de morrer é trabalho incompleto.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: null }, interrompido(), 0)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });
    // ADR-045: lease VENCIDO sem Parar e sem sucesso é a máquina que caiu — o mesmo desfecho do varredor.
    // Sucesso com o lease vencido é trabalho terminado; Parar pedido continua sendo parado_pela_pessoa.
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, interrompido(), 1_001)).toEqual({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, { ...sucesso(""), desfecho: "falha", motivoFalha: "erro_execucao" }, 1_001)).toMatchObject({ motivoInterrupcao: "maquina_sem_contato", motivoFalha: "erro_execucao" });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 1_000 }, sucesso("pronto"), 1_001)).toEqual({ estado: "concluido", motivoInterrupcao: null, motivoFalha: null });
    expect(desfechoDaEntrega({ pararSolicitadoEm: 900, leaseAte: 1_000 }, interrompido(), 1_001)).toMatchObject({ motivoInterrupcao: "parado_pela_pessoa" });
    expect(desfechoDaEntrega({ pararSolicitadoEm: null, leaseAte: 2_000 }, interrompido(), 1_001)).toMatchObject({ motivoInterrupcao: "trabalho_incompleto" });

    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.turnos.pedirInterrupcao([turnoId], Date.now());
      const { data, events } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "parte da resp" }, resultado: interrompido() });
      expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa", motivoFalha: null });
      expect(data.mensagem).toMatchObject({ texto: "parte da resp", parcial: true });
      const kinds = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId).map((m) => [m.kind, m.parcial]);
      expect(kinds).toEqual([
        ["texto", true],
        ["sistema", false],
      ]);
      expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "mensagem_criada", "turno_interrompido"]);
      // definido em 2026-09-18: a frase traduz o motivo — a pessoa lia "erro_max_turns" cru no chat.
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("Turno interrompido: você pediu para parar");
    });
  });

  it("negação de permissão do CLI vira mensagem 'negacao' + evento (ADR-029), sem ser erro do turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const { data, events } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "preciso de permissão" }, resultado: sucesso("preciso de permissão", { negacoesPermissao: ["mcp__nod__somar"] }) });
      expect(data.turno?.estado).toBe("concluido");
      const negacao = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).find((m) => m.kind === "negacao");
      expect(negacao).toMatchObject({ payload: { kind: "negacao", classe: "ferramenta_negada", nome: "mcp__nod__somar", motivo: "fora_do_catalogo", terminal: false } });
      expect(negacao?.texto).toContain("ferramenta mcp__nod__somar negada");
      expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "negacao", "turno_encerrado"]);
    });
  });

  it("entrega tardia de turno já interrompido entra como anexo parcial, sem reabrir", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.turnos.interromper(turnoId, "maquina_sem_contato");
      const { data } = await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "cheguei tarde" }, resultado: sucesso("cheguei tarde") });
      expect(data).toMatchObject({ tardia: true, mensagem: { texto: "cheguei tarde", parcial: true } });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
    });
  });

  it("gate pré-spawn (ADR-019): inventário nao_autenticado interrompe o turno reivindicado com executor_indisponivel + negação", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const { data: enviado } = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const { data, events } = await executar(deps, despacharTurno, { machineId: randomUUID(), executor: "local", inventario: { estado: "nao_autenticado", motivo: "faça login no claude", em: 5 } });
      expect(data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
      expect(await deps.repos.turnos.buscar(enviado.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" });
      expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("claude-cli nao_autenticado: faça login no claude");
      expect(events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada"]);
    });
  });
});
