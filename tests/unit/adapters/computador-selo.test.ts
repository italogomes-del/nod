import { describe, expect, it } from "vitest";
import { abrirSelo, assinarComando, chaveDaMaquina, conferirAssinatura, gerarParX25519, publicaDeAssinatura, seloDoIniciar } from "../../../src/adapters/computador/selo.ts";

const chave = "ab".repeat(32);
const id = "11111111-2222-3333-4444-555555555555";
const comando = { id: "c1", computadorId: id, tipo: "acao" as const, agenteId: "ag", acao: { tipo: "navegar" as const, url: "https://exemplo.com" }, uso: "equilibrado" as const, prazoMs: 1_000 };

describe("assinatura Ed25519", () => {
  it("o supervisor confere com a pública do computador; adulterado ou de outro computador, não", () => {
    const assinado = assinarComando(chave, comando);
    const publica = publicaDeAssinatura(chave, id);
    expect(conferirAssinatura(publica, assinado)).toBe(true);
    expect(conferirAssinatura(publica, { ...assinado, prazoMs: 2_000 })).toBe(false);
    expect(conferirAssinatura(publica, { ...assinado, acao: { tipo: "navegar", url: "https://outro.com" } })).toBe(false);
    expect(conferirAssinatura(publicaDeAssinatura(chave, "99999999-2222-3333-4444-555555555555"), assinado)).toBe(false);
  });
  it("é determinística pela chave e pelo id (sobrevive ao reinício do servidor)", () => {
    expect(publicaDeAssinatura(chave, id)).toBe(publicaDeAssinatura(chave, id));
    expect(assinarComando(chave, comando).assinatura).toBe(assinarComando(chave, comando).assinatura);
  });
  it("recusa NOD_CREDENTIAL_KEY que não é hex de 64", () => {
    expect(() => assinarComando("curta", comando)).toThrow();
  });
});

describe("selo X25519", () => {
  it("só o supervisor abre; leva a chave da máquina e a pública para fixar", () => {
    const sup = gerarParX25519();
    const selo = seloDoIniciar(chave, id, sup.publica);
    const aberto = JSON.parse(abrirSelo(sup.privada, selo).toString()) as { chaveMaquina: string; confia: string };
    expect(aberto).toEqual({ chaveMaquina: chaveDaMaquina(chave, id), confia: publicaDeAssinatura(chave, id) });
    expect(() => abrirSelo(gerarParX25519().privada, selo)).toThrow();
    expect(seloDoIniciar(chave, id, sup.publica)).not.toBe(selo);
  });
  it("o segredo não aparece no selo", () => {
    const sup = gerarParX25519();
    expect(Buffer.from(seloDoIniciar(chave, id, sup.publica), "base64").toString("hex")).not.toContain(chaveDaMaquina(chave, id));
  });
});
