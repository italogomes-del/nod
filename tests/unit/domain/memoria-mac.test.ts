import { describe, expect, it } from "vitest";
import { leituraDoTurno, nivelDaPressao, pressaoSimulada, somarPorGrupo } from "../../../src/domain/memoria-mac.ts";

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
