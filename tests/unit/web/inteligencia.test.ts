import { expect, it } from "vitest";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import type { CatalogoHarness } from "../../../src/contracts/harness.ts";
import { renderInteligencia, escolhaInteligencia } from "../../../web/telas/inteligencia.ts";
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
