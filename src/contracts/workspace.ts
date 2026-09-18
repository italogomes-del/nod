/** definido em 2026-09-18 (ADR-038): recurso de arquivos independente do harness. */
export type ModoWorkspace = "auto" | "direto" | "worktree";

export type WorkspacePreparado = {
  id: string;
  modo: "direto" | "worktree";
  caminho: string;
  origem: string;
  git: null | { raiz: string; diretorioComum: string; commitInicial: string | null; branch: string | null };
};

export type PedidoWorkspace = {
  id: string;
  /** Caminho já escolhido/autorizado na máquina; nunca um caminho arbitrário do modelo. */
  pastaAutorizada: string;
  modo: ModoWorkspace;
  /** Commit/ref para um NOVO worktree; ausente leva alterações e novos arquivos não ignorados. */
  referencia?: string;
};
