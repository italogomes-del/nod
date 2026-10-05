import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarProvedoresVoz, provedorPadrao } from "../../../src/adapters/voz/fabrica.ts";

describe("voz: fábrica de provedores", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("padrão: produção → google; dev no macOS → local; dev fora do Mac → falso", () => {
    expect(provedorPadrao({ NODE_ENV: "production" }, "linux")).toBe("google");
    expect(provedorPadrao({ NODE_ENV: "production" }, "darwin")).toBe("google");
    expect(provedorPadrao({}, "darwin")).toBe("local");
    expect(provedorPadrao({ NODE_ENV: "development" }, "linux")).toBe("falso");
  });

  it("escolhe cada lado por NOD_VOZ_STT e NOD_VOZ_TTS", async () => {
    const a = criarProvedoresVoz({ NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "falso" }, "darwin");
    expect([a.stt.id, a.tts.id]).toEqual(["falso", "falso"]);
    const b = criarProvedoresVoz({ NOD_VOZ_STT: "google", NOD_VOZ_TTS: "local", NOD_VOZ_PROJETO: "p" }, "darwin");
    expect([b.stt.id, b.tts.id]).toEqual(["google", "local"]);
    expect(b.stt.capacidades.parciais).toBe(true);
    const c = criarProvedoresVoz({}, "darwin");
    expect([c.stt.id, c.tts.id]).toEqual(["local", "local"]);
    expect(c.stt.capacidades.parciais).toBe(false);
    const d = criarProvedoresVoz({ NODE_ENV: "production", NOD_VOZ_PROJETO: "p" }, "linux");
    expect([d.stt.id, d.tts.id]).toEqual(["google", "google"]);
    await Promise.all([a.encerrar(), b.encerrar(), c.encerrar(), d.encerrar()]);
  });

  it("a voz do Google sai em streaming por padrão; NOD_VOZ_TTS_STREAMING=0 volta ao REST puro", async () => {
    const padrao = criarProvedoresVoz({ NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "google", NOD_VOZ_PROJETO: "p" }, "linux");
    expect(padrao.tts.capacidades.streaming).toBe(true);
    const rest = criarProvedoresVoz({ NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "google", NOD_VOZ_PROJETO: "p", NOD_VOZ_TTS_STREAMING: "0" }, "linux");
    expect(rest.tts.capacidades.streaming).toBe(false);
    // Encerrar fecha a sessão HTTP/2 (nenhuma foi aberta: ela só nasce no primeiro pedido).
    await Promise.all([padrao.encerrar(), rest.encerrar()]);
  });

  it("valor inválido e TTS local fora do Mac falham no boot", () => {
    expect(() => criarProvedoresVoz({ NOD_VOZ_STT: "azure" }, "darwin")).toThrow("entrada_invalida");
    expect(() => criarProvedoresVoz({ NOD_VOZ_TTS: "local" }, "linux")).toThrow("integracao_nao_configurada");
  });
});
