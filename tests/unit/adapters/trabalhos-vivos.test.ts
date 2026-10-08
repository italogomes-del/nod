import { describe, expect, it } from "vitest";
import { criarTrabalhosVivos, VALIDADE_LEITURA_MS } from "../../../src/adapters/fundo/trabalhos-vivos.ts";
import { FECHAR_OCIOSA_SOB_PRESSAO_MS, soltarPorMemoria } from "../../../src/domain/trabalho.ts";

const leitura = (nivel: "verde" | "amarela" | "vermelha", totalMb = 1000) => ({ nivel, totalMb, porTurno: [] });

describe("trabalhos vivos: memória do Mac (#194)", () => {
  it("o nível que a pessoa vê muda uma vez por transição; verde de partida não é mudança", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    expect(v.registrarMemoria("p", "mac", leitura("verde")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("amarela"))).toEqual({ mudou: true, nivel: "amarela", anterior: "verde" });
    expect(v.registrarMemoria("p", "mac", leitura("amarela")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("vermelha")).mudou).toBe(true);
    expect(v.memoria("p")).toEqual({ nivel: "vermelha", totalMb: 1000, processador: null, carga: null });
    expect(v.memoria("outra")).toBeNull();
    agora += VALIDADE_LEITURA_MS + 1;
    expect(v.memoria("p")).toBeNull();
  });

  it("dois Macs da mesma pessoa: vale o pior, e o total soma", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac-a", leitura("verde", 400));
    expect(v.registrarMemoria("p", "mac-b", leitura("amarela", 600))).toMatchObject({ mudou: true, nivel: "amarela" });
    expect(v.registrarMemoria("p", "mac-a", leitura("verde", 400)).mudou).toBe(false);
    expect(v.memoria("p")).toEqual({ nivel: "amarela", totalMb: 1000, processador: null, carga: null });
  });

  it("ADR-085: o processador de cada Mac — o pior para a pessoa, a leitura de um Mac para o puxar dele; leitura velha some", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac-a", { ...leitura("verde", 400), processador: { nivel: "amarela", carga: 0.8 } });
    v.registrarMemoria("p", "mac-b", { ...leitura("verde", 300), processador: { nivel: "vermelha", carga: 1.6 } });
    v.registrarMemoria("p", "mac-c", leitura("verde", 100));
    expect(v.memoria("p")).toEqual({ nivel: "verde", totalMb: 800, processador: "vermelha", carga: 1.6 });
    expect(v.daMaquina("mac-a")).toEqual({ memoria: "verde", processador: "amarela" });
    expect(v.daMaquina("mac-c")).toEqual({ memoria: "verde", processador: null });
    expect(v.daMaquina("mac-x")).toBeNull();
    agora = VALIDADE_LEITURA_MS + 1;
    expect(v.daMaquina("mac-a")).toBeNull();
  });

  it("a última ferramenta do turno vivo (o último passo da faixa) some quando o turno acaba", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.ferramenta("t1", "Rodou um comando");
    v.ferramenta("t1", "Leu um arquivo");
    expect(v.ultimaFerramenta("t1")).toBe("Leu um arquivo");
    v.esquecerTurno("t1");
    expect(v.ultimaFerramenta("t1")).toBeNull();
  });

  it("soltar a espera por memória: só sob amarela ou vermelha, e só passados 5 min", () => {
    const desde = 0;
    expect(soltarPorMemoria({ nivel: "amarela", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS + 1 })).toBe(true);
    expect(soltarPorMemoria({ nivel: "vermelha", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS + 1 })).toBe(true);
    expect(soltarPorMemoria({ nivel: "amarela", esperandoDesde: desde, agora: FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
    expect(soltarPorMemoria({ nivel: "verde", esperandoDesde: desde, agora: 10 * FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
    expect(soltarPorMemoria({ nivel: null, esperandoDesde: desde, agora: 10 * FECHAR_OCIOSA_SOB_PRESSAO_MS })).toBe(false);
  });
});
