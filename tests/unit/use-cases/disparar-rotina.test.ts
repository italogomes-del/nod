import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CapacidadeConector } from "../../../src/contracts/conector.ts";
import { EXECUCOES_GUARDADAS } from "../../../src/shared/constantes.ts";
import { concederLote } from "../../../src/use-cases/conceder.ts";
import { confirmarProposta } from "../../../src/use-cases/confirmar-proposta.ts";
import { decidirAcesso } from "../../../src/use-cases/decidir-acesso.ts";
import { confiancaDaFonte, dispararRotina, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { executarRotinaAgora } from "../../../src/use-cases/executar-rotina-agora.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
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
  it("teste manual mantém pausa e agenda e deduplica dois cliques no mesmo minuto", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    await d.deps.repos.rotinas.atualizarEstado(rotina.id, "pausada");
    const a = await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" });
    const b = await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" });
    expect(a.data.turnoId).toBeTruthy();
    expect(b.data.turnoId).toBeNull();
    expect(d.banco.turnos).toHaveLength(1);
    expect(await d.deps.repos.rotinas.buscar(rotina.id)).toMatchObject({ estado: "pausada", proximaExecucao: JANELA });
  });
  it("reivindica a janela canônica, enfileira turno origem 'rotina' ligado à janela e reagenda a próxima; a mesma janela de novo é de outro processo", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("deveria ter disparado");
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

    // O turno terminou; a MESMA janela reivindicada de novo é de outro processo, sem turno novo.
    await d.deps.repos.turnos.assentar(r.data.turno.id, { estado: "concluido" });
    const outra = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m2", executor: "local" });
    expect(outra.data).toEqual({ janelaDeOutro: true });
    expect(d.banco.turnos).toHaveLength(1);
  });

  /**
   * ADR-045: o Mac dormiu com o turno anterior pendente (ou rodando). O agendador NÃO reivindica a janela
   * nova — só reagenda; senão as execuções se empilhavam a cada acordar. "Executar agora" e "Permitir e
   * rodar agora" (preservarAgenda) são da pessoa e nunca são pulados.
   */
  it("uma execução aberta por rotina: turno anterior aberto → a janela do agendador é pulada e só reagendada; ato da pessoa roda", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const primeira = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in primeira.data)) throw new Error("deveria ter disparado");
    const seguinte = Date.parse("2026-09-18T08:00:00-03:00");
    const pulada = await dispararRotina(d.deps, { rotina, instanteAgendado: seguinte, machineId: "m1", executor: "catcher" });
    expect(pulada.data).toEqual({ pulada: true, turnoAbertoId: primeira.data.turno.id, proximaExecucao: Date.parse("2026-09-21T08:00:00-03:00") });
    expect(d.banco.janelas.map((j) => j.instanteAgendado)).toEqual([JANELA]);
    expect(d.banco.turnos).toHaveLength(1);
    expect(d.banco.rotinas[0]?.proximaExecucao).toBe(Date.parse("2026-09-21T08:00:00-03:00"));

    const daPessoa = await dispararRotina(d.deps, { rotina, instanteAgendado: AGORA + 1, machineId: "m1", executor: "catcher", preservarAgenda: true });
    expect("turno" in daPessoa.data).toBe(true);

    // Rodando (despachando) também conta como aberta; concluído libera a próxima janela.
    await d.deps.repos.turnos.assentar(primeira.data.turno.id, { estado: "concluido" });
    if ("turno" in daPessoa.data) await d.deps.repos.turnos.reivindicar({ machineId: "m1", agora: AGORA });
    expect("pulada" in (await dispararRotina(d.deps, { rotina, instanteAgendado: seguinte, machineId: "m1", executor: "catcher" })).data).toBe(true);
    if ("turno" in daPessoa.data) await d.deps.repos.turnos.assentar(daPessoa.data.turno.id, { estado: "concluido" });
    expect("turno" in (await dispararRotina(d.deps, { rotina, instanteAgendado: seguinte, machineId: "m1", executor: "catcher" })).data).toBe(true);
  });

  it("janelas perdidas não são repostas: a próxima execução é calculada a partir de agora, nunca da janela", async () => {
    const tarde = Date.parse("2026-09-20T15:00:00-03:00"); // domingo, três dias depois
    const d = depsMemoria({ agora: () => tarde });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("deveria ter disparado");
    expect(new Date(r.data.proximaExecucao).toISOString()).toBe("2026-09-21T11:00:00.000Z");
  });

  // revisto em 2026-09-30 (ADR-062): o critério é a curadoria de conteúdo de fora, não a declaração de dado de aprendiz.
  it("fonte que cita app de conteúdo de fora (sem curadoria, GitHub, Gmail) → nao_confiavel; app interno curado (ClickUp, Slack) → confiavel", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    for (const [nome, slug, declaracao] of [["Alunos", "alunos", "toca"], ["GitHub", "github", "nao-toca"], ["ClickUp", "clickup", "toca"], ["Slack", "slack", "toca"]] as const) {
      const c = await d.deps.repos.conectores.criar({ nome, slug, transporte: "stdio", comando: "node", declaracao });
      await d.deps.repos.conectores.registrarSonda(c?.id ?? "", { ok: true, catalogo: [], agora: AGORA });
    }
    expect(await confiancaDaFonte(d.deps, "lista de Alunos do conector alunos")).toBe("nao_confiavel");
    // Declarado 'nao-toca' (sem dado de aprendiz) não o faz interno: um PR ou issue pode vir de qualquer pessoa.
    expect(await confiancaDaFonte(d.deps, "PRs abertos no GitHub")).toBe("nao_confiavel");
    // Marcados 'toca' como todo app do marketplace, e mesmo assim internos: é o caso do Milton (fonte "ClickUp, Slack").
    expect(await confiancaDaFonte(d.deps, "tasks do ClickUp e mensagens no Slack")).toBe("confiavel");
    expect(await confiancaDaFonte(d.deps, "planilha interna")).toBe("confiavel");
  });

  it("registrarDesfechoRotina: executou / falhou / passou_em_branco são distintos, escrevem mensagem rotina_execucao; UMA linha por janela", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("deveria ter disparado");
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
    // ADR-045: três desfechos para a MESMA janela = uma linha no histórico, com o mais recente.
    expect(d.banco.execucoes.filter((e) => e.rotinaId === rotina.id).map((e) => [e.id, e.desfecho])).toEqual([[ok.data.execucao.id, "passou_em_branco"]]);

    // 21 janelas (cada uma com o seu turno) → ficam as 20 mais recentes.
    await d.deps.repos.turnos.assentar(turnoId, { estado: "concluido" });
    for (let i = 1; i <= EXECUCOES_GUARDADAS; i++) {
      const n = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA + i * 86_400_000, machineId: "m1", executor: "catcher" });
      if (!("turno" in n.data)) throw new Error("deveria ter disparado");
      await registrarDesfechoRotina(d.deps, { turnoId: n.data.turno.id, desfecho: "executou" });
      await d.deps.repos.turnos.assentar(n.data.turno.id, { estado: "concluido" });
    }
    expect(d.banco.execucoes.filter((e) => e.rotinaId === rotina.id)).toHaveLength(EXECUCOES_GUARDADAS);

    // turno que não é de rotina → ignorado, sem execução
    const alheio = await d.deps.repos.turnos.enfileirar({ conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    expect((await registrarDesfechoRotina(d.deps, { turnoId: alheio?.id ?? randomUUID(), desfecho: "executou" })).data).toEqual({ ignorado: "nao_e_rotina" });
  });

  it("'interrompida' (a máquina caiu) fica só no histórico: sem mensagem na conversa, com o evento para o painel", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("deveria ter disparado");
    const antes = d.banco.mensagens.length;
    const caiu = await registrarDesfechoRotina(d.deps, { turnoId: r.data.turno.id, desfecho: "interrompida", motivo: "maquina_sem_contato" });
    expect("execucao" in caiu.data && caiu.data.execucao).toMatchObject({ desfecho: "interrompida", motivo: "maquina_sem_contato" });
    expect(d.banco.mensagens).toHaveLength(antes);
    expect(caiu.events?.map((e) => [e.kind, e.dados.desfecho])).toEqual([["rotina_executou", "interrompida"]]);
  });

  it("'executou' com gate_rotina ainda pendente para o turno NÃO conta como execução (aguardando_gate); a retomada do turno conta", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const rotina = await rotinaAtiva(d);
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in r.data)) throw new Error("deveria ter disparado");
    const turnoId = r.data.turno.id;
    const gate = await d.deps.repos.decisoes.criar({ tipo: "gate_rotina", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId, prazoDecisaoEm: AGORA + 60_000, frase: "gate" });
    expect((await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
    await d.deps.repos.decisoes.decidir(gate?.id ?? "", { por: "p", agora: AGORA });
    const retomada = await d.deps.repos.turnos.enfileirar({ conversaId: rotina.conversaId, agenteId: rotina.agenteId, origem: "retomada", retomaTurnoId: turnoId, prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const ok = await registrarDesfechoRotina(d.deps, { turnoId: retomada?.id ?? "", desfecho: "executou" });
    expect("execucao" in ok.data && ok.data.execucao.turnoId).toBe(turnoId);
  });
});

/**
 * Emenda da ADR-044, "rotina se trava sozinha": a rotina da Nina rodava 3x/dia sem a concessão do Gmail
 * — cada execução gastava um turno (~US$ 0,09), falhava e abria um card. O pré-voo para a janela ANTES
 * do turno quando o servidor já sabe que falta o app.
 */
describe("pré-voo da rotina (emenda da ADR-044)", () => {
  const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });
  const SEXTA = Date.parse("2026-09-18T08:00:00-03:00");
  const SEGUNDA = Date.parse("2026-09-21T08:00:00-03:00");

  async function gmail(d: ReturnType<typeof depsMemoria>, habilitado = true) {
    const c = await d.deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!c) throw new Error("conector");
    await d.deps.repos.conectores.registrarSonda(c.id, { ok: true, agora: AGORA, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)] });
    if (!habilitado) await d.deps.repos.conectores.habilitar(c.id, false);
    return c;
  }
  /** A rotina como o agendador a vê agora (proximaExecucao reagendada). */
  const atual = async (d: ReturnType<typeof depsMemoria>, id: string) => {
    const r = await d.deps.repos.rotinas.buscar(id);
    if (!r) throw new Error("rotina");
    return r;
  };

  it("sem acesso: a janela vira 'bloqueada' sem turno; UM card de um clique, sem turno e com a geração do agente; nenhuma mensagem; a agenda anda", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "E-mails do Gmail" });
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in r.data)) throw new Error("deveria ter bloqueado");
    expect(r.data).toEqual({ bloqueada: "sem_acesso", propostaId: expect.any(String), proximaExecucao: SEXTA });
    expect(d.banco.turnos).toHaveLength(0);
    expect(d.banco.janelas.map((j) => [j.instanteAgendado, j.turnoId])).toEqual([[JANELA, null]]);
    expect(d.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo, e.turnoId])).toEqual([[JANELA, "bloqueada", "sem_acesso", null]]);
    const propostaId = r.data.propostaId;
    const proposta = d.banco.propostas.find((p) => p.id === propostaId);
    expect(proposta?.payload).toEqual({ kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], rotinaId: rotina.id, geracao: 0 });
    expect(d.banco.decisoes.find((x) => x.id === propostaId)).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: null, frase: "Vera precisa ler seu Gmail para a rotina “poste o resumo”. Não inclui: enviar, apagar, arquivar." });
    expect(d.banco.mensagens).toHaveLength(0);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada", "rotina_bloqueada"]);
    expect(r.events?.at(-1)?.dados).toMatchObject({ rotinaId: rotina.id, desfecho: "bloqueada", motivo: "sem_acesso", propostaId: r.data.propostaId, instanteAgendado: JANELA });
    expect(d.banco.rotinas[0]?.proximaExecucao).toBe(SEXTA);
  });

  it("três janelas sem acesso: três execuções 'bloqueada' e UM card só", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "Gmail" });
    const ids: (string | null)[] = [];
    for (const instante of [JANELA, SEXTA, SEGUNDA]) {
      const r = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: instante, machineId: "m1", executor: "catcher" });
      if (!("bloqueada" in r.data)) throw new Error("deveria ter bloqueado");
      ids.push(r.data.propostaId);
      if (instante !== JANELA) expect(r.events?.map((e) => e.kind)).toEqual(["rotina_bloqueada"]);
    }
    expect(new Set(ids).size).toBe(1);
    expect(d.banco.execucoes.filter((e) => e.desfecho === "bloqueada")).toHaveLength(3);
    expect(d.banco.propostas).toHaveLength(1);
    expect(d.banco.decisoes).toHaveLength(1);
    expect(d.banco.turnos).toHaveLength(0);
  });

  it("permitir roda a rotina na hora (sem pré-voo) e a janela seguinte roda normal", async () => {
    let agora = AGORA;
    const d = depsMemoria({ agora: () => agora });
    await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "Gmail" });
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in r.data) || !r.data.propostaId) throw new Error("deveria ter bloqueado");
    agora = AGORA + 3 * 60_000 + 417;
    const decidido = await decidirAcesso(d.deps, { decisaoId: r.data.propostaId, recusar: false, executor: "catcher" });
    expect(decidido.data).toMatchObject({ concessoes: 2, rotinaId: rotina.id, turnoId: expect.any(String) });
    expect(d.banco.turnos.find((t) => t.id === decidido.data.turnoId)?.origem).toBe("rotina");
    await d.deps.repos.turnos.assentar(decidido.data.turnoId ?? "", { estado: "concluido" });
    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect("turno" in sexta.data).toBe(true);
    expect(d.banco.propostas.filter((p) => p.estado === "pendente")).toHaveLength(0);
  });

  it("'executar agora' bloqueado: turnoId null e o bloqueio com o card; a agenda não muda", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "Gmail" });
    const r = await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" });
    expect(r.data).toEqual({ conversaId: rotina.conversaId, turnoId: null, bloqueio: { motivo: "sem_acesso", propostaId: d.banco.propostas[0]?.id } });
    expect(d.banco.turnos).toHaveLength(0);
    expect(d.banco.rotinas[0]?.proximaExecucao).toBe(JANELA);
  });

  it("sem conexão: card de conexão, sem decisão; com o app ligado, a janela seguinte troca pelo card de um clique", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const conector = await gmail(d, false);
    const rotina = await rotinaAtiva(d, { fonte: "Gmail" });
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in r.data)) throw new Error("deveria ter bloqueado");
    expect(r.data.bloqueada).toBe("sem_conexao");
    expect(d.banco.propostas[0]?.payload).toMatchObject({ kind: "acesso", conectar: true, capacidades: [], rotinaId: rotina.id });
    expect(d.banco.decisoes).toHaveLength(0);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada", "rotina_bloqueada"]);

    await d.deps.repos.conectores.habilitar(conector.id, true);
    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in sexta.data)) throw new Error("deveria ter bloqueado");
    const [conexao, umClique] = [r.data.propostaId, sexta.data.propostaId];
    expect(sexta.data.bloqueada).toBe("sem_acesso");
    expect(umClique).not.toBe(conexao);
    expect(d.banco.propostas.find((p) => p.id === conexao)?.estado).toBe("confirmada");
    expect(d.banco.decisoes.find((x) => x.id === umClique)?.tipo).toBe("acesso");
  });

  it("'Continuar tarefa' no card de conexão do pré-voo vira o card de um clique da rotina; o clique repetido no card velho devolve o novo", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const conector = await gmail(d, false);
    const rotina = await rotinaAtiva(d, { fonte: "Gmail" });
    const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("bloqueada" in r.data) || !r.data.propostaId) throw new Error("deveria ter bloqueado");
    const conexao = r.data.propostaId;
    await d.deps.repos.conectores.habilitar(conector.id, true);
    const primeiro = await confirmarProposta(d.deps, { propostaId: conexao });
    expect(primeiro.data.proposta.id).not.toBe(conexao);
    expect(primeiro.data.proposta.payload).toMatchObject({ kind: "acesso", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], rotinaId: rotina.id });
    expect(primeiro.data.decisao).toMatchObject({ tipo: "acesso", id: primeiro.data.proposta.id });
    expect(primeiro.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada", "mensagem_criada"]);
    const repetido = await confirmarProposta(d.deps, { propostaId: conexao });
    expect(repetido.data.proposta.id).toBe(primeiro.data.proposta.id);
    expect(d.banco.propostas.filter((p) => p.estado === "pendente")).toHaveLength(1);
  });

  it("card aberto por pedir_acesso num turno (app fora da fonte) segura a janela seguinte; a concessão feita à mão libera", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const conector = await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "a caixa de entrada" });
    const oito = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in oito.data)) throw new Error("deveria ter disparado");
    const pedido = await pedirAcesso(d.deps, { turnoId: oito.data.turno.id, conversaId: rotina.conversaId, agenteId: rotina.agenteId, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    await d.deps.repos.turnos.assentar(oito.data.turno.id, { estado: "concluido" });
    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect(sexta.data).toMatchObject({ bloqueada: "sem_acesso", propostaId: pedido.data.proposta_id });

    await concederLote(d.deps, { agenteId: rotina.agenteId, conectorId: conector.id, capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], autorTipo: "pessoa" });
    const segunda = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEGUNDA, machineId: "m1", executor: "catcher" });
    expect("turno" in segunda.data).toBe(true);
  });

  it("a pergunta pendente da execução anterior segura só o AGENDADOR (aguardando_resposta); 'executar agora' roda", async () => {
    let agora = AGORA;
    const d = depsMemoria({ agora: () => agora });
    const rotina = await rotinaAtiva(d);
    const oito = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
    if (!("turno" in oito.data)) throw new Error("deveria ter disparado");
    await d.deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId: oito.data.turno.id, prazoDecisaoEm: AGORA + 86_400_000, frase: "qual repositório?" });
    await d.deps.repos.turnos.assentar(oito.data.turno.id, { estado: "concluido" });
    const sexta = await dispararRotina(d.deps, { rotina: await atual(d, rotina.id), instanteAgendado: SEXTA, machineId: "m1", executor: "catcher" });
    expect(sexta.data).toEqual({ bloqueada: "aguardando_resposta", propostaId: null, proximaExecucao: SEGUNDA });
    expect(d.banco.execucoes.map((e) => [e.desfecho, e.motivo])).toEqual([["bloqueada", "aguardando_resposta"]]);
    expect(sexta.events?.map((e) => e.kind)).toEqual(["rotina_bloqueada"]);
    agora = AGORA + 5 * 60_000; // fora do minuto das 08:00, que o agendador já reivindicou
    expect((await executarRotinaAgora(d.deps, { rotinaId: rotina.id, executor: "local" })).data.turnoId).toBeTruthy();
  });

  it("app citado que a pessoa NÃO registrou não trava: 'regressão linear' roda sem o Linear", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    await gmail(d);
    const rotina = await rotinaAtiva(d, { fonte: "planilha de regressão linear" });
    expect("turno" in (await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" })).data).toBe(true);
  });
});
