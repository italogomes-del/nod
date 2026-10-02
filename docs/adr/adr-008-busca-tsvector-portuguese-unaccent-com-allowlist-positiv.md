# ADR-008 — Busca tsvector portuguese + unaccent com allowlist positiva

**Status** revisado

## Decisão

Fixar AGORA só o que é caro em base populada: a configuração de busca própria (unaccent + portuguese_stem) criada como OBJETO DE BANCO, a coluna TSVECTOR GENERATED ALWAYS AS STORED, e a ALLOWLIST POSITIVA (o que não está na lista vira NULL). ESPERAM até haver conteúdo: o índice GIN, a extensão btree_gin, e o procedimento genérico de rebuild. Quando o índice vier, nasce escopado por (owner_id, search_tsv). Busca continua não sendo fronteira de acesso: devolve ids e a releitura reaplica a policy.

## O que mudou

Índice GIN, btree_gin e rebuild-busca.sql saem do primeiro commit e esperam volume. A configuração e a allowlist ficam.

## Por quê

Este é o ADR onde a pergunta 'o que pode simplesmente ESPERAR?' dá a resposta mais clara, e nenhuma das quatro frentes a fez. Três coisas se separam. A CONFIGURAÇÃO é cara e recorrente — trocar depois é DROP COLUMN + ADD COLUMN gerada + CREATE INDEX com a tabela em ACCESS EXCLUSIVE, e o Buzz nem tentou em base populada. Fica. A ALLOWLIST protege por omissão e o Buzz provou o custo de aprender errado (0001 nasceu com denylist, 0005 fez DROP+ADD, 0008 inverteu). Fica. O ÍNDICE e o REBUILD são caros só depois de haver volume — e um time pequeno que ainda não gerou um único documento pode viver com ILIKE por seis meses.

