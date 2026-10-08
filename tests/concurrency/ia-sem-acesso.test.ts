import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna } from "../../src/adapters/fundo/ponte-interna.ts";
import { iniciarLaco } from "../../src/adapters/executor/laco.ts";
import type { Driver, Registry } from "../../src/adapters/executor/spi.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * A conta da IA entrou e não serve (definido em 2026-10-05, emenda da ADR-019), de ponta a ponta no servidor: a ponte
 * in-process, o laço de verdade e dois drivers de mentira no lugar do Claude Code e do Codex. Medido em produção nesse
 * dia: todo turno voltava com a recusa do fornecedor e a conversa a mostrava como fala do bot.
 *
 * Terceiro modo (ADR-011): a ponte abre transações REAIS por pessoa; linhas commitadas, apagadas no afterEach. Pessoa
 * própria deste arquivo (uuid aleatório): a fila é por pessoa.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO: Inventario = { estado: "pronto", versao: "teste", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const base = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();
/** As IAs que a máquina do teste anuncia agora (o que `ponteHttp.harnesses` devolve em compor.ts). */
let harnessesDaMaquina: () => Partial<Record<"claude-cli" | "codex-cli", Inventario>> = () => ({});
/**
 * O plano sai do caso de uso de verdade, como o servidor o compõe para as máquinas (compor.ts): executor local e as IAs
 * que a máquina anuncia. O dublê de `servicosDeTeste` só emite plano do catcher.
 */
const services: typeof base = {
  ...base,
  planos: {
    ...base.planos,
    async emitir(trx, turnoId, machineId) {
      const d = depsSobreTrx(trx, PESSOA, { services });
      const r = await emitirPlanoTurno(d, { turnoId, machineId, executor: "local", permitirResume: false, harnesses: harnessesDaMaquina() });
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
      return r.data;
    },
  },
};

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_diagnosticos where owner_id = ${p}`.catch(() => undefined);
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from pendencias where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-081 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const BASE: Omit<ResultadoTurno, "desfecho" | "texto"> = { sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
/** O que o driver do Claude entrega depois de `comContaSemAcesso`: falha com a causa, sem a frase do fornecedor. */
const SEM_ACESSO: ResultadoTurno = { ...BASE, desfecho: "falha", motivoFalha: "nao_autenticado", causaSemIa: "conta_sem_acesso", texto: "", erroCru: "success | Your organization has disabled Claude subscription access for Claude Code" };

function driverFixo(id: "claude-cli" | "codex-cli", resultado: () => ResultadoTurno, rodou: string[]): Driver {
  return {
    meta: { id, locality: "local" },
    async create() {
      return {
        sondar: async () => PRONTO,
        dispose: async () => {},
        adapter: () => ({
          async rodarTurno(sinks) {
            await sinks.sinal("attempted");
            await sinks.sinal("promptSubmitted");
            rodou.push(id);
            return resultado();
          },
          async interromper() {},
        }),
      };
    },
  };
}

const esperarAte = async (cond: () => Promise<boolean>, ms = 15_000) => {
  const fim = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fim) throw new Error("esperarAte: tempo esgotado");
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function montar(harnesses: Partial<Record<"claude-cli" | "codex-cli", Inventario>>) {
  const machineId = randomUUID();
  const ponte = criarPonteInterna(db, { services, useCases, executor: "local", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id), erroCruNoLog: false });
  await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, harnesses, versaoContrato: 1 });
  harnessesDaMaquina = () => ponte.maquinasConectadas().find((m) => m.machineId === machineId)?.harnesses ?? {};
  const rodou: string[] = [];
  const claude = driverFixo("claude-cli", () => SEM_ACESSO, rodou);
  const codex = driverFixo("codex-cli", () => ({ ...BASE, desfecho: "sucesso", texto: "Oi! Respondi pelo Codex." }), rodou);
  const registry: Registry = {
    catcher: { estado: "sombra", motivo: "teste" },
    "claude-cli": { estado: "pronto", driver: claude, instance: await claude.create({ env: {}, cwdBase: "/tmp/nao-usado" }) },
    "codex-cli": { estado: "pronto", driver: codex, instance: await codex.create({ env: {}, cwdBase: "/tmp/nao-usado" }) },
  };
  const conversaId = await escopado(async (trx) => {
    const deps = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Frida" })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "oi", inventario: PRONTO, executor: "local" });
    return c.conversa.id;
  });
  const laco = iniciarLaco({ ponte, registry, pessoaId: PESSOA.pessoaId, machineId, relogio: Date.now, esperaVaziaMs: 20, jitterMs: 5, renovacaoMs: 200 });
  // Só o que veio da fala da pessoa em diante (a conversa nasce com a linha de sistema da criação do bot).
  const mensagens = async () => {
    const todas = await escopado((trx) => trx<{ kind: string; texto: string; payload: Record<string, unknown> | null }[]>`select kind, texto, payload from mensagens where conversa_id = ${conversaId} order by criado_em, id`);
    return todas.slice(todas.findIndex((m) => m.kind === "texto" && m.texto === "oi"));
  };
  const turnos = () => escopado((trx) => trx<{ estado: string; harness: string; motivo_interrupcao: string | null }[]>`select estado, harness, motivo_interrupcao from turnos where conversa_id = ${conversaId} order by criado_em, id`);
  return { ponte, machineId, laco, rodou, mensagens, turnos };
}

describeIntegracao("a conta da IA entrou e não serve (2026-10-05)", () => {
  it("bot em automático, Claude sem acesso e Codex pronto: a resposta chega pelo Codex, com UMA linha de troca e sem a recusa na conversa", { timeout: 40_000 }, async () => {
    const c = await montar({ "claude-cli": PRONTO, "codex-cli": PRONTO });
    try {
      await esperarAte(async () => (await c.mensagens()).some((m) => m.texto === "Oi! Respondi pelo Codex."));
      const msgs = await c.mensagens();
      expect(msgs.map((m) => m.kind)).toEqual(["texto", "sistema", "texto"]);
      expect(msgs[1]?.payload).toMatchObject({ kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "conta_sem_acesso" });
      expect(msgs.some((m) => m.texto.includes("disabled Claude subscription"))).toBe(false);
      // Cada IA rodou uma vez: o Claude não é tentado de novo depois de reprovado.
      expect(c.rodou).toEqual(["claude-cli", "codex-cli"]);
      expect((await c.turnos()).map((t) => [t.estado, t.motivo_interrupcao])).toEqual([["interrompido", "executor_indisponivel"], ["concluido", null]]);
      // A máquina passa a anunciar o Claude como fora, com a causa; o Codex vira a IA em uso.
      const maquina = c.ponte.maquinasConectadas().find((m) => m.machineId === c.machineId);
      expect(maquina?.harnesses?.["claude-cli"]).toMatchObject({ estado: "nao_autenticado", causa: "conta_sem_acesso" });
      expect(maquina?.inventario.estado).toBe("pronto");
    } finally {
      await c.laco.parar();
    }
  });

  it("só o Claude neste Mac: a conversa ganha o aviso com a causa, nada é repetido, e a máquina fica sem IA pronta", { timeout: 40_000 }, async () => {
    const c = await montar({ "claude-cli": PRONTO });
    try {
      await esperarAte(async () => (await c.mensagens()).some((m) => m.kind === "negacao"));
      const msgs = await c.mensagens();
      expect(msgs.map((m) => m.kind)).toEqual(["texto", "negacao"]);
      expect(msgs[1]?.payload).toMatchObject({ kind: "negacao", classe: "plano_ausente", nome: "claude-cli", causa: "conta_sem_acesso" });
      expect(msgs.some((m) => m.texto.includes("disabled Claude subscription"))).toBe(false);
      await new Promise((r) => setTimeout(r, 300));
      expect(c.rodou).toEqual(["claude-cli"]);
      expect(await c.turnos()).toHaveLength(1);
      const maquina = c.ponte.maquinasConectadas().find((m) => m.machineId === c.machineId);
      expect(maquina?.inventario).toMatchObject({ estado: "nao_autenticado", causa: "conta_sem_acesso" });
    } finally {
      await c.laco.parar();
    }
  });
});
