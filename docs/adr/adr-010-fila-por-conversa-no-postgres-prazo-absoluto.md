# ADR-010 — Fila por conversa no Postgres, prazo absoluto

**Status** revisado

## Decisão

Mantidos os três estados e o prazo absoluto, e acrescentado um QUARTO estado: 'interrompido', com motivo tipado. Duas colunas novas na linha de turno: machine_id (qual máquina reivindicou) e lease_ate (instante absoluto, renovado). O prazo passa a ter dois níveis: o lease curto (90s, renovado de 30 em 30 pela máquina) e o prazo de produto que já existia. A reivindicação é o UPDATE condicional com FOR UPDATE SKIP LOCKED — não precisa de tabela nova. Lease vencido converte a linha em parada VISÍVEL com motivo escrito, nunca em reenvio.

## O que mudou

Quarto estado 'interrompido'. Duas colunas (machine_id, lease_ate). O lease como segundo nível de prazo.

## Por quê

Este é o ADR que MAIS ganha com a mudança de premissa, e quem o lesse procurando o que simplificar tiraria a coisa errada. O argumento original era 'o container do PaaS reinicia — é premissa, não acidente'. Agora o executor é o seu laptop, e laptop fecha várias vezes por dia: a interrupção sobe uma ordem de grandeza e o estado 'despachando' com prazo absoluto deixa de ser rede contra restart e vira o mecanismo central do modelo de execução. O openmausbot já tem 'interrupted' no enum (server/message-db.ts:55-64) — o nod estava com três estados onde o repo de referência tem quatro, e a sua decisão 4 mostra por quê.


## Refinamentos (2026-09-16)

- Outbox transacional (`events_outbox`) gravado na MESMA transação do evento (`eventsRepo.gravarComOutbox`): rollback derruba os dois; índice parcial nos pendentes.
- Abandono exige DUAS condições simultâneas: `tentativas >= OUTBOX_TETO_TENTATIVAS` E `criado_em < agora - OUTBOX_IDADE_MIN_MS` (ambas em `src/shared/constantes.ts`, com o critério datado). Só o teto esvaziaria a fila numa queda curta do consumidor; só a idade nunca abandonaria a linha envenenada. Abandonado é CONTADO (métrica `outbox_abandonados`, ADR-017), nunca apagado. Prova: `tests/integration/outbox-abandono.test.ts`.
- Trava de reivindicação só se prova no terceiro modo de teste (duas conexões, `tests/concurrency`), nunca dentro do withRollback (ver ADR-011).

## Gatilho de reversão

Reabrir (trocar por fila externa) se, medido em produção: latência de reivindicação p95 > 500 ms com o pool do ADR-001, ou `outbox_abandonados` > 0 por dia durante duas semanas seguidas sem causa no consumidor, ou a fila precisar de fan-out entre serviços que não compartilham o Postgres.
