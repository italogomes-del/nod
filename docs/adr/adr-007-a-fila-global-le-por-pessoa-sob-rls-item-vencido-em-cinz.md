# ADR-007 — A fila global lê por PESSOA sob RLS, item vencido em cinza, servidor é fonte da verdade do tempo

**Status** mantido

## Decisão

Inalterado, e agora é a policy do ADR-003 e não uma segunda policy. A consulta de 'Sua vez' é leitura por PESSOA com a policy de duas pernas (dono OU decisor designado). Devolve pendentes e vencidos recentes com o estado como coluna; vencido em cinza com desfecho e botão de reabrir, nunca suprimido. Servidor envia instante absoluto em UTC; cliente só interpola. Os dois relógios (DECISÃO, tempo de parede; EXECUÇÃO, conta trabalho) continuam separados por nome de campo. O agrupamento muda de 'por empresa' para 'por pessoa e por agente' — é o critério de agrupamento de core/fila-frota.ts que muda, não a assinatura.

## O que mudou

Só o critério de agrupamento. A policy de duas pernas deixa de ser sobre tenant e passa a SER a policy de visibilidade do ADR-003.

## Por quê

Este ADR já se chamava 'lê por PESSOA' — estava certo por antecipação e a premissa nova só tirou o ruído de tenant que o cercava. Uma frente escreveu um ADR NOVO inteiro, com quatro alternativas rejeitadas, para chegar onde este ADR já estava. Era uma emenda de um parágrafo. E a alternativa 'consultar com role privilegiado e filtrar na aplicação' fica MAIS perigosa agora: a fila é a única tela onde o trabalho de 19 pessoas legitimamente se mistura, é a tela de abertura, e é onde um bug de filtro expõe conversa privada de colega.

