# ADR-003 — Isolamento em duas camadas: RLS restritiva COM predicado de aplicação, e os cinco axiomas no teste de conformidade

**Frente** Dados · **Status** decidido · **Épicos** E1, E2, E3, E6, E8, E12

## Decisão

ENABLE + FORCE ROW LEVEL SECURITY com policy RESTRICTIVE tenant_id = current_setting('nod.tenant_id')::uuid em toda tabela de tenant; aplicação com role NOBYPASSRLS que não é dono das tabelas; SET LOCAL na abertura de cada transação; e o filtro tenant_id = $1 explícito mantido em toda query. Um teste de conformidade roda a cada migração contra o CATÁLOGO (pg_class.relrowsecurity, pg_policies, pg_constraint, pg_proc) e falha o CI se: alguma tabela com coluna tenant_id não tem policy restritiva; alguma constraint UNIQUE ou FK não inclui tenant_id (A-RLS-5); alguma função SECURITY DEFINER existe fora de uma lista fechada e auditada (A-RLS-4).

## Contexto

E2.2 é P0 e exige que uma consulta que esquece o predicado devolva apenas linhas da sessão, 'por política do banco'. São dados de menores sob LGPD: vazamento entre clientes é incidente reportável, não bug. A arquitetura preliminar dizia 'tenant_id + RLS' e precisava ser conferida.

## Alternativas rejeitadas

### Só filtro na aplicação com fence de tipo e lint de migration, como o Buzz realmente fez

É exatamente onde o Buzz ficou devendo, e o próprio código admite: crates/buzz-core/src/tenant.rs:20-25 diz textualmente 'This is a lint-and-review fence, not a compiler fence' e explica que TenantContext::resolved e CommunityId::from_uuid são pub, então 'a determined caller elsewhere could call them too'. O lint que fecharia o buraco (crates/buzz-db/src/runtime/migration.rs:500-660) é um teste de Rust que faz parsing de texto SQL — checa forma de constraint, nunca checa se uma query em runtime esqueceu o WHERE. Com 2-3 engenheiros e rotatividade, disciplina não sobrevive.

### Só RLS, sem predicado explícito na aplicação

Duas razões de custo real. Plano: os índices são tenant-leading e o predicado explícito é o que permite o planner escolhê-los com estatística boa. Diagnóstico: se o pool devolver conexão sem contexto setado, o resultado é zero linhas — fail-closed, ótimo para segurança, mas vira bug silencioso de produto ('a fila apareceu vazia') difícil de diagnosticar com 3 engenheiros.

### Um banco ou schema por cliente, como o openmausbot fleet faz com usuário de SO

server/fleet.ts:381-395 dá isolamento mais forte que RLS — useradd por workspace, dataDir 0700, unit systemd própria, ReadWritePaths restrito, nftables. Mas mata a tese do produto: a fila global de E3.1 atravessa empresas por desenho, e com 70 bancos vira 70 conexões e merge na aplicação. Também multiplica por 70 o custo de toda migração.

### SECURITY DEFINER como válvula de escape quando RLS custar caro

É o que a frente de Deploy recomendou e é perigoso: A-RLS-4 do mesmo documento que a frente de Dados citou como autoridade diz que 'a SECURITY DEFINER function can read data unavailable to the caller' e por isso é parte da fronteira confiável auditada (docs/multi-tenant-relay.md:364-367). É o mecanismo canônico de FURAR RLS, não de otimizá-la. A ordem correta quando doer é: confirmar índice tenant-leading e predicado explícito; índice parcial sobre o recorte quente; VIEW com security_invoker=true (PG15+), que preserva a RLS do chamador.

## Evidência

CONTRADIZ A PREMISSA DA ARQUITETURA PRELIMINAR: grep por 'ROW LEVEL SECURITY|CREATE POLICY' em todo o repo buzz retorna UM hit, e é documentação (docs/multi-tenant-relay.md:359), não DDL. Nenhuma das 44 migrations tem RLS. O que existe é tenant_id liderando PK nas 22 tabelas de 0001_initial_schema.sql, o fence de tipo em tenant.rs e o lint em migration.rs. Decisivo: docs/multi-tenant-relay.md:355-370 traz a prova formal e lista RLS como AXIOMA que a implementação deve fornecer — A-RLS-1 (policy restritiva), A-RLS-2 (role NOBYPASSRLS não-dono), A-RLS-3 (SET LOCAL por transação), A-RLS-4 (SECURITY DEFINER e leakproof como fronteira confiável auditada), A-RLS-5 (tenant_id em toda unique e FK). A linha 375 explica o porquê: 'A query that fails to set app.community_id matches the policy predicate over NULL → no rows, never all rows. This is what makes a missed application predicate fail closed rather than leak (Theorem I4).' A prova de isolamento do Buzz repousa num axioma que o schema dele não satisfaz.

## Consequências

- Toda transação passa a precisar de SET LOCAL antes da primeira query, num único helper. É a disciplina que substitui o lint frágil do Buzz, e casa com o modo transação do pooler (ADR-001).
- Supabase merece cuidado específico: qualquer worker que use a service_role key faz BYPASSRLS e a rede some. O worker da fila e o scheduler precisam de role próprio NOBYPASSRLS.
- Cada migração que cria tabela de tenant chama um único script make_tenant_table(nome) que faz coluna + ENABLE + FORCE + policy de uma vez.
- A-RLS-5 empurra para IDs de decisão únicos por tenant e chave composta em toda constraint — a mesma exigência do ADR-005.
- O teste de conformidade roda contra o catálogo real, não contra os arquivos de migração: senão prova só que alguém escreveu a linha. O molde é verify_floor_guard_catalog do Buzz (migration.rs:52-64), que falha fechado se uma partição escapou do gatilho.

## Reversibilidade

barata para LIGAR hoje (ALTER TABLE por tabela, sem reescrita de dados), irreversível na prática depois. É o erro que o Buzz cometeu: começar sem, deixar o código crescer assumindo que qualquer role lê qualquer linha, e descobrir que ligar quebra worker, migração, script de suporte e job de relatório, porque nenhum deles nunca setou contexto de tenant.

## Revisitar quando

Quando EXPLAIN mostrar a policy atrapalhando plano numa consulta quente, ou quando aparecer consulta operacional legítima entre clientes. A resposta nos dois casos é role separado com policy própria ou VIEW com security_invoker — nunca desligar RLS nem introduzir SECURITY DEFINER sem entrar na lista auditada.

