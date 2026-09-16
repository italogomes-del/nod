# ADR-008 — Busca tsvector portuguese + unaccent com allowlist positiva, e o procedimento de rebuild escrito antes do primeiro uso

**Frente** Dados · **Status** decidido · **Épicos** E2, E3, E8, E12

## Decisão

Coluna TSVECTOR GENERATED ALWAYS AS STORED usando uma configuração de busca própria (unaccent + portuguese_stem) criada como objeto de banco, com índice GIN, e ALLOWLIST POSITIVA de tipos indexáveis — o que não está na lista gera NULL. O escopo de tenant do índice é garantido, não derivado: índice GIN composto com btree_gin sobre (tenant_id, search_tsv), ou índice parcial por tenant se EXPLAIN mostrar que é melhor. Busca nunca é fronteira de acesso: devolve ids e a releitura reaplica a policy. E o procedimento genérico de rebuild da coluna gerada (ler a expressão do catálogo via pg_attrdef, dropar, recriar com format) é escrito no PRIMEIRO commit, antes de precisar dele.

## Contexto

Conteúdo em português escrito por pessoas com pressa, com nomes de aprendizes acentuados. A arquitetura preliminar dizia 'portuguese + unaccent' e precisava ser conferida — e o rebuild precisava ser precificado honestamente.

## Alternativas rejeitadas

### Usar 'simple' como o Buzz

É o que o Buzz faz — to_tsvector('simple', content) em 0001:224, 0005:28, 0008:18 e em buzz-search/src/query.rs:174 — e o comentário em 0001:217-219 explica: 'simple config = no stemming/stopwords, matching the existing substring-ish search semantics'. Foi escolha de PARIDADE com o Typesense antigo, não de qualidade. Para português é ruim de um jeito específico: 'aprendiz' não acha 'aprendizes', 'avaliacao' não acha 'avaliação'.

### Motor de busca externo (Typesense/Meilisearch)

O Buzz removeu e a razão está no schema, 0001:213-216: 'Full-text search vector (Typesense → Postgres FTS). Generated/STORED so it is a single source of truth — no sidecar indexer to keep coherent'. O custo não era a busca, era a COERÊNCIA: um indexador paralelo que atrasa, falha ou diverge e precisa aprender sozinho as regras de privacidade.

### GIN de coluna única confiando no BitmapAnd com índices btree tenant-leading, como o Buzz

O Buzz recusou btree_gin com a regra 'avoid unless EXPLAIN proves it buys something' (0001:219-222) — mas ele avaliava PERFORMANCE e nós avaliamos ISOLAMENTO, que é critério diferente e mais forte. Sem tenant no índice, uma query de busca montada sem o predicado faz varredura GIN que atravessa tenants antes de a RLS filtrar o resultado: o conteúdo não vaza, mas a diferença de latência revela a EXISTÊNCIA de resultado em outro cliente.

### Denylist de tipos sensíveis em vez de allowlist

Vaza por omissão, e o Buzz aprendeu na prática: 0001:220-227 nasceu com denylist de kinds (1059, 30300, 30622, 44100, 44101); 0005 teve que adicionar 44200 com DROP+ADD da coluna gerada e rebuild do GIN; 0008_fresh_install_search_allowlist.sql:17 então INVERTE para allowlist positiva — mas só em base vazia, porque em base populada o rebuild é caro demais e precisou de script fora de banda.

## Evidência

CONTRADIZ A ARQUITETURA PRELIMINAR NO DETALHE QUE MAIS IMPORTA: grep por 'unaccent' em todo o repo buzz retorna ZERO; grep por 'portuguese' retorna ZERO. Todas as ocorrências são to_tsvector('simple', ...). 'portuguese + unaccent' não tem precedente no Buzz; é escolha nossa e é a certa porque o Buzz é produto em inglês. A FORMA copiamos: coluna GENERATED STORED como fonte única (0001:213-216). E CORREÇÃO AO QUE AS FRENTES DISSERAM: search_tsv aparece em CINCO migrations além da 0001 — 0005, 0007, 0008, 0014 e 0033 — não duas. A 0014_push_lease_fts.sql:20-35 mostra o padrão maduro que eles só inventaram na terceira vez: um bloco PL/pgSQL que LÊ a expressão gerada do catálogo (pg_attrdef), dropa a coluna e a recria injetando a expressão via format(%s). Rebuild de coluna gerada não é evento raro: é RECORRENTE, cinco vezes em 44 migrations. E 0007_nip_rs_retention.sql:1-6 registra que apagar não bastava porque 'search_tsv tokenized it and the GIN index amplified it further'.

## Consequências

- A configuração de busca é objeto de banco que precisa existir antes da coluna gerada, e a extensão unaccent precisa estar habilitada no Supabase. É dependência de bootstrap: a migração inicial não roda sem ela.
- unaccent() padrão NÃO é IMMUTABLE e por isso não pode ser chamada direto na expressão GENERATED — é obrigatório criar a CONFIGURAÇÃO de busca como objeto e usá-la. Erro clássico que custa uma tarde se descoberto tarde.
- Allowlist positiva INVERTE quem paga o rebuild: com denylist só conteúdo sensível novo custa; com allowlist, todo tipo novo INDEXÁVEL custa. A escolha continua certa (protege por omissão) e o rebuild vira custo recorrente orçado — e o particionamento (ADR-006) torna o rebuild por partição muito mais barato que na tabela inteira.
- Purga por pedido de titular precisa de VACUUM/REINDEX explícito depois, senão 'apagamos' é falso no nível de página, e precisa de teste que prove que a busca não acha mais o termo.
- unaccent + portuguese torna a busca por nome de aprendiz MAIS eficaz — é recurso de descoberta de pessoa. Só é aceitável porque o escopo de tenant está no índice e a releitura passa pela policy.

## Reversibilidade

cara e RECORRENTE para a configuração; barata para a consulta. Trocar a configuração depois é DROP COLUMN + ADD COLUMN gerada + CREATE INDEX GIN com a tabela em ACCESS EXCLUSIVE — 0005 e 0008 mostram o procedimento e mostram que em base populada o Buzz nem tentou, empurrou para scripts/maintenance. Por isso o procedimento genérico se escreve antes do primeiro uso, não depois do terceiro.

## Revisitar quando

A allowlist, toda vez que um tipo novo de conteúdo aparecer — o padrão é ele ficar de fora e isso vai parecer bug antes de parecer proteção. A configuração, quando alguém reclamar que a busca não acha o que sabe que existe: teste com nomes acentuados e plurais é o diagnóstico.

