import { describe, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, HARNESSES, SEM_CAPACIDADES } from "../../../src/contracts/harness.ts";
import { capacidadesDe } from "../../../src/domain/harness.ts";

describe("capacidadesDe (ADR-081): diferença entre harnesses só por capacidade", () => {
  it("todo harness do catálogo declara as cinco capacidades", () => {
    for (const h of HARNESSES) expect(Object.keys(CAPACIDADES_HARNESS[h.id]).sort()).toEqual(Object.keys(SEM_CAPACIDADES).sort());
  });

  it("harness desconhecido, ausente ou 'auto' cai no caminho sem nenhuma capacidade", () => {
    for (const h of ["grok", "", null, undefined, "auto", "__proto__"]) expect(capacidadesDe(h)).toEqual(SEM_CAPACIDADES);
  });

  it("Claude retoma e bifurca a sessão; o Codex recebe mensagem no meio mas não retoma (thread/resume não medido)", () => {
    expect(capacidadesDe("claude-cli")).toMatchObject({ retomaSessao: true, bifurcaSessao: true, mensagemNoMeio: true });
    expect(capacidadesDe("codex-cli")).toMatchObject({ retomaSessao: false, bifurcaSessao: false, mensagemNoMeio: true });
  });
});
