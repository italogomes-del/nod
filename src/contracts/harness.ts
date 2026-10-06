import type { Inventario } from "./inventario.ts";

export type IdHarness = "claude-cli" | "codex-cli" | "cursor-cli" | "hermes";
export type PreferenciaHarness = "auto" | IdHarness;
export type ModeloHarness = { id: string; nome: string; descricao: string };
export type OpcaoHarness = {
  id: IdHarness;
  nome: string;
  descricao: string;
  integrado: boolean;
  modelos: readonly ModeloHarness[];
  inventario: Inventario;
};
export type CatalogoHarness = { padrao: IdHarness | null; simulacao: boolean; opcoes: OpcaoHarness[] };

/**
 * NOD-167: o id do Luna, o modelo rápido do Codex, num lugar só: o catálogo do chat e o padrão da ligação
 * (MODELOS_LIGACAO_PADRAO) leem daqui. Antes eram `gpt-5.6-luna` aqui e `gpt-6-luna` no padrão da ligação. Vale o
 * `gpt-5.6-luna` (a família do `gpt-5.6-sol`, já medido no Codex real), até o `model/list` da sonda
 * (scripts/sonda-codex-app-server.ts) mostrar o id de verdade: trocar é esta linha.
 */
export const MODELO_LUNA_CODEX = "gpt-5.6-luna";

/**
 * definido em 2026-09-18: catálogo editorial; disponibilidade de conta vem da sonda, nunca desta lista. NOD-171
 * (2026-10-06): a lista só cresce; entra o modelo que o `model/list` do Codex real mostrou E que passou num turno real
 * do UAT (docs/uat-harnesses-e-modelos.md). Os padrões do automático (resolverHarness em domain/harness.ts) não mudam.
 */
export const HARNESSES = [
  { id: "claude-cli", nome: "Claude Code", descricao: "Usa sua conta do Claude.", integrado: true,
    modelos: [{ id: "sonnet", nome: "Sonnet", descricao: "Equilíbrio para o dia a dia" }, { id: "haiku", nome: "Haiku", descricao: "Tarefas rápidas e simples" }, { id: "opus", nome: "Opus", descricao: "Trabalhos mais complexos" }] },
  { id: "codex-cli", nome: "Codex", descricao: "Usa sua conta do Codex.", integrado: true,
    modelos: [{ id: "gpt-5.6-sol", nome: "GPT-5.6 Sol", descricao: "Trabalho do dia a dia" }, { id: "gpt-6-astra", nome: "GPT-6 Astra", descricao: "Trabalhos mais complexos" }, { id: MODELO_LUNA_CODEX, nome: "GPT-5.6 Luna", descricao: "Tarefas rápidas e simples" },
      { id: "gpt-6.1-sol", nome: "GPT-6.1 Sol", descricao: "Dia a dia, geração mais nova" }, { id: "gpt-6-sol", nome: "GPT-6 Sol", descricao: "Dia a dia, geração 6" }, { id: "gpt-6-luna", nome: "GPT-6 Luna", descricao: "Rápido, geração 6" }] },
  { id: "cursor-cli", nome: "Cursor", descricao: "Integração em preparação.", integrado: false, modelos: [] },
  { id: "hermes", nome: "Hermes", descricao: "Integração em preparação; poderá oferecer modelos de diferentes provedores, como Grok.", integrado: false, modelos: [] },
] as const satisfies readonly Omit<OpcaoHarness, "inventario">[];
