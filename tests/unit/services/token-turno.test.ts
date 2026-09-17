import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { criarTokenTurno } from "../../../src/services/token-turno.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

const identidade = { tenantId: "t", pessoaId: "p", agenteId: "a1" };

describe("token de turno (ADR-024: só em memória, sha256, tempo constante)", () => {
  it("cunhar → autorizar devolve a identidade do turno; token errado, vazio ou de outro turno não autoriza", () => {
    let agora = 1_000;
    const tokens = criarTokenTurno({ agora: () => agora, validadeMs: 10_000 });
    const t = tokens.cunhar("t1", identidade);
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(tokens.autorizar(t)).toEqual({ turnoId: "t1", ...identidade });
    expect(tokens.autorizar(`${t.slice(0, -1)}${t.endsWith("x") ? "y" : "x"}`)).toBeNull();
    expect(tokens.autorizar("")).toBeNull();
    agora += 5_000;
    expect(tokens.autorizar(t)).not.toBeNull();
    expect(tokens.ativos()).toBe(1);
  });

  it("expira: após validadeMs o token deixa de autorizar e some", () => {
    let agora = 1_000;
    const tokens = criarTokenTurno({ agora: () => agora, validadeMs: 1_000 });
    const t = tokens.cunhar("t1", identidade);
    agora = 2_000;
    expect(tokens.autorizar(t)).toBeNull();
    expect(tokens.ativos()).toBe(0);
  });

  it("revogar: autoriza uma vez, falha depois; cunhar de novo invalida o token anterior (epoch)", () => {
    const tokens = criarTokenTurno({ agora: () => 1_000 });
    const t1 = tokens.cunhar("t1", identidade);
    expect(tokens.autorizar(t1)?.turnoId).toBe("t1");
    tokens.revogar("t1");
    expect(tokens.autorizar(t1)).toBeNull();
    const t2 = tokens.cunhar("t1", identidade);
    const t3 = tokens.cunhar("t1", identidade);
    expect(tokens.autorizar(t2)).toBeNull();
    expect(tokens.autorizar(t3)?.turnoId).toBe("t1");
    expect(tokens.ativos()).toBe(1);
  });

  it("sem identidade (nem no cunhar nem por identidadeDe) lança estado_invalido — fail-closed", () => {
    const tokens = criarTokenTurno({ agora: () => 1_000 });
    expect(() => tokens.cunhar("t1")).toThrow(ErroDeDominio);
    const comResolver = criarTokenTurno({ agora: () => 1_000, identidadeDe: (id) => (id === "t9" ? identidade : null) });
    expect(comResolver.autorizar(comResolver.cunhar("t9"))).toEqual({ turnoId: "t9", ...identidade });
    expect(() => comResolver.cunhar("t8")).toThrow(ErroDeDominio);
  });

  it("guardarPlano/planoDe: o plano vive junto do token e morre com ele", () => {
    const tokens = criarTokenTurno({ agora: () => 1_000 });
    expect(() => tokens.guardarPlano(planoDeTeste())).toThrow(ErroDeDominio);
    tokens.cunhar("t1", identidade);
    tokens.guardarPlano(planoDeTeste());
    expect(tokens.planoDe("t1")?.turnoId).toBe("t1");
    tokens.revogar("t1");
    expect(tokens.planoDe("t1")).toBeNull();
  });
});
