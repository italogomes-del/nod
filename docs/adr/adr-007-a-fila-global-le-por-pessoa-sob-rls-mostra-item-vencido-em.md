# ADR-007 — A fila global lê por PESSOA sob RLS, mostra item vencido em cinza, e o servidor é a única fonte da verdade do tempo

**Frente** Tempo real · **Status** decidido · **Épicos** E3, E4, E5, E7, E8

## Decisão

A consulta de 'Sua vez' é leitura por PESSOA, não por organização: policy de duas pernas (dono do tenant OU decisor designado) sobre a tabela de decisões pendentes, lida com o role de aplicação normal sob RLS. A consulta devolve pendentes E vencidos recentes, com o estado como coluna — item vencido aparece em cinza com o texto do desfecho e botão de reabrir, nunca suprimido. O servidor calcula a fila e envia instante absoluto de expiração em UTC; o cliente nunca decide o que entra, nunca ordena por critério próprio, nunca usa o relógio local para julgar expiração — só interpola a contagem entre frames, corrigindo pelo 'agora' do servidor recebido no frame hello.

## Contexto

E3.1 exige que o produto abra na fila consolidada atravessando empresas e que a pessoa ZERE a fila dali, sem navegar. E3.2 exige que item vencido continue visível em cinza com desfecho e botão de reabrir. E3.3 estabelece o princípio: estado negativo é escrito, nunca ausência. Duas frentes de análise chegaram à conclusão oposta (filtro estrito que nunca mostra vencido) porque não leram o aceite.

## Alternativas rejeitadas

### Tabela global de fila sem tenant_id, fora do RLS

É o erro que o lint do Buzz existe para pegar. A tabela _operator_global_tables (0001:628-636) é um registro explícito de exceções com justificativa por linha, e tem três entradas: communities, rate_limit_violations e ela mesma. Uma fila de decisões carrega o assunto da decisão: é a última tabela que deveria sair do escopo de tenant.

### Fan-out na aplicação: N consultas com SET LOCAL por tenant

Honesto com o RLS, mas a latência é linear no número de empresas e a ordenação global tem que ser feita depois de N round-trips. Para o consultor que atende 15 clientes, a tela de abertura vira 15 consultas. É a alternativa de recuo, não a primeira escolha.

### Consultar com service_role (BYPASSRLS) e filtrar na aplicação

Desliga o backstop na consulta mais sensível do produto — a única que legitimamente vê linhas de vários clientes. Se o filtro de pessoa tiver bug, a pessoa vê decisão de cliente que não é dela, com o texto junto.

### Filtro de leitura estrito que nunca mostra item vencido

Contradiz E3.2 diretamente: 'Dado um item já expirado, quando abro a fila, então ele continua visível em cinza com o texto do desfecho e um botão de reabrir, e ao reabrir volta ao topo em âmbar com prazo novo'. Suprimir é o oposto do princípio de E3.3.

### Cliente monta a fila a partir dos eventos que recebeu

Duas falhas graves. Exatidão: se o cliente caiu em gap, a fila fica errada em silêncio, e fila que esconde item é o pior defeito possível aqui. Autoridade: a fila atravessa empresas e o que a pessoa pode ver é decisão de política de banco — deixar o cliente compor essa lista põe a filtragem por tenant no único lugar onde não pode ser garantida.

## Evidência

O rigor do Buzz NÃO proíbe consulta cross-tenant: crates/buzz-db/src/store/workflow.rs:462 list_all_enabled_workflows(pool) roda sem CommunityId nenhum para o scheduler global, e admin_moderation.rs:178 list_reports recebe community_id: Option<Uuid> com doc-comment 'List reports across all communities by stable descending keyset'. O que ele exige é que o tenant_id volte ROTULADO e vire proveniência do servidor (workflow.rs:494-500). CONTRADIÇÃO ENCONTRADA COM O OPENMAUSBOT, e é a descoberta mais importante desta frente: server/room-turn-timeout.ts:8-11 diz que o relógio de turno 'conta trabalho, não tempo de parede: o relógio segura enquanto o turno está parado num card de aprovação (request.opened → request.resolved) — esperar por uma pessoa não é trabalho', e turn-watchdog.ts:11 repete. O OpenMausBot decidiu que a espera humana é infinita por construção; o nod decide o oposto em E3.2. É inversão deliberada e obriga infraestrutura que o OpenMausBot nunca teve.

## Consequências

- DOIS RELÓGIOS DISTINTOS, nomeados como campos diferentes e que nenhuma frente separou: o RELÓGIO DE DECISÃO conta tempo de parede e NÃO pausa enquanto uma pessoa olha (é a inversão do OpenMausBot, e é o produto); o RELÓGIO DE EXECUÇÃO conta trabalho e PAUSA em aprovação humana (é o watchdog de turno preso). Se não forem separados, o primeiro bug é um turno parado em aprovação sendo morto pelo watchdog, ou uma decisão que nunca expira porque o relógio pausou.
- A policy de duas pernas é a mais complexa do sistema e precisa de teste com três atores — a pessoa certa, a pessoa da mesma empresa que não é decisora, e a pessoa de outra empresa — rodando como regressão a cada migração.
- O índice é (decisor, estado, expires_at), com índice parcial sobre pendentes; a fila é a consulta mais cara do produto e o primeiro lugar a doer.
- Reabrir cria prazo novo e volta ao topo: é transição de estado com escrita na trilha como LINHA NOVA, nunca UPDATE (ADR-004).
- O corte de exposição de dado é por TIPO DE ITEM (ADR-002), não por camada de navegação: E3.5 já decidiu onde fica o corte — 'NENHUM dado pessoal de aprendiz no corpo' do e-mail e do push, porque eles saem do perímetro. A tela autenticada sob RLS não é o mesmo perímetro.

## Reversibilidade

cara, e é a decisão mais irreversível da frente de tempo real. Se a fila nascer montada no cliente, mover o cálculo para o servidor significa reescrever o cliente E descobrir que decisões foram tomadas sobre filas que cada aba compôs de um jeito, sem meio de reconstruir o que cada pessoa viu. Se a expiração nascer decidida pelo relógio do cliente, a trilha fica com registros cujo instante não é auditável — e com dados de menores, 'não dá para reconstruir o que a pessoa viu quando decidiu' é passivo jurídico, não débito técnico.

## Revisitar quando

A IMPLEMENTAÇÃO (granularidade do job, projeção versus leitura direta) quando a consulta passar de ~200ms no p95. O PRINCÍPIO — servidor como fonte da verdade do tempo — não se revisita enquanto E8 exigir trilha auditável.

