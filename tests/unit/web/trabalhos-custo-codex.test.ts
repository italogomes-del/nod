import { describe, expect, it } from "vitest";
import type { CustoDoDiaDto } from "../../../src/contracts/cota.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { custoDaFrente, tokensLegiveis } from "../../../web/telas/modo-dev.ts";
import { custoDoTopo } from "../../../web/telas/trabalhos.ts";

/** NOD-273 (definido em 2026-10-15): o Codex não informa custo — a tela mostra os tokens e diz que o dólar é parcial. */

const AGORA = new Date(2026, 9, 15, 15, 0).getTime();
const estado = (custoHoje: CustoDoDiaDto): Estado => ({
  ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [
    { id: "eng", nome: "Eng 1", conversaId: "c-eng", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
    { id: "ada", nome: "Ada", conversaId: "c-ada", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "PM", descricao: "", confirmado: true },
    { id: "gil", nome: "Gil", conversaId: "c-gil", cor: "c-blue", forma: "shape-square", ownerId: "p", titulo: "UX", descricao: "", confirmado: true },
  ] } as never,
  custoHoje, custoAberto: true,
});
const base = { fuso: "America/Sao_Paulo", desde: AGORA - 15 * 3_600_000, ate: AGORA, foraDoRitmo: false, mediaUsd: 0 };
const bot = (agenteId: string, hojeUsd: number, tokens: number, parcial: boolean) => ({ agenteId, hojeUsd, tokens, parcial, mediaUsd: 0, vezes: null, foraDoRitmo: false });

describe("custo do dia com o Codex", () => {
  it("o total diz (parcial); o bot só do Codex mostra os tokens e o porquê; o misto, o valor com (parcial)", () => {
    const html = custoDoTopo(estado({ ...base, totalUsd: 2.5, parcial: true, bots: [bot("ada", 2, 0, false), bot("gil", 0.5, 3_000, true), bot("eng", 0, 13_500, true)] }));
    expect(html).toContain("US$ 2,50 hoje (parcial)");
    expect(html).toMatch(/Eng 1<\/span><small class="tt-custo-sem">o Codex não informa custo<\/small><b class="tt-custo-tokens">14 mil tokens<\/b>/);
    expect(html).toMatch(/Gil<\/span><b>US\$ 0,50 \(parcial\)<\/b>/);
    expect(html).toMatch(/Ada<\/span><b>US\$ 2,00<\/b>/);
    expect(html).toContain("O Codex não informa custo");
  });

  it("sem Codex no dia, nada muda: sem (parcial) nem nota", () => {
    const html = custoDoTopo(estado({ ...base, totalUsd: 2, parcial: false, bots: [bot("ada", 2, 900, false)] }));
    expect(html).toContain("US$ 2,00 hoje");
    expect(html).not.toContain("parcial");
    expect(html).not.toContain("Codex");
  });

  it("tokens legíveis: abaixo de mil, o número; acima, em mil arredondado", () => {
    expect(tokensLegiveis(850)).toBe("850 tokens");
    expect(tokensLegiveis(13_500)).toBe("14 mil tokens");
    expect(tokensLegiveis(1_204_400)).toBe("1.204 mil tokens");
  });

  it("o custo da frente: (parcial) com turno do Codex; só Codex diz por quê; sem nada, nada", () => {
    expect(custoDaFrente({ custoUsd: 0.88 })).toBe("US$ 0,88");
    expect(custoDaFrente({ custoUsd: 0.88, custoParcial: true })).toBe("US$ 0,88 (parcial)");
    expect(custoDaFrente({ custoUsd: null, custoParcial: true })).toBe("custo não informado pelo Codex");
    expect(custoDaFrente({ custoUsd: null })).toBeNull();
  });
});
