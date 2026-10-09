import { describe, expect, it } from "vitest";
import { criarTrabalhosVivos, VALIDADE_LEITURA_MS } from "../../../src/adapters/fundo/trabalhos-vivos.ts";

/** A tela fala por máquina (definido em 2026-10-09): a leitura de cada máquina separada, e o frame quando só uma muda. */
const comCpu = (nivel: "verde" | "amarela" | "vermelha", uso: number, totalMb = 500) => ({ nivel, totalMb, porTurno: [], processador: { nivel: "verde" as const, carga: 0.1, uso } });

describe("trabalhos vivos por máquina", () => {
  it("cada máquina viva da pessoa com a própria leitura, sem juntar", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac", comCpu("verde", 0.2, 400));
    v.registrarMemoria("p", "vm", comCpu("verde", 1, 700));
    expect(v.porMaquina("p")).toEqual([
      expect.objectContaining({ machineId: "mac", nivel: "verde", totalMb: 400, portao: "verde" }),
      expect.objectContaining({ machineId: "vm", nivel: "verde", totalMb: 700, portao: "vermelha" }),
    ]);
    expect(v.porMaquina("outra")).toEqual([]);
    agora += VALIDADE_LEITURA_MS + 1;
    expect(v.porMaquina("p")).toEqual([]);
  });

  it("a VM muda de nível com o Mac já pior: a pior não muda, mas o frame sai (a pílula e a linha da VM mudam)", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac", comCpu("vermelha", 0.2));
    v.registrarMemoria("p", "vm", comCpu("verde", 0.2));
    expect(v.registrarMemoria("p", "vm", comCpu("verde", 0.2)).mudou).toBe(false);
    expect(v.registrarMemoria("p", "vm", comCpu("amarela", 0.2)).mudou).toBe(true);
    expect(v.memoria("p")?.nivel).toBe("vermelha");
  });
});
