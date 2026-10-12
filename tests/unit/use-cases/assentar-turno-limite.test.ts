import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdHarness } from "../../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../../src/contracts/turno.ts";
import { PRAZO_LIMITE_SEM_HORARIO_MS } from "../../../src/domain/inteligencia.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { definirInteligenciaDoBot } from "../../../src/use-cases/inteligencia.ts";
import { depsEmMemoria, executar, MARLON } from "../../helpers/deps-l6.ts";

const T0 = Date.now();
const DUAS_HORAS = 2 * 3_600_000;
const base = {
  texto: "", sessaoCli: null, custoUsd: 0, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false },
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
} satisfies Omit<ResultadoTurno, "desfecho">;
/** O que o driver do Claude entrega com `rate_limit_event` `rejected` e o `result` com erro (stream-json.ts). */
const limiteDoClaude = (voltaEm: number | null): ResultadoTurno => ({ ...base, desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm, erroCru: "Claude AI usage limit reached" });
/** O Codex só diz em texto (erro-fornecedor.ts, classe limite_de_uso), sem horário. */
const limiteDoCodex: ResultadoTurno = { ...base, desfecho: "falha", motivoFalha: "erro_execucao", erroCru: "You've hit your usage limit. Upgrade to Pro" };
const sucesso: ResultadoTurno = { ...base, desfecho: "sucesso", texto: "Pronto." };

/**
 * definido em 2026-10-10 (emenda da ADR-036; teste do Breno em 09/10): no limite da assinatura, o bot no Automático
 * repete o pedido na próxima IA da ordem e a conversa ganha a linha "chegou ao limite · respondendo pelo".
 */
async function cenario(o: { pedido?: unknown; origem?: "conversa" | "rotina" } = {}) {
  const { deps, banco } = depsEmMemoria(MARLON, { relogio: () => T0 });
  const { data: bot } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Assistente pessoal" });
  if (o.pedido) await executar(deps, definirInteligenciaDoBot, { agenteId: bot.agente.id, pedido: o.pedido });
  const agente = (await deps.repos.agentes.buscar(bot.agente.id))!;
  const origem = await deps.repos.mensagens.criar({ conversaId: bot.conversa.id, autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId, sob_procuracao_de: null, conta_de_execucao: MARLON.pessoaId, executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "texto", texto: "oi", confianca: "confiavel" });
  const t = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: o.origem ?? "conversa", prazoEm: T0 + 86_400_000, profundidade: 0, entradaTexto: "oi", mensagemOrigemId: origem!.id, entradaConfianca: "confiavel", modelo: agente.modelo, harness: agente.harness, executor: "local" });
  const maquina = randomUUID();
  await deps.repos.turnos.reivindicar({ machineId: maquina, agora: T0 });
  const antes = banco.mensagens.length;
  const entregar = (resultado: ResultadoTurno, harness: IdHarness, prontosDaPessoa: IdHarness[] = ["claude-cli", "codex-cli"]) =>
    executar(deps, assentarTurno, { turnoId: t!.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "local", harness, prontosDaPessoa });
  return { deps, banco, turnoId: t!.id, antes, entregar };
}

describe("assentarTurno: a IA chegou ao limite da assinatura", () => {
  it("Automático com outra IA pronta: grava o limite, repete na próxima da ordem e a conversa ganha a linha da troca", async () => {
    const c = await cenario();
    const r = await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
    expect(r.data.limiteMudou).toBe(true);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({ "claude-cli": { renovaEm: T0 + DUAS_HORAS, desde: T0 } });
    const novas = c.banco.mensagens.slice(c.antes);
    expect(novas.map((m) => m.kind)).toEqual(["sistema"]);
    expect(novas[0]?.payload).toEqual({ kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite", renovaEm: T0 + DUAS_HORAS });
    expect(novas[0]?.texto).toMatch(/^O Claude Code chegou ao limite da assinatura · respondendo pelo Codex\. Ele volta a ser usado (às|em \d\d\/\d\d às) \d\d:\d\d\.$/);
    const repetido = c.banco.turnos.filter((t) => t.id !== c.turnoId);
    expect(repetido).toMatchObject([{ estado: "pendente", origem: "conversa", entradaTexto: "oi", harness: "auto", modelo: "auto", reenvios: 1 }]);
    expect(r.events.map((e) => e.kind)).toEqual(["turno_interrompido", "mensagem_criada", "turno_criado"]);
    expect(r.events[0]?.dados).toMatchObject({ motivo_falha: "limite_do_plano", ia_no_limite: "claude-cli", renova_em: T0 + DUAS_HORAS });
  });

  it("a ordem do bot decide para onde vai; o Codex no limite sem horário fica fora por 1 h", async () => {
    const c = await cenario({ pedido: { ordem: ["codex-cli", "claude-cli"] } });
    await c.entregar(limiteDoCodex, "codex-cli");
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({ "codex-cli": { renovaEm: T0 + PRAZO_LIMITE_SEM_HORARIO_MS, desde: T0 } });
    expect(c.banco.mensagens.slice(c.antes)[0]?.payload).toMatchObject({ kind: "ia_trocada", de: "codex-cli", para: "claude-cli", causa: "limite" });
  });

  it("sem outra IA pronta fora do limite: o aviso do limite de sempre (com a hora) e nada repetido; o limite fica gravado", async () => {
    for (const prontos of [["claude-cli"], ["claude-cli", "codex-cli"]] as IdHarness[][]) {
      const c = await cenario();
      if (prontos.length === 2) await c.deps.repos.preferencias.registrarLimite("codex-cli", { renovaEm: T0 + DUAS_HORAS, desde: T0 });
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli", prontos);
      const novas = c.banco.mensagens.slice(c.antes);
      expect(novas.map((m) => m.payload?.kind), JSON.stringify(prontos)).toEqual(["limite_do_plano"]);
      expect(c.banco.turnos, JSON.stringify(prontos)).toHaveLength(1);
      expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"]?.renovaEm).toBe(T0 + DUAS_HORAS);
    }
  });

  it("Uma IA só e turno de rotina não trocam de IA sozinhos (o limite fica gravado para os outros bots)", async () => {
    for (const o of [{ pedido: { modo: "fixa", fixa: "claude-cli" } }, { origem: "rotina" as const }]) {
      const c = await cenario(o);
      await c.entregar(limiteDoClaude(T0 + DUAS_HORAS), "claude-cli");
      expect(c.banco.mensagens.slice(c.antes).map((m) => m.payload?.kind), JSON.stringify(o)).toEqual(["limite_do_plano"]);
      expect(c.banco.turnos, JSON.stringify(o)).toHaveLength(1);
      expect((await c.deps.repos.preferencias.buscar()).iasNoLimite?.["claude-cli"], JSON.stringify(o)).toBeDefined();
    }
  });

  it("um turno que dá certo na IA a tira do limite antes do prazo", async () => {
    const c = await cenario();
    await c.deps.repos.preferencias.registrarLimite("claude-cli", { renovaEm: T0 + DUAS_HORAS, desde: T0 });
    const r = await c.entregar(sucesso, "claude-cli");
    expect(r.data.limiteMudou).toBe(true);
    expect((await c.deps.repos.preferencias.buscar()).iasNoLimite).toEqual({});
  });
});
