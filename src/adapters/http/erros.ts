import type { ServerResponse } from "node:http";
import { ehErroDeDominio, ErroDeDominio, type CodigoErro } from "../../domain/erro.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { json } from "./util.ts";

/**
 * A mensagem de erro é canal de vazamento (ADR-002/004 refinados): só sai o que está nesta tabela
 * FIXA, indexada pelo código fechado. Nunca err.message. Erro desconhecido vira 500 + correlation_id
 * para achar no log.
 */
const TABELA: Record<CodigoErro, { status: number; mensagem: string }> = {
  conector_indisponivel: { status: 502, mensagem: "Não foi possível acessar o serviço. Tente novamente ou refaça a conexão." },
  integracao_nao_configurada: { status: 409, mensagem: "Configure sua chave Composio no marketplace para conectar os apps." },
  integracao_autenticacao: { status: 403, mensagem: "O Composio recusou a autenticação. Confira a chave e as permissões do seu projeto." },
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
  http_toca_dado_pessoal: { status: 400, mensagem: "Use HTTPS para conectar um serviço que acessa dados pessoais" },
  env_placeholder_chave_nova: { status: 400, mensagem: "placeholder de env só vale para chave já existente" },
  dono_imutavel: { status: 403, mensagem: "o dono do agente não muda" },
  texto_vazio: { status: 400, mensagem: "texto vazio" },
};

export interface ErroDto {
  codigo: string;
  mensagem: string;
  correlation_id?: string | null;
}

/**
 * definido em 2026-09-16 (EMENDA-L9 §2): um id de CORPO fora do formato uuid chega ao Postgres como
 * 22P02 (invalid_text_representation). É entrada inválida da pessoa, não falha interna — vira 400 com o
 * código fechado; a mensagem do driver (que ecoa o valor) nunca sai.
 */
const SQLSTATE_TEXTO_INVALIDO = "22P02";

/** Onde a recusa aconteceu, para o log. Ids viram `:id`: a linha diz a ROTA, não o registro. */
export type OrigemRequisicao = { metodo: string; caminho: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * definido em 2026-09-24: a recusa de domínio (4xx) também vai para o log, com a rota e o `cause`.
 * Motivo: um banner `entrada_invalida` na tela da Nina não deixou rastro nenhum no servidor — havia
 * uma dúzia de lugares que lançam esse código e nada dizia qual. O `cause` sai só quando é texto
 * (é o que os casos de uso escrevem para quem depura) e cortado; nunca vai para o cliente.
 */
function logarRecusa(err: ErroDeDominio, status: number, origem: OrigemRequisicao | undefined, causa?: string): void {
  const bruta = causa ?? (typeof err.cause === "string" ? err.cause : err.cause instanceof SyntaxError ? "json_malformado" : undefined);
  log(status >= 500 ? "erro" : "aviso", "requisicao_recusada", {
    codigo: err.codigo,
    status,
    metodo: origem?.metodo,
    rota: origem?.caminho.split("?")[0]?.replace(UUID, ":id"),
    causa: bruta?.slice(0, 200),
  });
}

export function responderErro(res: ServerResponse, err: unknown, origem?: OrigemRequisicao): void {
  if (ehErroDeDominio(err)) {
    const { status, mensagem } = TABELA[err.codigo];
    logarRecusa(err, status, origem);
    const corpo: ErroDto = { codigo: err.codigo, mensagem };
    json(res, status, corpo);
    return;
  }
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === SQLSTATE_TEXTO_INVALIDO) {
    logarRecusa(new ErroDeDominio("entrada_invalida"), 400, origem, "id_malformado");
    json(res, 400, { codigo: "entrada_invalida", mensagem: TABELA.entrada_invalida.mensagem });
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
