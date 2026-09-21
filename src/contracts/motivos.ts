// Enum único de motivos (ADR-004): cada união vira `CREATE TYPE ... AS ENUM` na 0002 e
// tests/conformidade/motivos-enum.test.ts (L3) compara pg_enum com estas listas `as const`.
// Nenhum campo `motivo text` livre existe em trilha/turno/sala: só estes valores.

export const MOTIVOS_PASSE = ["passei_sem_nada_a_dizer", "negado_fail_closed", "ausente_offline", "cota_esgotada"] as const;
export type MotivoPasse = (typeof MOTIVOS_PASSE)[number];

export const MOTIVOS_NEGACAO = [
  "capacidade_desligada",
  "teto_canal",
  "alcance_insuficiente",
  "fora_do_catalogo",
  "plano_ausente",
  "plano_expirado",
  "catalogo_vazio",
  "conector_indisponivel",
  "parada_ativa",
  "args_invalidos",
  "falha_tecnica",
  "timeout_transporte",
] as const;
export type MotivoNegacao = (typeof MOTIVOS_NEGACAO)[number];

export const MOTIVOS_INTERRUPCAO = [
  "parado_pela_pessoa",
  "maquina_sem_contato",
  "reinicio_servidor",
  "sem_progresso",
  "lancamento_falhou",
  "sessao_rejeitada",
  "executor_indisponivel",
  /** definido em 2026-09-18: ficou mudo sem ferramenta pendente; o watchdog de atividade encerrou. */
  "turno_travado",
  /** definido em 2026-09-18: produziu trabalho e não concluiu — não confundir com sem_progresso. */
  "trabalho_incompleto",
] as const;
export type MotivoInterrupcao = (typeof MOTIVOS_INTERRUPCAO)[number];

export const MOTIVOS_FALHA = ["erro_max_turns", "erro_execucao", "motor_ausente", "nao_autenticado"] as const;
export type MotivoFalha = (typeof MOTIVOS_FALHA)[number];

/** Localidade honesta: nesta rodada existe um executor só, na máquina da pessoa (ADR-022, ADR-028). */
export const MOTIVOS_LOCALIDADE = ["tudo_local_nesta_rodada", "motor_ausente"] as const;
export type MotivoLocalidade = (typeof MOTIVOS_LOCALIDADE)[number];

export const DESFECHOS_ITEM = ["executado", "retirado_pela_pessoa", "sensivel_nao_aprovado", "falhou_na_execucao"] as const;
export type DesfechoItem = (typeof DESFECHOS_ITEM)[number];

/**
 * Por que um item continuou PENDENTE em vez de ser resolvido por regra (ADR-042). NÃO é
 * MotivoNegacao: o item não foi negado, e classificar terminal/transitória (parada-alcada.ts) não
 * faz sentido para ele. ADR-029: regra suspensa em silêncio é negação seca — a pessoa lê o motivo.
 */
export const MOTIVOS_APROVACAO_MANUAL = [
  "sem_regra_permanente",
  "regra_suspensa_conteudo_nao_confiavel",
  "regra_inativa",
  "origem_sensivel",
  "destino_computador",
  "gate_de_rotina",
  "fora_do_catalogo",
  "sem_plano",
] as const;
export type MotivoAprovacaoManual = (typeof MOTIVOS_APROVACAO_MANUAL)[number];

/** Por que uma permissão permanente parou de valer (ADR-042 claim 7). Inativa nunca é apagada. */
export const MOTIVOS_INATIVIDADE_PERMISSAO = [
  "revogada_pela_pessoa",
  "concessao_revogada",
  "conector_desabilitado",
  "capacidade_fora_do_catalogo",
  "agente_excluido",
] as const;
export type MotivoInatividadePermissao = (typeof MOTIVOS_INATIVIDADE_PERMISSAO)[number];

/**
 * passou_em_branco ≠ falhou: ninguém respondeu o gate não é erro técnico (E7.3).
 * sem_novidade ≠ passou_em_branco: o agente CONSULTOU a fonte e nada mudou — a execução foi
 * completa e correta, só não rendeu notícia. É o único desfecho que não escreve no chat
 * (definido em 2026-09-21): rotina que não tem o que dizer fica em silêncio, e a pessoa confere
 * no histórico da rotina que ela rodou.
 */
export const DESFECHOS_ROTINA = ["executou", "passou_em_branco", "sem_novidade", "falhou"] as const;
export type DesfechoRotina = (typeof DESFECHOS_ROTINA)[number];

/**
 * Por que a execução não rendeu notícia. Campo TIPADO vindo da ferramenta `sem_novidade` —
 * nunca inferido do texto do modelo (Regra 9, domain/rotina-texto.ts). Mesmo precedente do passe.
 */
export const MOTIVOS_SEM_NOVIDADE = ["nada_mudou", "fonte_vazia", "ja_relatado"] as const;
export type MotivoSemNovidade = (typeof MOTIVOS_SEM_NOVIDADE)[number];

/** Código FECHADO de erro de domínio: a mensagem sai de tabela fixa em src/adapters/http/erros.ts (ADR-002/004). */
export const CODIGOS_ERRO = [
  "nao_encontrado",
  "entrada_invalida",
  "escopo_vazio",
  "limite_atingido",
  "nao_permitido",
  "estado_invalido",
  "executor_indisponivel",
  "fuso_invalido",
  "cron_sem_futuro",
  "sala_tamanho",
  "http_toca_aprendiz",
  "env_placeholder_chave_nova",
  "dono_imutavel",
  "texto_vazio",
  "conector_indisponivel",
  "integracao_nao_configurada",
  "integracao_autenticacao",
] as const;
export type CodigoErro = (typeof CODIGOS_ERRO)[number];
