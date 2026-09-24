/**
 * Rótulo humano de uma chamada de ferramenta para o cartão de atividade do turno vivo. Recebe só o
 * NOME que o CLI viu (mcp__nod__<nome>, mcp__<servidor>__<nome> no Codex, ou nativa como Bash) e
 * nunca input/resultado: o cartão diz o que o agente está fazendo, não o conteúdo que ele tocou.
 */
const NOD: Record<string, string> = {
  lembrar: "Anotou na memória",
  atualizar_perfil: "Propôs mudança no perfil",
  pedir_acesso: "Pediu um acesso",
  criar_rotina: "Propôs uma rotina",
  listar_rotinas: "Consultou as rotinas",
  pausar_rotina: "Pausou uma rotina",
  reativar_rotina: "Reativou uma rotina",
  atualizar_rotina: "Propôs mudança numa rotina",
  excluir_rotina: "Propôs excluir uma rotina",
  pedir_aprovacao: "Pediu aprovação",
  pedir_a_pessoa: "Pediu ajuda a você",
  passar: "Passou a vez",
  encaminhar: "Encaminhou a outro bot",
  sem_novidade: "Viu que não há novidade",
  perguntar_a_bot: "Perguntou a outro bot",
};

/** Prefixos de capacidade que só leem; o resto de um conector conta como alteração. */
const LEITURA = /^(search|list|get|read|find|fetch|query|consultar|listar|ler|buscar)/;

function titulo(slug: string): string {
  const limpo = slug.replace(/[-_]+/g, " ").trim();
  return limpo ? limpo[0]!.toUpperCase() + limpo.slice(1) : "uma ferramenta";
}

export function rotuloFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(nomeCli);
  if (!m) return nomeCli ? `Usou ${nomeCli}` : "Usou uma ferramenta";
  const nome = m[2]!;
  const nod = NOD[nome];
  if (nod) return nod;
  if (nome.startsWith("computador_")) return "Usou o computador";
  if (nome.startsWith("workspace_")) return "Usou a pasta de trabalho";
  const conector = /^(.+?)__(.+)$/.exec(nome);
  if (conector) return `${LEITURA.test(conector[2]!) ? "Consultou" : "Alterou"} ${titulo(conector[1]!)}`;
  return `Usou ${titulo(m[1] === "nod" ? nome : m[1]!)}`;
}
