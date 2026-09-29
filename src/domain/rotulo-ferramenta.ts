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
  pedir_a_bot: "Pediu ajuda a outro bot",
  ver_colegas: "Viu o que os colegas fazem",
};

/**
 * As nativas do Claude Code no kit do terminal (definido em 2026-09-28): "Usou TaskCreate" e "Usou Bash" não diziam
 * nada a quem lê o cartão. A lista de tarefas aparece inteira no cartão; aqui basta dizer que o bot a organizou.
 */
const NATIVAS: Record<string, string> = {
  Read: "Leu um arquivo",
  Edit: "Editou um arquivo",
  Write: "Escreveu um arquivo",
  NotebookEdit: "Editou um notebook",
  Glob: "Procurou arquivos",
  Grep: "Procurou nos arquivos",
  Bash: "Rodou um comando",
  WebFetch: "Abriu uma página",
  WebSearch: "Pesquisou na web",
  Skill: "Usou uma skill",
  Agent: "Chamou um subagente",
  ToolSearch: "Buscou ferramentas",
  TaskCreate: "Organizou as tarefas",
  TaskUpdate: "Organizou as tarefas",
  TaskList: "Organizou as tarefas",
  TaskGet: "Organizou as tarefas",
};

/** Prefixos de capacidade que só leem; o resto de um conector conta como alteração. */
const LEITURA = /^(search|list|get|read|find|fetch|query|who|consultar|listar|ler|buscar)/i;

function titulo(slug: string): string {
  const limpo = slug.replace(/[-_]+/g, " ").trim();
  return limpo ? limpo[0]!.toUpperCase() + limpo.slice(1) : "uma ferramenta";
}

export function rotuloFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(nomeCli);
  if (!m) return NATIVAS[nomeCli] ?? (nomeCli ? `Usou ${nomeCli}` : "Usou uma ferramenta");
  const nome = m[2]!;
  const nod = NOD[nome];
  if (nod) return nod;
  if (nome.startsWith("computador_")) return "Usou o computador";
  if (nome.startsWith("workspace_")) return "Usou a pasta de trabalho";
  const conector = /^(.+?)__(.+)$/.exec(nome);
  if (conector) {
    // Composio repete o app no nome da capacidade (gmail__GMAIL_FETCH_EMAILS): o verbo vem depois dele.
    const slug = conector[1]!;
    const cap = conector[2]!.toLowerCase().startsWith(`${slug.toLowerCase()}_`) ? conector[2]!.slice(slug.length + 1) : conector[2]!;
    return `${LEITURA.test(cap) ? "Consultou" : "Alterou"} ${titulo(slug)}`;
  }
  return `Usou ${titulo(m[1] === "nod" ? nome : m[1]!)}`;
}
