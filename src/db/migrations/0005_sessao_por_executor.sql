-- 0005 a sessão do CLI pertence ao EXECUTOR, não à conversa. Convenção `-- ROLLBACK:` no fim.
--
-- medido em 2026-09-16 (teste manual do Marlon, conversa "Teste 1"): a conversa nasceu no executor
-- catcher, que gerava um session_id de mentira (randomUUID) e o assentar-turno o gravava em
-- conversas.sessao_cli sem olhar de onde veio. Ao trocar NOD_EXECUTOR para claude-cli, o primeiro
-- turno real montou `--resume <uuid-que-o-claude-nunca-viu>` e o CLI devolveu result com falha:
-- turno interrompido com erro_execucao, sinais attempted/prompt_submitted/produced_output todos true.
-- O E2E nunca pegou porque cada executor sempre rodou em conversas próprias.
--
-- Correção: guardar QUEM criou a sessão. O plano só reaproveita `--resume` quando o executor do
-- turno é o mesmo que gravou; caso contrário começa sessão nova (--session-id) e sobrescreve.

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS sessao_executor text
  CHECK (sessao_executor IS NULL OR sessao_executor IN ('local', 'catcher'));

-- Sessões já gravadas não têm dono conhecido: invalidar é mais seguro que adivinhar (ADR-009:
-- desfecho desconhecido é tratado como perigoso). O próximo turno abre sessão nova.
UPDATE conversas SET sessao_cli = NULL WHERE sessao_cli IS NOT NULL AND sessao_executor IS NULL;

-- ROLLBACK:
-- ALTER TABLE conversas DROP COLUMN IF EXISTS sessao_executor;
