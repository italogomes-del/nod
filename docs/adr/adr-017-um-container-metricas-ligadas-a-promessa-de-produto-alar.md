# ADR-017 — Um container, métricas ligadas a promessa de produto, alarme externo

**Status** revisado

## Decisão

O container único sobrevive, com menos gente dentro: web, fila, trilha e o executor de SERVIDOR. O endpoint de long-poll mora NELE. As sete métricas caem para QUATRO: (1) idade da pendência mais velha não decidida; (2) taxa de expiração por falta de decisão, COM OS DOIS RÓTULOS (expirou_sem_ninguém_ver / expirou_com_alguém_ciente); (4) turnos retomados versus perdidos após restart, agora com rótulo separando restart do servidor de máquina sumida; (5) custo do executor de servidor no mês. Entra uma quinta: quantas máquinas estão com poll aberto agora, por pessoa. Saem: duração de checkout do pool, distância até a partição futura, taxa de resumed:false. O alarme externo PERMANECE. Rótulo como union fechado em TypeScript permanece, com o campo de tenant JÁ DECLARADO no tipo.

## O que mudou

De sete para cinco métricas. A (2) é DEVOLVIDA com os dois rótulos depois de uma frente a ter cortado.

## Por quê

Uma frente cortou a métrica (2) dizendo que ela foi justificada por cardinalidade segura com 70 clientes. Fui ao texto do ADR-017 e não foi: a justificativa é 'uma pendência que expira porque ninguém olhou não move CPU — o container fica saudável enquanto o produto falha em silêncio'. Os dois rótulos separam problemas OPOSTOS: ninguém viu (falha de notificação) versus viram e não decidiram (falha de carga). E a substituição proposta — 'entre colegas que se veem todo dia alguém pergunta' — é exatamente a disciplina humana que o ADR-003 rejeitou como mecanismo. Custo de manter: dois valores num union fechado. Histórico não se inventa depois.


## Refinamento (2026-09-16)

Entra a sexta métrica, `outbox_abandonados` (por tenant), do ADR-010 refinado: item do outbox abandonado pelas DUAS condições é contado, não apagado — no projeto de referência isso era um `console.error` que ninguém lia. O rótulo continua union fechado em `src/obs/metricas.ts` (L8), sem id/email de titular.

## Refinamento (2026-10-13, NOD-219)

Entra a sétima métrica, `turno_velho_na_fila` (contador, por tenant e pessoa, rótulo `bloqueio`: `depois_de` | `faixa_ocupada` | `condicao_da_maquina`). A promessa é a mesma da (1): o pedido que a pessoa fez não pode ficar "na fila" em silêncio. Ela conta a partir do prazo da fila do turno (`prazo_em`, em geral 24 h depois do pedido), não antes: o "na fila · há 6h" do diagnóstico continua sem alarme, e se as primeiras semanas mostrarem que 24 h é tarde demais, o limiar próprio é decisão a tomar com o dado dela. O varredor de turnos órfãos encerra só o pendente impossível de rodar (agente excluído, geração antiga); o pendente que passou do prazo da fila mas pode sair a qualquer momento (preso por outro trabalho, pela faixa ou pela condição da máquina — cota, Mac fora, memória, disco) não é encerrado, é contado, no máximo uma vez por hora por turno. É a medida que falta para decidir se esse caso merece regra própria; sem ela, a decisão seria no escuro, como foi o diagnóstico da NOD-219. Union continua fechado, sem id de turno no rótulo (o id vai só no log `turno_velho_na_fila`). O gatilho abaixo vale para ela: dois meses sem decisão operacional, sai.

## Gatilho de reversão

Reabrir (segundo container ou métricas de infraestrutura) se o executor de servidor passar a competir por CPU com o long-poll a ponto de o `puxar` estourar o teto de 20 s medido, ou se alguma das sete métricas ficar dois meses sem gerar decisão operacional — aí ela sai, não entra outra.
