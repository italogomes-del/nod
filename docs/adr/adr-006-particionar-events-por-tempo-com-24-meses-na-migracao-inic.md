# ADR-006 — Particionar events por tempo com 24 meses na migração inicial e SEM partição catch-all

**Frente** Dados · **Status** decidido · **Épicos** E2, E3, E8, E9

## Decisão

Criar events como PARTITION BY RANGE (created_at) mensal na migração inicial, com 24 meses de partições futuras criadas de uma vez e NENHUMA partição catch-all p_future. Uma escrita sem partição correspondente FALHA em vez de acumular silenciosamente. Um job no boot cria partições faltantes e uma métrica alarma quando a partição mais distante está a menos de 3 meses. Nenhuma outra tabela nasce particionada; nunca particionar por tenant.

## Contexto

A tabela de eventos é a única que nunca pode parar de aceitar escrita (é a trilha), e converter tabela grande em particionada depois exige recriar e mover dados com janela fechada. Mas o mecanismo de gestão do Buzz cria um modo de falha silencioso que 3 engenheiros não detectam.

## Alternativas rejeitadas

### Partições de 6 meses mais catch-all p_future e gestor no boot, como o Buzz

É a decisão que mais cria plantão silencioso por unidade de benefício. crates/buzz-relay/src/main.rs:285 chama ensure_future_partitions(3) UMA vez no boot e, se falhar, apenas loga error! e segue. partition.rs:3 diz 'Call ensure_future_partitions on startup and monthly via cron' — e o cron mensal é externo e não existe no repositório. A migração 0001 hardcoda 2026-01 a 2026-06 mais events_p_past e events_p_future (0001:237-255). Se o container não reiniciar por quatro meses — que é o OBJETIVO de um PaaS estável — e o cron não existir, tudo cai em p_future: partição gigante sem poder de poda. O sintoma é a retenção LGPD não funcionar, descoberto numa auditoria, meses depois da causa. 24 meses são 24 linhas de SQL em vez de 8 e compram dois anos de silêncio; remover o catch-all torna a falha barulhenta em vez de silenciosa, que é o mesmo fail-closed do ADR-003.

### Não particionar agora

Converter depois é reconstrução com escrita parada, e é a tabela que não pode parar. Ser honesto: com 70 clientes o particionamento NÃO vai doer por volume nos primeiros anos; estamos pagando linhas de migração por opcionalidade futura e por DROP PARTITION como caminho de retenção, não resolvendo escala.

### Particionar também por tenant (LIST ou HASH)

Tentação óbvia com 70 clientes e errada. Isolamento físico não é o que o particionamento entrega (RLS + tenant_id entregam o lógico) e o custo bate na fila global de E3.1, que atravessaria 70 partições. O Buzz, com rigor multi-tenant maior que o nosso, particionou por TEMPO e resolveu isolamento com índice tenant-leading.

### Particionar também as tabelas de decisão e aprovação

O Buzz particionou exatamente duas tabelas — events e delivery_log — e tem allowlist de duas entradas para impedir que alguém adicione mais por engano (crates/buzz-db/src/store/partition.rs:14, PARTITIONED_TABLES, 'prevents DDL injection'). Tabela de estado com FK e UPDATE frequente ganha pouco e perde: FK para particionada é mais restrita e UPDATE que muda a chave vira DELETE+INSERT.

## Evidência

Verificado: 0001_initial_schema.sql:237-255 cria events_p_past, seis meses de 2026 e events_p_future com MAXVALUE. crates/buzz-relay/src/main.rs:285 chama ensure_future_partitions uma vez no boot e loga erro sem falhar. O custo aceito da chave composta está documentado no próprio schema: 0001:253-256 diz que 'the PK can't serve WHERE id=$1 because created_at sits between community_id and id' e por isso existe idx_events_community_id (community_id, id, created_at DESC) para a busca direta ser index-served 'not a partition scan'.

## Consequências

- A PK de events é (tenant_id, created_at, id) e a busca por id sozinho precisa do índice extra — custo aceito, não descuido.
- Poda por retenção vira DROP PARTITION, instantâneo. É o ganho prático principal, mas o trigger de imutabilidade do ADR-004 está no caminho: o role que executa a poda é separado, nomeado, e seu uso entra na trilha.
- Sem catch-all, uma escrita fora de faixa falha e o turno quebra visivelmente. Com 24 meses de folga e alarme a 3 meses isso não deve acontecer — e se acontecer, é imediatamente diagnosticável, que é o ponto.
- A distância até a partição futura mais próxima vira métrica de dia 1 (ADR-017).
- O rebuild da coluna de busca (ADR-008) fica muito mais barato por ser feito por partição — argumento a favor do particionamento que nenhuma frente usou.

## Reversibilidade

cara nos dois sentidos, e é por isso que a decisão é agora. A escolha da CHAVE de partição é a parte mais irreversível: mudar de RANGE(created_at) para HASH(tenant_id) depois é reescrever a tabela inteira. É o campo mais caro desta frente junto com a forma da PK.

## Revisitar quando

Quando a partição de um mês passar de alguns milhões de linhas e o GIN não couber em memória — aí a conversa é granularidade (semanal), não chave. E imediatamente se aparecer cliente exigindo residência física separada: aí nada de particionamento resolve e a conversa é banco separado.

