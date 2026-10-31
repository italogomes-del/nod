/**
 * O quadro-agente (definido em 2026-10-31, NOD-442; base visual NOD-429): uma meta com prazo, tarefas em colunas de
 * status, e cada tarefa com um bot responsável que começa sozinho. Só tipos (EMENDA 26): o domínio puro mora em
 * src/domain/quadro.ts, o banco na 0133.
 *
 * Um quadro por bot anfitrião (quem o criou): ele mora na aba Quadro da conversa desse bot (NOD-429). Qualquer bot da
 * pessoa mexe nele pelas mesmas ações (ADR-135, domínio `quadro`).
 */

/** Os status, na ordem das colunas (os mesmos de web/lib/quadro.ts, que a NOD-429 já desenha). */
export const STATUS_TAREFA = ["backlog", "afazer", "fazendo", "voce", "revisao", "bloqueado", "feito", "cancelado"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];

/** O estado do trabalho do bot na tarefa, lido do turno ligado a ela (null = nenhum turno vivo nem falho). */
export type ExecucaoTarefa = "fila" | "rodando" | "falhou" | null;

export type TarefaQuadro = {
  id: string;
  quadroId: string;
  titulo: string;
  descricao: string;
  status: StatusTarefa;
  agenteId: string | null;
  ordem: number;
  /** O item do Linear de onde veio (NOD-416): identificador "NOD-12" e a url; nulos quando nasceu no quadro. */
  linearId: string | null;
  linearUrl: string | null;
  prUrl: string | null;
  /** O bloqueio (NOD-420): a pergunta à pessoa e, depois, a resposta dela. */
  pergunta: string | null;
  resposta: string | null;
  /** O conteúdo veio do Linear ou de um turno não confiável (ADR-062): o turno que a tarefa abrir nasce contaminado. */
  deFora: boolean;
  turnoId: string | null;
  criadoEm: number;
  mudadoEm: number;
};

export type Quadro = {
  id: string;
  agenteId: string;
  meta: string;
  /** AAAA-MM-DD, ou null. */
  prazo: string | null;
  cumpridoEm: number | null;
  resumo: string | null;
  criadoEm: number;
  atualizadoEm: number;
};

/** Quem fez o lote: a pessoa (na tela) ou um bot (pela ferramenta). */
export type AutorLote = { tipo: "pessoa" } | { tipo: "agente"; agenteId: string };

export type LoteQuadro = {
  id: string;
  quadroId: string;
  autor: AutorLote;
  resumo: string;
  tarefaIds: string[];
  desfeitoEm: number | null;
  criadoEm: number;
};

/** O que a web e o bot recebem: o quadro com as tarefas, a execução de cada uma e o último lote que dá para desfazer. */
export type TarefaDto = TarefaQuadro & { execucao: ExecucaoTarefa; agenteNome: string | null };
export type QuadroDto = Quadro & {
  agenteNome: string;
  tarefas: TarefaDto[];
  /** O último lote ainda não desfeito (o Desfazer da faixa e do aviso). */
  ultimoLote: LoteQuadro | null;
  feitas: number;
  total: number;
};

/** Uma operação no quadro (a ferramenta manda uma lista; a rota, uma). Cada tipo é um id do registro `quadro.*`. */
export type OpQuadro =
  | { tipo: "criar_quadro"; meta: string; prazo?: string | null }
  | { tipo: "criar_tarefa"; titulo: string; descricao?: string; status?: StatusTarefa; agente?: string | null }
  | { tipo: "importar_linear"; itens: ItemLinear[] }
  | { tipo: "mudar_tarefa"; tarefa: string; titulo?: string; descricao?: string; status?: StatusTarefa; agente?: string | null; pr_url?: string | null; pergunta?: string | null; excluir?: boolean }
  | { tipo: "responder"; tarefa: string; resposta: string }
  | { tipo: "editar_quadro"; meta?: string; prazo?: string | null }
  | { tipo: "desfazer"; lote?: string };

export type TipoOpQuadro = OpQuadro["tipo"];

/** Um item que o bot já buscou no Linear com a ferramenta dele (o servidor não fala com o Linear). */
export type ItemLinear = { identificador: string; titulo: string; url?: string; descricao?: string; status?: StatusTarefa; agente?: string | null };

export type ArgsGerirQuadro = {
  /** O quadro: o id, ou o nome do bot anfitrião. Sem ele, o do próprio bot, senão o único da pessoa. */
  quadro?: string;
  acoes: OpQuadro[];
};

export type ResultadoGerirQuadro =
  | { ok: true; quadro: ResumoQuadroParaBot | null; lote_id: string | null; comecaram: { tarefa_id: string; agente: string }[]; instrucao: string }
  | { ok: false; erro: "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado"; instrucao: string };

/** O quadro como o bot o lê: curto, com os ids que ele usa na próxima chamada. */
export type ResumoQuadroParaBot = {
  id: string;
  anfitriao: string;
  meta: string;
  prazo: string | null;
  cumprida: boolean;
  resumo: string | null;
  tarefas: { id: string; titulo: string; status: StatusTarefa; agente: string | null; linear: string | null; pr: string | null; pergunta: string | null; execucao: ExecucaoTarefa }[];
};

/** Os tetos do quadro (a ferramenta, o domínio e a tela usam os mesmos). */
export const LIMITES_QUADRO = { meta: 200, titulo: 200, descricao: 4000, pergunta: 1000, resposta: 4000, ops: 50, itens: 50, identificador: 40, url: 500 } as const;
