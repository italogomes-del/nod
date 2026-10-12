# Plano: um dono por bot

Entrega da [ADR-099](adr/adr-099-um-dono-por-bot.md) em seis partes. Cada parte vai para produção sozinha e já melhora o
que se viu em 11/10; a ordem põe primeiro o que tira a confusão e o desperdício, depois a mudança de forma.

Como medir: os números de referência são os de 11/10, lidos na produção (`trabalhos` e `turnos` por bot e por dia:
estado, voltas com `acordar_em`, `motivo_interrupcao`, `custo_usd`) e no histórico do GitHub Actions do gamefik
(`gh run list --branch <branch>`). Repetir as mesmas leituras depois de cada parte.

## Parte 1 · Esperar não é trabalhar

Pequena e independente; resolve o "13 trabalhando" antes de tudo.

- Estado derivado `esperando` no `TrabalhoDto`: trabalho com volta marcada (`acordar_em` no futuro) ou esperando colega
  sai de `rodando`. A tela Trabalhos ganha o grupo **Esperando**; o chip da barra separa ponto vivo de ponto vazado.
- Alarme do gatilho da ADR-086: a mesma task voltando 3 vezes sem fala nova vai para "Precisa de você" com o motivo, em vez
  de marcar a quarta volta.
- **Pronto quando:** num dia como 11/10, "Trabalhando" mostra só turnos vivos; nenhuma task passa de 3 voltas sem a pessoa
  saber. (Referência: 13 mostrados × 1 real; 12 voltas seguidas.)

## Parte 2 · `esperar_comando`

- Ferramenta do proxy `esperar_comando({ comando, motivo })` nos modos com terminal; o pedido fica numa tabela própria
  (comando, pasta, máquina, turno de origem, estado, saída final). Validação pelas regras do terminal do bot (ADR-052,
  ADR-089).
- O motor roda o comando fora do CLI, em grupo próprio (ADR-089), e devolve código de saída e últimas linhas pela ponte.
  O fim enfileira a retomada pelo caminho do `acordar_em`.
- Queda: no boot, o motor relança os pedidos `rodando` da máquina; o que não volta acorda o dono com "a espera caiu".
- Prompt: para esperar CI, deploy ou processo, `esperar_comando` e encerrar o turno; `me_chame_as` só para hora marcada.
- **Pronto quando:** esperar uma CI custa uma retomada por execução terminada, não uma por volta. (Referência: 67 voltas,
  US$ 114.)

## Parte 3 · Frentes

- Migração: `trabalhos` ganha a ligação com o dono (a conversa do bot) e a marca de frente; a origem `frente` entra no
  `CHECK`. Frente não abre frente.
- Ferramenta do dono para abrir frentes em lote e receber o resumo (fatos: o que fez, PR e SHA, o que falta) como uma
  mensagem só quando o lote termina.
- Branch e worktree próprios por frente que mexe em repositório; o prompt do dono diz que só ele integra e empurra no
  branch do PR.
- Limpeza imediata: frente terminada com zero commits além da base e árvore limpa tem a pasta apagada na hora (prova
  afirmativa, como no Hermes); o resto segue a ADR-096.
- **Pronto quando:** nenhum branch recebe push de duas frentes do mesmo bot; a pasta média por frente sem trabalho some no
  fim. (Referência: CI do #845 cancelada 9 vezes por commits de tasks do próprio Ze 1.)

## Parte 4 · A fila do dono

- `pedir_a_bot` e rotina entram na fila do dono do bot que recebe; o turno de colega ou rotina vira frente na hora e o dono
  recebe o resumo. Resposta imediata com a posição na fila.
- A pessoa passa na frente no `reivindicar`; turno do dono curto (prompt e rede de 2 min promovendo a frente, com histórico
  quando o harness não bifurca).
- Espera circular recusada no `pedir_a_bot`.
- Varredor da ADR-084 lendo a frente que atende o pedido; três quedas → pergunta à pessoa (item 5 da ADR).
- **Pronto quando:** um bot nunca tem duas frentes nascidas de pedidos diferentes esperando a mesma coisa; o orquestrador
  recebe "entrou na fila" em vez de abrir trabalho paralelo. (Referência: 11 tasks do Ze 1 na mesma CI; Leonardo empilhando.)

## Parte 5 · A tela

- Linha acima do campo com a regra de prioridade e o detalhe aberto (frentes com último passo, espera, fila); a decisão
  na conversa com opções.
- Linhas centralizadas de início e fim de frentes na conversa.
- Trabalhos com uma linha por bot; barra lateral com um sinal por bot.
- Migração das tasks abertas: viram frentes do dono, com o mesmo id, pasta e sessão. As rotas antigas ficam enquanto houver
  app do Mac antigo (versão mínima, ADR-020); `faixaTrabalhosRecolhida` sai.
- Celular: a linha acima do campo cabe em 390 px.
- **Pronto quando:** as telas batem com o [protótipo](prototipos/um-dono-por-bot/README.md); a tela Trabalhos de um dia
  como 11/10 tem uma linha por bot.

## Parte 6 · Disco (com a ADR-097)

- Postgres de teste compartilhado por máquina: um cluster, um banco por frente (`CREATE`/`DROP DATABASE`), com dono
  registrado. Em 11/10 eram ~17 Postgres embutidos e 3,4 GB de memória.
- Pasta descartável para frente que não commita (QA, pesquisa): apagada no fim, só os artefatos declarados ficam.
- Registro de dono para o que é pesado fora da pasta (pgdata, contêineres, clones), recolhido pelo rótulo quando o dono some.
- **Pronto quando:** o disco da VM não cresce com frentes encerradas; nenhum Postgres de teste sobra sem dono.

## Fora deste plano

- O contexto do dono: medir o tamanho das conversas depois da parte 4 antes de criar regra de compactação.
- Falar direto com uma frente: a rota vira recado; `mandar_para_task`, "Fazer aqui" e "Fazer depois" são decididos na
  parte 5 com o protótipo.
