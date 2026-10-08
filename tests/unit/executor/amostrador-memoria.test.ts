import { describe, expect, it } from "vitest";
import { criarAmostradorMemoria, type Executar } from "../../../src/adapters/executor/amostrador-memoria.ts";

/** #194 (ADR-083 §4, decisão S8): um amostrador por máquina; `sysctl` e `ps` injetados, nenhum comando real. */
function executorFalso(o: { nivel?: string; ps?: string; falhaSysctl?: boolean; falhaPs?: boolean } = {}) {
  const chamadas: string[] = [];
  const executar: Executar = async (bin) => {
    chamadas.push(bin);
    if (bin.endsWith("sysctl")) {
      if (o.falhaSysctl) throw new Error("sysctl: unknown oid");
      return `${o.nivel ?? "1"}\n`;
    }
    if (o.falhaPs) throw new Error("ps falhou");
    return o.ps ?? "";
  };
  return { executar, chamadas };
}

describe("amostrador de memória da máquina", () => {
  it("mapa 1/2/4 do sysctl e soma por grupo do ps; o turno vê a própria linha", async () => {
    const f = executorFalso({ nivel: "2", ps: " 4242 1048576\n 4242 1048576\n 5000 512000\n" });
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", 4242);
    a.leitura("t2", 5000);
    await a.amostrar();
    expect(a.leitura("t1", 4242)).toEqual({ nivel: "amarela", totalMb: 2548, porTurno: [{ turnoId: "t1", mb: 2048 }] });
    a.soltar("t2");
    await a.amostrar();
    expect(a.leitura("t1", 4242).totalMb).toBe(2048);
    a.parar();
  });

  it("NOD_SIMULAR_PRESSAO força o nível sem ler o sysctl", async () => {
    const f = executorFalso({ nivel: "1" });
    const a = criarAmostradorMemoria({ env: { NOD_SIMULAR_PRESSAO: "4" }, executar: f.executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", null);
    await a.amostrar();
    expect(a.leitura("t1", null).nivel).toBe("vermelha");
    expect(f.chamadas.some((c) => c.endsWith("sysctl"))).toBe(false);
    a.parar();
  });

  it("sysctl falhou (ou fora do macOS) = verde; sem grupo nenhum, o ps nem roda", async () => {
    const f = executorFalso({ falhaSysctl: true });
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6 });
    expect(a.leitura("t1", null)).toEqual({ nivel: "verde", totalMb: 0, porTurno: [] });
    await a.amostrar();
    expect(a.leitura("t1", null).nivel).toBe("verde");
    expect(f.chamadas.some((c) => c.endsWith("ps"))).toBe(false);
    a.parar();
  });

  it("ps que falha mantém a última soma, em vez de zerar a memória do turno", async () => {
    let falhar = false;
    const executar: Executar = async (bin) => {
      if (bin.endsWith("sysctl")) return "1";
      if (falhar) throw new Error("ps");
      return " 77 2048\n";
    };
    const a = criarAmostradorMemoria({ env: {}, executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", 77);
    await a.amostrar();
    falhar = true;
    await a.amostrar();
    expect(a.leitura("t1", 77).porTurno).toEqual([{ turnoId: "t1", mb: 2 }]);
    a.parar();
  });

  it("X5: o número da amostra só sobe quando o nível ou a memória de um grupo vivo mudou", async () => {
    let nivel = "1";
    let ps = " 4242 1024\n 9999 1\n";
    const executar: Executar = async (bin) => (bin.endsWith("sysctl") ? nivel : ps);
    const a = criarAmostradorMemoria({ env: {}, executar, intervaloMs: 10 ** 6 });
    a.leitura("t1", 4242);
    await a.amostrar();
    const primeira = a.amostra();
    await a.amostrar();
    expect(a.amostra()).toBe(primeira);
    // Grupo que não é de turno nenhum não conta.
    ps = " 4242 1024\n 9999 2\n";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira);
    ps = " 4242 4096\n";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira + 1);
    nivel = "4";
    await a.amostrar();
    expect(a.amostra()).toBe(primeira + 2);
    a.parar();
  });

  it("preguiçoso: só amostra depois da primeira leitura; uma amostra por vez", async () => {
    const f = executorFalso();
    const a = criarAmostradorMemoria({ env: {}, executar: f.executar, intervaloMs: 10 ** 6 });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.chamadas).toEqual([]);
    a.leitura("t1", null);
    await Promise.all([a.amostrar(), a.amostrar()]);
    expect(f.chamadas.filter((c) => c.endsWith("sysctl")).length).toBeLessThanOrEqual(2);
    a.parar();
  });
});
