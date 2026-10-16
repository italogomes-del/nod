-- definido em 2026-10-16 (ADR-108, plano docs/plano-limite-e-troca.md, PR 2): a lista de contas é a FILA e as tasks no
-- limite ganham a troca de IA com recomendação.
--
-- 1. `contas_ia.entra_na_troca_automatica` passa a significar "na fila" para TODA conta (até aqui só valia para a
--    corporativa; a pessoal entrava sempre, mas só com "Trocar sozinho"). Some o "Perguntar antes"/"Trocar sozinho":
--    `preferencias.contas_modo` fica (o app antigo lê), mas o código o ignora. Termos de uso (ADR-101 §4): a 1ª conta
--    pessoal de cada IA nasce na fila; a 2ª em diante e a corporativa nascem fora. O backfill liga a flag na conta
--    pessoal não removida de menor posição de cada pessoa e IA; quem já usava "Trocar sozinho" (`contas_modo =
--    'automatico'`) já consentiu: todas as pessoais entram. A corporativa fica como a pessoa deixou.
-- 2. `trocas_de_ia`: o aviso de troca de IA de um bot cujas tasks esperam a IA que parou (R4) ou do bot fixo sem conta
--    da IA dele na fila (R6). Um aberto por bot (`trocas_de_ia_aberta_por_agente`): a segunda task que para atualiza o
--    mesmo. `recomendacao` = 'esperar' (volta em até 30 min) ou 'levar' (mais longe, ou sem hora); `aplicar_em` só no
--    'levar' (criada + 10 min, quando o varredor aplica sozinho). `decidido_em`/`decisao` fecham o aviso; quem fecha usa
--    `UPDATE … WHERE decidido_em IS NULL` (o clique e o varredor ao mesmo tempo: um vence, o outro não faz nada).
--    `volta_ao_fixo`: a inteligência do bot fixo que seguiu noutra IA até a volta (R6 b); `restaurado_em`, quando o
--    varredor a devolveu. Sem FK para mensagens (a linha é escrita depois, na mesma transação, e pode ser trocada).
-- Só adição (expand-only): o código anterior não lê a tabela, e a flag ligada numa conta pessoal não muda nada para ele
-- (`entraNaTroca` de antes = `!corporativa || flag`).
SET LOCAL lock_timeout = '5s';

-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta do comando, religado no MESMO bloco (regra da
-- 0005/0026/0039/0049/0061/0068/0072) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE contas_ia NO FORCE ROW LEVEL SECURITY;
ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;
UPDATE contas_ia c SET entra_na_troca_automatica = true
  WHERE c.removida_em IS NULL AND NOT c.corporativa AND NOT c.entra_na_troca_automatica
    AND (c.posicao = (SELECT min(x.posicao) FROM contas_ia x
                       WHERE x.tenant_id = c.tenant_id AND x.owner_id = c.owner_id AND x.ia = c.ia AND x.removida_em IS NULL AND NOT x.corporativa)
      OR EXISTS (SELECT 1 FROM preferencias p WHERE p.tenant_id = c.tenant_id AND p.owner_id = c.owner_id AND p.contas_modo = 'automatico'));
ALTER TABLE preferencias FORCE ROW LEVEL SECURITY;
ALTER TABLE contas_ia FORCE ROW LEVEL SECURITY;

CREATE TABLE trocas_de_ia (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  ia_de text NOT NULL,
  ia_para text,
  recomendacao text NOT NULL,
  volta_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  aplicar_em timestamptz,
  decidido_em timestamptz,
  decisao text,
  mensagem_id uuid,
  fixo boolean NOT NULL DEFAULT false,
  volta_ao_fixo jsonb,
  restaurado_em timestamptz,
  CONSTRAINT troca_ia_de CHECK (ia_de IN ('claude-cli', 'codex-cli')),
  CONSTRAINT troca_ia_para CHECK (ia_para IS NULL OR (ia_para IN ('claude-cli', 'codex-cli') AND ia_para <> ia_de)),
  CONSTRAINT troca_recomendacao CHECK (recomendacao IN ('esperar', 'levar')),
  CONSTRAINT troca_decisao CHECK (decisao IS NULL OR decisao IN ('esperar', 'levar', 'outra_ia', 'conta', 'expirou', 'voltou')),
  CONSTRAINT troca_decidida CHECK ((decisao IS NULL) = (decidido_em IS NULL)),
  CONSTRAINT troca_aplicar_so_levar CHECK (aplicar_em IS NULL OR recomendacao = 'levar'),
  CONSTRAINT troca_volta_ao_fixo CHECK (volta_ao_fixo IS NULL OR (jsonb_typeof(volta_ao_fixo) = 'object' AND octet_length(volta_ao_fixo::text) <= 2000))
);
SELECT nod_escopar_tabela('trocas_de_ia');
ALTER TABLE trocas_de_ia ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE trocas_de_ia ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE trocas_de_ia ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
-- Um aviso aberto por bot: a task seguinte que para no limite atualiza o mesmo (ON CONFLICT … WHERE decidido_em IS NULL).
CREATE UNIQUE INDEX trocas_de_ia_aberta_por_agente ON trocas_de_ia (tenant_id, agente_id) WHERE decidido_em IS NULL;
-- O varredor (30 s): as abertas por pessoa e as que ainda devolvem o bot fixo.
CREATE INDEX trocas_de_ia_varredor ON trocas_de_ia (tenant_id, owner_id, aplicar_em) WHERE decidido_em IS NULL;
CREATE INDEX trocas_de_ia_a_restaurar ON trocas_de_ia (tenant_id, owner_id) WHERE volta_ao_fixo IS NOT NULL AND restaurado_em IS NULL;

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. Este bloco desfaz só o SCHEMA. A flag ligada pelo
-- -- backfill fica: o código anterior a ignora na conta pessoal (`!corporativa || flag`), e a corporativa não foi tocada.
-- -- Os avisos abertos somem com o DROP; as tasks que esperavam acordam sozinhas na volta da conta (acordar_em).
-- DROP INDEX trocas_de_ia_a_restaurar;
-- DROP INDEX trocas_de_ia_varredor;
-- DROP INDEX trocas_de_ia_aberta_por_agente;
-- DROP TABLE trocas_de_ia;
