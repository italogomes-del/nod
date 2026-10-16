import { describe, expect, it } from "vitest";
import { decidirTurnoOrfao, deveObservar, INTERVALO_OBSERVACAO_TURNO_VELHO_MS, textoDaCausa, type FatosTurnoOrfao } from "../../../src/domain/turno-orfao.ts";

const AGORA = Date.parse("2026-10-13T12:00:00Z");
const H = 3_600_000;

/** Um pendente de conversa, com o prazo da fila de 24 h, criado há 6 h, sem nada que o segure. */
const base: FatosTurnoOrfao = { origem: "conversa", criadoEm: AGORA - 6 * H, prazoEm: AGORA + 18 * H, acordarEm: null, agenteExcluido: false, geracaoAntiga: false, depoisDeAberto: false, faixaOcupada: false };
const velho: Partial<FatosTurnoOrfao> = { criadoEm: AGORA - 30 * H, prazoEm: AGORA - 6 * H };

describe("turno órfão na fila (NOD-219): só o pendente impossível de rodar se encerra", () => {
  it.each<[string, Partial<FatosTurnoOrfao>, ReturnType<typeof decidirTurnoOrfao>]>([
    ["pendente comum, dentro do prazo", {}, { tipo: "manter" }],
    ["agente excluído encerra, mesmo novo", { agenteExcluido: true }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["geração antiga encerra, mesmo novo", { geracaoAntiga: true }, { tipo: "encerrar", causa: "geracao_antiga" }],
    ["excluído ganha da geração antiga", { agenteExcluido: true, geracaoAntiga: true }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["excluído de rotina encerra", { agenteExcluido: true, origem: "rotina" }, { tipo: "encerrar", causa: "agente_excluido" }],
    ["ligação nunca entra, nem com o agente excluído", { agenteExcluido: true, origem: "ligacao" }, { tipo: "manter" }],
    ["volta marcada para mais tarde nunca entra", { geracaoAntiga: true, acordarEm: AGORA + H }, { tipo: "manter" }],
    ["volta marcada que já acordou entra", { geracaoAntiga: true, acordarEm: AGORA - H }, { tipo: "encerrar", causa: "geracao_antiga" }],
    ["velho preso pelo depois_de: observa, não encerra", { ...velho, depoisDeAberto: true, faixaOcupada: true }, { tipo: "observar", bloqueio: "depois_de" }],
    ["velho com a faixa ocupada: observa", { ...velho, faixaOcupada: true }, { tipo: "observar", bloqueio: "faixa_ocupada" }],
    ["velho sem bloqueio visível: condição da máquina (cota, Mac, memória, disco)", velho, { tipo: "observar", bloqueio: "condicao_da_maquina" }],
    ["no instante do prazo já é velho", { criadoEm: AGORA - 24 * H, prazoEm: AGORA }, { tipo: "observar", bloqueio: "condicao_da_maquina" }],
    ["um ms antes do prazo ainda não", { criadoEm: AGORA - 24 * H, prazoEm: AGORA + 1 }, { tipo: "manter" }],
  ])("%s", (_nome, extra, esperado) => {
    expect(decidirTurnoOrfao({ ...base, ...extra }, AGORA)).toEqual(esperado);
  });

  it("a causa em palavras, para a conversa e para quem pediu", () => {
    expect(textoDaCausa("agente_excluido")).toBe("o bot foi excluído");
    expect(textoDaCausa("geracao_antiga")).toContain("reiniciado");
  });

  it("a observação do mesmo turno sai no máximo uma vez por hora", () => {
    expect(deveObservar(undefined, AGORA)).toBe(true);
    expect(deveObservar(AGORA - INTERVALO_OBSERVACAO_TURNO_VELHO_MS + 1, AGORA)).toBe(false);
    expect(deveObservar(AGORA - INTERVALO_OBSERVACAO_TURNO_VELHO_MS, AGORA)).toBe(true);
  });
});
