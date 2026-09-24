import { describe, expect, it } from "vitest";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { PonteInterna } from "../../../src/contracts/ponte.ts";
import { iniciarPoolDeLacos } from "../../../src/adapters/executor/pool-lacos.ts";

const esperarAte = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  expect(cond()).toBe(true);
};

/** Ponte com fila controlada pelo teste e um laço mínimo (puxa → roda até liberar → puxa de novo). */
function cenario() {
  const fila: string[] = [];
  const liberar = new Map<string, () => void>();
  const rodando = new Set<string>();
  const ponte = {
    conectar: async () => {},
    puxar: async () => {
      const id = fila.shift();
      return id ? ({ turnoId: id } as PlanoTurno) : null;
    },
    renovar: async () => ({ ativo: true, versaoMinimaApp: "0" }),
    entregar: async () => {},
    desconectar: async () => {},
  } satisfies PonteInterna;
  const criar = (p: PonteInterna) => {
    let parado = false;
    let atual: string | null = null;
    const corrida = (async () => {
      while (!parado) {
        const plano = await p.puxar("pessoa");
        if (parado) break;
        if (!plano) { await new Promise((r) => setTimeout(r, 1)); continue; }
        atual = plano.turnoId;
        rodando.add(plano.turnoId);
        await new Promise<void>((r) => liberar.set(plano.turnoId, r));
        rodando.delete(plano.turnoId);
        atual = null;
      }
    })();
    return { parar: async () => { parado = true; await corrida; }, turnoAtual: () => atual };
  };
  return { fila, liberar, rodando, pool: iniciarPoolDeLacos(criar, ponte) };
}

describe("pool elástico de laços: um ocioso sempre, um a mais por turno rodando", () => {
  it("três turnos (de agentes diferentes) rodam juntos; ao acabarem, volta a um laço só", async () => {
    const { fila, liberar, rodando, pool } = cenario();
    expect(pool.tamanho()).toBe(1);
    fila.push("nina", "taga", "gil");
    await esperarAte(() => rodando.size === 3);
    expect(pool.tamanho()).toBe(4);
    expect(pool.turnosAtuais().sort()).toEqual(["gil", "nina", "taga"]);
    for (const id of ["nina", "taga", "gil"]) liberar.get(id)?.();
    await esperarAte(() => pool.tamanho() === 1);
    await pool.parar();
  });

  it("parar() encerra todos, inclusive os que estão rodando", async () => {
    const { fila, liberar, rodando, pool } = cenario();
    fila.push("nina");
    await esperarAte(() => rodando.size === 1);
    const parou = pool.parar();
    liberar.get("nina")?.();
    await parou;
    expect(pool.tamanho()).toBe(0);
  });
});
