# UAT manual — harnesses e modelos por agente

Objetivo: validar que uma pessoa leiga pode deixar o nod escolher a inteligência sem configuração e
que uma pessoa avançada consegue trocar o harness e o modelo de cada agente sem afetar os demais.

## Como trocar

Há dois caminhos para chegar ao mesmo seletor:

1. Abra a conversa do agente e clique no atalho `✦ Automático`, `✦ Sonnet`, `✦ GPT-5.6 Sol` ou
   equivalente, no cabeçalho.
2. Ou abra **Perfil → Inteligência do agente → Personalizar modelo**.

No campo **Modelo**, a escolha também define o harness:

- **Automático · recomendado**: o nod escolhe harness e modelo entre as conexões disponíveis.
- **Claude Code → Recomendado pelo nod**: fixa Claude Code e deixa o nod escolher o modelo.
- **Claude Code → Sonnet/Haiku/Opus**: fixa Claude Code e o modelo escolhido.
- **Codex → Recomendado pelo nod**: fixa Codex e deixa o nod escolher o modelo.
- **Codex → GPT-5.6 Sol/GPT-6 Astra/GPT-5.6 Luna**: fixa Codex e o modelo escolhido.

Clique em **Salvar escolha**. A mudança vale para as próximas tarefas desse agente. Tarefas que já
estavam na fila mantêm a configuração capturada quando foram criadas. Harnesses desconectados ficam
desabilitados; **Harnesses e disponibilidade** explica o estado de cada conexão. Cursor e Hermes
aparecem como **Em preparação** e ainda não podem ser selecionados.

## Preparação

- Use Node 24.19.0, aplique `npm run db:migrate` e inicie o nod nas portas documentadas.
- Para a rodada sem custo, use `NOD_EXECUTOR=catcher` e crie dois agentes descartáveis:
  `UAT Inteligência A` e `UAT Inteligência B`.
- Para a rodada real, use `NOD_EXECUTOR=auto`, com Claude Code e/ou Codex instalados e autenticados.
- Não use agentes, conversas ou rotinas de trabalho. Não conceda acessos externos durante este UAT.
- Mensagens enviadas na rodada real podem consumir a assinatura. Uma mensagem curta por combinação
  é suficiente. A descoberta de instalação e login, sozinha, não executa um turno pago.
- Registre cada caso como **Aprovado**, **Falhou**, **Bloqueado** ou **Não executado**.

## Rodada A — experiência sem custo

| ID | Passos | Resultado esperado | Prioridade | Resultado |
|---|---|---|---|---|
| HM-01 | Crie `UAT Inteligência A` sem procurar configurações de IA. Abra a conversa. | O agente nasce sem pergunta sobre harness/modelo; o cabeçalho mostra `✦ Automático`; nenhuma execução paga ocorre antes de uma mensagem. | P0 | Aprovado |
| HM-02 | Clique no atalho `✦ Automático` do cabeçalho. | Abre `Inteligência de UAT Inteligência A`; a explicação diz que o nod cuida da escolha; **Personalizar modelo** é opcional. | P0 | Aprovado |
| HM-03 | Abra o dropdown **Modelo** no modo catcher. Expanda também **Harnesses e disponibilidade**. | **Automático** pode ser escolhido; modelos de contas desconectadas ficam desabilitados; Claude Code e Codex mostram estado compreensível; Cursor e Hermes mostram **Em preparação**. | P0 | Aprovado |
| HM-04 | Sem alterar nada, clique **Cancelar**. | O diálogo fecha; o foco volta ao atalho de inteligência; a configuração continua igual. | P1 | Aprovado |
| HM-05 | Reabra o diálogo, escolha **Automático** e salve. Recarregue a página e reabra o agente. | A escolha persiste; o cabeçalho continua `✦ Automático`; histórico, memória e acessos do agente permanecem. | P0 | Aprovado |
| HM-06 | Abra **Perfil** e localize **Inteligência do agente**. | O mesmo valor aparece no perfil; a pessoa encontra a personalização sem precisar conhecer a palavra “harness”. | P1 | Aprovado |
| HM-07 | Navegue do atalho até dropdown, detalhes, Cancelar e Salvar usando Tab/Shift+Tab; feche com Cancelar. | Ordem de foco é previsível, os controles têm nomes compreensíveis e a operação não exige mouse. | P1 | Aprovado |

## Rodada B — Claude Code e Codex reais

Execute apenas as linhas cujos harnesses estejam instalados, autenticados e marcados como
**Conectado**. Se só um estiver disponível, marque os casos do outro como **Bloqueado**, não como
falha do produto.

| ID | Passos | Resultado esperado | Prioridade | Resultado |
|---|---|---|---|---|
| HM-08 | Com os dois CLIs conectados, crie um novo agente e envie `Responda somente: UAT-AUTO-OK`. | Sem configuração prévia, o nod escolhe um harness disponível; há uma única resposta `UAT-AUTO-OK`; o turno termina normalmente. | P0 | Aprovado |
| HM-09 | Em `UAT Inteligência A`, escolha **Claude Code → Sonnet**, salve e envie `Responda somente: UAT-CLAUDE-OK`. | O cabeçalho mostra `✦ Sonnet`; a próxima tarefa usa Claude Code/Sonnet e responde uma vez. Reabrir o seletor mostra Sonnet selecionado. | P0 | Aprovado |
| HM-10 | No mesmo agente, escolha **Codex → GPT-5.6 Sol**, salve e envie `Responda somente: UAT-CODEX-OK`. | O cabeçalho mostra `✦ GPT-5.6 Sol`; a próxima tarefa usa Codex/GPT-5.6 Sol e responde uma vez. Não há reaproveitamento indevido da sessão Claude. | P0 | Aprovado |
| HM-11 | Em `UAT Inteligência A`, escolha **Codex → Recomendado pelo nod**. | O cabeçalho representa a preferência do agente; o harness fica Codex e o nod resolve o modelo recomendado no próximo turno. | P1 | Aprovado |
| HM-12 | Configure A com Codex/GPT-5.6 Sol e B com Claude Code/Sonnet. Recarregue e abra os dois agentes. | Cada agente preserva sua própria escolha; trocar A não altera B. | P0 | Aprovado |
| HM-13 | Em A, volte para **Automático · recomendado**, salve e envie `Responda somente: UAT-RESET-OK`. | O cabeçalho volta a `✦ Automático`; a tarefa usa uma conexão disponível e termina normalmente. | P0 | Aprovado |
| HM-14 | Fixe A em um harness, encerre/desautentique somente esse CLI e mantenha o outro conectado. Envie uma tarefa curta. | O nod informa indisponibilidade; não troca silenciosamente para o outro fornecedor. Ao abrir o seletor, a escolha anterior continua visível e o estado explica a desconexão. | P0 | Aprovado com ressalva UX-01 |
| HM-15 | Volte A para **Automático** ainda com apenas um CLI conectado e repita a tarefa. | O nod usa o harness conectado automaticamente. A recuperação exige apenas salvar Automático, sem recriar o agente. | P0 | Aprovado |

## Rodada C — momento da troca e compatibilidade

| ID | Passos | Resultado esperado | Prioridade | Resultado |
|---|---|---|---|---|
| HM-16 | Deixe uma tarefa aguardando na fila com A em Claude/Sonnet. Antes de ela começar, altere A para Codex/GPT-5.6 Sol. Depois libere a execução. | A tarefa já enfileirada usa Claude/Sonnet; somente a tarefa criada depois da mudança usa Codex/GPT-5.6 Sol. | P0 | Aprovado por integração |
| HM-17 | Abra um agente criado antes desta feature e não salve nenhuma nova escolha. | O modelo anterior continua visível e utilizável; não há migração silenciosa para outro fornecedor. | P0 | Aprovado |
| HM-18 | Duplique um agente personalizado e abra o original e a cópia. | A cópia preserva harness/modelo; mudanças posteriores em um não alteram o outro; memória e histórico não são copiados. | P1 | Aprovado |
| HM-19 | Configure uma rotina curta no agente A, confirme a preferência antes de enfileirar e execute uma vez. Pause a rotina ao terminar. | O turno da rotina usa a preferência capturada de A; B não é afetado; pausar impede nova execução. | P1 | Aprovado |

## Registro da execução

Preencha uma linha por ambiente usado. Não registre emails, tokens, caminhos de credenciais ou
conteúdo privado das respostas.

| Data/hora | Ambiente | Harnesses conectados | Casos aprovados | Falhas/bloqueios | Evidência curta |
|---|---|---|---|---|---|
| 18/09/2026, 23:41–00:23 | Local, Node 24.19.0, web 5274/API 8888 | Claude Code 2.1.273 e Codex 0.155.0-alpha.2.6; indisponibilidade do Codex simulada em HM-14/15 | HM-01–HM-15 e HM-17–HM-19; HM-16 por integração | Nenhum bloqueio; UX-01 | Respostas exatas `UAT-AUTO-OK`, `UAT-CLAUDE-OK`, `UAT-CODEX-OK`, `UAT-RESET-OK` e `UAT-ROTINA-HARNESS-OK`; 3/3 testes de integração passaram. |

### Evidências e achados de 18/09/2026

- Foram criados apenas agentes descartáveis, sem acessos externos: `UAT Inteligência A`,
  `UAT Inteligência B`, `UAT Inteligência Auto` e `UAT Inteligência B (cópia)`.
- HM-14 usou um caminho inválido temporário para o binário do Codex, sem encerrar sessão nem alterar
  credenciais. O turno fixado no Codex terminou com indisponibilidade e não caiu para Claude Code.
- HM-15, no mesmo ambiente, executou em Claude Code ao voltar para **Automático**.
- HM-16 foi validado de forma determinística por `tests/integration/harnesses.test.ts`: a preferência
  gravada no turno permaneceu Codex/GPT-6 Astra após o perfil mudar para Claude/Haiku. Os três testes
  do arquivo passaram em Node 24.19.0.
- HM-18 confirmou que a cópia começou em Sonnet, sem histórico e sem acessos. Alterar somente a cópia
  para Automático manteve o original em Sonnet.
- HM-19 criou uma rotina a cada cinco minutos em `UAT Inteligência B`, executou uma vez em Sonnet,
  entregou `UAT-ROTINA-HARNESS-OK` e foi pausada imediatamente.
- **UX-01 — mensagem ambígua (P1):** com o agente fixado no Codex indisponível e Claude Code pronto,
  o turno mostra `executor indisponível (motor pronto)`. O bloqueio e a ausência de fallback estão
  corretos, mas “motor pronto” contradiz a indisponibilidade percebida e deve ser substituído por uma
  explicação específica do harness escolhido.

Critério de aceite da feature: HM-01, HM-02, HM-03, HM-05, HM-08, HM-09, HM-10, HM-12, HM-13,
HM-14, HM-15, HM-16 e HM-17 aprovados nos ambientes aplicáveis, sem troca silenciosa de fornecedor,
sem perda de histórico/memória e sem interferência entre agentes. Caso um CLI não esteja disponível,
os casos exclusivos dele podem permanecer bloqueados, mas a indisponibilidade precisa aparecer com
clareza na interface.
