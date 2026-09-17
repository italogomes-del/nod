# UAT — criação conversacional, colaboração, Marketplace e rotinas

Objetivo: aceitar as jornadas da segunda rodada do nod pela experiência da pessoa.
Base inicial: commit `8002634`, PR #18. Execução: 17/09/2026, ambiente local, Node 24.19.0.

## Preparação e critérios

- API em 8888, web em 5274, Postgres em 5434. Claude Code autenticado para linguagem natural.
- Usar um agente identificado como teste; não alterar missões nem rotinas dos agentes existentes.
- Nunca enviar mensagens, emails ou publicações reais como efeito do aceite.
- Pausar qualquer rotina criada no teste; guardar histórico para inspeção. Não apagar dados existentes.
- Registrar resultado observado e evidência. Teste automatizado com provedor simulado não aprova OAuth real.
- **Aprovado**: todos os resultados esperados observados; **Falhou**: divergência reproduzível;
  **Bloqueado**: falta pré-requisito externo; **Não executado**: roteiro ainda sem evidência.
- Saída: nenhum defeito crítico conhecido; pendências externas explicitadas, nunca contadas como aprovação.

## Roteiro por épico

| ID | Jornada e passos | Resultado esperado | Prioridade |
|---|---|---|---|
| UAT-01 | Clique no `+` da lista de agentes. | Exatamente um bot com nome sugerido; chat aberto; saudação e quatro opções; nenhum formulário nem turno pago antes de interagir. | P0 |
| UAT-02 | Escolha uma opção de missão e descreva uma tarefa em linguagem natural. | Opção vira mensagem uma vez; bot responde; propõe perfil; nome é mantido; confirmar aplica nome/título/descrição. | P0 |
| UAT-03 | Abra Nova conversa, busque o nome do novo bot e abra-o. | Busca filtra destinatários; chat correto e histórico preservado; ações de criar bot/grupo acessíveis. | P1 |
| UAT-04 | Recarregue a página e reabra o bot. | Nome, perfil confirmado e histórico persistem; onboarding não reaparece após a primeira mensagem. | P0 |
| UAT-05 | Envie uma mensagem; enquanto o bot responde, digite um rascunho sem enviar. | Streaming/atualizações não apagam nem alteram o rascunho; uma única resposta final. | P1 |
| UAT-06 | Localize uma consulta a um colega (ou peça uma nova); expanda a linha de colaboração. | Contagem discreta, colega correto, pedido e resposta acessíveis; conclusão normal permanece no chat. | P0 |
| UAT-07 | Peça consulta a dois colegas na mesma solicitação. | Uma linha com contagem total e dois bots; lista permite abrir cada troca; nenhuma contribuição perdida. | P0 |
| UAT-08 | Pelo menu crie grupo com dois bots e envie uma pergunta dirigida por @Nome. | Sala correta, participantes persistidos, resposta na sala; DM dos participantes não recebe cópia indevida. | P1 |
| UAT-09 | Abra Marketplace; busque Slack e depois texto sem correspondência; limpe a busca. | Apps filtrados corretamente; ausência de resultado compreensível; catálogo completo retorna. | P1 |
| UAT-10 | Com Composio não configurado, clique em Conectar no Slack. | Instrução clara para configurar; campo da chave visível/focado; nenhum falso “conectado”. | P0 |
| UAT-11 | Peça no chat ajuda para preparar mensagem no Slack, sem enviar; clique no card de conexão e volte. | Bot sugere card contextual; Marketplace destaca Slack; retorno preserva o chat e a intenção. | P0 |
| UAT-12 | Recuse o card com Agora não. | Card pendente desaparece; nenhuma conexão ou concessão é criada. | P1 |
| UAT-13 | Cadastre MCP de exemplo no ambiente isolado; sonde, conceda leitura, execute; revogue e tente novamente. | Catálogo real, resultado real de ferramenta local; efeito proibido sem aprovação; revogação bloqueia nova execução; segredos não aparecem na listagem. | P0 |
| UAT-14 | Configure chave Composio, faça login em um app, verifique, retome o pedido e conceda somente leitura. | Conta correta conectada; chave invisível em respostas; leitura real funciona; nenhuma ação de escrita concedida implicitamente. | P0 |
| UAT-15 | Peça “lembre aqui no chat a cada 5 minutos”; confirme a proposta. | Proposta legível; confirmação sem erro; rotina ativa com próxima janela válida e fuso explícito. | P0 |
| UAT-16 | Pela interface escolha 5 minutos e depois dias úteis; cancele. | Horário fixo fica oculto/desabilitado no intervalo e retorna obrigatório em dias úteis; cancelar não agenda nada. | P1 |
| UAT-17 | Crie rotina pela interface, pause e clique Testar agora; consulte histórico. | Uma entrega no chat e histórico executou; rotina continua pausada e agenda não muda. | P0 |
| UAT-18 | Deixe rotina de 5 minutos atravessar uma janela; confira entrega e pause. | Uma entrega automática, próxima janela avançada; pausa impede disparos seguintes. | P0 |
| UAT-19 | Troque de pessoa no ambiente isolado e tente ler credenciais/conexões privadas. | Acesso negado/nenhum dado alheio; chave cifrada não retornada nem em listagem. | P0 |

## Execução e evidências

Execução em 17/09/2026, entre 14:06 e 14:27 (America/Sao_Paulo), pelo navegador do Codex.
API com Claude Code real; MCP/isolamento no banco `nod_test` e servidor de teste.
Resultado: **18 aprovados (16 pela interface, 2 automatizados) e 1 bloqueado**.
O UAT-06 reabre um histórico existente; não contabiliza a consulta original como nova execução.
O UAT-07 executou uma nova consulta real aos dois colegas nesta rodada.

| ID | Resultado | Evidência observada |
|---|---|---|
| UAT-01 | Aprovado após correção | Chico criado às 14:06 com quatro opções; reteste com Cecília às 14:21 mostrou nome também no composer e “nunca executou”. |
| UAT-02 | Aprovado | Opção A gerou uma mensagem; missão de teste proposta e confirmada; título “Agente de Teste UAT” e descrição persistidos. |
| UAT-03 | Aprovado após correção | Busca por Chico deixou somente esse contato no seletor; lista lateral intacta; abertura levou ao histórico correto. |
| UAT-04 | Aprovado | Recarregamento preservou perfil e mensagens de Chico, sem repetir as opções de onboarding. |
| UAT-05 | Aprovado | “RASCUNHO UAT: preservar enquanto o bot responde.” permaneceu idêntico durante e após a resposta/propostas das 14:07. |
| UAT-06 | Aprovado — histórico existente | Reaberta consulta Lume → Cora das 10:57: “2 mensagens com Cora”; expansão mostrou pedido, resposta e conclusão do Lume fora do agrupamento. |
| UAT-07 | Aprovado | Nova consulta Chico → Lume/Cora às 14:11; “4 mensagens com 2 bots”; ambos os pares pedido/resposta acessíveis; consolidação real às 14:12. |
| UAT-08 | Aprovado após correção | Sala “UAT 17-09 — Chico e Cora”; @Chico entregou UAT-SALA-OK às 14:15 apenas na sala. Participantes persistidos. Texto de liderança corrigido e retestado. |
| UAT-09 | Aprovado após correção | Slack isolado pela busca; texto inexistente exibiu orientação; limpar restaurou oito apps. |
| UAT-10 | Aprovado após correção | Clique em Conectar exibiu instrução para adicionar chave; árvore de acessibilidade confirmou foco no campo “Chave do projeto”; Slack não foi marcado conectado. |
| UAT-11 | Aprovado | Pedido sem envio externo gerou card Slack às 14:14; Marketplace abriu com Slack selecionado; retorno manteve conversa/intenção. |
| UAT-12 | Aprovado | “Agora não” removeu o card; mensagem confirmou que nada foi agendado ou concedido. |
| UAT-13 | Aprovado — automatizado | `uat:regressao`: servidor completo e processo MCP local real; catálogo, leitura e aprovação cobertos no e2e catcher; teste separado comprova que revogar antes do despacho remove a ferramenta do plano. |
| UAT-14 | Bloqueado | Falta chave do projeto Composio e login de uma conta externa. Contrato simulado passou, mas não aceita OAuth/leitura real. |
| UAT-15 | Aprovado | Pedido das 14:07 propôs `*/5 * * * *`; confirmação criou agenda UTC, próxima 17:10 UTC, sem erro. |
| UAT-16 | Aprovado | Intervalo de 5 minutos ocultou horário; dias úteis restaurou campo obrigatório; cancelar manteve cinco rotinas naquele momento. |
| UAT-17 | Aprovado | Rotina de interface por hora, pausada, executou manualmente UAT-INTERFACE-OK às 14:21; histórico “executou”; permaneceu pausada, próxima 15:00 America/Sao_Paulo inalterada. |
| UAT-18 | Aprovado | Uma entrega automática às 14:10 (17:10 UTC); próxima avançou para 17:15 UTC. Pausa às 14:11 impediu nova entrega na janela das 14:15, conferido após 14:16 e novamente às 14:25. |
| UAT-19 | Aprovado — automatizado | Teste RLS com duas pessoas: a outra não lê, altera ou publica a chave da dona. Segredo cifrado e ausência de concessão implícita verificados pelo contrato. |

Artefatos mantidos para inspeção: Chico (missão de teste), Cecília (onboarding sem execução), sala
“UAT 17-09 — Chico e Cora” e duas rotinas de Chico, **ambas pausadas**. Nenhuma mensagem foi enviada
a Slack/email; nenhuma credencial externa foi adicionada. Rotinas preexistentes não foram modificadas.

### Registro de defeitos encontrados

| Defeito | Reprodução | Correção e reteste |
|---|---|---|
| UAT-D01 | Bot recém-criado mostrava placeholder “o bot” mesmo após o nome carregar. | Atualização apenas do atributo placeholder, preservando valor/foco; reteste incluído no UAT-01. |
| UAT-D02 | Buscar Chico continuava mostrando todos os contatos. `display:flex` sobrepunha `hidden`; atualizações também reaplicavam o filtro lateral sobre o seletor. | Regra global `[hidden]`, filtros com escopos separados e busca preservada durante re-render. Reteste: apenas Chico no seletor; lista lateral intacta. |
| UAT-D03 | Busca sem correspondência deixava o catálogo sem explicação. | Mensagem de nenhum resultado com orientação; limpar busca restabelece oito apps. |
| UAT-D04 | Conectar sem chave focava um input que era substituído ao mostrar o aviso. | Foco aplicado após renderizar o aviso de configuração; reteste incluído no UAT-10. |
| UAT-D05 | Nova sala dizia que o primeiro marcado liderava, mas o formulário usa a ordem da lista. | Orientação passou a dizer “entre os selecionados, o primeiro da lista lidera”; reteste visual confirmou o texto. |

Observação de qualidade do modelo: no teste de colaboração, Chico antecipou uma sugestão própria
antes da chegada dos colegas, deixando explícito que ainda não tinham respondido. Depois recebeu
Lume e Cora e fez a consolidação real. A contagem e as contribuições estão corretas; a concisão
dessa espera continua sendo um ponto de melhoria, sem atribuir a hipótese a uma resposta recebida.

### Apoio automatizado reproduzível

`npm run uat:regressao` executa 16 testes: 13 jornadas com servidor completo/catcher e MCP local,
um teste de revogação entre enfileiramento e despacho, mais dois testes de contrato Composio e
isolamento das credenciais. A seleção inicial de 15 testes passou às 14:06–14:07; o teste de
revogação foi incluído para tornar o UAT-13 reproduzível pelo mesmo comando. O provedor Composio é simulado nesses dois testes; o banco/RLS e o servidor são reais.

Para repetir: preparar `.env` e os bancos conforme o README, usar Node 24.19.0 e executar
`npm run uat:regressao`. Para as jornadas de linguagem natural, abrir a interface com Claude Code
conectado e seguir a tabela. Repetir UAT-14 somente depois de configurar Composio e autenticar uma
conta de teste; limitar o aceite a leitura. Ao terminar, pausar as rotinas criadas.

A primeira tentativa de `npm run check` no worktree usou Node 22.14.0 e falhou ao iniciar proxies
TypeScript. Esse resultado não é uma regressão do produto: a repetição usa explicitamente o binário
Node 24.19.0, incluindo subprocessos. A execução anterior, durante uma troca de checkout, também
foi desconsiderada. A validação final foi feita no worktree estável `/tmp/nod-uat`.

Validação final com Node 24.19.0: `npm run check` passou em 159 arquivos, **652 testes**
(354 unitários, 208 integração, 49 conformidade e 41 concorrência), além de lint, tipagem e
cerca de domínio. `npm run build` também passou.

`npm run uat:regressao` foi repetido com a seleção final às 14:29–14:30: **16 testes passaram**
(14 de concorrência/servidor completo e 2 de integração).
