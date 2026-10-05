import { expect, it } from "vitest";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { CatalogoHarness } from "../../../src/contracts/harness.ts";
import { motivoDoInventario, renderInteligencia, escolhaInteligencia } from "../../../web/telas/inteligencia.ts";
const catalogo: CatalogoHarness = { padrao: "codex-cli", simulacao: false, opcoes: HARNESSES.map((h) => ({ ...h, inventario: h.id === "codex-cli" ? { estado: "pronto", versao: "teste", em: 1 } : { estado: "ausente", motivo: "Conecte sua conta", em: 1 } })) };
it("automático selecionado, opções agrupadas e ausência explicada", () => {
  const html = renderInteligencia({ modelo: "auto", harness: "auto" }, catalogo);
  expect(html).toContain('value="auto" selected');
  expect(html).toContain('<optgroup label="Codex">');
  expect(html).toContain('value="claude-cli:sonnet" disabled');
  expect(html).toContain('name="inteligencia" aria-describedby="inteligencia-ajuda"');
  expect(html).toContain("Em preparação");
  expect(html).not.toContain('value="hermes:');
  expect(html).not.toContain('inteligencia-personalizar" open');
});
it("preserva escolha offline e legada em vez de salvar a primeira opção por acidente", () => {
  const html = renderInteligencia({ modelo: 'claude-antigo', harness: 'auto' }, catalogo);
  expect(html).toContain('<option selected value="claude-cli:claude-antigo">');
  const d = new FormData(); d.set("inteligencia", "codex-cli:gpt-6-astra");
  expect(escolhaInteligencia(d)).toEqual({ harness: "codex-cli", modelo: "gpt-6-astra" });
});
it("NOD-174: código da sonda vira frase; frase pronta passa como está", () => {
  expect(motivoDoInventario("Claude Code", { estado: "ausente", motivo: "binario_nao_encontrado", em: 1 })).toBe("Não encontramos o Claude Code neste Mac. Instale e entre na sua conta para usá-lo no nod.");
  expect(motivoDoInventario("Claude Code", { estado: "nao_autenticado", motivo: "turno_de_sonda_exit_1", em: 1 })).toBe("Entre na sua conta do Claude Code neste Mac e tente de novo.");
  expect(motivoDoInventario("Codex", { estado: "nao_autenticado", motivo: "A conta entrou, mas não respondeu ao teste.", causa: "teste_falhou", em: 1 })).toBe("A conta entrou, mas não respondeu ao teste.");
  expect(motivoDoInventario("Codex", { estado: "ausente", motivo: "Atualize o Codex: esta versão não aceita o isolamento exigido pelo nod.", em: 1 })).toContain("Atualize o Codex");
  const html = renderInteligencia({ modelo: "auto", harness: "auto" }, { ...catalogo, opcoes: catalogo.opcoes.map((h) => ({ ...h, integrado: true, inventario: { estado: "ausente", motivo: "claude_fora_do_path", em: 1 } })) });
  expect(html).not.toContain("claude_fora_do_path");
});
// Regression: NOD-174 QA — o driver em sombra guarda "<estado>: <motivo>" (registry.ts) e o create que falha guarda
// "create_falhou: <erro>"; com espaço e dois-pontos o código passava pelo teste de "só snake_case" e aparecia cru.
it.each([
  ["ausente", "ausente: claude_fora_do_path", "Não encontramos o Claude Code"],
  ["ausente", "nao_autenticado: turno_de_sonda_sem_result", "Não encontramos o Claude Code"],
  ["ausente", "create_falhou: spawn ENOENT", "Não encontramos o Claude Code"],
  ["nao_autenticado", "nao_autenticado: conta_sem_acesso", "Entre na sua conta do Claude Code"],
] as const)("NOD-174: motivo com código embutido (%s, %s) vira frase", (estado, motivo, frase) => {
  const texto = motivoDoInventario("Claude Code", { estado, motivo, em: 1 });
  expect(texto).toContain(frase);
  expect(texto).not.toMatch(/[a-z0-9]+_[a-z0-9]+/);
});
