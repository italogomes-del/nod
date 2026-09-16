# ADR-017 — Um container, métricas ligadas a promessa de produto, alarme externo

**Status** revisado

## Decisão

O container único sobrevive, com menos gente dentro: web, fila, trilha e o executor de SERVIDOR. O endpoint de long-poll mora NELE. As sete métricas caem para QUATRO: (1) idade da pendência mais velha não decidida; (2) taxa de expiração por falta de decisão, COM OS DOIS RÓTULOS (expirou_sem_ninguém_ver / expirou_com_alguém_ciente); (4) turnos retomados versus perdidos após restart, agora com rótulo separando restart do servidor de máquina sumida; (5) custo do executor de servidor no mês. Entra uma quinta: quantas máquinas estão com poll aberto agora, por pessoa. Saem: duração de checkout do pool, distância até a partição futura, taxa de resumed:false. O alarme externo PERMANECE. Rótulo como union fechado em TypeScript permanece, com o campo de tenant JÁ DECLARADO no tipo.

## O que mudou

De sete para cinco métricas. A (2) é DEVOLVIDA com os dois rótulos depois de uma frente a ter cortado.

## Por quê

Uma frente cortou a métrica (2) dizendo que ela foi justificada por cardinalidade segura com 70 clientes. Fui ao texto do ADR-017 e não foi: a justificativa é 'uma pendência que expira porque ninguém olhou não move CPU — o container fica saudável enquanto o produto falha em silêncio'. Os dois rótulos separam problemas OPOSTOS: ninguém viu (falha de notificação) versus viram e não decidiram (falha de carga). E a substituição proposta — 'entre 19 colegas que se veem todo dia alguém pergunta' — é exatamente a disciplina humana que o ADR-003 rejeitou como mecanismo. Custo de manter: dois valores num union fechado. Histórico não se inventa depois.

