import { describe, expect, it } from "vitest";
import { cargaDoLoadavg, deveSegurar, ESPERA_MAXIMA_FUNDO_MS, leituraDoTurno, seguravelPeloMac, nivelDaPressao, nivelDoProcessador, piorNivel, pressaoSimulada, somarPorGrupo } from "../../../src/domain/memoria-mac.ts";

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
