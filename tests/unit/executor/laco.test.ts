import { describe, expect, it } from "vitest";
import { driverDoPlano, iniciarLaco, resultadoDeExcecao } from "../../../src/adapters/executor/laco.ts";
import type { Adapter, Driver, Instance, Registry } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno } from "../../../src/contracts/turno.ts";
import type { Entrega, PedidoRenovar, PonteInterna } from "../../../src/contracts/ponte.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { SINAIS_ZERADOS } from "../../../src/domain/stream-json.ts";
import { driverFalso } from "../../helpers/driver-falso.ts";

function planoDeTeste(turnoId: string, texto: string, executor: "local" | "catcher" = "catcher"): PlanoTurno {
  return {
    tenantId: "t",
    turnoId,
    conversaId: "c",
    agenteId: "a",
    localidade: "local",
    machineId: "m1",
    executor,
    superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas",
    autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor, locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m1", decidido_por: "regra:x", regra_versao: 1 },
    confiancaEntrada: "confiavel",
    profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] },
    promptSistema: "",
    entrada: { texto, sessaoCli: null, modelo: "claude-haiku-4-5-20251001" },
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000, efeitoExternoSoPorAprovacao: false },
    tokenDeTurno: "tok",
    expiraEm: 1,
  };
}

type PonteFalsa = PonteInterna & { renovacoes: PedidoRenovar[]; entregas: Entrega[]; conectada: boolean; desconectada: boolean };

function ponteFalsa(planos: (PlanoTurno | null)[], responderRenovar: (p: PedidoRenovar) => boolean = () => true): PonteFalsa {
  const fila = [...planos];
  const ponte: PonteFalsa = {
    renovacoes: [],
    entregas: [],
    conectada: false,
    desconectada: false,
    async conectar() {
      ponte.conectada = true;
    },
    async puxar() {
      return fila.shift() ?? null;
    },
    async renovar(p) {
      ponte.renovacoes.push({ ...p, sinais: { ...p.sinais } });
      return { ativo: responderRenovar(p), versaoMinimaApp: "0.1.0" };
    },
    async entregar(e) {
      ponte.entregas.push(e);
    },
    async desconectar() {
      ponte.desconectada = true;
    },
  };
  return ponte;
}

async function registryCom(driver: Driver): Promise<Registry> {
  const instance = await driver.create({ env: {}, cwdBase: "/tmp/nao-usado" });
  return { "claude-cli": { estado: "sombra", motivo: "ausente: teste" }, catcher: { estado: "pronto", driver, instance } };
}

const esperarAte = async (cond: () => boolean, ms = 3_000) => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("esperarAte: tempo esgotado");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("laço puxar → rodar → renovar → entregar (ADR-021, ADR-009)", () => {
  it("roda o plano, renova imediatamente ao marcar promptSubmitted, entrega UMA vez e dorme quando não há plano", async () => {
    const ponte = ponteFalsa([planoDeTeste("t1", "[[delta: oi]] [[texto: pronto]]")]);
    const registry = await registryCom(driverFalso());
    const deltas: string[] = [];
    const dormidas: number[] = [];
    const laco = iniciarLaco({
      ponte,
      registry,
      pessoaId: "p",
      machineId: "m1",
      relogio: Date.now,
      renovacaoMs: 10_000,
      anuncio: { nome: "mac-da-ana", inventario: { estado: "pronto", versao: "catcher", em: 0 }, versaoContrato: 1 },
      aoDelta: (_p, t) => deltas.push(t),
      dormir: async (ms) => {
        dormidas.push(ms);
        await new Promise((r) => setTimeout(r, 1));
      },
      aleatorio: () => 0.5,
      esperaVaziaMs: 1_000,
      jitterMs: 300,
    });
    await esperarAte(() => ponte.entregas.length === 1 && dormidas.length >= 1);
    await laco.parar();

    expect(ponte.conectada).toBe(true);
    expect(ponte.desconectada).toBe(true);
    expect(ponte.entregas).toHaveLength(1);
    const [entrega] = ponte.entregas;
    expect(entrega?.turnoId).toBe("t1");
    expect(entrega?.machineId).toBe("m1");
    expect(entrega?.seqLocal).toBe(1);
    expect(entrega?.fala).toEqual({ tipo: "texto", texto: "pronto" });
    expect(entrega?.resultado.desfecho).toBe("sucesso");
    expect(entrega?.resultado.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(deltas).toEqual(["oi"]);
    // a renovação da fronteira: promptSubmitted já viajou antes do primeiro delta
    expect(ponte.renovacoes.length).toBeGreaterThanOrEqual(1);
    expect(ponte.renovacoes[0]?.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: false });
    expect(ponte.renovacoes[0]?.turnoId).toBe("t1");
    expect(dormidas[0]).toBe(1_150);
  });

  it("renovar devolvendo {ativo:false} chama interromper() no adapter: turno termina 'interrompido' e é entregue uma vez", async () => {
    const muitosDeltas = Array.from({ length: 200 }, (_, i) => `[[delta: ${i}]]`).join(" ");
    const ponte = ponteFalsa([planoDeTeste("t2", muitosDeltas)], (p) => p.sinais.producedOutput !== true);
    const registry = await registryCom(driverFalso({ atrasoMs: 5 }));
    const laco = iniciarLaco({ ponte, registry, pessoaId: "p", machineId: "m1", relogio: Date.now, renovacaoMs: 20, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1, 10_000);
    await laco.parar();
    expect(ponte.entregas).toHaveLength(1);
    expect(ponte.entregas[0]?.resultado.desfecho).toBe("interrompido");
    // sem motivo: quem sabe se a pessoa pediu é o servidor (ADR-009)
    expect(ponte.entregas[0]?.resultado.motivoInterrupcao).toBeUndefined();
    expect(ponte.renovacoes.some((r) => r.sinais.producedOutput)).toBe(true);
  });

  it("exceção do adapter vira Entrega 'falha' erro_execucao e o laço continua vivo para o próximo plano", async () => {
    let chamadas = 0;
    const explosivo: Driver = {
      meta: { id: "catcher", locality: "ambos" },
      async create(): Promise<Instance> {
        return {
          sondar: async () => ({ estado: "pronto", versao: "x", em: 0 }),
          adapter: (): Adapter => ({
            async rodarTurno(sinks) {
              chamadas += 1;
              await sinks.sinal("attempted");
              if (chamadas === 1) throw new Error("estourou");
              throw new ErroDeDominio("executor_indisponivel", { cause: "cli_antigo" });
            },
            interromper: async () => {},
          }),
          dispose: async () => {},
        };
      },
    };
    const ponte = ponteFalsa([planoDeTeste("t3", "a"), planoDeTeste("t4", "b")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(explosivo), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 2);
    await laco.parar();
    expect(ponte.entregas.map((e) => [e.turnoId, e.resultado.desfecho, e.resultado.motivoFalha ?? e.resultado.motivoInterrupcao])).toEqual([
      ["t3", "falha", "erro_execucao"],
      ["t4", "interrompido", "executor_indisponivel"],
    ]);
    expect(ponte.entregas[0]?.resultado.sinais.attempted).toBe(true);
    expect(ponte.entregas.map((e) => e.seqLocal)).toEqual([1, 2]);
  });

  it("plano para um driver em sombra é entregue 'interrompido' executor_indisponivel sem rodar nada", async () => {
    const ponte = ponteFalsa([planoDeTeste("t5", "x", "local")]);
    const laco = iniciarLaco({ ponte, registry: await registryCom(driverFalso()), pessoaId: "p", machineId: "m1", relogio: Date.now, dormir: async () => new Promise((r) => setTimeout(r, 1)) });
    await esperarAte(() => ponte.entregas.length === 1);
    await laco.parar();
    expect(driverDoPlano(planoDeTeste("t5", "x", "local"))).toBe("claude-cli");
    expect(ponte.entregas[0]?.resultado).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", sinais: SINAIS_ZERADOS });
  });

  it("puxar que lança não derruba o laço; parar() acorda o sono e interrompe o turno em curso", async () => {
    let vezes = 0;
    const ponte = ponteFalsa([]);
    ponte.puxar = async () => {
      vezes += 1;
      if (vezes === 1) throw new Error("servidor fora");
      return null;
    };
    const dormidas: number[] = [];
    const laco = iniciarLaco({
      ponte,
      registry: await registryCom(driverFalso()),
      pessoaId: "p",
      machineId: "m1",
      relogio: Date.now,
      esperaVaziaMs: 60_000,
      jitterMs: 0,
      dormir: (ms) => {
        dormidas.push(ms);
        return new Promise((r) => setTimeout(r, ms));
      },
    });
    // o puxar lançou e o laço foi dormir 60 s em vez de morrer
    await esperarAte(() => vezes === 1 && dormidas.length === 1);
    expect(dormidas).toEqual([60_000]);
    const inicio = Date.now();
    await laco.parar();
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(vezes).toBe(1);
    expect(laco.turnoAtual()).toBeNull();
  });

  it("resultadoDeExcecao distingue executor_indisponivel (interrompido) de qualquer outra exceção (falha erro_execucao)", () => {
    expect(resultadoDeExcecao(new ErroDeDominio("executor_indisponivel"), SINAIS_ZERADOS)).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel" });
    expect(resultadoDeExcecao(new Error("x"), SINAIS_ZERADOS)).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
    expect(resultadoDeExcecao(new ErroDeDominio("nao_encontrado"), SINAIS_ZERADOS).desfecho).toBe("falha");
  });
});

/**
 * definido em 2026-09-18: o watchdog substituiu o teto de passos (--max-turns), que cortava
 * trabalho legítimo. Driver controlado evento a evento, com relógio falso — o teste não espera
 * cinco minutos de verdade.
 */
function driverControlado(): { driver: Driver; emitir: (ev: EventoStream) => void; terminar: () => void; interrupcoes: () => number } {
  let sinks: { evento(e: EventoStream): void; delta(t: string): void; sinal(s: "attempted" | "promptSubmitted" | "producedOutput" | "rejected"): Promise<void> } | null = null;
  let resolver: ((r: ResultadoTurno) => void) | null = null;
  let interrupcoes = 0;
  const parado = (): ResultadoTurno => ({ desfecho: "interrompido", texto: "", sessaoCli: null, sinais: { ...SINAIS_ZERADOS, attempted: true, producedOutput: true }, custoUsd: null, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });
  const adapter: Adapter = {
    async rodarTurno(s) {
      sinks = s;
      return new Promise<ResultadoTurno>((r) => { resolver = r; });
    },
    async interromper() {
      interrupcoes += 1;
      resolver?.(parado());
    },
  };
  const instance: Instance = { async sondar() { return { estado: "pronto", versao: "falso", em: 0 }; }, adapter: () => adapter, async dispose() {} };
  return {
    driver: { meta: { id: "catcher", locality: "local" }, async create(): Promise<Instance> { return instance; } },
    emitir: (ev) => sinks?.evento(ev),
    terminar: () => resolver?.(parado()),
    interrupcoes: () => interrupcoes,
  };
}

describe("watchdog de atividade", () => {
  const JANELA = 1_000;
  async function cenario(d: ReturnType<typeof driverControlado>, agora: () => number) {
    const ponte = ponteFalsa([planoDeTeste("t1", "tarefa longa"), null]);
    const registry = await registryCom(d.driver);
    const laco = iniciarLaco({
      ponte, registry, pessoaId: "p", machineId: "m1",
      relogio: agora,
      renovacaoMs: 10 ** 6,
      inatividadeMs: JANELA,
      verificacaoInatividadeMs: 5,
      isencaoFerramentaMs: JANELA * 3,
      // Ceder o event loop como os demais testes: async () => {} gira em laço fechado.
      dormir: async () => new Promise((r) => setTimeout(r, 1)),
    });
    return { ponte, laco };
  }

  it("não interrompe turno que segue emitindo eventos, por mais longo que seja", async () => {
    let t = 0;
    const d = driverControlado();
    const { laco } = await cenario(d, () => t);
    await new Promise((r) => setTimeout(r, 15));
    // Muito além da janela, mas com atividade a cada passo: é trabalho, não travamento.
    for (let n = 0; n < 6; n++) {
      t += JANELA * 0.9;
      d.emitir({ tipo: "delta", texto: `passo ${n}` });
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(d.interrupcoes()).toBe(0);
    d.terminar();
    await laco.parar();
  });

  it("interrompe turno mudo e marca turno_travado", async () => {
    let t = 0;
    const d = driverControlado();
    const { ponte, laco } = await cenario(d, () => t);
    await new Promise((r) => setTimeout(r, 15));
    t += JANELA * 2;
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.interrupcoes()).toBe(1);
    expect(ponte.entregas[0]!.resultado.motivoInterrupcao).toBe("turno_travado");
    await laco.parar();
  });

  // O caso que prova que o watchdog não mata quem espera: ferramenta em andamento é silêncio
  // legítimo (computador_* leva até 240s; o proxy serializa as chamadas).
  it("não interrompe enquanto uma ferramenta está aberta, e o relógio reinicia quando ela responde", async () => {
    let t = 0;
    const d = driverControlado();
    const { ponte, laco } = await cenario(d, () => t);
    await new Promise((r) => setTimeout(r, 15));
    d.emitir({ tipo: "tool_use", id: "u1", nome: "computador_terminal", input: {} });
    t += JANELA * 2.5;
    await new Promise((r) => setTimeout(r, 25));
    expect(d.interrupcoes()).toBe(0);
    expect(ponte.entregas).toHaveLength(0);
    d.emitir({ tipo: "tool_result", toolUseId: "u1", isError: false, texto: "ok" });
    await new Promise((r) => setTimeout(r, 15));
    expect(d.interrupcoes()).toBe(0);
    d.terminar();
    await laco.parar();
  });

  it("a isenção não é eterna: ferramenta aberta além do teto deixa de proteger", async () => {
    let t = 0;
    const d = driverControlado();
    const { ponte, laco } = await cenario(d, () => t);
    await new Promise((r) => setTimeout(r, 15));
    d.emitir({ tipo: "tool_use", id: "u1", nome: "computador_terminal", input: {} });
    t += JANELA * 4;
    await esperarAte(() => ponte.entregas.length === 1);
    expect(d.interrupcoes()).toBe(1);
    await laco.parar();
  });
});
