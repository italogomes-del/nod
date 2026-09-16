/**
 * Erro de domínio com código FECHADO (ADR-002/004 refinados): a mensagem que sai para o cliente
 * vem de uma tabela fixa em src/adapters/http/erros.ts, indexada pelo código. O detalhe técnico
 * mora em `cause` e nunca atravessa a resposta HTTP. A união inicial é desta rodada; L2 estende.
 */
export type CodigoErro =
  | "nao_encontrado"
  | "entrada_invalida"
  | "escopo_vazio"
  | "limite_atingido"
  | "nao_permitido"
  | "estado_invalido"
  | "executor_indisponivel"
  | "fuso_invalido"
  | "cron_sem_futuro"
  | "sala_tamanho"
  | "http_toca_aprendiz"
  | "env_placeholder_chave_nova"
  | "dono_imutavel"
  | "texto_vazio";

export class ErroDeDominio extends Error {
  readonly codigo: CodigoErro;
  /** Marca explícita: só o CÓDIGO é seguro para o cliente; `message` nunca sai. */
  readonly seguro = true as const;

  constructor(codigo: CodigoErro, opcoes?: { cause?: unknown }) {
    super(codigo, opcoes);
    this.name = "ErroDeDominio";
    this.codigo = codigo;
  }
}

export function ehErroDeDominio(e: unknown): e is ErroDeDominio {
  return e instanceof ErroDeDominio;
}
