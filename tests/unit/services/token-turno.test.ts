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
    // NOD-214: o escopo alegado (base64url de {t, p}) "." 24 bytes aleatórios.
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/);
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

  it("ADR-067: sem validadeMs o token vale enquanto o turno vive — horas depois ainda autoriza; só revogar o tira", () => {
    let agora = 1_000;
    const tokens = criarTokenTurno({ agora: () => agora });
    const t = tokens.cunhar("t1", identidade);
    agora += 6 * 60 * 60 * 1000;
    expect(tokens.autorizar(t)?.turnoId).toBe("t1");
    tokens.revogar("t1");
    expect(tokens.autorizar(t)).toBeNull();
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

describe("NOD-214: o token de turno atravessa o reinício do servidor (hash no banco)", () => {
  const T = "00000000-0000-4000-8000-0000000000a1";
  const P = "00000000-0000-4000-8000-0000000000b1";
  const OUTRA = "00000000-0000-4000-8000-0000000000b2";
  const identidade = { tenantId: T, pessoaId: P, agenteId: "a1" };
  const escopoDo = (token: string) => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { t: string; p: string };

  it("o token leva o escopo alegado; credencialDe dá o hash (nunca o token) e o epoch", () => {
    const tokens = criarTokenTurno({ agora: () => 1_000 });
    const t = tokens.cunhar("t1", identidade);
    expect(escopoDo(t)).toEqual({ t: T, p: P });
    const c = tokens.credencialDe("t1")!;
    expect(c.epoch).toBe(1);
    expect(c.tokenHash).toHaveLength(32);
    expect(c.tokenHash.toString("utf8")).not.toContain(t.split(".")[1]);
    tokens.cunhar("t1", identidade);
    expect(tokens.credencialDe("t1")?.epoch).toBe(2);
    expect(tokens.credencialDe("t2")).toBeNull();
  });

  it("ativos({semSobrevive}) não conta o turno da máquina que atravessa o reinício (a drenagem não o espera)", () => {
    const tokens = criarTokenTurno({ agora: () => 1_000 });
    tokens.cunhar("t1", identidade);
    tokens.cunhar("t2", identidade);
    tokens.marcarSobrevive("t1");
    expect(tokens.ativos()).toBe(2);
    expect(tokens.ativos({ semSobrevive: true })).toBe(1);
  });

  it("autorizarComBanco: o token que o processo novo não conhece é achado pelo hash no escopo alegado e volta para a memória", async () => {
    const velho = criarTokenTurno({ agora: () => 1_000 });
    const t = velho.cunhar("t1", identidade);
    const guardada = { turnoId: "t1", ...velho.credencialDe("t1")!, sobreviveReinicio: true };
    const buscas: { escopo: unknown }[] = [];
    const novo = criarTokenTurno({ agora: () => 2_000, buscar: async (escopo, hash) => { buscas.push({ escopo }); return guardada.tokenHash.equals(hash) ? guardada : null; } });
    expect(novo.autorizar(t)).toBeNull();
    expect(await novo.autorizarComBanco(t)).toEqual({ turnoId: "t1", ...identidade });
    expect(buscas).toEqual([{ escopo: { tenantId: T, pessoaId: P } }]);
    // Já na memória: não vai ao banco de novo, e conta como sobrevive.
    expect(novo.autorizar(t)?.turnoId).toBe("t1");
    expect(await novo.autorizarComBanco(t)).not.toBeNull();
    expect(buscas).toHaveLength(1);
    expect(novo.ativos({ semSobrevive: true })).toBe(0);
  });

  it("autorizarComBanco recusa: sem escopo alegado, escopo trocado, credencial de outra pessoa", async () => {
    const velho = criarTokenTurno({ agora: () => 1_000 });
    const t = velho.cunhar("t1", identidade);
    const guardada = { turnoId: "t1", ...velho.credencialDe("t1")!, sobreviveReinicio: false };
    const novo = criarTokenTurno({ agora: () => 1_000, buscar: async (_e, hash) => (guardada.tokenHash.equals(hash) ? guardada : null) });
    expect(await novo.autorizarComBanco(t.split(".")[1])).toBeNull();
    const outroEscopo = `${Buffer.from(JSON.stringify({ t: T, p: OUTRA })).toString("base64url")}.${t.split(".")[1]}`;
    expect(await novo.autorizarComBanco(outroEscopo)).toBeNull();
    const deOutra = criarTokenTurno({ agora: () => 1_000, buscar: async () => ({ ...guardada, identidade: { ...identidade, pessoaId: OUTRA } }) });
    expect(await deOutra.autorizarComBanco(t)).toBeNull();
    expect(await novo.autorizarComBanco(123)).toBeNull();
  });

  it("adotar: hash errado não adota; não troca um token mais novo do mesmo turno; o antigo volta se for o da memória", () => {
    const velho = criarTokenTurno({ agora: () => 1_000 });
    const t1 = velho.cunhar("t1", identidade);
    const c1 = { turnoId: "t1", ...velho.credencialDe("t1")!, sobreviveReinicio: false };
    const novo = criarTokenTurno({ agora: () => 1_000 });
    expect(novo.adotar(`${t1}x`, c1)).toBe(false);
    const t2 = novo.cunhar("t1", identidade);
    novo.cunhar("t1", identidade); // epoch 2 na memória do novo
    expect(novo.adotar(t1, c1)).toBe(false);
    expect(novo.autorizar(t2)).toBeNull();
    const vazio = criarTokenTurno({ agora: () => 1_000 });
    expect(vazio.adotar(t1, c1)).toBe(true);
    expect(vazio.adotar(t1, c1)).toBe(true);
    expect(vazio.autorizar(t1)?.turnoId).toBe("t1");
  });

  it("planoOuRecompor: recompõe o plano do turno adotado uma vez só; revogado no meio, o plano não volta", async () => {
    const velho = criarTokenTurno({ agora: () => 1_000 });
    const t = velho.cunhar("t1", identidade);
    const c = { turnoId: "t1", ...velho.credencialDe("t1")!, sobreviveReinicio: true };
    let soltar: () => void = () => undefined;
    let chamadas = 0;
    const novo = criarTokenTurno({
      agora: () => 1_000,
      recompor: async (id, token) => { chamadas++; expect(token).toBe(t); await new Promise<void>((r) => { soltar = r; }); return { ...planoDeTeste(), turnoId: id.turnoId }; },
    });
    expect(await novo.planoOuRecompor("t1")).toBeNull();
    novo.adotar(t, c);
    const a = novo.planoOuRecompor("t1");
    const b = novo.planoOuRecompor("t1");
    await Promise.resolve();
    soltar();
    expect((await a)?.turnoId).toBe("t1");
    expect((await b)?.turnoId).toBe("t1");
    expect(chamadas).toBe(1);
    expect(novo.planoDe("t1")?.turnoId).toBe("t1");

    novo.revogar("t1");
    novo.adotar(t, c);
    const d = novo.planoOuRecompor("t1");
    await Promise.resolve();
    novo.revogar("t1");
    soltar();
    expect(await d).toBeNull();
    expect(novo.planoDe("t1")).toBeNull();
  });
});
