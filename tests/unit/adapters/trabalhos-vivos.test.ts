import { describe, expect, it } from "vitest";
import { criarTrabalhosVivos, VALIDADE_LEITURA_MS } from "../../../src/adapters/fundo/trabalhos-vivos.ts";
import { FECHAR_OCIOSA_SOB_PRESSAO_MS, soltarPorMemoria } from "../../../src/domain/trabalho.ts";

const leitura = (nivel: "verde" | "amarela" | "vermelha", totalMb = 1000) => ({ nivel, totalMb, porTurno: [] });

describe("trabalhos vivos: memória do Mac (#194)", () => {
  it("o nível que a pessoa vê muda uma vez por transição; verde de partida não é mudança", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    expect(v.registrarMemoria("p", "mac", leitura("verde")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("amarela"))).toMatchObject({ mudou: true, nivel: "amarela", anterior: "verde" });
    expect(v.registrarMemoria("p", "mac", leitura("amarela")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", leitura("vermelha")).mudou).toBe(true);
    expect(v.memoria("p")).toEqual({ nivel: "vermelha", totalMb: 1000, processador: null, carga: null });
    expect(v.memoria("outra")).toBeNull();
    agora += VALIDADE_LEITURA_MS + 1;
    expect(v.memoria("p")).toBeNull();
  });

  it("revisão do #209: a mudança só do processador também vira frame (a pílula do Mac ocupado depende dele)", () => {
    const v = criarTrabalhosVivos(() => 0);
    const comCpu = (nivel: "verde" | "amarela" | "vermelha") => ({ ...leitura("verde"), processador: { nivel, carga: nivel === "verde" ? 0.2 : 1.4 } });
    expect(v.registrarMemoria("p", "mac", comCpu("verde")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", comCpu("vermelha"))).toMatchObject({ mudou: true, nivel: "verde", processador: "vermelha" });
    expect(v.registrarMemoria("p", "mac", comCpu("vermelha")).mudou).toBe(false);
    expect(v.registrarMemoria("p", "mac", comCpu("verde"))).toMatchObject({ mudou: true, processador: "verde" });
  });

  it("revisão do #209: desfazer devolve o 'visto' (o evento não foi gravado) e a próxima leitura refaz o frame", () => {
    const v = criarTrabalhosVivos(() => 0);
    v.registrarMemoria("p", "mac", leitura("verde"));
    const m = v.registrarMemoria("p", "mac", leitura("amarela"));
    expect(m.mudou).toBe(true);
    v.desfazer("p", m);
    expect(v.registrarMemoria("p", "mac", leitura("amarela")).mudou).toBe(true);
    // Sem nada visto antes: o primeiro aviso também volta.
    const w = criarTrabalhosVivos(() => 0);
    const primeiro = w.registrarMemoria("q", "mac", leitura("vermelha"));
    w.desfazer("q", primeiro);
    expect(w.registrarMemoria("q", "mac", leitura("vermelha")).mudou).toBe(true);
  });

  it("revisão do #209: o Mac que desconectou sai na hora; leitura vencida sai do mapa na próxima leitura", () => {
    let agora = 0;
    const v = criarTrabalhosVivos(() => agora);
    v.registrarMemoria("p", "mac-a", leitura("vermelha"));
    v.esquecerMaquina("mac-a");
    expect(v.daMaquina("mac-a")).toBeNull();
    expect(v.memoria("p")).toBeNull();
    v.registrarMemoria("p", "mac-b", leitura("amarela"));
    agora += VALIDADE_LEITURA_MS + 1;
    v.registrarMemoria("p", "mac-c", leitura("verde"));
    agora -= VALIDADE_LEITURA_MS + 1; // mesmo voltando o relógio, o mac-b já foi podado
    expect(v.daMaquina("mac-b")).toBeNull();
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
