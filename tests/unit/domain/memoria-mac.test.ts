import { describe, expect, it } from "vitest";
import { cargaDoLoadavg, deveSegurar, DISCO_ALERTA_MB, DISCO_CRITICO_MB, discoDoStatfs, discoSimulado, ESPERA_MAXIMA_FUNDO_MS, esperaDoMac, leituraDoTurno, nivelDoDisco, portaoDoMac, seguravelPeloMac, nivelDaPressao, nivelDoProcessador, piorNivel, pressaoSimulada, somarPorGrupo } from "../../../src/domain/memoria-mac.ts";
import type { UsoDoMac } from "../../../src/contracts/raio-x.ts";

/** #194 (ADR-083 §4): o mapa da pressão do macOS e a soma da memória por grupo de processos, puros. */
describe("nível de pressão", () => {
  it("1 = verde, 2 = amarela, 4 = vermelha (kern.memorystatus_vm_pressure_level)", () => {
    expect(nivelDaPressao("1\n")).toBe("verde");
    expect(nivelDaPressao("2")).toBe("amarela");
    expect(nivelDaPressao(4)).toBe("vermelha");
  });

  it("leitura que falhou ou estranha é verde: o aviso nunca nasce de uma falha", () => {
    for (const bruto of ["", "3", "abc", null, undefined, "0", "-1"]) expect(nivelDaPressao(bruto)).toBe("verde");
  });

  it("NOD_SIMULAR_PRESSAO força 1|2|4; outro valor não simula", () => {
    expect(pressaoSimulada("2")).toBe("amarela");
    expect(pressaoSimulada(" 4 ")).toBe("vermelha");
    expect(pressaoSimulada("1")).toBe("verde");
    expect(pressaoSimulada("3")).toBeNull();
    expect(pressaoSimulada(undefined)).toBeNull();
  });
});

describe("memória por grupo (ps -A -o pgid=,rss=)", () => {
  const PS = ["  101  2048", "  101  1024", "  202   512", "    1 99999", "", "lixo", "  303 x"].join("\n");

  it("soma o RSS (KiB) de todos os processos de cada grupo; linha fora do formato é ignorada", () => {
    expect([...somarPorGrupo(PS)]).toEqual([[101, 3072], [202, 512], [1, 99999]]);
  });

  it("a leitura do turno: nível, total dos grupos vivos desta máquina e a linha do turno em MB (arredondados)", () => {
    // 3072 + 512 KiB = 3,5 MB no total (vira 4); o turno, 3 MB. O grupo 1 (fora do nod) não entra.
    const rss = somarPorGrupo(PS);
    expect(leituraDoTurno({ nivel: "amarela", rssPorGrupo: rss, gruposVivos: [101, 202], turnoId: "t1", grupo: 101 })).toEqual({ nivel: "amarela", totalMb: 4, porTurno: [{ turnoId: "t1", mb: 3 }] });
  });

  it("turno sem grupo (harness sem processo próprio) leva só o nível e o total; grupo que o ps não viu também", () => {
    const rss = somarPorGrupo(PS);
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [101], turnoId: "t2", grupo: null })).toEqual({ nivel: "verde", totalMb: 3, porTurno: [] });
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: rss, gruposVivos: [404], turnoId: "t3", grupo: 404 })).toEqual({ nivel: "verde", totalMb: 0, porTurno: [] });
  });
});

/** ADR-085 (definido em 2026-10-08): o processador do Mac e a regra de segurar trabalho novo em segundo plano. */
describe("processador", () => {
  it("vm.loadavg do macOS: a primeira carga é a do último minuto; saída estranha = sem leitura", () => {
    expect(cargaDoLoadavg("{ 2.43 2.12 1.98 }\n")).toBe(2.43);
    expect(cargaDoLoadavg("265.08 180.3 120.1")).toBe(265.08);
    expect(cargaDoLoadavg("")).toBeNull();
    expect(cargaDoLoadavg("{ abc }")).toBeNull();
  });

  it("carga por núcleo: verde abaixo de 0,7, amarela até 1,0, vermelha a partir de 1,0 (06/10: 265 em 12 núcleos)", () => {
    expect(nivelDoProcessador(4, 12)).toEqual({ nivel: "verde", carga: 0.33 });
    expect(nivelDoProcessador(9, 12)).toEqual({ nivel: "amarela", carga: 0.75 });
    expect(nivelDoProcessador(12, 12)).toEqual({ nivel: "vermelha", carga: 1 });
    expect(nivelDoProcessador(265, 12).nivel).toBe("vermelha");
    expect(nivelDoProcessador(3, 0)).toEqual({ nivel: "verde", carga: 0 });
  });

  it("a leitura da máquina leva o processador; sem turno, sem linha por turno", () => {
    const rss = somarPorGrupo(["  101  2048", "  101  1024"].join("\n"));
    expect(leituraDoTurno({ nivel: "amarela", rssPorGrupo: rss, gruposVivos: [101], turnoId: null, grupo: null, processador: { nivel: "verde", carga: 0.2 } }))
      .toEqual({ nivel: "amarela", totalMb: 3, porTurno: [], processador: { nivel: "verde", carga: 0.2 } });
  });

  it("o pior de dois níveis; sem leitura não piora nada", () => {
    expect(piorNivel("verde", "vermelha")).toBe("vermelha");
    expect(piorNivel(null, "amarela")).toBe("amarela");
    expect(piorNivel(null, null)).toBeNull();
  });
});

describe("segurar trabalho novo (uso do Mac)", () => {
  it("livre nunca segura, nem com o Mac vermelho", () => {
    expect(deveSegurar("livre", "vermelha", "vermelha")).toBe(false);
  });

  it("equilibrado: memória em alerta ou processador cheio", () => {
    expect(deveSegurar("equilibrado", "amarela", "verde")).toBe(true);
    expect(deveSegurar("equilibrado", "verde", "vermelha")).toBe(true);
    expect(deveSegurar("equilibrado", "verde", "amarela")).toBe(false);
    expect(deveSegurar("equilibrado", "verde", "verde")).toBe(false);
  });

  it("pouco: já com o processador começando a apertar", () => {
    expect(deveSegurar("pouco", "verde", "amarela")).toBe(true);
    expect(deveSegurar("pouco", "verde", "verde")).toBe(false);
  });

  it("sem leitura (nenhum Mac falou, ou app sem processador) não segura", () => {
    expect(deveSegurar("pouco", null, null)).toBe(false);
    expect(deveSegurar("equilibrado", "verde", null)).toBe(false);
  });

  it("revisão do #209: o que o Mac apertado segura — segundo plano, não começou, ninguém esperando, dentro da espera máxima", () => {
    const agora = 10 * ESPERA_MAXIMA_FUNDO_MS;
    const base = { origem: "rotina" as const, iniciadoEm: null, criadoEm: agora - 60_000, pessoaEsperando: false };
    expect(seguravelPeloMac(base, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, origem: "colega" }, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, origem: "pessoa" }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, origem: "rede" }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, iniciadoEm: agora - 1 }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, pessoaEsperando: true }, agora)).toBe(false);
    expect(seguravelPeloMac({ ...base, pessoaEsperando: undefined }, agora)).toBe(true);
    expect(seguravelPeloMac({ ...base, criadoEm: agora - ESPERA_MAXIMA_FUNDO_MS }, agora)).toBe(false);
  });
});

/** #219 (emenda à ADR-085, definido em 2026-10-09; revisto no mesmo dia pelo coordenador do #221): memória e disco. */
const GB = 1024;
describe("disco do Mac", () => {
  it("limites absolutos num lugar só: abaixo de 10 GB livres, alerta; abaixo de 3 GB, crítico; sem regra percentual", () => {
    expect([DISCO_ALERTA_MB, DISCO_CRITICO_MB]).toEqual([10 * GB, 3 * GB]);
    expect(nivelDoDisco({ livreMb: 17 * GB, totalMb: 466 * GB })).toBe("verde"); // o Mac do Marlon em 09/10: 3,6%, mas 17 GB
    expect(nivelDoDisco({ livreMb: 10 * GB, totalMb: 2000 * GB })).toBe("verde"); // 10 GB exatos, 0,5% de um disco grande
    expect(nivelDoDisco({ livreMb: 10 * GB - 1, totalMb: 100 * GB })).toBe("amarela");
    expect(nivelDoDisco({ livreMb: 3 * GB, totalMb: 100 * GB })).toBe("amarela");
    expect(nivelDoDisco({ livreMb: 3 * GB - 1, totalMb: 100 * GB })).toBe("vermelha");
  });

  it("sem leitura, ou leitura sem total, não tem nível: nada espera por um disco que ninguém mediu", () => {
    expect(nivelDoDisco(null)).toBeNull();
    expect(nivelDoDisco(undefined)).toBeNull();
    expect(nivelDoDisco({ livreMb: 0, totalMb: 0 })).toBeNull();
    expect(nivelDoDisco({ livreMb: Number.NaN, totalMb: 100 * GB })).toBeNull();
  });

  it("statfs → MB pelo bavail (o que um processo comum pode gravar), com bigint ou number", () => {
    expect(discoDoStatfs({ bsize: 4096, blocks: 122_000_000, bavail: 4_456_448 })).toEqual({ livreMb: 17_408, totalMb: 476_562 });
    expect(discoDoStatfs({ bsize: 4096n, blocks: 256n, bavail: 0n })).toEqual({ livreMb: 0, totalMb: 1 });
    expect(discoDoStatfs({ bsize: 4096, blocks: 0, bavail: 0 })).toBeNull();
  });

  it("NOD_SIMULAR_DISCO: GB livres (de 500) ou 'livres/total'; outro valor não simula", () => {
    expect(discoSimulado("8")).toEqual({ livreMb: 8 * GB, totalMb: 500 * GB });
    expect(discoSimulado(" 17/466 ")).toEqual({ livreMb: 17 * GB, totalMb: 466 * GB });
    expect(discoSimulado("0.5")).toEqual({ livreMb: 512, totalMb: 500 * GB });
    for (const v of [undefined, "", "abc", "-1", "20/10", "8/0"]) expect(discoSimulado(v)).toBeNull();
  });

  it("a leitura da máquina leva o disco quando há", () => {
    expect(leituraDoTurno({ nivel: "verde", rssPorGrupo: new Map(), gruposVivos: [], turnoId: null, grupo: null, disco: { livreMb: 9 * GB, totalMb: 500 * GB } }))
      .toEqual({ nivel: "verde", totalMb: 0, porTurno: [], disco: { livreMb: 9 * GB, totalMb: 500 * GB } });
  });
});

describe("portão do Mac: memória normal/alerta/crítica e disco folgado/alerta/crítico", () => {
  const folgado = { livreMb: 200 * GB, totalMb: 500 * GB };
  const alerta = { livreMb: 8 * GB, totalMb: 500 * GB };
  const critico = { livreMb: 2 * GB, totalMb: 500 * GB };
  const ABERTO = { fundo: null, tudoNovo: null, semPrazo: false };
  const SEGURAM: UsoDoMac[] = ["pouco", "equilibrado"];

  it("memória normal e disco folgado: nada espera, em qualquer uso", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, { memoria: "verde", processador: "verde", disco: folgado })).toEqual(ABERTO);
  });

  it("memória em alerta: só o segundo plano espera, com a espera máxima; 'O quanto precisar' não segura", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "amarela", processador: "verde", disco: folgado })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("livre", { memoria: "amarela", processador: "vermelha", disco: folgado })).toEqual(ABERTO);
  });

  it("memória crítica: o segundo plano espera SEM a espera máxima (o pedido da pessoa passa); 'O quanto precisar' não segura", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "vermelha", processador: "verde", disco: folgado })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: true });
    expect(portaoDoMac("livre", { memoria: "vermelha", processador: "vermelha", disco: folgado })).toEqual(ABERTO);
  });

  it("disco em alerta (< 10 GB): como a memória em alerta — só o segundo plano, e nunca em 'O quanto precisar'", () => {
    for (const uso of SEGURAM) expect(portaoDoMac(uso, { memoria: "verde", processador: "verde", disco: alerta })).toEqual({ fundo: "disco", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("livre", { memoria: "verde", processador: "verde", disco: alerta })).toEqual(ABERTO);
    // A memória crítica pesa mais que o disco em alerta no motivo, e leva o "sem prazo".
    expect(portaoDoMac("equilibrado", { memoria: "vermelha", processador: "verde", disco: alerta })).toEqual({ fundo: "memoria", tudoNovo: null, semPrazo: true });
    expect(portaoDoMac("equilibrado", { memoria: "amarela", processador: "vermelha", disco: alerta })).toEqual({ fundo: "disco", tudoNovo: null, semPrazo: false });
  });

  it("disco crítico (< 3 GB): nada novo começa, em QUALQUER uso — a trava de segurança", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, { memoria: "vermelha", processador: "verde", disco: critico })).toEqual({ fundo: "disco", tudoNovo: "disco", semPrazo: false });
  });

  it("o processador continua como antes, com o motivo processador", () => {
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: "vermelha", disco: folgado })).toEqual({ fundo: "processador", tudoNovo: null, semPrazo: false });
    expect(portaoDoMac("pouco", { memoria: "verde", processador: "amarela", disco: null })).toEqual({ fundo: "processador", tudoNovo: null, semPrazo: false });
  });

  it("sem medição: sem leitura do Mac, ou sem disco (app anterior, fora do macOS), o disco não segura nada", () => {
    for (const uso of [...SEGURAM, "livre" as const]) expect(portaoDoMac(uso, null)).toEqual(ABERTO);
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: null, disco: null })).toEqual(ABERTO);
    expect(portaoDoMac("equilibrado", { memoria: "verde", processador: null })).toEqual(ABERTO);
  });

  it("quem espera e por quê: tudoNovo = todo trabalho que não começou; fundo = o seguravel; semPrazo = também o que passou de 1 h", () => {
    const agora = 10 * ESPERA_MAXIMA_FUNDO_MS;
    const base = { estado: "na_fila" as const, origem: "rotina" as const, iniciadoEm: null, criadoEm: agora - 60_000, pessoaEsperando: false };
    const antiga = { ...base, criadoEm: agora - 2 * ESPERA_MAXIMA_FUNDO_MS };
    const tudo = { fundo: "disco" as const, tudoNovo: "disco" as const, semPrazo: false };
    const memoriaCritica = { fundo: "memoria" as const, tudoNovo: null, semPrazo: true };
    const fundo = { fundo: "disco" as const, tudoNovo: null, semPrazo: false };
    expect(esperaDoMac(base, tudo, agora)).toBe("disco");
    expect(esperaDoMac({ ...base, origem: "pessoa" }, tudo, agora)).toBe("disco");
    expect(esperaDoMac({ ...base, pessoaEsperando: true }, tudo, agora)).toBe("disco");
    expect(esperaDoMac(antiga, tudo, agora)).toBe("disco");
    // Memória crítica: o segundo plano, mesmo passado de 1 h; o pedido explícito da pessoa passa.
    expect(esperaDoMac(antiga, memoriaCritica, agora)).toBe("memoria");
    expect(esperaDoMac({ ...base, origem: "pessoa" }, memoriaCritica, agora)).toBeNull();
    expect(esperaDoMac({ ...base, pessoaEsperando: true }, memoriaCritica, agora)).toBeNull();
    // Disco em alerta: como o de antes — com a espera máxima.
    expect(esperaDoMac(base, fundo, agora)).toBe("disco");
    expect(esperaDoMac(antiga, fundo, agora)).toBeNull();
    expect(esperaDoMac({ ...base, origem: "pessoa" }, fundo, agora)).toBeNull();
    // O que já começou segue, e o que não está na fila não espera nada.
    expect(esperaDoMac({ ...base, iniciadoEm: agora - 1 }, tudo, agora)).toBeNull();
    expect(esperaDoMac({ ...base, estado: "rodando" }, tudo, agora)).toBeNull();
    expect(esperaDoMac(base, { fundo: null, tudoNovo: null, semPrazo: false }, agora)).toBeNull();
  });
});
