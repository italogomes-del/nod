import { describe, expect, it } from "vitest";
import { CLASSES_ERRO_FORNECEDOR, classificarErroFornecedor, FRASE_ERRO_FORNECEDOR, fraseDoErroFornecedor } from "../../../src/domain/erro-fornecedor.ts";
import { redigirSegredos } from "../../../src/domain/segredos.ts";

/**
 * Amostras no formato do `erroCru` de cada driver: o Claude junta `subtype | error | errors | result` (stream-json.ts) e
 * o Codex manda `turn.failed.error.message` ou o evento `error` (codex-stream.ts, codex-app-server.ts).
 */
const AMOSTRAS: Record<(typeof CLASSES_ERRO_FORNECEDOR)[number], string[]> = {
  login_expirado: [
    "success | Invalid API key · Please run /login",
    "success | OAuth token has expired. Please obtain a new token or refresh your existing token.",
    "success | Not logged in · Please run /login",
    'success | API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
    "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.",
  ],
  contexto_cheio: [
    "success | Prompt is too long",
    'error_during_execution | API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 212345 tokens > 200000 maximum"}}',
    "Your input exceeds the context window of this model. Please adjust your input and try again.",
    "context_length_exceeded",
  ],
  sobrecarga: [
    'success | API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "error_during_execution | Repeated 529 Overloaded errors",
    "unexpected status 503 Service Unavailable: upstream connect error",
  ],
  desconhecido: [
    "success | Credit balance is too low",
    "error_max_turns",
    "stream disconnected before completion: error sending request",
    "user cancelled MCP tool call",
  ],
};

const INGLES = /\b(?:error|failed|please|login|overloaded|expired|retry|context)\b/i;

describe("erro do fornecedor em classe fechada (NOD-174)", () => {
  for (const [classe, amostras] of Object.entries(AMOSTRAS)) {
    it(`amostras reais caem em ${classe}`, () => {
      for (const a of amostras) expect(classificarErroFornecedor(a), a).toBe(classe);
    });
  }

  it("vazio, nulo e só espaço são desconhecido, sem frase", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(classificarErroFornecedor(v)).toBe("desconhecido");
      expect(fraseDoErroFornecedor("claude-cli", v)).toBeNull();
    }
  });

  it("texto que bate em duas classes segue a ordem login > contexto > sobrecarga", () => {
    expect(classificarErroFornecedor("529 overloaded; then 401 Unauthorized")).toBe("login_expirado");
    expect(classificarErroFornecedor("Overloaded… Prompt is too long")).toBe("contexto_cheio");
  });

  it("a frase sai em pt-BR, com o nome da IA e sem código snake_case nem inglês", () => {
    expect(fraseDoErroFornecedor("claude-cli", AMOSTRAS.login_expirado[0])).toBe("sua conta do Claude Code saiu deste Mac; use Conectar IA para entrar de novo");
    expect(fraseDoErroFornecedor("codex-cli", AMOSTRAS.contexto_cheio[2])).toBe("a conversa ficou longa demais para o Codex; use /compactar e peça de novo");
    expect(fraseDoErroFornecedor(null, AMOSTRAS.sobrecarga[0])).toBe("o serviço da sua IA está sobrecarregado; tente de novo em alguns minutos");
    for (const harness of ["claude-cli", "codex-cli", null] as const) {
      for (const classe of Object.keys(FRASE_ERRO_FORNECEDOR) as (keyof typeof FRASE_ERRO_FORNECEDOR)[]) {
        const frase = fraseDoErroFornecedor(harness, AMOSTRAS[classe][0])!;
        expect(frase).not.toMatch(/[{}]|[a-z]+_[a-z]+|claude-cli|codex-cli/);
        expect(frase).not.toMatch(INGLES);
      }
    }
  });

  it("segredo no erro cru: o redator roda antes e a frase não carrega o valor", () => {
    const chave = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const cru = redigirSegredos(`success | Invalid API key ${chave} · Please run /login`);
    expect(cru).not.toContain(chave);
    expect(classificarErroFornecedor(cru)).toBe("login_expirado");
    expect(fraseDoErroFornecedor("claude-cli", cru)).not.toContain("sk-ant");
  });
});
