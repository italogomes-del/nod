import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarDespachanteOutbox } from "../../../src/adapters/fundo/despachar-outbox.ts";
import { criarBarramento } from "../../../src/services/barramento.ts";
import { avisarOutbox } from "../../../src/shared/sinal-outbox.ts";
import type { Db } from "../../../src/shared/types.ts";

/**
 * #218 (2026-10-09): o despachante do outbox passava a cada 250 ms, com uma transação por pessoa, mesmo com o Nod
 * parado (~345 mil transações por dia). Agora o passo dobra a cada passada vazia até 5 s e volta a 250 ms quando o
 * processo grava no outbox. Cada passada lista as pessoas: contar `listarPessoas` é contar passadas (sem pessoas, o
 * banco nem é tocado).
 */
const db = {} as Db;

describe("despachante do outbox: passo adaptativo (#218)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function montar() {
    let passadas = 0;
    const laco = iniciarDespachanteOutbox(db, criarBarramento(), {
      listarPessoas: async () => {
        passadas += 1;
        return [];
      },
    });
    return { laco, passadas: () => passadas };
  }

  it("ocioso: menos de uma passada por segundo depois do aquecimento (antes eram 4)", async () => {
    const m = montar();
    await vi.advanceTimersByTimeAsync(10_000); // os 5 s de passo curto do início e o passo crescendo
    const antes = m.passadas();
    await vi.advanceTimersByTimeAsync(60_000);
    await m.laco.parar();
    const porSegundo = (m.passadas() - antes) / 60;
    expect(porSegundo).toBeLessThan(1);
    expect(porSegundo).toBeGreaterThanOrEqual(0.2 - 0.02); // o teto de 5 s: o frame de outro processo ainda sai
  });

  it("linha gravada neste processo acorda o despachante: a próxima passada sai em 250 ms, não no passo ocioso", async () => {
    const m = montar();
    await vi.advanceTimersByTimeAsync(30_000);
    const antes = m.passadas();
    avisarOutbox();
    await vi.advanceTimersByTimeAsync(250);
    expect(m.passadas()).toBe(antes + 1);
    // Fica no passo curto por um tempo (cobre o commit de quem gravou), depois volta a espaçar.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(m.passadas()).toBeGreaterThanOrEqual(antes + 15);
    await m.laco.parar();
  });

  it("parado, o aviso não agenda nada", async () => {
    const m = montar();
    await m.laco.parar();
    const antes = m.passadas();
    avisarOutbox();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.passadas()).toBe(antes);
  });
});
