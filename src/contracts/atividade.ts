import type { CategoriaDaAtividade } from "./destino-no-chat.ts";
import type { EpochMs } from "./ids.ts";

/**
 * A Atividade do bot (definido em 2026-10-18, plano do chat limpo, PR 1; ADR-114): tudo o que sai do chat, um dia por
 * vez. `GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…`. O título e o detalhe vêm prontos do servidor, na redação de
 * hoje (ADR-029: nome, causa e relógio).
 *
 * Fontes: as mensagens da conversa própria do bot com destino `atividade` ou `anexo` (mais as de destino temporal), as
 * negações de conector indisponível da trilha (uma linha por conector e causa, com "N vezes") e os trabalhos que
 * começaram ou terminaram no dia. A memória não é fonte (sem índice em `events`): a web mostra a linha "Agora" do estado
 * que já tem.
 */
export type AlvoDaAtividade = { trabalhoId: string } | { mensagemId: string };

export type ItemDeAtividade = {
  /** Id da mensagem; `trilha:<conector>:<causa>` para a linha da trilha; `trabalho:<id>:<começou|terminou>`. */
  id: string;
  em: EpochMs;
  categoria: CategoriaDaAtividade | null;
  titulo: string;
  detalhe: string | null;
  /** Negações repetidas (mesma ferramenta, mesma causa) numa linha só. */
  vezes?: number;
  /** O que o clique abre: a frente, ou o texto inteiro da mensagem com o "Relatar" (ADR-041). A trilha não tem alvo. */
  alvo?: AlvoDaAtividade;
};

/**
 * A página é o dia (revisão de 18/10: sem cursor; um cursor por `(em, id)` não atravessa as linhas agrupadas da
 * trilha). Até 500 itens, os mais recentes primeiro; `truncados` diz quantos ficaram de fora. `diaAnterior` é o dia de
 * antes, até o dia em que o bot nasceu (null nele), sem procurar o último dia com atividade.
 */
export type AtividadeDto = {
  dia: string;
  itens: ItemDeAtividade[];
  total: number;
  truncados: number;
  diaAnterior: string | null;
};

/** `contagem=1`: o "N hoje" da gaveta, contado nas três fontes sem montar os itens. */
export type ContagemDaAtividade = { dia: string; total: number };

/** Teto de itens por dia. definido em 2026-10-18 (plano, decisão 12): o resto fica no Raio-X. */
export const TETO_ITENS_ATIVIDADE = 500;
