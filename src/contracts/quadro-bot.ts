import type { FalhaImportacao } from "./quadro-importacao.ts";
import type { LinkDeTarefa } from "./quadro-pela-conversa.ts";
import type { OpQuadro } from "./quadro.ts";
import type { ResumoQuadroParaBot } from "./quadro-resumo-bot.ts";

/**
 * A ferramenta gerir_quadro (o que ela recebe e devolve) e a proposta de trocar as colunas. Separado do quadro.ts para não
 * passar do teto de linhas dos contratos; o quadro.ts reexporta tudo.
 */

/** Um item que o bot já buscou no Linear com a ferramenta dele (o servidor não fala com o Linear). */
export type ItemLinear = { identificador: string; titulo: string; url?: string; descricao?: string; status?: string; agente?: string | null };

export type ArgsGerirQuadro = {
  /** O quadro: o id, ou o nome do bot anfitrião. Sem ele, o do próprio bot, senão o único da pessoa. */
  quadro?: string;
  acoes: OpQuadro[];
};

export type ResultadoGerirQuadro =
  | { ok: true; quadro: ResumoQuadroParaBot | null; lote_id: string | null; comecaram: { tarefa_id: string; agente: string }[]; instrucao: string; ajustada?: boolean; proposta_id?: string; /** NOD-430: o link de cada tarefa tocada. */ tarefas?: LinkDeTarefa[]; movida?: { tarefa_id: string; codigo: string; codigo_antigo: string }; aplicada?: boolean; /** NOD-418: o trabalho que ficou (repetir, cancelar, recado). */ trabalho?: { numero: number | null; estado: string | null } }
  | { ok: false; erro: "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado" | "nao_permitido" | "estado_invalido" | "conflito" | FalhaImportacao; instrucao: string };

/** O quadro como o bot o lê e a proposta de colunas moram em arquivos próprios (merge da NOD-416); aqui só reexporta. */
export type { ResumoQuadroParaBot } from "./quadro-resumo-bot.ts";
export type { ColunaNaProposta, PayloadPropostaColunasQuadro } from "./quadro-proposta-colunas.ts";
