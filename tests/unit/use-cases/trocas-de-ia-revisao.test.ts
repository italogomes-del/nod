import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { PayloadTrocaDeIa } from "../../../src/contracts/troca-de-ia.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../../src/domain/cota-da-ia.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { seguirComConta } from "../../../src/use-cases/contas-ia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../../src/use-cases/emitir-plano-turno.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { avisarTrocaDeIa, decidirTrocaDeIa, varrerTrocasDeIa } from "../../../src/use-cases/trocas-de-ia.ts";
import { depsEmMemoria, esperarErro, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-108, revisão do PR 2 (16/10/2026): os achados C1–C6 e I1–I6 da troca de IA no limite. O cenário: o Eng 1 no
 * Automático, preso à vm-bots (a máquina dele), com o Claude · Pessoal e o ChatGPT · Pessoal na fila e o Claude · Leapy
 * (corporativa) fora; o Mac da pessoa tem outras contas.
 */
const T0 = Date.now();
const MIN = 60_000;
const HORA = 60 * MIN;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string, corporativa = false): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number | null): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm ?? undefined, erroCru: "usage limit" });
const pronto = { estado: "pronto" as const, versao: "2.1.296", em: T0 };
const PESSOA = { autor_tipo: "pessoa" as const, autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "pessoa" as const, regra_versao: 1 };

async function cenario(o: { fixo?: boolean; codexNaVm?: boolean; segundaCodex?: boolean } = {}) {
  const relogio = { agora: T0 };
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => relogio.agora });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Eng 1" });
  if (o.fixo) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: { modo: "fixa", fixa: "claude-cli" } });
  const vm = (await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) }))!.id;
  const mac = (await deps.repos.maquinaTokens.criar({ nome: "mac", prefixo: "9a1b", hash: randomBytes(32) }))!.id;
  await deps.repos.agentes.definirMaquina([bot.agente.id], vm);
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Leapy", true), ...(o.segundaCodex ? [anuncio(5, "codex-cli", "Reserva")] : [])], T0);
  // O Mac tem uma 2ª conta do Claude, NA FILA (a pessoa ligou), que a vm-bots não tem.
  await deps.repos.contasIa.doAnuncio(mac, [anuncio(4, "claude-cli", "Mac")], T0);
  const lista = (await deps.repos.contasIa.listar()).contas;
  const conta = (apelido: string, ia: IdHarness = "claude-cli") => lista.find((c) => c.apelido === apelido && c.ia === ia)!;
  await deps.repos.contasIa.definirTrocaAutomatica(conta("Mac").id, true);
  if (o.segundaCodex) await deps.repos.contasIa.definirTrocaAutomatica(conta("Reserva", "codex-cli").id, true);
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const task = async (o2: { sessao?: IdHarness | null } = {}) => {
    const t = await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "A1", origem: "pessoa", rotinaId: null, forma: "frente", ...(o2.sessao !== null ? { iniciadoEm: T0 - HORA } : {}) });
    if (o2.sessao !== null) await deps.repos.trabalhos.atualizarSessao(t!.id, `sessao-${o2.sessao ?? "claude-cli"}`, o2.sessao ?? "claude-cli", "local");
    const turno = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz a A1", entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: t!.id });
    return { trabalhoId: t!.id, turnoId: turno!.id };
  };
  const prontosPorMaquina = { [vm]: (o.codexNaVm === false ? ["claude-cli"] : ["claude-cli", "codex-cli"]) as IdHarness[], [mac]: ["claude-cli", "codex-cli"] as IdHarness[] };
  const bateNoLimite = async (turnoId: string, contaId: string, voltaEm: number | null, harness: IdHarness = "claude-cli") => {
    const t = banco.turnos.find((x) => x.id === turnoId)!;
    Object.assign(t, { estado: "despachando", machineId: vm, leaseAte: relogio.agora + HORA });
    await deps.repos.turnos.registrarConta(turnoId, contaId);
    return executar(deps, assentarTurno, { turnoId, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: limite(voltaEm), executor: "local", harness, prontosDaPessoa: ["claude-cli", "codex-cli"], prontosPorMaquina });
  };
  const despachar = () => executar(deps, despacharTurno, { machineId: vm, executor: "local", inventario: pronto, harnessesProntos: prontosPorMaquina[vm], harnessesDaPessoa: { "claude-cli": pronto, "codex-cli": pronto }, prontosPorMaquina });
  const trocas = () => banco.trocasDeIa;
  const avisos = () => banco.mensagens.filter((m) => m.payload?.kind === "troca_de_ia");
  const payload = () => avisos().at(-1)?.payload as PayloadTrocaDeIa | undefined;
  const voltaDe = (turnoId: string) => banco.turnos.find((x) => x.retomaTurnoId === turnoId);
  return { deps, banco, relogio, vm, mac, bot: bot.agente, conversaId: bot.conversa.id, conta, task, bateNoLimite, despachar, trocas, avisos, payload, voltaDe, prontosPorMaquina };
}

describe("C1: a cota medida não leva a task com sessão para outra IA", () => {
  it("Claude em 100% medido e o ChatGPT livre: a task com sessão no Claude espera a janela renovar e o aviso nasce", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "esgotado", cincoHoras: { utilizacao: 1, renovaEm: T0 + 3 * HORA }, semana: null, medidoEm: T0 }, c.vm);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.voltaDe(t.turnoId)).toMatchObject({ estado: "pendente", acordarEm: T0 + 3 * HORA, harness: "auto" });
    expect(c.trocas()).toMatchObject([{ iaDe: "claude-cli", iaPara: "codex-cli", voltaEm: T0 + 3 * HORA, machineId: c.vm }]);
  });

  it("na reserva (99,5%), a task que já começou segue no Claude: a sessão não sai para o ChatGPT", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.deps.repos.usoDoPlano.gravar({ harness: "claude-cli", situacao: "perto", cincoHoras: { utilizacao: 0.995, renovaEm: T0 + 3 * HORA }, semana: null, medidoEm: T0 }, c.vm);
    // O plano (emitir) não põe o Claude no "no limite" desta task: a sessão é dele.
    const plano = await executar(c.deps, emitirPlanoTurno, { turnoId: t.turnoId, machineId: c.vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(plano.data.harness).toBe("claude-cli");
    // E a guarda do despacho deixa passar (a reserva não segura o fundo que já começou).
    const r = await c.despachar();
    expect(r.data.plano?.turnoId).toBe(t.turnoId);
    expect(c.trocas()).toEqual([]);
  });
});

describe("C2: 'parou' e 'voltou' pela mesma regra, na máquina do bot", () => {
  it("uma conta do Claude livre só no Mac não fecha o aviso da vm-bots; e reabrir na janela não cria linha nova", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    expect(c.trocas()).toMatchObject([{ machineId: c.vm, decididoEm: null }]);
    // A "Mac" está na fila e livre, mas não está na vm-bots: o Claude NÃO voltou para o Eng 1.
    c.relogio.agora = T0 + MIN;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    // A conta da vm-bots volta: fecha "voltou".
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 1 });
    expect(c.avisos()).toHaveLength(1);
    // Acaba de novo logo depois: o aviso reabre (prazo novo), mas na MESMA linha da conversa.
    const b = await c.task();
    c.relogio.agora = T0 + 5 * MIN;
    await c.bateNoLimite(b.turnoId, c.conta("Pessoal").id, T0 + 3 * HORA);
    expect(c.trocas()).toHaveLength(2);
    expect(c.trocas()[1]).toMatchObject({ decididoEm: null, mensagemId: c.trocas()[0]!.mensagemId });
    expect(c.avisos()).toHaveLength(1);
    expect(c.payload()?.decisao).toBeUndefined();
    // A guarda do despacho, com a fila da vm-bots ainda no limite, só atualiza o mesmo aviso.
    const d = await c.task();
    void d;
    await c.despachar();
    expect(c.trocas().filter((t) => t.decididoEm === null)).toHaveLength(1);
    expect(c.avisos()).toHaveLength(1);
  });
});

describe("C3: a decisão 'esperar' vale para as tasks seguintes", () => {
  it("outra task que para não abre aviso nem prazo novo; quando o Claude volta, o varredor acorda as esperas", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" });
    const b = await c.task();
    c.relogio.agora = T0 + MIN;
    await c.bateNoLimite(b.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas()).toHaveLength(1);
    expect(c.trocas()[0]).toMatchObject({ decisao: "esperar", voltouEm: null });
    expect(c.avisos()).toHaveLength(1);
    expect(c.payload()).toMatchObject({ decisao: "esperar", tasks: 2 });
    // O varredor não leva nada: a pessoa escolheu esperar.
    c.relogio.agora = T0 + 20 * MIN;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ aplicadas: 0, voltaram: 0 });
    expect(c.voltaDe(b.turnoId)).toMatchObject({ harness: "auto", acordarEm: T0 + 16 * HORA });
    // O Claude volta antes do prazo: as esperas acordam já.
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 1 });
    expect(c.voltaDe(a.turnoId)).toMatchObject({ acordarEm: null, harness: "auto" });
    expect(c.voltaDe(b.turnoId)).toMatchObject({ acordarEm: null, harness: "auto" });
    expect(c.trocas()[0]?.voltouEm).toBe(c.relogio.agora);
    // Depois da volta, o próximo limite abre aviso de novo.
    const d = await c.task();
    await c.bateNoLimite(d.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas().filter((t) => t.decididoEm === null)).toHaveLength(1);
  });
});

describe("C5: 'levar' só para uma IA pronta na máquina do bot", () => {
  it("o ChatGPT só no Mac: a recomendação vira esperar, sem prazo, o cartão diz por quê, e 'levar' é recusado", async () => {
    const c = await cenario({ codexNaVm: false });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.trocas()).toMatchObject([{ iaPara: null, recomendacao: "esperar", aplicarEm: null }]);
    expect(c.payload()).toMatchObject({ iaPara: null, foraDaMaquina: { ia: "codex-cli", maquina: "vm-bots" } });
    expect(c.avisos()[0]?.texto).toMatch(/O ChatGPT não está em vm-bots, a máquina do Eng 1\./);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" }), "entrada_invalida");
    // O varredor nunca aplica sozinho.
    c.relogio.agora = T0 + HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ aplicadas: 0 });
  });

  it("a task SEM sessão também espera (não 'segue no ChatGPT' que a máquina do bot não tem)", async () => {
    const c = await cenario({ codexNaVm: false });
    const t = await c.task({ sessao: null });
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    expect(c.voltaDe(t.turnoId)?.entradaTexto).not.toMatch(/passou este trabalho/);
    expect(c.trocas()).toEqual([]);
  });
});

describe("C6: levar as tasks para o Automático", () => {
  it("fixa cada turno na IA que o Automático escolheria agora na máquina do bot (fora a que parou)", async () => {
    const c = await cenario({ fixo: true });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    const r = await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "auto", levarTasks: true }, prontosPorMaquina: c.prontosPorMaquina });
    expect(r.data.tasksLevadas).toBe(1);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ harness: "codex-cli", modelo: "auto", acordarEm: null });
  });

  it("sem IA pronta na máquina do bot fora a que parou: não leva e avisa na conversa dele", async () => {
    const c = await cenario({ fixo: true, codexNaVm: false });
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    const r = await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { modo: "auto", levarTasks: true }, prontosPorMaquina: c.prontosPorMaquina });
    expect(r.data).toMatchObject({ tasksLevadas: 0, semIaParaLevar: true });
    expect(c.voltaDe(t.turnoId)).toMatchObject({ harness: "claude-cli", acordarEm: T0 + 16 * HORA });
    expect(c.banco.mensagens.at(-1)?.texto).toMatch(/Nenhuma IA está pronta agora na máquina do Eng 1/);
  });
});

describe("I1: no ChatGPT, trocar de conta perde a sessão", () => {
  it("a task com sessão na conta que parou espera; o aviso recomenda e 'levar' segue noutra conta do ChatGPT", async () => {
    const c = await cenario({ segundaCodex: true });
    await c.deps.repos.contasIa.marcarLimite(c.conta("Pessoal").id, T0 + 5 * HORA);
    const t = await c.task({ sessao: "codex-cli" });
    await c.deps.repos.trabalhos.definirContaDaSessao(t.trabalhoId, c.conta("Pessoal", "codex-cli").id);
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal", "codex-cli").id, T0 + 16 * HORA, "codex-cli");
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + 16 * HORA });
    expect(c.trocas()).toMatchObject([{ iaDe: "codex-cli", iaPara: "codex-cli", contaDe: c.conta("Pessoal", "codex-cli").id, recomendacao: "levar" }]);
    expect(c.payload()).toMatchObject({ contaDe: { apelido: "Pessoal" } });
    expect(c.avisos()[0]?.texto).toMatch(/^A conta Pessoal do ChatGPT chegou ao limite/);
    // Com a outra conta do ChatGPT livre, o varredor NÃO fecha como "voltou" (a conta da sessão segue parada).
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ fechadas: 0 });
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "levar" });
    const volta = c.voltaDe(t.turnoId)!;
    expect(volta).toMatchObject({ harness: "codex-cli", acordarEm: null });
    expect(volta.entradaTexto.startsWith(ENTRADA_DA_VOLTA_DA_COTA)).toBe(true);
    expect(volta.entradaTexto).toMatch(/outra conta do ChatGPT/);
  });

  it("no Claude a sessão é compartilhada: a task segue na hora na outra conta, sem aviso", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.definirTrocaAutomatica(c.conta("Leapy").id, true);
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 });
    expect(c.trocas()).toEqual([]);
  });
});

describe("I2: um aviso por bot E por IA", () => {
  it("o limite das duas IAs no mesmo bot não se mistura; com dois abertos, a decisão diz qual (trocaId)", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 16 * HORA);
    // O ChatGPT também parou para outra task do mesmo bot (o aviso dele nasce pela mesma porta).
    await avisarTrocaDeIa(c.deps, { agenteId: c.bot.id, conversaId: c.conversaId, turnoId: null, iaDe: "codex-cli", iaPara: "claude-cli", voltaEm: T0 + 2 * HORA, fixo: false, machineId: c.vm, autoria: { ...PESSOA }, agora: T0 });
    expect(c.trocas().map((t) => [t.iaDe, t.decididoEm])).toEqual([["claude-cli", null], ["codex-cli", null]]);
    expect(c.avisos()).toHaveLength(2);
    await esperarErro(() => executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar" }), "entrada_invalida");
    const r = await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "esperar", trocaId: c.trocas()[1]!.id });
    expect(r.data).toMatchObject({ aplicada: true });
    expect(c.trocas().map((t) => t.decisao)).toEqual([null, "esperar"]);
  });
});

describe("I3: a volta do bot fixo", () => {
  it("sem mudança da pessoa: volta ao fixo e as tasks voltam ao Claude", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" });
    c.relogio.agora = T0 + 2 * HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(1);
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "fixa", fixa: "claude-cli" });
    expect(c.voltaDe(task.turnoId)).toMatchObject({ harness: "claude-cli" });
  });

  it("a pessoa trocou a ordem do bot depois: a inteligência dela vale e nada volta", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, decidirTrocaDeIa, { agenteId: c.bot.id, decisao: "outra_ia" });
    await executar(c.deps, definirInteligenciaDoBot, { agenteId: c.bot.id, pedido: { ordem: ["codex-cli", "claude-cli"] } });
    c.relogio.agora = T0 + 2 * HORA;
    expect((await varrerTrocasDeIa(c.deps)).restaurados).toBe(0);
    expect((await c.deps.repos.agentes.buscar(c.bot.id))?.inteligencia).toMatchObject({ modo: "auto", ordem: ["codex-cli", "claude-cli"] });
    expect(c.voltaDe(task.turnoId)).toMatchObject({ harness: "codex-cli" });
  });
});

// Regression: re-QA do PR #329 (merge 62d2c747) — o "Continuar na conta" do aviso só de tasks acordava as tasks e a tela
// ainda dizia "Essa fala não está parada no limite; nada foi repetido" (motivo turno_nao_interrompido do núcleo da NOD-284).
// Found by /qa on 2026-10-16
// Report: comentário de re-QA no PR #329
describe("re-QA PR #329: 'Continuar na conta' do aviso de tasks não volta com motivo", () => {
  it("aviso sem fala da conversa: acorda a task, fecha o aviso e não diz que nada aconteceu", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    const r = await executar(c.deps, seguirComConta, { contaId: c.conta("Leapy").id, conversaId: c.conversaId });
    expect(c.trocas()[0]).toMatchObject({ decisao: "conta" });
    expect(r.data).toEqual({ turnoId: null, motivo: null });
    // Sem aviso para fechar nem fala parada, o mesmo clique segue dizendo por que não refez.
    const outra = await executar(c.deps, seguirComConta, { contaId: c.conta("Leapy").id, conversaId: c.conversaId });
    expect(outra.data).toEqual({ turnoId: null, motivo: "turno_nao_interrompido" });
  });
});

describe("I4: a escolhida fora da fila não vira caminho silencioso", () => {
  it("'Continuar na conta Leapy' grava a escolhida; quando a fila da vm-bots volta, o varredor a solta", async () => {
    const c = await cenario({ fixo: true });
    const task = await c.task();
    await c.bateNoLimite(task.turnoId, c.conta("Pessoal").id, T0 + 2 * HORA);
    await executar(c.deps, seguirComConta, { contaId: c.conta("Leapy").id, conversaId: c.conversaId });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.conta("Leapy").id });
    expect(c.trocas()[0]).toMatchObject({ decisao: "conta", voltouEm: null });
    c.relogio.agora = T0 + HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 0 });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.conta("Leapy").id });
    c.relogio.agora = T0 + 2 * HORA;
    expect(await varrerTrocasDeIa(c.deps)).toMatchObject({ voltaram: 1 });
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({});
  });
});

describe("I5: o varredor isola cada aviso", () => {
  it("um aviso que lança não impede os outros (e o que lança fica para o próximo tique)", async () => {
    const c = await cenario();
    const a = await c.task();
    await c.bateNoLimite(a.turnoId, c.conta("Pessoal").id, T0 + 20 * MIN);
    const outro = await executar(c.deps, criarAgente, { dono: "pessoa", nome: "Eng 2" });
    await c.deps.repos.agentes.definirMaquina([outro.data.agente.id], c.vm);
    const t2 = await c.deps.repos.trabalhos.criar({ agenteId: outro.data.agente.id, conversaId: outro.data.conversa.id, titulo: "B1", origem: "pessoa", rotinaId: null, forma: "frente" });
    await c.deps.repos.trabalhos.atualizarSessao(t2!.id, "s", "claude-cli", "local");
    const turno2 = await c.deps.repos.turnos.enfileirar({ conversaId: outro.data.conversa.id, agenteId: outro.data.agente.id, origem: "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "faz", entradaConfianca: "confiavel", modelo: "auto", harness: "auto", executor: "local", trabalhoId: t2!.id });
    await c.bateNoLimite(turno2!.id, c.conta("Pessoal").id, T0 + 20 * MIN);
    expect(c.trocas()).toHaveLength(2);
    await c.deps.repos.contasIa.limparLimite(c.conta("Pessoal").id);
    const buscar = c.deps.repos.agentes.buscar.bind(c.deps.repos.agentes);
    c.deps.repos.agentes.buscar = async (id: string) => { if (id === c.bot.id) throw new Error("falha de teste"); return buscar(id); };
    const isolados: number[] = [];
    const r = await varrerTrocasDeIa(c.deps, { isolar: async (fn) => { isolados.push(1); return fn(); } });
    expect(isolados).toHaveLength(2);
    expect(r.fechadas).toBe(1);
    expect(c.trocas().map((t) => t.decisao)).toEqual([null, "voltou"]);
  });
});

describe("I6: sem a hora do fornecedor, a volta fica vazia", () => {
  it("o aviso grava volta nula, recomenda levar e diz que o Claude não disse quando volta; a task tenta de novo em 1 h", async () => {
    const c = await cenario();
    const t = await c.task();
    await c.bateNoLimite(t.turnoId, c.conta("Pessoal").id, null);
    expect(c.trocas()).toMatchObject([{ voltaEm: null, recomendacao: "levar", aplicarEm: T0 + 10 * MIN }]);
    expect(c.payload()).toMatchObject({ voltaEm: null });
    expect(c.avisos()[0]?.texto).toMatch(/o Claude não disse quando volta/);
    expect(c.voltaDe(t.turnoId)).toMatchObject({ acordarEm: T0 + HORA });
  });
});

describe("I8: o despacho lê as contas uma vez", () => {
  it("a guarda da sessão usa a mesma leitura da guarda das contas", async () => {
    const c = await cenario();
    await c.task();
    let leituras = 0;
    const listar = c.deps.repos.contasIa.listar.bind(c.deps.repos.contasIa);
    c.deps.repos.contasIa.listar = async () => { leituras++; return listar(); };
    await c.despachar();
    // Uma para as duas guardas; o plano (emitir) lê a dele.
    expect(leituras).toBeLessThanOrEqual(2);
  });
});
