# ADR-004 — Trilha imutável por TRIGGER, sem texto livre, prosa em tabela irmã apagável

**Status** mantido

## Decisão

Inalterado em tudo: trigger BEFORE UPDATE OR DELETE OR TRUNCATE levantando exceção inclusive para o dono; payload só enum, uuid, timestamp e numérico garantido por CHECK na mesma migração; prosa em tabela irmã apagável referenciada por id; coluna de hash nullable e não preenchida; role de poda separado; SAVEPOINT em todo teste. A trilha ganha owner_id e é lida sob a policy do ADR-003 revisto.

## O que mudou

Só o acréscimo de owner_id, que vem do ADR-003.

## Por quê

O rigor nunca veio do número de clientes. Veio de dois fatos que não mudaram: dados de aprendiz continuam em jogo, e o CHECK é o que impede que prosa entre na trilha. Se prosa entrar durante o uso interno, no dia do SaaS o passivo vai junto e não sai — numa trilha imutável 'limpar' não é DELETE. Uso interno gera MAIS texto informal e MENOS revisão, não menos. Custo de manter: uma linha.

