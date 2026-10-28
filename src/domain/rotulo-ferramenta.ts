/**
 * Rótulo humano de uma chamada de ferramenta para o cartão de atividade do turno vivo. Recebe só o
 * NOME que o CLI viu (mcp__nod__<nome>, mcp__<servidor>__<nome> no Codex, ou nativa como Bash) e
 * nunca input/resultado: o cartão diz o que o agente está fazendo, não o conteúdo que ele tocou.
 */
import type { EventoStream } from "../contracts/turno.ts";
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
  // ADR-083 (#193): a conversa coordena as tasks.
  abrir_task: "Abriu uma task",
  mandar_para_task: "Repassou a uma task",
  me_chame_as: "Saiu do Mac até a hora de voltar",
  // ADR-099 (I2): o dono abre frentes em lote e cada frente devolve um resumo.
  abrir_frentes: "Começou frentes",
  mandar_para_frente: "Repassou a uma frente",
  devolver_resumo: "Devolveu o resumo",
  // ADR-099 (parte 2): o Nod roda o comando e acorda o bot quando ele termina.
  esperar_comando: "Deixou um comando esperando por ele",
  // NOD-210 (ADR-104): um bot comum cria outros bots quando a pessoa pede.
  criar_bots: "Criou bots",
  // NOD-262: o bot fecha da conversa um pedido de colega que já resolveu.
  responder_pedido: "Respondeu a um pedido de colega",
  // NOD-50: o cartão de credencial; o rótulo nunca cita o valor (o bot nem o tem).
  pedir_credencial: "Pediu uma chave",
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

/**
 * Sem o nome da IA em nenhum rótulo (critério 8 da NOD-348; QA 2 e revisão 4 do #508): o conector do próprio CLI
 * (`mcp__claude_ai_Linear__…`) é o app; outro servidor com nome de IA (`claude-in-chrome`, `codex`) vira o navegador,
 * se for um, ou fica sem nome.
 */
function semIaNoNome(nomeCli: string): string {
  const semPrefixo = nomeCli.replace(/^mcp__claude_ai_(?=[^_])/, "mcp__");
  const m = /^mcp__(.+?)__/.exec(semPrefixo);
  if (!m || !SERVIDOR_DE_IA.test(m[1]!)) return semPrefixo;
  return semPrefixo.replace(/^mcp__.+?__/, `mcp__${/chrome|browser|navegador/i.test(m[1]!) ? "navegador" : "ferramenta"}__`);
}

/**
 * Revisão 5 do #508: sem exigir separador, para pegar os colados (`openaiDeveloperDocs`, `claudeCode`). Um servidor que
 * só contenha as letras (`decodex`) também fica sem nome: melhor "uma ferramenta" do que o nome da IA na tela.
 */
const SERVIDOR_DE_IA = /claude|codex|openai|anthropic|gemini|gpt/i;

export function rotuloFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(semIaNoNome(nomeCli));
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
    // Revisão 7 do #508: um conector do nod com nome de IA (`mcp__nod__openai__…`) também fica sem nome.
    return `${LEITURA.test(cap) ? "Consultou" : "Alterou"} ${SERVIDOR_DE_IA.test(slug) ? "uma ferramenta" : titulo(slug)}`;
  }
  if (m[1] === "navegador") return "Usou o navegador";
  if (m[1] === "ferramenta") return "Usou uma ferramenta";
  return `Usou ${titulo(m[1] === "nod" ? nome : m[1]!)}`;
}

/** O substantivo das nativas no aviso do vigia ("Esperando *Terminal* terminar"), nunca o comando (NOD-73). */
const NATIVAS_NOME: Record<string, string> = {
  Bash: "Terminal",
  BashOutput: "Terminal",
  Monitor: "Monitor",
  Read: "Leitura de arquivo",
  Edit: "Edição de arquivo",
  Write: "Escrita de arquivo",
  NotebookEdit: "Notebook",
  Glob: "Busca de arquivos",
  Grep: "Busca nos arquivos",
  WebFetch: "Navegador",
  WebSearch: "Pesquisa na web",
  Skill: "Skill",
  Agent: "Subagente",
  ToolSearch: "Busca de ferramentas",
  TaskCreate: "Lista de tarefas",
  TaskUpdate: "Lista de tarefas",
  TaskList: "Lista de tarefas",
  TaskGet: "Lista de tarefas",
};

/**
 * O nome curto da ferramenta para o aviso do vigia do turno (definido em 2026-10-05, NOD-73): "Terminal", "Linear",
 * "Computador". Como o rótulo, só lê o NOME que o CLI viu.
 */
export function nomeDaFerramenta(nomeCli: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(semIaNoNome(nomeCli));
  if (!m) return NATIVAS_NOME[nomeCli] ?? (nomeCli || "uma ferramenta");
  const nome = m[2]!;
  if (nome.startsWith("computador_")) return "Computador";
  if (nome.startsWith("workspace_")) return "Pasta de trabalho";
  const conector = /^(.+?)__(.+)$/.exec(nome);
  if (conector) return SERVIDOR_DE_IA.test(conector[1]!) ? "uma ferramenta" : titulo(conector[1]!);
  if (m[1] === "ferramenta") return "uma ferramenta";
  return titulo(m[1] === "nod" ? nome : m[1]!);
}

/**
 * NOD-348 (definido em 2026-10-23): o que a fala viva diz AGORA — "Usando ‹ferramenta›", com o mesmo nome do vigia
 * (`nomeDaFerramenta`), e "Abrindo frentes" quando o bot abre ou manda para frentes. Os verbos no presente ("Rodando um
 * comando") são da NOD-352; aqui só o nome que já existe (revisão do #508). Como o rótulo, só lê o NOME que o CLI viu.
 */
export type FerramentaEmUso = { texto: string; frentes: boolean };

const FRENTES = new Set(["abrir_frentes", "mandar_para_frente"]);

export function ferramentaEmUso(nomeCli: string): FerramentaEmUso {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(nomeCli);
  if (!m) return { texto: `Usando ${NATIVAS_NOME[nomeCli] ?? "uma ferramenta"}`, frentes: false };
  if (m[1] === "nod" && FRENTES.has(m[2]!)) return { texto: "Abrindo frentes", frentes: true };
  // O conector do próprio CLI (`claude_ai_Linear`) não mostra o nome da IA na tela (critério 8 da NOD-348).
  const semIa = semIaNoNome(nomeCli);
  if (semIa.startsWith("mcp__navegador__")) return { texto: "Usando o navegador", frentes: false };
  if (semIa.startsWith("mcp__ferramenta__")) return { texto: "Usando uma ferramenta", frentes: false };
  const nome = m[1] === "nod" && !/^(computador_|workspace_)/.test(m[2]!) && !/__/.test(m[2]!) ? "o nod" : nomeDaFerramenta(semIa);
  return { texto: `Usando ${nome}`, frentes: false };
}

/** NOD-353: teto do rótulo da ação, o mesmo no frame ao vivo e no resumo gravado (a troca da viva pela gravada não muda o texto). */
export const ROTULO_DA_ACAO_MAX = 120;

/** O frame `turno.atividade` de uma ferramenta: o mesmo nos dois caminhos (ponte HTTP e laço local); `id` do tool_use (NOD-353). */
export function frameVivoDoEvento(ev: EventoStream): { tipo: "turno.atividade"; dados: ReturnType<typeof frameDaFerramenta> } | { tipo: "turno.acao_fim"; dados: { id: string; falhou: boolean } } | null {
  if (ev.tipo === "tool_use") return { tipo: "turno.atividade", dados: frameDaFerramenta(ev.nome, ev.id) };
  // O fim de cada chamada leva só o Falhou de tool_result.isError (nunca o conteúdo do resultado).
  if (ev.tipo === "tool_result") return { tipo: "turno.acao_fim", dados: { id: ev.toolUseId, falhou: ev.isError } };
  return null;
}

/** NOD-353: o desktop e o motor repassam à ponte a chamada e o fim dela (o mesmo mapa nos dois). */
export function repassarAcaoDoEvento(alvo: { ferramenta(turnoId: string, nome: string, id?: string): void; fimDaFerramenta(turnoId: string, id: string, falhou: boolean): void }, turnoId: string, ev: EventoStream): void {
  if (ev.tipo === "tool_use") alvo.ferramenta(turnoId, ev.nome, ev.id);
  else if (ev.tipo === "tool_result") alvo.fimDaFerramenta(turnoId, ev.toolUseId, ev.isError);
}

/** O laço local manda o mesmo frame da ponte, com o `emUso` da fala viva (NOD-348) e o fim de cada chamada (NOD-353). */
export function frameDaFerramenta(nomeCli: string, id?: string): { nome: string; rotulo: string; emUso: FerramentaEmUso; id?: string } {
  return { nome: nomeCli, rotulo: rotuloFerramenta(nomeCli).slice(0, ROTULO_DA_ACAO_MAX), emUso: ferramentaEmUso(nomeCli), ...(id ? { id } : {}) };
}
