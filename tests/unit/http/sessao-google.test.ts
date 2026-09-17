import { describe, expect, it } from "vitest";
import { claimsDoIdToken, cunharState, STATE_VALIDADE_MS, stateValido, validarClaims } from "../../../src/adapters/http/sessao-google.ts";
import { exigirConfiguracaoSegura, opcoesSessaoDoEnv } from "../../../src/adapters/http/sessao.ts";
import { CLIENT_ID, claimsBoas, idTokenFalso } from "../../helpers/google-falso.ts";

const SEGREDO = "s".repeat(40);
const AGORA = 1_800_000_000_000;
const P = { clientId: CLIENT_ID, dominio: "leapy.com.br", agora: AGORA };

describe("state anti-CSRF do login Google (E1.2)", () => {
  it("o mesmo state na URL e no cookie, dentro da validade, casa", () => {
    const s = cunharState(SEGREDO, AGORA);
    expect(stateValido(s, s, SEGREDO, AGORA + 1_000)).toBe(true);
  });

  it("recusa: assinatura de outro segredo, URL ≠ cookie, ausente, vencido (601 s) e do futuro", () => {
    const s = cunharState(SEGREDO, AGORA);
    const outro = cunharState(SEGREDO, AGORA);
    expect(stateValido(s, s, "outro-segredo".repeat(4), AGORA)).toBe(false);
    expect(stateValido(s, outro, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(undefined, s, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(s, undefined, SEGREDO, AGORA)).toBe(false);
    expect(stateValido(s, s, SEGREDO, AGORA + STATE_VALIDADE_MS + 1_000)).toBe(false);
    expect(stateValido(s, s, SEGREDO, AGORA - 1)).toBe(false);
    const adulterado = `${s.slice(0, 4)}x${s.slice(5)}`;
    expect(stateValido(adulterado, adulterado, SEGREDO, AGORA)).toBe(false);
  });
});

describe("claims do id_token (E1.2, ADR-030)", () => {
  it("caminho feliz devolve o e-mail em minúsculas — com a assinatura do token sendo LIXO", () => {
    const claims = claimsDoIdToken(idTokenFalso(claimsBoas(AGORA, { email: "Marlon.Wanderllich@leapy.com.br" })));
    expect(claims).not.toBeNull();
    expect(validarClaims(claims ?? {}, P)).toEqual({ ok: true, email: "marlon.wanderllich@leapy.com.br" });
  });

  it.each([
    ["hd de outro domínio", { hd: "outra.com.br", email: "x@outra.com.br" }, "dominio"],
    ["hd AUSENTE (conta pessoal Gmail)", { hd: undefined, email: "alguem@gmail.com" }, "dominio"],
    ["hd certo mas e-mail de outro domínio", { email: "x@gmail.com" }, "dominio"],
    ["e-mail não verificado", { email_verified: false }, "email_nao_verificado"],
    ["email_verified como texto", { email_verified: "true" }, "email_nao_verificado"],
    ["audiência de outro cliente", { aud: "outro-cliente" }, "audiencia"],
    ["emissor falso", { iss: "https://evil.example" }, "emissor"],
    ["token vencido", { exp: Math.floor(AGORA / 1000) - 1 }, "expirado"],
  ])("recusa: %s", (_nome, extra, motivo) => {
    expect(validarClaims(claimsBoas(AGORA, extra), P)).toEqual({ ok: false, motivo });
  });

  it("id_token malformado não vira claims", () => {
    expect(claimsDoIdToken(undefined)).toBeNull();
    expect(claimsDoIdToken("so-um-pedaco")).toBeNull();
    expect(claimsDoIdToken("a.bm8tanNvbg.c")).toBeNull();
    expect(claimsDoIdToken(`a.${Buffer.from("[1]").toString("base64url")}.c`)).toBeNull();
  });
});

describe("configuração segura da sessão (E1.5/E1.6, ADR-030)", () => {
  it("login real (google) pode escutar fora de 127.0.0.1 com segredo forte", () => {
    expect(() => exigirConfiguracaoSegura({ modo: "google", host: "0.0.0.0", segredo: SEGREDO })).not.toThrow();
  });

  it("login de desenvolvimento (stub) fora de 127.0.0.1 é recusado; em loopback passa", () => {
    expect(() => exigirConfiguracaoSegura({ modo: "stub", host: "0.0.0.0", segredo: SEGREDO })).toThrow(/NOD_HOST=0.0.0.0 recusado/);
    expect(() => exigirConfiguracaoSegura({ modo: "stub", host: "127.0.0.1", segredo: undefined })).not.toThrow();
  });

  it("login real com segredo ausente, curto ou o valor de exemplo publicado é recusado", () => {
    for (const segredo of [undefined, "", "curto", "dev-sem-segredo", "troque-este-segredo-em-dev"]) {
      expect(() => exigirConfiguracaoSegura({ modo: "google", host: "127.0.0.1", segredo })).toThrow(/NOD_SESSAO_SEGREDO recusado/);
    }
  });

  it("NOD_LOGIN é obrigatório: ausente ou inválido não sobe; google meio configurado não sobe", () => {
    const fontes = { pessoaPorEmail: async () => null, pessoas: async () => [] };
    expect(() => opcoesSessaoDoEnv({}, fontes)).toThrow(/NOD_LOGIN=\(ausente\) recusado/);
    expect(() => opcoesSessaoDoEnv({ NOD_LOGIN: "sim" }, fontes)).toThrow(/NOD_LOGIN=sim recusado/);
    expect(() => opcoesSessaoDoEnv({ NOD_LOGIN: "google", NOD_GOOGLE_CLIENT_ID: "x" }, fontes)).toThrow(/exige NOD_GOOGLE_CLIENT_ID/);
    expect(opcoesSessaoDoEnv({ NOD_LOGIN: "stub" }, fontes).modo).toBe("stub");
    const g = opcoesSessaoDoEnv({ NOD_LOGIN: "google", NOD_GOOGLE_CLIENT_ID: "a", NOD_GOOGLE_CLIENT_SECRET: "b", NOD_GOOGLE_REDIRECT_URI: "https://nod/cb" }, fontes);
    expect(g.modo).toBe("google");
  });
});
