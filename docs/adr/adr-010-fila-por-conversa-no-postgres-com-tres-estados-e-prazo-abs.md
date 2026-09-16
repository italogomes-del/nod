# ADR-010 — Fila por conversa no Postgres com três estados e prazo absoluto, sem segurar conexão do pool

**Frente** Execução · **Status** decidido · **Épicos** E9, E7, E3, E12, E8

## Decisão

Cada mensagem enfileirada é linha com tenant_id, conversa e status (pendente, despachando, assentado). No boot, restaurar APENAS 'pendente'. A linha vira 'despachando' ANTES do turno começar, numa transação curta, e o turno roda FORA de transação aberta. Uma linha em 'despachando' tem prazo absoluto que a expira e a converte em parada visível, nunca em reenvio automático. O índice em memória é cache derivado, reconstruído do banco no boot. As filas de pessoa e de delegação de agente têm políticas de descarte DIFERENTES.

## Contexto

E9.3 é P0 e exige fila persistida no Postgres, liberação de no máximo uma mensagem por conversa após o restart, e teste que prove ordem preservada através de restart. O container do PaaS reinicia — é premissa, não acidente.

## Alternativas rejeitadas

### Fila só em memória, como o Buzz

crates/buzz-acp/src/queue.rs usa VecDeque, HashSet<SessionScope> para in_flight_scopes e HashMap<SessionScope, Instant> para deadlines (linhas 201-206), sem sqlx nem persistência. Restart perde a fila e perde o conhecimento de qual turno estava em voo. Para app desktop é aceitável; para 70 clientes com prazo e expiração, não.

### Redis

Adiciona serviço com estado ao deploy de 2-3 engenheiros, e a fila precisa ser lida junto com a trilha e o estado da decisão nas MESMAS transações. Fila no Postgres deixa 'enfileirei' e 'registrei que enfileirei' atômicos; Redis exigiria conciliação entre dois estados duráveis, que é onde nascem os efeitos duplicados. readiness.rs:17-31 do Buzz mostra o preço: redis_pool_timeout e redis_pool_error entre as razões de não-prontidão.

### SELECT ... FOR UPDATE segurando o lock durante o turno

Prende uma conexão do pool por segundos a minutos, e com pooler em modo transação e pool pequeno (ADR-001), dez turnos concorrentes esgotam o pool e a fila global para de responder. A exclusão é por ESTADO com prazo, não por lock segurado.

### Só 'em voo' e apagar no fim, sem estado intermediário

Perde a distinção entre 'não começou' e 'começou e não sei se terminou' — que é exatamente a distinção que impede o replay no boot.

## Evidência

O OpenMausBot já faz isso: server/message-db.ts:55-64 (chat_followups com status) e FollowupStatus = pending | dispatching | interrupted | cancelled (linha 186). A restauração no boot só admite pendentes — server/channel-queue.ts restoreChannelMessages: 'if (row.status !== "pending") continue'. O drain marca 'dispatching' ANTES de rodar. settleChatFollowups(ids, null) apaga a linha com o comentário 'null aposenta um despacho cuja transcrição canônica já é durável' (message-db.ts:215). E está provado contra SIGKILL real: server/chat-followups-restart.test.ts mata o servidor, reinicia e verifica que a linha 'dispatching' não é reexecutada (linhas 122, 137, 143-145). O prazo absoluto vem do Buzz: in_flight_deadline = max_turn + 100s (queue.rs). CUIDADO: esse prazo é RELÓGIO DE EXECUÇÃO (conta trabalho, pausa em aprovação humana) e é semanticamente oposto ao relógio de decisão do ADR-007.

## Consequências

- Turno que morreu em 'despachando' não volta sozinho: uma varredura de boot classifica pelos quatro sinais do ADR-009 e transforma em parada visível ou reenvio permitido.
- 'despachando' sem prazo é vazamento: trava a conversa para sempre. O prazo é obrigatório e o item expirado vira parada na fila.
- Toda linha carrega tenant_id sob RLS. A fila global vira consulta sobre tabela, não agregação de memória.
- A distinção de descarte é explícita no OpenMausBot e vale copiar: 'ao contrário do drain de delegação, um turno interrompido ou falho NÃO descarta esta fila: delegações são fan-out de um bot (descartar no Stop é propriedade de segurança), mas estas são as palavras do usuário' (steer-queue.ts, cabeçalho).
- E9.3 exige que mensagem recebida durante turno ativo fique fora do transcript até a operação assentar, 'para que o respondente não pareça responder palavras que não viu' — é comportamento de leitura, não só de fila.

## Reversibilidade

barata para a tecnologia, cara para a semântica. Nascer sem o estado 'despachando' faz o primeiro restart em produção reexecutar turnos, e a descoberta é um efeito duplicado em dado de aprendiz. Adicionar o estado depois é fácil; desfazer o efeito, não.

## Revisitar quando

Quando a contenção na tabela aparecer no perfil de latência — o que, com 70 clientes, não deve acontecer cedo. Antes disso, se rolling deploy voltar à mesa (ADR-001): a exclusão por conversa já estará no banco, que é o ponto.

## Revisão — investigação do monorepo da Leapy

**O que muda.** Confirmado com evidência de quem tinha o fornecedor contratado, mais um refinamento que falta: a política de ABANDONO exige DUAS condições simultâneas (tentativas E idade), nunca uma só. E 'itens abandonados' entra nas sete métricas do ADR-017.

**Motivo.** A Leapy PAGA Inngest e ainda assim a durabilidade mora no events_outbox do Postgres, escrito na mesma transação do domínio. Se a fila externa bastasse, a tabela não existiria. A regra de abandono é cicatriz: só o teto esvazia a fila inteira numa queda do fornecedor porque o cron roda a cada minuto sem backoff; só a idade nunca abandona a linha envenenada que falha rápido e para sempre.

Ver [o que o nod herda da Leapy](../inherited-from-leapy.md).
