import type { ServerResponse } from "node:http";
import { ehErroDeDominio, type CodigoErro } from "../../domain/erro.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { json } from "./util.ts";

/**
 * A mensagem de erro é canal de vazamento (ADR-002/004 refinados): só sai o que está nesta tabela
 * FIXA, indexada pelo código fechado. Nunca err.message. Erro desconhecido vira 500 + correlation_id
 * para achar no log.
 */
const TABELA: Record<CodigoErro, { status: number; mensagem: string }> = {
  nao_encontrado: { status: 404, mensagem: "não encontrado" },
  entrada_invalida: { status: 400, mensagem: "entrada inválida" },
  escopo_vazio: { status: 400, mensagem: "escopo ausente" },
  limite_atingido: { status: 429, mensagem: "limite atingido" },
  nao_permitido: { status: 403, mensagem: "não permitido" },
  estado_invalido: { status: 409, mensagem: "estado não permite esta ação" },
  executor_indisponivel: { status: 503, mensagem: "executor indisponível" },
  fuso_invalido: { status: 400, mensagem: "fuso inválido: use um nome IANA, nunca offset" },
  cron_sem_futuro: { status: 400, mensagem: "a expressão cron não tem próxima execução" },
  sala_tamanho: { status: 400, mensagem: "sala tem de 2 a 6 bots" },
  http_toca_aprendiz: { status: 400, mensagem: "conector que toca dado de aprendiz não pode usar http" },
  env_placeholder_chave_nova: { status: 400, mensagem: "placeholder de env só vale para chave já existente" },
  dono_imutavel: { status: 403, mensagem: "o dono do agente não muda" },
  texto_vazio: { status: 400, mensagem: "texto vazio" },
};

export interface ErroDto {
  codigo: string;
  mensagem: string;
  correlation_id?: string | null;
}

export function responderErro(res: ServerResponse, err: unknown): void {
  if (ehErroDeDominio(err)) {
    const { status, mensagem } = TABELA[err.codigo];
    const corpo: ErroDto = { codigo: err.codigo, mensagem };
    json(res, status, corpo);
    return;
  }
  const correlationId = contextoAtual()?.correlationId ?? null;
  log("erro", "falha_interna", {
    erro: err instanceof Error ? err.name : "desconhecido",
    correlation_id: correlationId,
  });
  const corpo: ErroDto = { codigo: "falha_interna", mensagem: "falha interna", correlation_id: correlationId };
  json(res, 500, corpo);
}
