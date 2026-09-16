import type { Agente } from "./agente.ts";
import type { Conversa } from "./conversa.ts";
import type { Decisao, ItemFila } from "./decisao.ts";
import type { EpochMs, IsoUtc } from "./ids.ts";
import type { Inventario } from "./inventario.ts";
import type { ItemAprovacao } from "./item-aprovacao.ts";
import type { Mensagem } from "./mensagem.ts";
import type { Negacao } from "./negacao.ts";
import type { Rotina } from "./rotina.ts";

/** Mutação devolve ids; o estado chega por SSE (ADR-016). */
export type RespostaMutacao = { ok: true; ids: Record<string, string> };
export type ErroDto = { codigo: string; mensagem: string; correlation_id?: string | null };

export type FrotaDto = {
  agentes: (Agente & { conversaId: string; descricaoEstado: string })[];
  inventario: Inventario;
  negacoes: Negacao[];
};

/**
 * EMENDA 13: turno pendente por agente ocupado é renderizável ("na fila — Vera está respondendo em #revisão").
 * `conversaId` é ONDE o bloqueio está (turnosRepo.pendentesRenderizaveis): igual à conversa lida =
 * serialização desta própria conversa ("na fila"); diferente = o agente está ocupado noutra
 * ("Vera está respondendo em #revisão"). A web distingue pela igualdade — definido em 2026-09-16.
 */
export type TurnoPendenteDto = { id: string; motivo: "agente_ocupado_em"; conversaId: string };

export type ConversaDto = {
  conversa: Conversa;
  mensagens: Mensagem[];
  turnosPendentes: TurnoPendenteDto[];
};

export type SuaVezDto = {
  itens: (ItemFila & { itensAprovacao: ItemAprovacao[] })[];
  foraDoAr: { nome: string; desde: EpochMs }[];
  vazio: boolean;
  ultimaDecisaoEm: IsoUtc | null;
};

export type DecisaoDto = { decisao: Decisao; itens: ItemAprovacao[] };
export type RotinaDto = { rotina: Rotina; proximaExecucao: EpochMs };

export type MetodoHttp = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type EntradaRota = { metodo: MetodoHttp; caminho: string; lane: "L1" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" };

/**
 * Tabela de rotas (ADR-005: prefixo /api/t/:tenantId/… salvo públicas e internas). Cada lane
 * escreve o handler fino da sua rota contra o roteador da L1; a posse é a coluna `lane`.
 */
export const ROTAS = [
  { metodo: "GET", caminho: "/api/saude", lane: "L1" },
  { metodo: "POST", caminho: "/api/sessao/entrar", lane: "L1" },
  { metodo: "GET", caminho: "/api/sessao", lane: "L1" },
  { metodo: "GET", caminho: "frota", lane: "L6" },
  { metodo: "GET", caminho: "inventario", lane: "L9" },
  { metodo: "POST", caminho: "agentes", lane: "L6" },
  { metodo: "PATCH", caminho: "agentes/:id", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/fixar", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/ocultar", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/duplicar", lane: "L6" },
  { metodo: "GET", caminho: "agentes/:id/memoria", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/memoria", lane: "L6" },
  { metodo: "PATCH", caminho: "agentes/:id/memoria/:mid", lane: "L6" },
  { metodo: "DELETE", caminho: "agentes/:id/memoria/:mid", lane: "L6" },
  { metodo: "GET", caminho: "agentes/:id/concessoes", lane: "L5" },
  { metodo: "POST", caminho: "agentes/:id/concessoes", lane: "L5" },
  { metodo: "DELETE", caminho: "concessoes/:id", lane: "L5" },
  { metodo: "GET", caminho: "conversas/:id/mensagens", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/mensagens", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/parar", lane: "L6" },
  { metodo: "POST", caminho: "parar", lane: "L6" },
  { metodo: "POST", caminho: "propostas/:id/confirmar", lane: "L6" },
  { metodo: "POST", caminho: "propostas/:id/recusar", lane: "L6" },
  { metodo: "GET", caminho: "rotinas", lane: "L7" },
  { metodo: "POST", caminho: "rotinas", lane: "L7" },
  { metodo: "POST", caminho: "rotinas/:id/pausar", lane: "L7" },
  { metodo: "POST", caminho: "rotinas/:id/ativar", lane: "L7" },
  { metodo: "GET", caminho: "rotinas/:id/execucoes", lane: "L7" },
  { metodo: "GET", caminho: "salas", lane: "L7" },
  { metodo: "POST", caminho: "salas", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/membros", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/mensagens", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/parar", lane: "L7" },
  { metodo: "GET", caminho: "conectores", lane: "L5" },
  { metodo: "POST", caminho: "conectores", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/sondar", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/habilitar", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/desabilitar", lane: "L5" },
  { metodo: "GET", caminho: "sua-vez", lane: "L8" },
  { metodo: "POST", caminho: "decisoes/:id/decidir", lane: "L9" },
  { metodo: "POST", caminho: "decisoes/:id/reabrir", lane: "L8" },
  { metodo: "POST", caminho: "decisoes/:id/retomar", lane: "L9" },
  { metodo: "POST", caminho: "decisoes/:id/responder", lane: "L9" },
  { metodo: "GET", caminho: "trilha", lane: "L5" },
  { metodo: "GET", caminho: "eventos", lane: "L8" },
  { metodo: "GET", caminho: "/metrics", lane: "L8" },
  { metodo: "GET", caminho: "dev/catcher", lane: "L8" },
  { metodo: "GET", caminho: "/api/interno/plano", lane: "L5" },
  { metodo: "POST", caminho: "/api/interno/ferramentas/:nome", lane: "L5" },
  { metodo: "GET", caminho: "/api/interno/decisoes/:id/aguardar", lane: "L5" },
] as const satisfies readonly EntradaRota[];
