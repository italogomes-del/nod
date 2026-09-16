-- Helper único: coluna + ENABLE + FORCE + policy restritiva (ADR-003).
-- Chamado por cada tabela de tenant na 0001.

CREATE OR REPLACE FUNCTION nod_make_tenant_table(tbl text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL', tbl);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'DROP POLICY IF EXISTS tenant_isolation ON %I',
    tbl
  );
  EXECUTE format(
    $p$CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE
       USING (tenant_id = current_setting('nod.tenant_id')::uuid)
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid)$p$,
    tbl
  );
END;
$$;
