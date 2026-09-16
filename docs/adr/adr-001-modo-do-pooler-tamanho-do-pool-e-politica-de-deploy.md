# ADR-001 — Modo do pooler, tamanho do pool e política de deploy

**Status** mantido

## Decisão

Pooler em modo transação, pool pequeno, deploy por recreate (nunca rolling). Decidido antes da fase 0. Acréscimo de uma linha: o endpoint de long-poll da ponte NÃO segura conexão do banco enquanto espera — consulta, solta, dorme no processo.

## O que mudou

Só a nota sobre o long-poll. Nenhuma decisão mudou.

## Por quê

Cinco decisões de quatro frentes dependem deste ADR e nada nele dependia do número de clientes. A nota sobre o long-poll existe porque a ponte nova introduz ~38 conexões HTTP paradas, e se cada uma segurasse conexão de banco o pool esgotaria — que é o incidente de sexta 19h que o ADR-001 já nomeava como o mais provável do sistema.

