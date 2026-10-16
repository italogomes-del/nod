# ADR-001 — Modo do pooler, tamanho do pool e política de deploy

**Status** mantido

## Decisão

Pooler em modo transação, pool pequeno, deploy por recreate (nunca rolling). Decidido antes da fase 0. Acréscimo de uma linha: o endpoint de long-poll da ponte NÃO segura conexão do banco enquanto espera — consulta, solta, dorme no processo.

## O que mudou

Só a nota sobre o long-poll. Nenhuma decisão mudou.

## Por quê

Cinco decisões de quatro frentes dependem deste ADR e nada nele dependia do número de clientes. A nota sobre o long-poll existe porque a ponte nova introduz ~38 conexões HTTP paradas, e se cada uma segurasse conexão de banco o pool esgotaria — que é o incidente de sexta 19h que o ADR-001 já nomeava como o mais provável do sistema.


## Emenda de 2026-10-15 — Pool direto no Cloud SQL, prazo de aquisição e timeouts por tx (NOD-266)

Contexto: produção conecta direto ao Cloud SQL (db-custom-1-3840, max_connections 100), sem pooler; a premissa "pooler em modo transação, pool pequeno" não vale hoje. Em 15/10 08:07–10:12 o pool de 5 se esgotou com conexões presas por chamada de conector e o servidor ficou ~2 h esperando uma conexão livre, sem erro nem log.

Decisão:
- Tamanho do pool da app vem de NOD_DB_POOL_MAX (padrão 15; não inteiro, menor que 1 ou maior que 50 derruba o boot). Pool do dono segue max 1; migrações fora.
- Toda tx escopada (abrirTxEscopada) tem prazo de 10 s para pegar conexão. Estourou: 503 codigo "banco_ocupado" com a mensagem genérica e correlation_id; a função não roda se a conexão chegar depois. Os laços de fundo (paraCadaPessoa) param a volta no primeiro banco_ocupado, e a listagem das pessoas tem o mesmo prazo.
- vincularEscopo aplica via SET LOCAL statement_timeout 60s, lock_timeout 10s e idle_in_transaction_session_timeout 660s (acima dos 600 s da chamada de conector com arquivo, que hoje roda dentro da tx; baixa para 60s quando a NOD-263 tirar o conector da tx). Só na tx escopada da app.
- A trx entregue à função é guardada: depois que a transação assenta (fim da função, commit, rollback ou a sessão encerrada pelo idle), qualquer consulta por ela lança tx_encerrada. Spike de 2026-10-15 (postgres.js 3.4.9): sem a guarda, a consulta seguinte de uma trx cuja sessão o Postgres encerrou rodou na conexão reaberta do pool, fora de transação e sem escopo. Ligar o kill por idle depende dessa guarda e de mais duas emendas: quando a função termina depois da queda, o callback do begin não assenta (senão o begin mandaria COMMIT/ROLLBACK pelo handler cru, no objeto Connection que o pool pode ter reaberto para outra requisição), e o remendo `nod:remendo-vaga-do-pool` faz o `execute` sem socket devolver `true`, para a conexão fechada não sair da fila de fechadas (com pool `max 1`, o servidor inteiro travava).
- Quem pode estar dentro da tx escopada da mesma pessoa (o carregador de conectores da composição) reusa a trx do contexto em vez de abrir uma segunda tx: duas tx da mesma requisição com o pool cheio são deadlock de pool.
- Tx > 5 s gera log tx_longa (aviso).
- Revisão do PR #321: a guarda vale também no ENVIO da consulta (o postgres.js é preguiçoso; uma consulta montada com a tx viva e aguardada depois do kill rodaria fora da tx). O reuso da trx do contexto roda num SAVEPOINT, para o erro de quem reusa não abortar a tx do caso de uso. Timeout da tx (57014, 55P03 — inclusive esperando pg_advisory_xact_lock — e o 25P02 que vem depois) responde 503 banco_ocupado e não marca falha no conector. A volta do laço de fundo começa num ponto sorteado, para a parada no banco_ocupado não deixar sempre as mesmas pessoas de fora. O remendo do postgres.js decide "troca já aplicada" por uma marca própria de cada troca (a segunda passagem do postinstall reinseria a checagem sem a correção da vaga).
- Limitação conhecida: o postgres.js não tira da fila do pool o begin de quem desistiu; quando a conexão chega, ele faz BEGIN → ROLLBACK sem rodar nada. Custa uma ida ao banco por desistência; só some com um prazo de aquisição no próprio driver.

Consequência: idle_timeout continua protegendo contra conexões ociosas; o prazo de aquisição protege contra esgotamento. Se um pooler voltar, rever o tamanho (pool pequeno) — os timeouts por SET LOCAL continuam válidos em modo transação. Réplicas × NOD_DB_POOL_MAX + dono + migrações precisa caber no max_connections.
