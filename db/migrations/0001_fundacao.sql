-- 0001 fundação. Imutável. RLS, trilha+CHECK, rotinas, concessões, 24 meses de partições SEM catch-all.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

\i db/migrations/_make_tenant_table.sql

CREATE TABLE IF NOT EXISTS agentes (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  nome text NOT NULL,
  instrucoes text NOT NULL DEFAULT '',
  dono_tipo text NOT NULL CHECK (dono_tipo IN ('pessoa', 'empresa')),
  dono_id uuid NOT NULL,
  forma text NOT NULL,
  cor text NOT NULL,
  secao text NOT NULL DEFAULT 'sem-secao',
  favorito boolean NOT NULL DEFAULT false,
  confirmado boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
SELECT nod_make_tenant_table('agentes');

CREATE TABLE IF NOT EXISTS rotinas (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  agente_id uuid NOT NULL,
  cron text NOT NULL,
  fuso_iana text NOT NULL,
  instrucao text NOT NULL,
  exige_aprovacao boolean NOT NULL DEFAULT true,
  estado text NOT NULL CHECK (estado IN ('proposta', 'ativa', 'pausada')),
  proximo_disparo timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id),
  CONSTRAINT rotina_fuso_iana CHECK (fuso_iana !~ '[+\-]\d')
);
SELECT nod_make_tenant_table('rotinas');

CREATE TABLE IF NOT EXISTS rotina_janela (
  tenant_id uuid NOT NULL,
  rotina_id uuid NOT NULL,
  instante_agendado timestamptz NOT NULL,
  estado text NOT NULL,
  PRIMARY KEY (tenant_id, rotina_id, instante_agendado),
  UNIQUE (tenant_id, rotina_id, instante_agendado)
);
SELECT nod_make_tenant_table('rotina_janela');

CREATE TABLE IF NOT EXISTS concessoes (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  agente_id uuid NOT NULL,
  conector_id text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('proposta', 'conectada', 'revogada')),
  declaracao text NOT NULL CHECK (declaracao IN ('toca', 'nao-toca', 'nao-declarou')),
  capacidades_ligadas text[] NOT NULL DEFAULT '{}',
  credencial_cifrada text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id)
);
SELECT nod_make_tenant_table('concessoes');

CREATE TABLE IF NOT EXISTS trilha (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  regra text,
  source text NOT NULL,
  agente_id uuid,
  pessoa_id uuid,
  hash_sha256 bytea,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT trilha_sem_texto_livre CHECK (
    kind ~ '^[a-z0-9_-]+$'
    AND (regra IS NULL OR regra ~ '^[a-z0-9_-]+$')
    AND source ~ '^[a-z0-9_-]+$'
  )
);
SELECT nod_make_tenant_table('trilha');

CREATE TABLE IF NOT EXISTS trilha_prosa (
  tenant_id uuid NOT NULL,
  trilha_id uuid NOT NULL,
  texto text NOT NULL,
  PRIMARY KEY (tenant_id, trilha_id),
  FOREIGN KEY (tenant_id, trilha_id) REFERENCES trilha (tenant_id, id)
);
SELECT nod_make_tenant_table('trilha_prosa');

CREATE OR REPLACE FUNCTION nod_trilha_imutavel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trilha é imutável';
END;
$$;

DROP TRIGGER IF EXISTS trilha_no_update ON trilha;
CREATE TRIGGER trilha_no_update BEFORE UPDATE OR DELETE ON trilha
  FOR EACH ROW EXECUTE FUNCTION nod_trilha_imutavel();
DROP TRIGGER IF EXISTS trilha_no_truncate ON trilha;
CREATE TRIGGER trilha_no_truncate BEFORE TRUNCATE ON trilha
  EXECUTE FUNCTION nod_trilha_imutavel();

CREATE TABLE IF NOT EXISTS events (
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (tenant_id, created_at, id)
) PARTITION BY RANGE (created_at);

-- 24 meses a partir de 2026-09, SEM partição catch-all (ADR-006).
DO $$
DECLARE
  m date := date '2026-09-01';
BEGIN
  FOR i IN 0..23 LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS events_%s PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
      to_char(m + (i || ' month')::interval, 'YYYY_MM'),
      (m + (i || ' month')::interval)::date,
      (m + ((i + 1) || ' month')::interval)::date
    );
  END LOOP;
END $$;
