import { describe, expect, it } from "vitest";
import { ACORDADA_APOS_ACAO_MS, escolherMaquina, formaCanonica, type MaquinaCandidata, motivoParaFicarAcordada } from "../../../src/domain/computador-canal.ts";

describe("formaCanonica", () => {
  it("ordena chaves, tira undefined e não depende da ordem de inserção", () => {
    expect(formaCanonica({ b: 1, a: { d: [1, "x", null], c: undefined } })).toBe('{"a":{"d":[1,"x",null]},"b":1}');
    expect(formaCanonica({ x: 1, y: 2 })).toBe(formaCanonica({ y: 2, x: 1 }));
  });
});

describe("escolherMaquina", () => {
  const m = (machineId: string, o: Partial<MaquinaCandidata> = {}): MaquinaCandidata => ({ machineId, plataforma: "linux", computador: "pronto", ultimoContato: 0, ...o });
  const base = { maquinaId: null, hospedeiraId: null, padraoId: null };

  it("maquina_id e hospedeira_id valem mesmo sem contato", () => {
    expect(escolherMaquina({ ...base, maquinaId: "fixa", hospedeiraId: "h", conectadas: [m("a")] })).toBe("fixa");
    expect(escolherMaquina({ ...base, hospedeiraId: "h", conectadas: [m("a")] })).toBe("h");
  });
  it("a única Linux pronta; Mac e motor sem computador não contam", () => {
    expect(escolherMaquina({ ...base, conectadas: [m("mac", { plataforma: "darwin" }), m("velho", { computador: null }), m("a")] })).toBe("a");
  });
  it("com várias prontas: a padrão, senão a de contato mais recente", () => {
    const conectadas = [m("a", { ultimoContato: 10 }), m("b", { ultimoContato: 30 }), m("c", { ultimoContato: 20 })];
    expect(escolherMaquina({ ...base, padraoId: "c", conectadas })).toBe("c");
    expect(escolherMaquina({ ...base, padraoId: "outra", conectadas })).toBe("b");
  });
  it("sem nenhuma pronta, a que anuncia o computador (para dizer o motivo); sem nenhuma, null", () => {
    expect(escolherMaquina({ ...base, conectadas: [m("a", { computador: "faltam_pacotes" })] })).toBe("a");
    expect(escolherMaquina({ ...base, conectadas: [m("mac", { plataforma: "darwin" })] })).toBeNull();
  });
});

describe("motivoParaFicarAcordada", () => {
  const agora = 1_000_000_000;
  it("tela abrindo, aberta ou esperando segura a máquina; fechada não", () => {
    for (const estado of ["abrindo", "aberta", "esperando"] as const) expect(motivoParaFicarAcordada([{ telas: [{ agenteId: "a", estado, ultimaAcaoEm: null, memoriaMb: null }] }], null, agora)).toBe(true);
    expect(motivoParaFicarAcordada([{ telas: [{ agenteId: "a", estado: "fechada", ultimaAcaoEm: null, memoriaMb: null }] }], null, agora)).toBe(false);
  });
  it("ação há menos de 15 min segura; há 15 min, não", () => {
    expect(motivoParaFicarAcordada([], agora - ACORDADA_APOS_ACAO_MS + 1, agora)).toBe(true);
    expect(motivoParaFicarAcordada([], agora - ACORDADA_APOS_ACAO_MS, agora)).toBe(false);
  });
});
