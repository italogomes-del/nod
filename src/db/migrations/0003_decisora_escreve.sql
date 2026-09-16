-- 0003 decisora escreve + events.locality_reason tipado. Fecha duas pendências de contrato da L3
-- (PENDENCIAS-A): (1) a perna extra de decisoes/itens_aprovacao só ABRIA LEITURA (o WITH CHECK da
-- nod_escopar_tabela exige owner_id = pessoa da sessão), então a decisora designada não conseguia
-- decidir; (2) events.locality_reason nasceu `text` na 0001 enquanto mensagens/turnos usam o enum
-- motivo_localidade da 0002. Convenção `-- ROLLBACK:` no fim.

-- ---------------------------------------------------------------------------------------------
-- (1) Policy PERMISSIVE ADICIONAL, só FOR UPDATE, para a decisora designada (EMENDA 1, ADR-007).
-- Postgres OR-a as policies PERMISSIVE do mesmo comando: para UPDATE, a linha precisa passar no
-- USING de alguma (nod_pessoa já enxerga pela perna extra) e a linha NOVA no WITH CHECK de alguma
-- — é este WITH CHECK que faltava. USING e WITH CHECK pela MESMA perna (decisor_id = pessoa da
-- sessão), e a RESTRICTIVE nod_tenant continua conjuntiva. INSERT e DELETE não ganham nada: a
-- policy é FOR UPDATE, então criar uma decisão em nome de outra pessoa continua 42501.
-- Provado em tests/integration/repos/decisora-escreve.test.ts (ana decide a de marlon dirigida a
-- ela; não vê nem decide a outra). O gate de RLS aceita esta policy por NOME (POLICIES_EXTRAS em
-- tests/conformidade/gate-rls.ts) — qualquer outra policy fora da lista é acusada.
CREATE POLICY nod_decisora ON decisoes AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid
         AND decisor_id = current_setting('nod.pessoa_id')::uuid)
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
              AND decisor_id = current_setting('nod.pessoa_id')::uuid);

CREATE POLICY nod_decisora ON itens_aprovacao AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid
         AND EXISTS (SELECT 1 FROM decisoes d
                     WHERE d.tenant_id = itens_aprovacao.tenant_id AND d.id = itens_aprovacao.decisao_id
                       AND d.decisor_id = current_setting('nod.pessoa_id')::uuid))
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
              AND EXISTS (SELECT 1 FROM decisoes d
                          WHERE d.tenant_id = itens_aprovacao.tenant_id AND d.id = itens_aprovacao.decisao_id
                            AND d.decisor_id = current_setting('nod.pessoa_id')::uuid));

-- O WITH CHECK olha só a linha NOVA: sem esta trava a decisora poderia reescrever owner_id (e
-- virar "dona") ou empurrar decisor_id para outra pessoa, e o item poderia mudar de decisão.
-- Mesmo padrão de nod_agente_dono_imutavel (0002): trigger BEFORE UPDATE OF <colunas>, P0001.
CREATE FUNCTION nod_decisao_pernas_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.decisor_id IS DISTINCT FROM OLD.decisor_id THEN
    RAISE EXCEPTION 'owner_id e decisor_id da decisão são imutáveis (EMENDA 1)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_decisao_pernas_imutaveis
  BEFORE UPDATE OF owner_id, decisor_id ON decisoes
  FOR EACH ROW EXECUTE FUNCTION nod_decisao_pernas_imutaveis();

CREATE FUNCTION nod_item_aprovacao_pernas_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.decisao_id IS DISTINCT FROM OLD.decisao_id THEN
    RAISE EXCEPTION 'owner_id e decisao_id do item de aprovação são imutáveis (EMENDA 1)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_item_aprovacao_pernas_imutaveis
  BEFORE UPDATE OF owner_id, decisao_id ON itens_aprovacao
  FOR EACH ROW EXECUTE FUNCTION nod_item_aprovacao_pernas_imutaveis();

-- ---------------------------------------------------------------------------------------------
-- (2) events.locality_reason vira o enum motivo_localidade (ADR-004: um enum só). Em tabela
-- particionada o ALTER COLUMN TYPE desce a todas as partições. O USING converte o texto existente:
-- valor fora do enum falha alto na migração, nunca vira linha silenciosa (a 0001 nasceu sem
-- linhas fora de 'tudo_local_nesta_rodada'/'motor_ausente' porque só src/domain/plano-turno.ts
-- produz esse campo, a partir de MOTIVOS_LOCALIDADE). O gate tests/conformidade/motivos-enum.test.ts
-- passa a cobrir `events` além das tabelas da 0002 + trilha.
ALTER TABLE events
  ALTER COLUMN locality_reason TYPE motivo_localidade USING locality_reason::motivo_localidade;

-- ROLLBACK:
ALTER TABLE events ALTER COLUMN locality_reason TYPE text USING locality_reason::text;
DROP TRIGGER IF EXISTS nod_item_aprovacao_pernas_imutaveis ON itens_aprovacao;
DROP FUNCTION IF EXISTS nod_item_aprovacao_pernas_imutaveis();
DROP TRIGGER IF EXISTS nod_decisao_pernas_imutaveis ON decisoes;
DROP FUNCTION IF EXISTS nod_decisao_pernas_imutaveis();
DROP POLICY IF EXISTS nod_decisora ON itens_aprovacao;
DROP POLICY IF EXISTS nod_decisora ON decisoes;
