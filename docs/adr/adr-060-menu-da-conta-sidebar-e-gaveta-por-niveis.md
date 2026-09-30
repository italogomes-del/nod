# ADR-060 — Menu da conta, sidebar arrastável e a gaveta do bot por níveis

Status: aceito · Data: 2026-09-30 · Emenda ADR-032 (painel do bot) e a regra de 2026-09-18 de "Seu espaço". Canvas "Nod —
tela do agente", página "Menu, sidebar e gaveta".

## Contexto

O Marlon comparou o nod com o Grok bot e pediu quatro mudanças. Conferido na tela real em 2026-09-30, numa janela de
1440 × 900:
- **Seu espaço** ocupava o lugar da conversa com uma página longa de seis blocos. Para sair, só clicando num bot.
- **Sidebar de 292 px:** o fixado tinha mascote de 49 px, o título cortava sem reticências e os ••• ficavam em cima do
  mascote. Não havia como arrastar um bot para fixar ou trocar de seção.
- **Gaveta de 300 px:** Editar perfil, Memória e Nova rotina saíam dela e ocupavam o lugar da conversa.
- **Editar perfil** juntava nome, título, missão, mascote, o catálogo com 15 estados do mascote, seis botões e a lista
  técnica de acessos.

## Decisão

1. **Menu da conta no avatar.** O avatar abre um menu: Conexão, Avisos, Modo dev (liga ali mesmo, ⌘⇧D continua),
   Computadores, Gerenciar agentes e Relatos. No rodapé do menu fica o banco da instância.
   - A faixa do topo só aparece quando algo precisa da pessoa: a IA desconectada (com Conectar) ou um conector fora do ar
     ("Gmail e ClickUp fora do ar", com Ver).
   - O selo "Persistente" saiu da barra. O efêmero e o não identificado continuam nela, porque pedem atenção.
2. **Seu espaço é uma camada, não uma tela.** Ele abre em tela cheia por cima da tela atual, já na seção escolhida, com
   as seções na coluna da esquerda.
   - A tela de baixo continua montada e inerte. Sair devolve a conversa exata: rolagem, rascunho do campo e nível da
     gaveta. O que chegou enquanto isso ganha a linha "Novas".
   - Um botão só para sair: "‹ <de onde veio>", com o mascote do bot, mais o Esc. Sem ×: os dois fariam o mesmo, e o
     nome diz para onde a pessoa volta. Trocar de seção não empilha.
   - As telas `gestao`, `relatos` e `chaves` viraram seções. A chave crua recém-emitida vive enquanto a seção
     Computadores está aberta.
3. **Sidebar de 340 px e gaveta de 380 px.** Na janela de 1440, a conversa fica com 720. Abaixo de 1100 px, a gaveta
   abre por cima da conversa.
   - Os fixados têm mascote de 56 px. Nome e título cortam com reticências, e o `title` mostra o nome inteiro.
   - Sem ••• nos bots: o menu abre no clique direito, na posição do cursor, ou com Shift+F10. No bot aberto, também
     pelo ⋯ do topo da gaveta.
4. **Arrastar na barra (0041).** Um bot da pessoa arrastado para a grade é fixado na posição em que cai. Arrastado
   para uma seção, sai da grade e entra na seção. Arrastado para "+ Nova seção", pede o nome.
   - O servidor recebe um pedido só: `PATCH agentes/:id/organizacao` com `fixado`, `secao` e `ordem`. A `ordem` traz os
     ids do grupo de destino, e cada um grava o próprio índice em `agentes.posicao`.
   - A frota ordena por `fixado desc, posicao nulls last, criado_em`. A barra se reorganiza na hora, sem esperar a
     frota voltar.
   - Bot de outra pessoa não arrasta. Fixar e "Mover para…" continuam no menu para quem não usa mouse.
5. **A gaveta por níveis.** Tudo o que é do bot abre dentro dela, com ‹ (ou Esc) para voltar, e a conversa continua ao
   lado. Os níveis são rotina, acesso a um app, Dar acesso, Editar perfil, Memória, Inteligência e Nova rotina. O ícone
   do painel fecha a gaveta de qualquer nível.
   - **Rotina:** a instrução inteira, o cron em palavras (`RotinaDto.resumo`) e as últimas execuções, incluindo as
     silenciosas. O rodapé tem Pausar, Testar agora e Ajustar. Ajustar só escreve o pedido no campo, porque quem muda a
     rotina é o bot (ADR-043).
   - **Acesso:** o nível do bot, o que ele deixa em palavras, cada ação legível e Revogar.
   - **Editar perfil** ficou com mascote (forma e cor), nome, título e missão. Sair com mudança não salva pergunta se
     descarta. Salvar sem o campo de modelo não mexe na inteligência do bot.
   - Trocar de bot abre a gaveta do outro na visão geral. A rotina parada por falta de acesso continua com o botão que a
     destrava na própria linha (emenda da ADR-044).

## Alternativas descartadas

- **Seu espaço como tela, com "voltar" pelo histórico.** Trocar a conversa pela página regravava o campo e perdia o
  rascunho, a rolagem e o nível da gaveta. A camada mantém tudo sem guardar nada.
- **× e ‹ juntos em Seu espaço.** Fariam o mesmo, e a pessoa ficaria em dúvida sobre qual deles descarta algo.
- **••• visível ao passar o mouse sobre o fixado.** Continuaria em cima do mascote, que foi a reclamação.
- **Posição fracionária (a média entre os vizinhos).** Evitaria mandar o grupo inteiro, mas exige renumerar quando os
  números se aproximam. Um grupo tem dezenas de bots, então mandar a ordem inteira custa pouco.

## Gatilho de reversão

- Se a camada de Seu espaço atrapalhar um aviso que precisa de clique (o foco preso nela), ela passa a fechar sozinha
  quando chega uma decisão.
- Se um grupo da barra passar de 200 bots (o teto da `ordem`), a posição vira fracionária.

## Não implementado

- **Computador do bot e Pasta de trabalho** continuam na janela grande deles. Um desktop remoto e uma árvore de arquivos
  não cabem em 380 px.
- **Reordenar seções:** elas seguem em ordem alfabética. Só os bots se arrastam.
- **O catálogo de estados do mascote** saiu do perfil e não foi para lugar nenhum.
