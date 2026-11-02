/**
 * O quadro-agente (definido em 2026-10-31, NOD-442; base visual NOD-429): uma meta com prazo, tarefas em colunas de
 * status, e cada tarefa com um bot responsável que começa sozinho. Só tipos (EMENDA 26): o domínio puro mora em
 * src/domain/quadro.ts, o banco na 0133.
 *
 * Um quadro por bot anfitrião (quem o criou): ele mora na aba Quadro da conversa desse bot (NOD-429). Qualquer bot da
 * pessoa mexe nele pelas mesmas ações (ADR-135, domínio `quadro`).
 */

import type { LinhaDeSistema, PrNaTela } from "./prs-da-tarefa.ts";
export type { CiPr, EstadoPr, LinhaDeSistema, PrDaTarefa, PrLido, PrNaTela, TipoLinhaTarefa } from "./prs-da-tarefa.ts";

/**
 * As colunas padrão, na ordem (os mesmos de web/lib/quadro.ts, que a NOD-429 já desenha). Definido em 2026-11-01
 * (NOD-448): são ids reservados com o comportamento de sempre; "Precisa de você" passa a ser a última do andamento.
 */
export const STATUS_TAREFA = ["backlog", "afazer", "fazendo", "revisao", "bloqueado", "voce", "feito", "cancelado"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];

/**
 * NOD-448 (definido em 2026-11-01): toda coluna é de um grupo, e o grupo dá o comportamento. Não iniciado não aciona
 * ninguém; Iniciado (o "andamento") aciona o responsável ao entrar; Feito conta no progresso; Fechado sai da conta.
 */
export const GRUPOS_COLUNA = ["nao_iniciado", "iniciado", "feito", "fechado"] as const;
export type GrupoColuna = (typeof GRUPOS_COLUNA)[number];

/** Uma coluna do quadro. `id` é uma das chaves de STATUS_TAREFA ou `c-<slug>` (criada pela pessoa; não muda ao renomear). */
export type ColunaQuadro = {
  id: string;
  nome: string;
  grupo: GrupoColuna;
  /** Passagem (ADR-142): o bot que pega a tarefa ao entrar na coluna; null/ausente = o responsável continua. */
  responsavel?: string | null;
  /** "O que essa etapa faz": vai no contexto do turno de quem pega a tarefa nesta coluna. */
  instrucoes?: string | null;
};

/** A coluna como a web e o bot a recebem: `fixa` = não move nem sai (Precisa de você, Cancelado). */
export type ColunaDto = ColunaQuadro & { fixa: boolean; daPessoa: boolean; recolhida: boolean; responsavelNome?: string | null };

/** O id de uma coluna (o `status` da tarefa): uma chave padrão ou `c-<slug>`. */
export type IdColuna = string;

/** O estado do trabalho do bot na tarefa, lido do turno ligado a ela (null = nenhum turno vivo nem falho). */
export type ExecucaoTarefa = "fila" | "rodando" | "falhou" | null;

export type TarefaQuadro = {
  id: string;
  quadroId: string;
  titulo: string;
  descricao: string;
  /** O id da coluna (NOD-448). */
  status: IdColuna;
  /** Para onde a tarefa volta quando a pessoa responde (a coluna de antes de "Precisa de você" ou de Bloqueado). */
  voltarPara: IdColuna | null;
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
  /** Quando entrou em feito/cancelado (null enquanto aberta). Só muda com o status, não com título ou ordem (revisão 3). */
  terminadaEm: number | null;
};

export type Quadro = {
  id: string;
  agenteId: string;
  /** NOD-415 (ADR-141): opcional. Sem meta é o fluxo contínuo: sem fração, sem progresso, sem risco de prazo. */
  meta: string | null;
  /** AAAA-MM-DD, ou null. */
  prazo: string | null;
  cumpridoEm: number | null;
  resumo: string | null;
  /** NOD-448: as colunas, na ordem; null = as padrão (todo quadro de antes fica assim, sem mudança). */
  colunas: ColunaQuadro[] | null;
  criadoEm: number;
  atualizadoEm: number;
  /** NOD-415 (revisão 2): quando a meta foi posta (de sem meta para com meta); o risco e o "N de M" partem dali. */
  metaDesde: number;
};

/**
 * NOD-417 (definido em 2026-11-02): um comentário numa tarefa. `deFora`: escrito por um bot (ADR-062): quem o recebe recebe
 * dado de fora. `acionados`: os bots que o comentário acionou (abriu turno ou se juntou ao que já estava na fila).
 */
export type ComentarioTarefa = { id: string; quadroId: string; tarefaId: string; autor: AutorLote; texto: string; deFora: boolean; criadoEm: number };
export type ComentarioDto = ComentarioTarefa & { autorNome: string | null; acionados: string[] };

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
export type TarefaDto = TarefaQuadro & { execucao: ExecucaoTarefa; agenteNome: string | null; prs?: PrNaTela[]; linhas?: LinhaDeSistema[] };
export type QuadroDto = Omit<Quadro, "colunas"> & {
  agenteNome: string;
  /** As colunas de verdade (as padrão quando o quadro não tem as dele). */
  colunas: ColunaDto[];
  tarefas: TarefaDto[];
  /** O último lote ainda não desfeito (o Desfazer da faixa e do aviso). */
  ultimoLote: LoteQuadro | null;
  feitas: number;
  total: number;
  avisoGithub?: string | null; // NOD-421: a linha do GitHub no topo ("não conectado", "sem acesso a dono/repo")
};

/** Uma operação no quadro (a ferramenta manda uma lista; a rota, uma). Cada tipo é um id do registro `quadro.*`. */
export type OpQuadro =
  | { tipo: "criar_quadro"; meta?: string | null; prazo?: string | null }
  | { tipo: "criar_tarefa"; titulo: string; descricao?: string; status?: string; agente?: string | null }
  | { tipo: "importar_linear"; itens: ItemLinear[] }
  | { tipo: "mudar_tarefa"; tarefa: string; titulo?: string; descricao?: string; status?: string; agente?: string | null; pr_url?: string | null; pergunta?: string | null; excluir?: boolean; sem_iniciar?: boolean }
  | { tipo: "responder"; tarefa: string; resposta: string }
  /** NOD-417: um comentário na tarefa (sozinho no lote, sem Desfazer). Aciona o responsável e os @mencionados, nunca o autor. */
  | { tipo: "comentar"; tarefa: string; texto: string }
  | { tipo: "editar_quadro"; meta?: string | null; prazo?: string | null }
  | { tipo: "desfazer"; lote?: string }
  /** NOD-415 (ADR-141): o bot volta a ser um agente comum. Apaga o quadro, as tarefas e o histórico; conversa e memória ficam. */
  | { tipo: "remover_quadro"; bot?: string }
  /* NOD-448: as colunas. `coluna`, `depois_de`, `antes_de`, `destino` = o id ou o nome da coluna. */
  | { tipo: "criar_coluna"; nome: string; grupo: GrupoColuna; depois_de?: string }
  | { tipo: "renomear_coluna"; coluna: string; nome: string }
  | { tipo: "mover_coluna"; coluna: string; antes_de?: string; depois_de?: string }
  | { tipo: "remover_coluna"; coluna: string; destino?: string }
  | { tipo: "definir_passagem"; coluna: string; agente?: string | null; instrucoes?: string | null }
  | { tipo: "terminei"; tarefa?: string }
  | { tipo: "substituir_colunas"; colunas: { id?: string; nome: string; grupo: GrupoColuna }[]; destinos?: { de: string; para: string }[] };

export type TipoOpQuadro = OpQuadro["tipo"];

/** Um item que o bot já buscou no Linear com a ferramenta dele (o servidor não fala com o Linear). */
export type ItemLinear = { identificador: string; titulo: string; url?: string; descricao?: string; status?: string; agente?: string | null };

export type ArgsGerirQuadro = {
  /** O quadro: o id, ou o nome do bot anfitrião. Sem ele, o do próprio bot, senão o único da pessoa. */
  quadro?: string;
  acoes: OpQuadro[];
};

export type ResultadoGerirQuadro =
  | { ok: true; quadro: ResumoQuadroParaBot | null; lote_id: string | null; comecaram: { tarefa_id: string; agente: string }[]; instrucao: string; ajustada?: boolean; proposta_id?: string }
  | { ok: false; erro: "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado"; instrucao: string };

/** O quadro como o bot o lê: curto, com os ids que ele usa na próxima chamada. */
export type ResumoQuadroParaBot = {
  id: string;
  anfitriao: string;
  meta: string | null;
  prazo: string | null;
  cumprida: boolean;
  resumo: string | null;
  colunas: { id: string; nome: string; grupo: GrupoColuna; passa_para?: string; instrucoes?: string }[];
  tarefas: { id: string; titulo: string; status: IdColuna; agente: string | null; linear: string | null; pr: string | null; pergunta: string | null; execucao: ExecucaoTarefa; prs?: string[] }[];
  avisoGithub?: string; // NOD-421: por que os PRs não aparecem
};

/** Os tetos do quadro (a ferramenta, o domínio e a tela usam os mesmos). */
export const LIMITES_QUADRO = { meta: 200, titulo: 200, descricao: 4000, pergunta: 1000, resposta: 4000, comentario: 4000, ops: 50, itens: 50, identificador: 40, url: 500, coluna: 40, colunas: 30, instrucoes: 500 } as const;

/**
 * definido em 2026-11-01 (NOD-448, ADR-140): trocar o conjunto de colunas pela conversa (substituir_colunas). O card mostra
 * o antes e o depois e para onde vão as tarefas; só aplica ao confirmar (proposta e decisão de mesmo id). `revisao` é a
 * lista de colunas de quando o card nasceu: se o quadro mudou depois, confirmar recusa.
 */
export type ColunaNaProposta = { id: string; nome: string; grupo: GrupoColuna };
export type PayloadPropostaColunasQuadro = {
  kind: "colunas_quadro";
  quadroId: string;
  anfitriaoId: string;
  anfitriaoNome: string;
  colunas: { id?: string; nome: string; grupo: GrupoColuna }[];
  destinos?: { de: string; para: string }[];
  antes: ColunaNaProposta[];
  depois: ColunaNaProposta[];
  movidas: { de: string; para: string; tarefas: number }[];
  revisao: string;
  turnoId?: string;
  /** Preenchido ao confirmar: o lote (para o Desfazer). */
  loteId?: string | null;
};
