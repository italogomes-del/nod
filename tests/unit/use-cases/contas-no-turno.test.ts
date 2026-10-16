import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ContaAnunciada } from "../../../src/contracts/contas-ia.ts";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { seguirComConta } from "../../../src/use-cases/contas-ia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

/**
 * ADR-102 (2026-10-13): o turno usa uma conta da lista da pessoa. No limite, quem para é a conta (não a IA): com outra
 * IA em uso na máquina o turno segue nela; sem outra conta na fila, a nota oferece as contas livres; sem conta
 * utilizável, o despacho nem gasta turno pago. O exemplo do Marlon: Claude · Pessoal, ChatGPT · Pessoal, Claude · Leapy.
 * ADR-108 (2026-10-16): a lista é a fila — a 1ª pessoal de cada IA nasce nela, a Leapy (2ª do Claude) nasce fora.
 */
const T0 = Date.now();
const HORA = 3_600_000;
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: T0 - HORA, apelidoSugerido: apelido });
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
const limite = (voltaEm: number): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "usage limit" });

async function cenario(o: { origem?: "conversa" | "rotina"; comTask?: boolean } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Ze 1" });
  const chave = await deps.repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: "8f2a", hash: randomBytes(32) });
  const vm = chave!.id;
  await deps.repos.contasIa.doAnuncio(vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal"), anuncio(3, "claude-cli", "Leapy")], T0);
  const [cPessoal, gPessoal, cLeapy] = (await deps.repos.contasIa.listar()).contas;
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "revisa o #861", confianca: "confiavel" });
  const task = o.comTask ? await deps.repos.trabalhos.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, titulo: "Revisar o #861", origem: "rotina", rotinaId: null, forma: "frente" }) : null;
  const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "revisa o #861", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local", trabalhoId: task?.id ?? null });
  const antes = banco.mensagens.length;
  const despachar = () => executar(deps, despacharTurno, { machineId: vm, executor: "local", inventario: { estado: "pronto", versao: "2.1.296", em: T0 }, harnessesProntos: ["claude-cli", "codex-cli"] });
  const reivindicar = () => deps.repos.turnos.reivindicar({ machineId: vm, agora: T0 });
  const entregar = (resultado: ResultadoTurno, harness: IdHarness) =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: vm, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "local", harness, prontosDaPessoa: ["claude-cli", "codex-cli"] });
  return { deps, banco, vm, turnoId: t!.id, conversaId: bot.conversa.id, contas: { cPessoal: cPessoal!, gPessoal: gPessoal!, cLeapy: cLeapy! }, antes, despachar, reivindicar, entregar };
}

describe("a conta do turno no limite (ADR-102)", () => {
  it("com outra IA em uso na máquina: marca a CONTA (não a IA), segue no ChatGPT e refaz a fala com a linha pelo apelido", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBe(T0 + 2 * HORA);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite ?? {}).toEqual({});
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.payload)).toEqual([{ kind: "conta_seguiu", de: { id: c.contas.cPessoal.id, apelido: "Pessoal", ia: "claude-cli" }, para: { id: c.contas.gPessoal.id, apelido: "Pessoal", ia: "codex-cli" }, voltaEm: T0 + 2 * HORA }]);
    expect(novas[0]?.texto).toMatch(/^Claude · Pessoal no limite na vm-bots até .+\. Seguindo com ChatGPT · Pessoal\.$/);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", entradaTexto: "revisa o #861", reenvios: 1 }]);
  });

  it("sem outra conta do Claude na fila e o ChatGPT também no limite: nota com as contas livres (fora da fila), nada refeito", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]?.texto).toMatch(/^Claude · Pessoal no limite na vm-bots até .+\. Seguir com Claude · Leapy\?$/);
    expect(novas[0]?.payload).toMatchObject({ kind: "limite_do_plano", harness: "claude-cli", contas: { de: { id: c.contas.cPessoal.id }, livres: [{ id: c.contas.cLeapy.id, naMaquina: true }], maquina: { id: c.vm, nome: "vm-bots" } } });
    expect(c.banco.turnos).toHaveLength(1);
  });

  it("ADR-108 (R1/R7): com a Leapy na fila, segue nela sozinho, sem perguntar, antes de mudar de IA — linha leve", async () => {
    const c = await cenario();
    expect(c.contas.cLeapy.entraNaTrocaAutomatica).toBe(false);
    await c.deps.repos.contasIa.definirTrocaAutomatica(c.contas.cLeapy.id, true);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    const linha = c.banco.mensagens.slice(c.antes)[0];
    expect(linha?.payload).toMatchObject({ kind: "conta_seguiu", para: { id: c.contas.cLeapy.id } });
    expect(linha?.texto).toMatch(/^Pessoal acabou às .+ → seguindo no Claude · Leapy · mesmo modelo$/);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 1 }]);
  });

  it("ADR-108 (R1): o 'Trocar sozinho' antigo (contas_modo) não decide mais nada — a Leapy fora da fila não entra sozinha", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.definirModo("automatico");
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar(limite(T0 + 2 * HORA), "claude-cli");
    expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "conta_seguiu", para: { id: c.contas.gPessoal.id } });
  });

  it("o turno que dá certo tira a conta do limite antes do prazo", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + HORA);
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "sucesso", texto: "feito" }, "claude-cli");
    expect((await c.deps.repos.contasIa.buscar(c.contas.cPessoal.id))?.noLimiteAte).toBeNull();
  });

  it("R6: a máquina não tinha mais a conta — o vínculo sai e a fala é refeita uma vez", async () => {
    const c = await cenario();
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "claude-cli");
    expect((await c.deps.repos.contasIa.listar()).vinculos.some((v) => v.contaId === c.contas.cPessoal.id)).toBe(false);
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", reenvios: 1 }]);
  });

  it("R6: na segunda ausência (a fala já foi refeita uma vez) não refaz de novo", async () => {
    const c = await cenario();
    const t = c.banco.turnos.find((x) => x.id === c.turnoId)!;
    t.reenvios = 1;
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.cPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "claude-cli");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente")).toEqual([]);
  });

  it("R6 numa task: não vira 'limite' (frase e IA erradas) nem retomada sem freio — fica o aviso de sempre", async () => {
    const c = await cenario({ origem: "rotina", comTask: true });
    await c.reivindicar();
    await c.deps.repos.turnos.registrarConta(c.turnoId, c.contas.gPessoal.id);
    await c.entregar({ ...base, desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", contaAusente: true }, "codex-cli");
    expect(c.banco.turnos.filter((x) => x.estado === "pendente")).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.texto).join(" ")).not.toMatch(/limite/i);
  });
});

describe("o despacho sem conta utilizável (ADR-102)", () => {
  it("conversa: nenhuma conta serve sem a pessoa decidir — o turno para com a nota, sem plano (nenhum turno pago)", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
    const nota = c.banco.mensagens.slice(c.antes)[0];
    expect(nota?.payload).toMatchObject({ kind: "limite_do_plano", contas: { de: { id: c.contas.cPessoal.id }, livres: [{ id: c.contas.cLeapy.id, naMaquina: true }] } });
  });

  it("com conta utilizável, o despacho segue e o plano sai", async () => {
    const c = await cenario();
    const r = await c.despachar();
    expect(r.data.plano).not.toBeNull();
  });

  it("frente (task): espera a primeira conta renovar numa retomada que acorda na hora; o turno nunca volta a 'pendente'", async () => {
    const c = await cenario({ origem: "rotina", comTask: true });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.find((t) => t.id === c.turnoId)).toMatchObject({ estado: "interrompido", motivoFalha: "limite_do_plano" });
    expect(c.banco.turnos.filter((t) => t.id !== c.turnoId)).toMatchObject([{ estado: "pendente", origem: "retomada", retomaTurnoId: c.turnoId, acordarEm: T0 + 2 * HORA }]);
  });

  it("fundo sem task (rotina antiga): a nota com a espera fica na conversa, nada refeito", async () => {
    const c = await cenario({ origem: "rotina" });
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.cLeapy.id, T0 + 4 * HORA);
    const r = await c.despachar();
    expect(r.data).toMatchObject({ plano: null, motivo: "executor_indisponivel" });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toEqual([]);
    expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind)).toEqual(["limite_do_plano"]);
  });

  it("'Seguir com' grava a escolhida da IA e refaz a fala que parou no limite", async () => {
    const c = await cenario();
    await c.deps.repos.contasIa.marcarLimite(c.contas.cPessoal.id, T0 + 2 * HORA);
    await c.deps.repos.contasIa.marcarLimite(c.contas.gPessoal.id, T0 + 3 * HORA);
    await c.despachar();
    const r = await executar(c.deps, seguirComConta, { contaId: c.contas.cLeapy.id, conversaId: c.conversaId });
    expect(r.data.turnoId).not.toBeNull();
    expect((await c.deps.repos.contasIa.modo()).escolhidas).toEqual({ "claude-cli": c.contas.cLeapy.id });
    expect(c.banco.mensagens.at(-1)).toMatchObject({ texto: "Seguindo com Claude · Leapy.", payload: { kind: "conta_escolhida", contaId: c.contas.cLeapy.id } });
    // De novo não refaz: já há uma fala nova pendente.
    const r2 = await executar(c.deps, seguirComConta, { contaId: c.contas.cLeapy.id, conversaId: c.conversaId });
    expect(c.banco.turnos.filter((t) => t.estado === "pendente")).toHaveLength(1);
    void r2;
  });
});
