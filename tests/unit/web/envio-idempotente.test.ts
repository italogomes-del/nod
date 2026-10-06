import { describe, expect, it, vi } from "vitest";
import { corpoDoEnvio, criarEnvios } from "../../../web/lib/envio-idempotente.ts";
import { enviarPeloComposer, type ApiDeEnvio } from "../../../web/lib/perguntas.ts";

function contador(): () => string {
  let n = 0;
  return () => `chave-${++n}`;
}

describe("NOD-156: idEnvio no envio da web", () => {
  it("o corpo do envio leva idEnvio quando há um; sem ele, fica como antes (cliente antigo)", () => {
    expect(corpoDoEnvio("oi", [], "11111111-1111-4111-8111-111111111111")).toEqual({ texto: "oi", idEnvio: "11111111-1111-4111-8111-111111111111" });
    expect(corpoDoEnvio("oi", ["a1"], "22222222-2222-4222-8222-222222222222")).toEqual({ texto: "oi", anexos: ["a1"], idEnvio: "22222222-2222-4222-8222-222222222222" });
    expect(corpoDoEnvio("oi")).toEqual({ texto: "oi" });
    expect(corpoDoEnvio("oi", ["a1"])).toEqual({ texto: "oi", anexos: ["a1"] });
  });

  it("o reenvio da mesma fala depois de uma falha reusa a chave; fala nova depois de um envio que deu certo gera outra", () => {
    const envios = criarEnvios(contador());
    const primeira = envios.iniciar("c1", "oi", []);
    expect(primeira).toBe("chave-1");
    envios.concluir("c1", false); // a resposta se perdeu
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    envios.concluir("c1", true);
    // A pessoa manda "oi" de novo, de propósito: é outra fala.
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-2");
    envios.concluir("c1", true);
  });

  it("texto ou anexos diferentes depois da falha são outra fala; cada conversa tem a sua", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    envios.concluir("c1", false);
    expect(envios.iniciar("c1", "oi, tudo bem?", [])).toBe("chave-2");
    envios.concluir("c1", false);
    expect(envios.iniciar("c1", "oi, tudo bem?", ["a1"])).toBe("chave-3");
    envios.concluir("c1", false);
    expect(envios.iniciar("c2", "oi, tudo bem?", ["a1"])).toBe("chave-4");
  });

  it("um segundo envio na mesma conversa com o primeiro em voo é ignorado (devolve null); outra conversa segue", () => {
    const envios = criarEnvios(contador());
    expect(envios.iniciar("c1", "oi", [])).toBe("chave-1");
    expect(envios.iniciar("c1", "oi", [])).toBeNull();
    expect(envios.iniciar("c2", "oi", [])).toBe("chave-2");
    envios.concluir("c1", true);
    expect(envios.iniciar("c1", "e aí?", [])).toBe("chave-3");
  });

  it("enviarPeloComposer repassa o idEnvio só para a mensagem comum (resposta e sala ficam fora)", async () => {
    const api = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "mensagem" }, "oi", ["an1"], "chave-1");
    expect(api.enviar).toHaveBeenCalledWith("c", "oi", ["an1"], "chave-1");
    await enviarPeloComposer(api, { conversaId: "c", salaId: "s1" }, { tipo: "mensagem" }, "oi, sala", [], "chave-2");
    expect(api.postarNaSala).toHaveBeenCalledWith("s1", "oi, sala");
    await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "resposta", decisaoId: "d1" }, "sim", [], "chave-3");
    expect(api.responder).toHaveBeenCalledWith("d1", "sim");
  });
});
