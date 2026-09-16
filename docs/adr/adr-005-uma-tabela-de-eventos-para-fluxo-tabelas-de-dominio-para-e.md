# ADR-005 — Uma tabela de eventos para fluxo, tabelas de domínio para estado com regra, e o par (tenant_id, id) em todo identificador

**Frente** Dados · **Status** decidido · **Épicos** E3, E4, E5, E7, E8, E9

## Decisão

Tabela events particionada para o fluxo append-only (mensagens, passos de turno, sinais de agente) e tabelas de domínio para as poucas entidades com ciclo de vida, constraint e consulta própria: agentes, canais, decisões pendentes, itens de aprovação, rotinas, credenciais. Decisão pendente é tabela, não um kind. E todo identificador que sai do servidor — inclusive na URL — é o par (tenant_id, id), nunca um id sozinho. Regra escrita de qual lado uma coisa nova cai: tem expiração, dono ou transição que o servidor precisa consultar? Domínio. É fato que aconteceu e só é lido em ordem? events.

## Contexto

A fila global de E3.1 precisa de consulta com relógio e expiração; a aprovação item a item de E4.1 precisa de estado por item com execução parcial; a parada de E5.1 precisa distinguir duas classes de negação. São coisas com regra, não fatos. E o par composto é exigência de A-RLS-5 e do padrão de proveniência do Buzz.

## Alternativas rejeitadas

### Tudo em events com kind, como o Buzz

O custo está no schema. São 130 constantes KIND_ em crates/buzz-core/src/kind.rs e o banco não conhece nenhuma: kind INT NOT NULL (0001:194) e tags JSONB carregam a semântica sem constraint. Para excluir kinds privados da busca, a lista de inteiros foi inlinada dentro de uma coluna GENERATED (0001:220-227) com o comentário admitindo o preço: 'inlined here because a sqlx migration is frozen SQL and cannot import the Rust constant'. Quando surgiu mais um kind sensível, 0005_agent_turn_metric_fts.sql:26-33 teve que DROPAR a coluna gerada, recriar e reconstruir o GIN inteiro. Adicionar um tipo de evento privado custa rebuild de índice na maior tabela do sistema. Significativo: quando a coisa tinha regra de verdade, o próprio Buzz saiu do modelo — workflow_approvals é tabela própria com enum, granted_at, denied_at, expires_at e FK composta (0001:411-435), exatamente no ponto onde o nosso produto vive.

### Tabela de domínio para tudo, sem events

Perde o que E8 e E9 pedem: a sequência bruta do que aconteceu, com ordem e tempo, incluindo o que nunca virou estado. E o Buzz mostra o outro extremo: 0041 e 0042 criaram 15 tabelas de domínio para identidade/autorização e 0044_drop_nip_fi_ledger.sql dropou as 15 com CASCADE porque a decisão de produto mudou. Tabela criada cedo demais para conceito instável é trabalho jogado fora — comece pequeno.

### Identificador global de decisão (um UUID que resolve sozinho)

Contraria A-RLS-5 e o padrão de proveniência que o Buzz documenta em crates/buzz-db/src/store/workflow.rs:494-500: 'community_id is server provenance — for the global scheduler scan it is the workflow.community_id returned by list_all_enabled_workflows, not any client-supplied value', porque resolver pelo id sozinho 'would fan a single claim across every community holding that UUID'. E 0001:66-70 registra que 'the same UUID may legitimately exist in two communities'. Corrigir depois muda o contrato do cliente, a URL de cada card e cada linha de trilha já gravada.

## Evidência

Contagem real: 130 pub const KIND_ em crates/buzz-core/src/kind.rs. events em 0001:190-236 com kind INT + tags JSONB sem constraint. O custo materializado em 0005:26-33. O contraexemplo do outro lado em 0044. E o padrão que copiamos: workflow_approvals (0001:411-435) com enum, timestamps e FK composta. Proveniência: workflow.rs:462 e :494-500.

## Consequências

- A decisão pendente vira tabela com expires_at indexado — é o que torna a consulta de E3.1 um index scan e não um filtro sobre JSONB.
- Os itens de E4.1 viram linhas-filhas com FK composta carregando tenant_id, no padrão de workflow_approvals, com estado por item e coluna de autoria da marcação (exigida por E4.2 como restrição de banco).
- A decisão aparece duas vezes: na tabela de domínio (estado) e como linha de trilha (registro). É intencional e exige que as duas escritas aconteçam na MESMA transação.
- O par composto aparece no protocolo do fio, então o cliente devolve sempre (tenant_id, id) e esse tenant_id que volta da fila vira proveniência do servidor para tudo depois.
- Este ADR e o ADR-006 formam a decisão de forma mais cara do sistema: a chave primária e a chave de partição.

## Reversibilidade

cara para o par composto e para a divisão. Promover um kind de events para tabela de domínio é backfill mecânico; colapsar domínio em events é mais caro porque as FKs e constraints viram disciplina de aplicação. Trocar id global por composto depois de ter clientes é mudança de contrato de cliente, não migração de dados.

## Revisitar quando

Quando a terceira consulta de produto tiver que ler tags JSONB de events para tomar decisão de negócio — aquele kind virou domínio. No sentido inverso, se uma tabela de domínio passar seis meses sem nenhuma constraint além de tenant_id, ela era um evento.

