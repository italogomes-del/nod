-- definido em 2026-09-24 (ADR-047): o GitHub App da organização, jeito 5 de conectar o GitHub, é
-- do TENANT, como a chave do Composio (ADR-041): um admin cadastra uma vez e o executor de servidor
-- (rotinas com o Mac desligado) gera tokens de instalação dele. A chave privada fica CIFRADA pelo
-- servidor (src/db/cifra.ts), como o env dos conectores; app id e instalação são números públicos.
-- Só aditiva: tabela nova, nenhuma coluna mexida (o banco de desenvolvimento é compartilhado).
CREATE TABLE github_app_configuracoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id text NOT NULL CHECK (app_id ~ '^[0-9]{1,12}$'),
  instalacao_id text NOT NULL CHECK (instalacao_id ~ '^[0-9]{1,15}$'),
  chave_privada_cifrada text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('github_app_configuracoes');
ALTER TABLE github_app_configuracoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE github_app_configuracoes ADD UNIQUE (tenant_id);
-- 'equipe' faz a nod_pessoa_select da 0004 abrir a LEITURA ao tenant: a rotina de qualquer pessoa usa
-- o App. Escrita continua só de quem cadastrou (sem policy extra, diferente da 0017): trocar a chave
-- da organização é ato de admin, e a troca por outra pessoa passa por nod_dono.
ALTER TABLE github_app_configuracoes ADD CHECK (visibility = 'equipe');

-- ROLLBACK:
-- DROP TABLE github_app_configuracoes;
