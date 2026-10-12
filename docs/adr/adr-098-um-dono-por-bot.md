# ADR-098 — Um dono por bot: a conversa coordena, as frentes trabalham por baixo

Status: proposta · Data: 2026-10-11 · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) (tasks
paralelas), [ADR-084](adr-084-pedido-a-colega-parado-avisa-ou-retoma.md) (pedido a colega parado),
[ADR-086](adr-086-esperar-fora-do-mac.md) (`me_chame_as`) e [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md)
(comando em segundo plano). Conversa com a [ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md) (proposta,
PR #252: fila dos comandos pesados). Plano de entrega em [plano-um-dono-por-bot.md](../plano-um-dono-por-bot.md);
telas em [prototipos/um-dono-por-bot](../prototipos/um-dono-por-bot/README.md). Decisões do Marlon em 2026-10-11.

## Contexto

Em 11/10, às 20:33, a tela Trabalhos mostrava "Trabalhando · 13", com um trabalhando de fato. Medido na produção (banco e
GitHub Actions do gamefik):

- **Onze tasks do Ze 1 dormiam com volta marcada** (`me_chame_as`). Todas dependiam, direta ou indiretamente, da CI do
  gamefik #845, a base de 14 PRs empilhados. Foram 67 voltas no dia e cerca de US$ 114 nas tasks que seguiam abertas. Uma
  delas voltou 12 vezes seguidas, acima das 10 em que a própria ADR-086 manda rever a regra; nada avisou.
- **A CI do #845 nunca terminou.** O job `checks` falhou 4 vezes (11:38–14:12) e depois foi cancelado 9 vezes seguidas: leva
  mais de 55 min nesse PR (cerca de 28 de banco e 27 de mobile; na `main`, 2 a 15 min) e é cancelado por commit novo. Várias
  tasks do próprio Ze 1 empurravam no mesmo branch; uma anotou "ver se o head mudou com a correção da outra sessão".
- **O orquestrador empilhava.** Às 17:29 o Leonardo abriu "Destravar o que está parado há mais de 1h" (mais uma task
  olhando a mesma CI) e mandou começar o B07/B08 (US$ 38 e mais 7 PRs em cima do #845). O Ze 2, o Ze 3 e os Devs estavam
  quase ociosos.
- **De manhã**, 14 tasks do Ze 1 caíram com a máquina (`maquina_sem_contato`, VM sem memória) sem produzir nada.

Cada bot acertou olhando a sua parte. O defeito é de forma: a ADR-083 fez das tasks **pares** independentes e visíveis,
cada uma com sessão própria, sem ninguém acima delas. Ninguém via o conjunto, cada task vigiava o mundo por conta própria,
os efeitos de uma eram invisíveis para as outras, e a tela listava cada sessão como trabalho.

Uma primeira proposta (esperas como objeto compartilhado, vigias, registro de efeitos, painel do orquestrador; página
"Tasks que terminam") remendava as consequências e obrigava o Nod a construir um harness de coordenação de pares. O Marlon
pediu algo mais geral, que não poluísse a tela e servisse a qualquer trabalho longo, não só código.

**Referência: Hermes Agent** (Nous Research, código lido em 11/10, commit 835c3dd; Bot Mode oficial, embutido no Hermes
Desktop). Um bot é uma conversa permanente, um turno por vez, com fila. O paralelismo são subagentes que devolvem só o
resumo, em uma mensagem. Esperar é um processo em segundo plano cujo fim abre um turno ("o filho devolve o fato, PR e SHA,
e o pai lança o vigia"); laço com sleep é proibido. Travas por falta de progresso, não por relógio, e o fluxo de CI tenta
3 vezes e pergunta ao usuário. Na tela, "ativo" é só turno vivo; esperar aparece como processo, não como trabalho.

## Decisão

**Cada bot tem um dono: a conversa dele.** Ela coordena todo o trabalho do bot; o paralelismo fica por baixo dela, em
frentes que devolvem o resultado ao dono. A pessoa fala com o bot, não com as frentes.

1. **O dono é a fila do bot, não uma sessão única do CLI.**
   - Pedidos da pessoa, de colegas (`pedir_a_bot`) e de rotinas entram na fila do dono, em ordem. A pessoa passa na frente.
   - Turno de colega ou de rotina vira frente na hora; o dono recebe só o resumo. Assim a marca de conteúdo de fora
     (ADR-047) fica na frente que leu, e a conversa com a pessoa não perde a escrita por causa de um pedido de colega.
   - Sala e ligação continuam paralelas à conversa, como hoje (são conversas diferentes; ADR-072).
2. **Frente.** Uma unidade de trabalho do bot, com sessão e pasta próprias, filha do dono e **que não aparece como task**.
   - É uma linha de `trabalhos` (reaproveita pasta da ADR-065/088, limpeza da ADR-096, custo, memória e `sessaoExecutor`).
     Não usa o subagente do harness: só o Claude tem, e o Nod não o enxerga (motivo da ADR-083).
   - Devolve ao dono um resumo curto com fatos (o que fez, PR e SHA, o que falta). Um lote de frentes vira uma mensagem do
     dono, não uma por frente.
   - Frente não abre frente (`podeAbrirTask`). Não há teto fixo de frentes (ADR-083/085); a máquina decide (item 7).
3. **O dono fica leve.** O turno do dono dispara frentes, responde em poucas linhas e encerra; o trabalho pesado vai para
   frente. A rede de 2 min (ADR-083) passa a promover o turno a frente, e sem `bifurcaSessao` promove com o histórico.
4. **Esperar algo de fora é um comando, e o fim dele acorda o dono.**
   - Ferramenta do Nod `esperar_comando({ comando, motivo })`, pelo proxy, em qualquer harness. O pedido fica no banco
     (comando, pasta, máquina, turno de origem); o motor roda o comando **fora do CLI**, com as regras do terminal do bot
     (ADR-052, ADR-089: sem laço com sleep); o turno do dono encerra na hora.
   - Quando o comando termina, o Nod enfileira a retomada do dono com o código de saída e as últimas linhas, pelo caminho
     do `acordar_em` (ADR-086). Ex.: `gh pr checks 845 --watch` acorda o Ze 1 uma vez, quando a CI acaba.
   - Só o dono espera. A frente devolve o fato; quem lança a espera é o dono.
   - Queda da máquina: ao voltar, o motor relança o comando gravado; se não puder, acorda o dono com "a espera caiu".
   - `me_chame_as` fica só para hora marcada ("me chame amanhã às 9 h") e sai do catálogo das frentes.
   - Um Bash em segundo plano dentro do CLI não serve para isso: pela ADR-067 o turno fica aberto e a fila do bot trava
     enquanto o comando roda, e o Codex não tem terminal.
5. **Sem progresso, o bot para e pergunta.** Três retornos da mesma espera sem fato novo, ou três quedas
   (`MAX_QUEDAS_POR_PEDIDO` da ADR-084), e o dono para e pergunta à pessoa na conversa, com opções. Mede-se novidade,
   não tempo: "só o Parar freia" (ADR-067) continua valendo. Substitui o teto de 24 voltas da ADR-086.
6. **Cada frente no próprio branch; só o dono integra.** Frentes que mexem num repositório trabalham em branch e worktree
   próprios; o dono junta o resultado e é o único que empurra no branch do PR. Não há trava no hook: é a forma de trabalhar
   que o dono usa ao disparar frentes. Resolve o caso do #845 sem proibir nada.
7. **Máquina apertada.** A frente herda a origem do pedido: veio da pessoa, não é segurada; veio de colega ou rotina,
   pode ser segurada (ADR-085). Comandos pesados seguem a fila da ADR-097, se aprovada.
8. **Entre bots.**
   - `pedir_a_bot` vira pedido na fila do dono do outro bot. A resposta imediata diz a posição ("entrou na fila, depois do
     #757"); o bot pode sugerir outro colega. A fila freia o orquestrador sem regra nova.
   - Espera circular (A espera B, B espera A) é detectada no `pedir_a_bot` e recusada com instrução ao bot.
   - O varredor da ADR-084 passa a ler o estado da frente que atende o pedido.
9. **Frente sem trabalho sai na hora.** Ao terminar, a pasta da frente com zero commits além da base e árvore limpa é
   apagada; com trabalho, segue a limpeza da ADR-096 (guardar antes de apagar). Só com prova afirmativa; na dúvida, fica.
10. **Tela** ([protótipo](../prototipos/um-dono-por-bot/README.md)):
    - **Conversa:** uma linha centralizada quando as frentes começam e outra quando terminam; o resultado chega numa
      mensagem do bot.
    - **Uma linha acima do campo**, nunca uma pilha. O texto principal é o estado de maior prioridade — Esperando você >
      Trabalhando em N frentes > Esperando X > N na fila — e os outros viram contagem ao lado. Some quando o bot está
      livre. Aberta, mostra cada frente com o último passo, a espera (comando, última linha, tentativa N de 3) e a fila.
    - **A decisão fica na conversa**, como mensagem do bot com opções; a linha só ecoa "Esperando você" e leva até ela.
    - **Trabalhos:** uma linha por bot (Precisa de você, Trabalhando, Esperando) e os livres numa linha; as frentes abrem
      com um clique.
    - **Barra lateral:** um sinal por bot — ponto vivo trabalhando, vazado esperando, azul precisa de você.
    - **Esperar não é trabalhar:** nada que só espera conta como "Trabalhando".
11. **Falar com uma frente.** A rota de mensagem para um trabalho vira recado para a frente, que aparece também na conversa
    do dono. `mandar_para_task`, "Fazer aqui" e "Fazer depois" são revistos no plano.
12. **Capacidades, nunca o nome do harness** (ADR-083 §5). Fila, frentes, espera e perguntas são ferramentas do Nod e
    valem igual para qualquer harness; dentro da frente o trabalho continua no CLI com o que ele tem de melhor.

## Emendas

- **ADR-083:** tasks deixam de ser pares visíveis. A faixa por trabalho no `reivindicar` continua, agora para frentes.
  `abrir_task` passa a abrir frente do dono.
- **ADR-084:** o pedido a colega é um item na fila do dono do outro bot; o varredor lê a frente que o atende.
- **ADR-086:** `me_chame_as` só para hora marcada; a volta marcada não conta como trabalhando; o teto de 24 voltas vira o
  item 5.
- **ADR-067:** esperar algo de fora não é mais comando em segundo plano do CLI (item 4). O comando do próprio trabalho
  (testes, build) continua no terminal da frente.

## Alternativas rejeitadas

- **Manter tasks como pares e coordenar por fora** (esperas como objeto, registro de efeitos, painel do orquestrador): é
  construir um harness de coordenação de pares, com mais estado e mais tela. Remenda as consequências da forma.
- **Dono por branch ou trava de push no hook:** regra específica de código que não generaliza e cria problemas novos.
- **Sessão única do CLI como dono:** mistura modo, catálogo e procuração, e pela ADR-047 a sessão retomada carrega a marca de
  conteúdo de fora de qualquer pedido que entrou nela.
- **Subagente do harness como frente:** só o Claude tem, e o Nod não o enxerga.
- **Esperar com Bash em segundo plano do CLI:** segura o turno e a fila do bot, e o Codex não tem terminal.
- **Teto fixo de frentes** (o Hermes recusa a 11ª): o Marlon rejeitou teto (ADR-083/085); a máquina decide.
- **O Nod virar o harness** (como o Hermes): perderia os laços de agente afinados pelos fabricantes e as assinaturas das
  pessoas; o Nod fica com a coordenação e os CLIs com o trabalho.

## Limites

- **O contexto do dono cresce.** Só o Claude retoma sessão; o Codex recebe as últimas mensagens. A frente devolve resumo
  curto; a compactação continua manual (`/compactar`) ou do CLI. Medir antes de criar regra.
- **Esperas sem comando** (a resposta de uma pessoa sem conector que avise) usam `me_chame_as` com a mesma paciência do item 5.
- **O computador do bot** continua um por bot (ADR-037); frentes que precisam dele esperam a vez.
- **A pessoa pode esperar o turno de um colega.** O dono é leve, mas um turno de colega em andamento ainda vai até o fim
  antes do próximo.

## Gatilho de reversão

- Mais de 10% das mensagens da pessoa esperando mais de 5 min na fila do dono em 2 semanas: reabrir uma faixa paralela para
  a pessoa.
- A pessoa abrindo o detalhe das frentes em mais de 30% das vezes em 2 semanas: as frentes voltam a aparecer como itens
  próprios.
- Mais de 20% das esperas acordando o dono sem fato novo: rever o `esperar_comando` e a orientação do prompt.
