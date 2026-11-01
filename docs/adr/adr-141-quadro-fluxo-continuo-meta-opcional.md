# ADR-141 — O quadro é um fluxo contínuo; a meta é opcional e só ela tem progresso

Status: aceita (2026-11-01, NOD-415) · Estende [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (as ações
`quadro.*`) · Convive com a [ADR-140](adr-140-colunas-do-quadro-por-grupo.md) (colunas por grupo, NOD-448).

## Contexto

O quadro da NOD-442 nascia de uma meta obrigatória e sempre mostrava "N de M feitas". A NOD-415 pede o quadro como
forma do bot (virar quadro e voltar), criado pela conversa ou pela tela, com meta e prazo definíveis e editáveis, aviso
de risco uma vez só, e só para o Marlon enquanto é teste. O Gil fixou o conceito: o **fluxo contínuo é o padrão**; a
meta é opcional e só ela mostra progresso.

## Decisão

1. **Meta opcional** (0136, `quadros.meta` sem `NOT NULL`; o check de 1 a 200 continua quando há meta). Sem meta, o
   topo mostra só "+ Meta" e o prazo: nenhuma fração, barra ou "cumprida", e o quadro nunca fecha. Com meta, a barra,
   "N de M feitas" e quanto falta. O `QuadroDto` continua com `feitas`/`total` (a web esconde sem meta), para não
   quebrar a NOD-448.
2. **Meta e prazo pela conversa e pela tela, no mesmo lote** (`criar_quadro {meta?, prazo?}`, `editar_quadro`, `null`
   tira). A tela tem o form "criar quadro" (meta opcional, prazo por atalhos: Hoje, Amanhã, Sexta, Sábado, Fim do mês,
   Outra data, Sem prazo), a meta clicável no topo (Enter grava, Esc desiste, vazio tira) e o menu de prazo que grava
   na hora. Toda mudança tem o Desfazer do lote.
3. **Aviso de risco uma vez só, e só com meta e prazo.** Risco = falta menos de 20% do período (de quando a meta foi
   posta, `quadros.meta_desde`, ao fim do dia do prazo em São Paulo) e o progresso está abaixo de 80%. O aviso sai na conversa do bot anfitrião como
   `aviso_pessoa` não confiável, com até 5 tarefas não iniciadas como corte sugerido (o título de tarefa escrita por um
   turno não confiável não entra no texto, que vira push: só conta, "e mais N"). O
   id de envio deriva de (quadro, meta, prazo): o índice único de mensagens segura a repetição, inclusive entre o lote e
   o varredor (a cada 15 min, com a trava do quadro). Trocar a meta ou o prazo é outra situação e pode avisar de novo.
4. **Voltar a agente comum** (`quadro.remover`, `DELETE /agentes/:id/quadro`, `remover_quadro` no `gerir_quadro`,
   sozinho no lote). Para os turnos das tarefas e apaga o quadro, as tarefas e os lotes (cascata). Conversa, memória,
   rotinas e acessos não são do quadro e ficam. **Não tem Desfazer**, então a ação é `arriscada`: a tela confirma antes;
   um bot só remove o **próprio** quadro, num turno limpo em que a pessoa falou com ele (o mesmo corte do `responder`) e
   com o nome dele em `bot` (a confirmação explícita). **Emenda à ADR-135 §3** (registrada lá): sem cartão no chat, porque o `gerir_quadro`
   não tem a fila de cartões do `gerir_bots`. Gatilho de reversão: um quadro removido sem a pessoa querer → vira cartão
   (ou ganha lixeira com Desfazer).
5. **A meta conta de quando foi posta** (`quadros.meta_desde`, 0136): de sem meta para com meta. A tarefa que
   terminou (feito ou cancelado, `quadro_tarefas.terminada_em`) antes disso não entra na fração, não cumpre a meta nova e
   o período do risco começa ali. Uma meta de texto novo posta depois de a anterior ser cumprida também recomeça
   (nasce aberta, sem o resumo da anterior). Corrigir o texto de uma meta ainda aberta ou trocar o prazo não recomeça; renomear uma
   tarefa antiga também não a devolve à meta (o `terminada_em` só muda com o status). As duas marcas vêm do mesmo
   relógio (o da aplicação).
6. **Flag `NOD_QUADROS`** (`desligado | admins | todos`; `admins` lê `NOD_ADMINS`; o deploy fixa `admins`, em produção só
   o Marlon; fora de produção o padrão é `todos`): fora dela, o experimento lê desligado mesmo com a
   chave gravada — sem pílula, sem tela e sem `gerir_quadro`. O bot sem quadro não muda.

## Consequências

- O criar pelo bot segue barrado em turno não confiável (a meta entra em todo turno de tarefa).
- O risco, a meta e o `terminada_em` classificam pelo **grupo da coluna** (ADR-140): Feito e Fechado terminam, Não
  iniciado entra no corte sugerido. O backfill da 0136 também olha o grupo (a 0134 pode já estar no ar com colunas da
  pessoa), e a foto de lote anterior à 0136 deduz o `terminada_em` pelo grupo da coluna dela.
- Na troca azul/verde do deploy (até ~10 min), o servidor anterior não grava `terminada_em` ao mover para Feito; a
  tarefa assim fica contando para uma meta posta depois. O alcance é o do experimento (só o Marlon) e a meta ainda não
  existe nesse servidor; aceito.
- Desfazer e remover não reavaliam o risco na hora: o varredor cobre em até 15 minutos.
- As colunas (criar, renomear, ordenar, status com grupo, sugestão confirmada por card) são da NOD-448/ADR-140.

## Gatilho de reversão

Se a pessoa pedir progresso sem meta (por exemplo, vazão por semana), ele entra como outra métrica, sem voltar a meta
obrigatória.
