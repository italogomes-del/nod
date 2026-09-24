import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { criarMetricas } from "../../src/obs/metricas.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

/** Uma rotina com o turno JÁ reivindicado por uma máquina (despachando, lease até agora + LEASE_MS). */
async function rotinaRodando(deps: Deps, conversaId: string, agenteId: string, maquina: string, agora: number) {
  const rotina = await deps.repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "resumo dos e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: agora, machineId: maquina, executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  const turno = await deps.repos.turnos.reivindicar({ machineId: maquina, agora });
  expect(turno?.id).toBe(r.data.turno.id);
  return { rotina, turnoId: r.data.turno.id };
}

describeIntegracao("varredor de lease (ADR-010/021, E9.4; ADR-045): conversa com UM Retomar, rotina só no histórico, UM aviso por queda", () => {
  it("conversa: lease vencido → interrompido maquina_sem_contato, fala parcial, decisão 'retomar_turno', mensagem com o Mac, eventos e UM aviso; 2x → nada novo; nunca 'pendente'", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.mensagens.criar({ conversaId: criado.conversa.id, turnoId, autoria: { ...(await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))!.autoria, autor_tipo: "agente", autor_id: criado.agente.id }, kind: "texto", texto: "comecei a resp", confianca: "confiavel" });

      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS - 1)).toEqual({ interrompidos: [], decisoes: [] });
      const metricas = criarMetricas();
      const primeira = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { metricas });
      expect(primeira.interrompidos).toEqual([turnoId]);
      expect(primeira.decisoes).toHaveLength(1);
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", leaseAte: null });
      const decisao = await deps.repos.decisoes.buscar(primeira.decisoes[0] ?? "");
      expect(decisao).toMatchObject({ tipo: "retomar_turno", estado: "pendente", turnoId, conversaId: criado.conversa.id, decisorId: MARLON.pessoaId });
      const mensagens = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId);
      expect(mensagens.map((m) => [m.kind, m.parcial])).toEqual([
        ["texto", true],
        ["sistema", false],
      ]);
      expect(mensagens[1]?.texto).toContain("seu Mac parou de responder (repouso, sem rede ou nod fechado)");
      const eventos = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turnoId} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["decisao_criada", "mensagem_criada", "turno_interrompido"]);
      // UM aviso, do Mac que voltou (modo local: o varredor roda nele), com a conversa contada.
      const [aviso, ...outros] = await deps.repos.incidentes.visiveis(0);
      expect(outros).toEqual([]);
      expect(aviso).toMatchObject({ id: primeira.incidenteId, tipo: "mac_sem_contato", machineId: maquina, comecouEm: agora, voltouEm: agora + LEASE_MS + 1, rotinas: 0, conversas: 1, agentes: [criado.agente.id] });
      expect(metricas.ler({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: MARLON.tenantId })).toBe(1);

      const segunda = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000);
      expect(segunda).toEqual({ interrompidos: [], decisoes: [] });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toHaveLength(1);
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, agora + LEASE_MS + 5000)).toEqual({ ativo: false });
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: agora + LEASE_MS + 5000 })).toBeNull();
      const estados = await trx<{ estado: string }[]>`select estado from turnos where conversa_id = ${criado.conversa.id}`;
      expect(estados.map((e) => e.estado)).toEqual(["interrompido"]);
    });
  });

  it("conversa: duas quedas na mesma conversa → UM Retomar aberto (o anterior, mesmo reaberto, fecha por regra:retomada_substituida); o aviso soma as duas", async () => {
    await withRollback(MARLON, async (trx) => {
      let agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "primeira", inventario: PRONTO });
      const t1 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const r1 = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      // A pessoa deixa vencer e reabre o primeiro Retomar: reaberta também é substituída.
      await deps.repos.decisoes.vencerPendentes(agora + 2 * 86_400_000);
      expect(await deps.repos.decisoes.reabrir(r1.decisoes[0] ?? "", agora + 3 * 86_400_000)).toMatchObject({ estado: "reaberta" });

      agora += 2 * 60_000;
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "segunda", inventario: PRONTO });
      const t2 = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const r2 = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r2.interrompidos).toEqual([t2]);
      const abertas = (await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).filter((d) => d.tipo === "retomar_turno");
      expect(abertas.map((d) => d.turnoId)).toEqual([t2]);
      expect(await deps.repos.decisoes.buscar(r1.decisoes[0] ?? "")).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: "regra:retomada_substituida", regraVersao: 1 } });
      expect(t1).not.toBe(t2);
      const avisos = await deps.repos.incidentes.visiveis(0);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ id: r1.incidenteId, conversas: 2, rotinas: 0 });
      expect(r2.incidenteId).toBe(r1.incidenteId);
    });
  });

  it("rotina: 0 decisões, 0 mensagens, 1 execução 'interrompida' motivo maquina_sem_contato, aviso com a rotina; idempotente", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Taga" });
      const maquina = randomUUID();
      const { rotina, turnoId } = await rotinaRodando(deps, criado.conversa.id, criado.agente.id, maquina, agora);
      const mensagensAntes = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).length;

      const r = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(r).toMatchObject({ interrompidos: [turnoId], decisoes: [] });
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato" });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toEqual([]);
      expect(await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).toHaveLength(mensagensAntes);
      const execucoes = await deps.repos.rotinaExecucoes.listar(rotina.id);
      expect(execucoes.map((e) => [e.desfecho, e.motivo, e.turnoId])).toEqual([["interrompida", "maquina_sem_contato", turnoId]]);
      expect(await deps.repos.incidentes.visiveis(0)).toMatchObject([{ id: r.incidenteId, rotinas: 1, conversas: 0, agentes: [criado.agente.id] }]);
      const eventos = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turnoId} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["rotina_executou", "turno_interrompido"]);

      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000)).toEqual({ interrompidos: [], decisoes: [] });
      expect(await deps.repos.rotinaExecucoes.listar(rotina.id)).toHaveLength(1);
      expect(await deps.repos.incidentes.visiveis(0)).toMatchObject([{ rotinas: 1 }]);
    });
  });

  it("modo compartilhado: sem sinal desde antes do boot é reinicio_servidor, sem aviso do Mac; o aviso fica em curso até a máquina voltar a puxar", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const antiga = randomUUID();
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "antes do reinício", inventario: PRONTO });
      const doServidor = (await executar(deps, despacharTurno, { machineId: antiga, inventario: PRONTO })).data.plano?.turnoId ?? "";
      const metricas = criarMetricas();
      // O processo subiu DEPOIS do último sinal do turno: quem o perdeu foi o servidor reiniciado.
      const reinicio = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1, { metricas, inicioDoProcesso: agora + 1, ultimoContato: () => null });
      expect(reinicio.interrompidos).toEqual([doServidor]);
      expect(await deps.repos.turnos.buscar(doServidor)).toMatchObject({ motivoInterrupcao: "reinicio_servidor" });
      expect((await deps.repos.decisoes.buscar(reinicio.decisoes[0] ?? ""))?.frase).toContain("o servidor reiniciou");
      expect(await deps.repos.incidentes.visiveis(0)).toEqual([]);
      expect(metricas.ler({ metrica: "pos_restart", desfecho: "perdido", origem: "restart_servidor", tenant_id: MARLON.tenantId })).toBe(1);

      // Uma rotina do Mac que sumiu (o servidor seguiu no ar): aviso EM CURSO, até o Mac puxar de novo.
      const mac = randomUUID();
      const agora2 = agora + LEASE_MS + 10;
      const deps2 = depsSobreTrx(trx, MARLON, { relogio: () => agora2 });
      const { turnoId } = await rotinaRodando(deps2, criado.conversa.id, criado.agente.id, mac, agora2);
      let contato: number | null = agora2 - 10 * 60_000;
      const opcoes = { inicioDoProcesso: agora, ultimoContato: (id: string) => (id === mac ? contato : null) };
      const queda = await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 1, opcoes);
      expect(queda.interrompidos).toEqual([turnoId]);
      expect(await deps2.repos.incidentes.emCurso()).toMatchObject([{ id: queda.incidenteId, voltouEm: null, rotinas: 1, machineId: mac }]);
      // Ainda sem contato: nada muda.
      expect((await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 15_000, opcoes)).voltaram).toBeUndefined();
      // O Mac voltou a puxar: o aviso fecha com a hora da volta.
      contato = agora2 + LEASE_MS + 29_000;
      const volta = await varrerPessoa(deps2.tx, MARLON, agora2 + LEASE_MS + 30_000, opcoes);
      expect(volta.voltaram).toEqual([queda.incidenteId]);
      expect(await deps2.repos.incidentes.emCurso()).toEqual([]);
      expect(await deps2.repos.incidentes.visiveis(0)).toMatchObject([{ id: queda.incidenteId, voltouEm: agora2 + LEASE_MS + 30_000 }]);
    });
  });
});
