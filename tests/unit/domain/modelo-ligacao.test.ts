import { describe, expect, it } from "vitest";
import { MODELOS_LIGACAO_PADRAO } from "../../../src/contracts/modelos.ts";
import { lerModelosLigacao } from "../../../src/domain/modelo-ligacao.ts";

describe("lerModelosLigacao (NOD-164)", () => {
  it.each([
    ["ausente", {}],
    ["vazia", { NOD_MODELO_LIGACAO_CLAUDE: "", NOD_MODELO_LIGACAO_CODEX: "" }],
    ["só espaços (deploy.sh grava ${VAR:-})", { NOD_MODELO_LIGACAO_CLAUDE: "   ", NOD_MODELO_LIGACAO_CODEX: "\t" }],
  ])("%s: vale o padrão", (_, env) => {
    expect(lerModelosLigacao(env)).toEqual(MODELOS_LIGACAO_PADRAO);
  });

  it("o padrão é o Sonnet 4.6 pelo id, sem thinking e sem esforço; o Codex segue no gpt-6-luna", () => {
    expect(MODELOS_LIGACAO_PADRAO).toEqual({ "claude-cli": { modelo: "claude-sonnet-4-6", pensamentoAdaptativo: false }, "codex-cli": { modelo: "gpt-6-luna" } });
  });

  it.each([
    ["claude-sonnet-4-6", { modelo: "claude-sonnet-4-6", pensamentoAdaptativo: false }],
    ["  claude-sonnet-5-5   esforco=low ", { modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false }],
    ["claude-sonnet-4-6 pensamento=adaptativo", { modelo: "claude-sonnet-4-6", pensamentoAdaptativo: true }],
    ["claude-sonnet-4-6 pensamento=desligado esforco=max", { modelo: "claude-sonnet-4-6", esforco: "max", pensamentoAdaptativo: false }],
    ["claude-haiku-4-5-20251001", { modelo: "claude-haiku-4-5-20251001", pensamentoAdaptativo: false }],
    ["us.anthropic.claude-sonnet-4-6", { modelo: "us.anthropic.claude-sonnet-4-6", pensamentoAdaptativo: false }],
  ])("Claude aceita %j", (valor, esperado) => {
    expect(lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: valor })["claude-cli"]).toEqual(esperado);
  });

  it("Codex aceita só o modelo", () => {
    expect(lerModelosLigacao({ NOD_MODELO_LIGACAO_CODEX: " gpt-6-astra " })["codex-cli"]).toEqual({ modelo: "gpt-6-astra" });
  });

  it.each([
    ["maiúscula", "NOD_MODELO_LIGACAO_CLAUDE", "Claude-Sonnet-4-6", /não é um id de modelo/],
    ["sufixo [1m]", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6[1m]", /não é um id de modelo/],
    ["separador :", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6:low", /não é um id de modelo/],
    ["esforço inexistente", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6 esforco=turbo", /esforco="turbo" não existe/],
    ["opção desconhecida", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6 foo=1", /opção desconhecida "foo=1"/],
    ["opção sem valor", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6 pensamento", /pensamento="" não existe/],
    ["opção repetida", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6 esforco=low esforco=high", /"esforco" aparece mais de uma vez/],
    ["pensamento inválido", "NOD_MODELO_LIGACAO_CLAUDE", "claude-sonnet-4-6 pensamento=sim", /pensamento="sim" não existe/],
    ["Codex com opção", "NOD_MODELO_LIGACAO_CODEX", "gpt-6-luna esforco=low", /o Codex aceita só o modelo/],
    ["Codex com espaço no id", "NOD_MODELO_LIGACAO_CODEX", "GPT 6", /não é um id de modelo/],
  ])("recusa %s com erro em pt-BR citando a variável", (_, variavel, valor, motivo) => {
    expect(() => lerModelosLigacao({ [variavel]: valor })).toThrow(new RegExp(`^${variavel} inválida: `));
    expect(() => lerModelosLigacao({ [variavel]: valor })).toThrow(motivo);
  });
});
