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

/** definido em 2026-09-18: catálogo editorial; disponibilidade de conta vem da sonda, nunca desta lista. */
export const HARNESSES = [
  { id: "claude-cli", nome: "Claude Code", descricao: "Usa sua conta do Claude.", integrado: true,
    modelos: [{ id: "sonnet", nome: "Sonnet", descricao: "Equilíbrio para o dia a dia" }, { id: "haiku", nome: "Haiku", descricao: "Tarefas rápidas e simples" }, { id: "opus", nome: "Opus", descricao: "Trabalhos mais complexos" }] },
  { id: "codex-cli", nome: "Codex", descricao: "Usa sua conta do Codex.", integrado: true,
    modelos: [{ id: "gpt-5.6-sol", nome: "GPT-5.6 Sol", descricao: "Trabalho do dia a dia" }, { id: "gpt-6-astra", nome: "GPT-6 Astra", descricao: "Trabalhos mais complexos" }, { id: "gpt-5.6-luna", nome: "GPT-5.6 Luna", descricao: "Tarefas rápidas e simples" }] },
  { id: "cursor-cli", nome: "Cursor", descricao: "Integração em preparação.", integrado: false, modelos: [] },
  { id: "hermes", nome: "Hermes", descricao: "Integração em preparação; poderá oferecer modelos de diferentes provedores, como Grok.", integrado: false, modelos: [] },
] as const satisfies readonly Omit<OpcaoHarness, "inventario">[];
