import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXECUCOES_GUARDADAS } from "../../../src/shared/constantes.ts";
import { confiancaDaFonte, dispararRotina, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-09-17T08:00:30-03:00"); // 30 s depois da janela das 08:00
const JANELA = Date.parse("2026-09-17T08:00:00-03:00");

async function rotinaAtiva(d: ReturnType<typeof depsMemoria>, extra: { fonte?: string } = {}) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({
    agenteId: agente?.id ?? "",
    conversaId: conversa?.id ?? "",
    cron: "0 8 * * 1-5",
    fusoIana: TZ,
    instrucao: "poste o resumo",
    fonte: extra.fonte ?? "PRs abertos",
    entregavel: "resumo",
    limitesAprovacao: "nada sai sem aprovação",
    politicaSemDado: "diga que não houve",
    proximaExecucao: JANELA,
  });
  if (!rotina) throw new Error("rotina não criada");
  return rotina;
}

describe("dispararRotina", () => {
  it("reivindica a janela canônica, enfileira turno origem 'rotina' ligado à janela e reagenda a próxima; a mesma janela de novo é de outro processo", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if ("janelaDeOutro" in r.data) throw new Error("deveria ter disparado");
    expect(r.data.turno).toMatchObject({ origem: "rotina", estado: "pendente", profundidade: 0, agenteId: rotina.agenteId, conversaId: rotina.conversaId, entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
    expect(r.data.turno.entradaTexto).toContain("poste o resumo");
    expect(r.data.turno.entradaTexto).toContain(`17/09/2026, 08:00 (${TZ})`);
    // sexta 18/09 08:00 SP
    expect(new Date(r.data.proximaExecucao).toISOString()).toBe("2026-09-18T11:00:00.000Z");
    expect(d.banco.rotinas[0]?.proximaExecucao).toBe(r.data.proximaExecucao);
    expect(d.banco.janelas).toEqual([{ tenantId: rotina.tenantId, rotinaId: rotina.id, instanteAgendado: JANELA, executor: "catcher", machineId: "m1", turnoId: r.data.turno.id }]);
    expect(r.events?.map((e) => e.kind)).toEqual(["turno_criado"]);
    // nenhuma execução ainda: o enum não tem 'pendente'; a janela com turno é o "em curso"
    expect(d.banco.execucoes).toHaveLength(0);

    const outra = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m2", executor: "local" });
    expect(outra.data).toEqual({ janelaDeOutro: true });
    expect(d.banco.turnos).toHaveLength(1);
  });

  it("janelas perdidas não são repostas: a próxima execução é calculada a partir de agora, nunca da janela", async () => {
    const tarde = Date.parse("2026-09-20T15:00:00-03:00"); // domingo, três dias depois
    const d = depsMemoria({ agora: () => tarde });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if ("janelaDeOutro" in r.data) throw new Error("deveria ter disparado");
    expect(new Date(r.data.proximaExecucao).toISOString()).toBe("2026-09-21T11:00:00.000Z");
  });

  it("fonte que cita conector habilitado que TOCA dado de aprendiz → entrada nao_confiavel; conector nao-toca → confiavel", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const toca = await d.deps.repos.conectores.criar({ nome: "Alunos", slug: "alunos", transporte: "stdio", comando: "node", declaracao: "toca" });
    await d.deps.repos.conectores.registrarSonda(toca?.id ?? "", { ok: true, catalogo: [], agora: AGORA });
    const naoToca = await d.deps.repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await d.deps.repos.conectores.registrarSonda(naoToca?.id ?? "", { ok: true, catalogo: [], agora: AGORA });
    expect(await confiancaDaFonte(d.deps, "lista de Alunos do conector alunos")).toBe("nao_confiavel");
    expect(await confiancaDaFonte(d.deps, "PRs abertos no GitHub")).toBe("confiavel");
    expect(await confiancaDaFonte(d.deps, "planilha interna")).toBe("confiavel");
  });

  it("registrarDesfechoRotina: executou / falhou / passou_em_branco são distintos, escrevem mensagem rotina_execucao e podam para 20", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if ("janelaDeOutro" in r.data) throw new Error("deveria ter disparado");
    const turnoId = r.data.turno.id;

    const ok = await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "executou" });
    if (!("execucao" in ok.data)) throw new Error("deveria registrar");
    expect(ok.data.execucao).toMatchObject({ rotinaId: rotina.id, turnoId, desfecho: "executou", motivo: null, instanteAgendado: JANELA });
    expect(ok.events?.map((e) => e.kind)).toEqual(["rotina_executou"]);
    const msg = d.banco.mensagens.find((m) => m.kind === "rotina_execucao");
    expect(msg?.payload).toEqual({ kind: "rotina_execucao", rotinaId: rotina.id, instanteAgendado: JANELA, desfecho: "executou" });
    expect(msg?.texto).toContain("Rotina executou em");

    const falha = await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "falhou", motivo: "erro_execucao" });
    if (!("execucao" in falha.data)) throw new Error("deveria registrar");
    expect(falha.data.execucao.desfecho).toBe("falhou");
    expect(d.banco.mensagens.filter((m) => m.kind === "rotina_execucao").at(-1)?.texto).toContain("A rotina falhou por erro técnico: erro_execucao");

    const branco = await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "passou_em_branco", motivo: "ninguem_respondeu_o_gate" });
    if (!("execucao" in branco.data)) throw new Error("deveria registrar");
    expect(branco.data.execucao).toMatchObject({ desfecho: "passou_em_branco", motivo: "ninguem_respondeu_o_gate" });
    expect(d.banco.mensagens.filter((m) => m.kind === "rotina_execucao").at(-1)?.texto).toContain("ninguém respondeu o gate. Nada foi enviado.");

    for (let i = 0; i < EXECUCOES_GUARDADAS; i++) await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "executou" });
    expect(d.banco.execucoes.filter((e) => e.rotinaId === rotina.id)).toHaveLength(EXECUCOES_GUARDADAS);

    // turno que não é de rotina → ignorado, sem execução
    const alheio = await d.deps.repos.turnos.enfileirar({ conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    expect((await registrarDesfechoRotina(d.deps, { turnoId: alheio?.id ?? randomUUID(), desfecho: "executou" })).data).toEqual({ ignorado: "nao_e_rotina" });
  });

  it("'executou' com gate_rotina ainda pendente para o turno NÃO conta como execução (aguardando_gate); a retomada do turno conta", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if ("janelaDeOutro" in r.data) throw new Error("deveria ter disparado");
    const turnoId = r.data.turno.id;
    const gate = await d.deps.repos.decisoes.criar({ tipo: "gate_rotina", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId, prazoDecisaoEm: AGORA + 60_000, frase: "gate" });
    expect((await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
    await d.deps.repos.decisoes.decidir(gate?.id ?? "", { por: "p", agora: AGORA });
    const retomada = await d.deps.repos.turnos.enfileirar({ conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "retomada", retomaTurnoId: turnoId, prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const ok = await registrarDesfechoRotina(d.deps, { turnoId: retomada?.id ?? "", desfecho: "executou" });
    expect("execucao" in ok.data && ok.data.execucao.turnoId).toBe(turnoId);
  });
});
