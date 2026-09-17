# Execução UAT — Composio, rotinas e cooperação — 17/09/2026

Ambiente real: Nod em 5274/8888, worktree `/private/tmp/nod-uat`, Claude Haiku pelo executor local e apps via Composio. Datas abaixo em America/Sao_Paulo. Nenhum email/mensagem externo enviado e nenhuma tarefa/evento criado nesta etapa.

## Resultados observados

| Teste executado | Resultado | Evidência e limite |
|---|---|---|
| Recuperação do ambiente | Aprovado | API e web restabelecidas nas portas previstas; login de desenvolvimento existente; executor real pronto |
| Conexão Calendar | Aprovado na descoberta | Verificação Composio concluída, 47 ferramentas disponíveis |
| Conexão ClickUp | Aprovado na descoberta | Verificação Composio concluída, 162 ferramentas disponíveis |
| Gmail: leitura pelo agente | Consulta executada | Turno `babaa1b8-c526-4f80-b4b4-61a0df6df5b2`: GET_PROFILE + FETCH_EMAILS; resposta sanitizada do agente |
| Slack: leitura pelo agente | Consulta executada | Turno `23d46cf7-0bdf-4ac1-a680-ef3f8a93236d`: WHO_AM_I + SEARCH_MESSAGES |
| Calendar: leitura pelo agente | Consulta executada | Turno `ab2f6173-272f-4e32-a813-84891b577d6a`: GET_CURRENT_USER + LIST_CALENDARS + EVENTS_LIST |
| ClickUp: navegação pelo agente | Consulta executada | Turno `a56ba7bc-16a1-456a-a47e-92b40a486d9f`: identidade, workspaces, espaços e pastas/listas; não equivale a tarefa criada |
| Gmail: Testar agora | Aprovado quanto ao disparo/leitura | Turno de rotina `04d814cd-35db-44b5-b6f0-b8afdedbef7a`: FETCH_EMAILS real |
| Gmail: disparo automático 15:55 | Aprovado quanto ao disparo/leitura | Turno `c1e14a4d-e94c-41b1-80c9-71c4cce20fbd`: origem rotina e FETCH_EMAILS; não houve delegação nesta rodada |
| Cooperação em conversa — CO01 | Aprovado para consulta de um salto | Origem `a51dbba1-ba68-4211-8285-032e5be94b77`: Gmail + perguntar_a_bot; especialista `128025ac-6c45-4b5f-a9b7-f527ab0bfe83`: identidade ClickUp; continuação `1a8ec3a5-caf5-48ff-b2e6-cbc2dea8d11d`: retorno à origem. Resposta exata UAT-COOP-OK conferida no especialista e no peer_ask, sem confundir com o texto do pedido |
| Slack: rotina manual pausada | Aprovado para leitura manual | Turno `a4ecb0ca-fc48-49c5-84fb-d42ea6fbbb4a`: SEARCH_MESSAGES; marcador sanitizado de sucesso na resposta própria, sem erro reportado; rotina pausada |
| Calendar: rotina manual pausada | Aprovado para leitura manual | Turno `f9f212e3-7aad-4305-9444-bfa61650c964`: EVENTS_LIST; marcador sanitizado de sucesso na resposta própria, sem erro reportado; rotina pausada |
| Cooperação iniciada por agendamento às 16:05 | Aprovado para leitura e consulta a colega | Origem rotina `89ad12d7-6bb8-4729-a82c-c1fb882e3084`: FETCH_EMAILS + perguntar_a_bot; especialista `b06d35ba-3e82-4307-ac27-c1835bc27591`: GET_AUTHORIZED_USER; continuação `127d5ecc-4a4a-4e61-9a55-75dcfb4436eb`: retorno. Marcador exato UAT-COOP-OK conferido no retorno ligado à tarefa. A missão permanente define a consulta ao colega; a rotina só solicita a leitura da amostra |
| Criação autônoma de duas tarefas | Bloqueado nesta etapa | Falta selecionar lista de teste e conceder escrita; além disso o produto ainda restringe escrita em turno peer. Não foi contornado esse controle |

As chamadas da trilha comprovam tentativa real de ferramenta; retornos/objetos devem ser conferidos para aprovar o resultado semântico completo. Não se aprovam os casos completos de menções, homônimos, filtragem, paginação, deduplicação ou correlação entre fontes somente por essas consultas de fumaça. Os casos dos roteiros que não aparecem acima permanecem não executados ou dependentes de dados controlados.

## Correções realizadas e testes

- Agente acordado por rotina recebe perguntar_a_bot; destinatário e continuação continuam sem novo salto.
- Prompt distingue executar a consulta agora de anunciar a ativação de uma rotina; exige consulta real para afirmações sobre fontes.
- Sessões CLI novas para rotina/peer, com histórico explícito; sessão interativa preservada. A causa comportamental original não foi isolada somente por essa mudança.
- Escrita externa continua filtrada no conteúdo não confiável; permissões de um agente não são transferidas ao outro.
- Lint e typecheck passaram. 360 testes unitários passaram. Integração dirigida de catálogo/proxy/sessão/fila passou, incluindo regressões novas. 13 jornadas de servidor completo com catcher passaram; estas não aprovam OAuth ou efeito externo real.

Decisão técnica em [ADR-035](adr/adr-035-agendamentos-acordam-agentes.md).

## Autorizações e dados

A pessoa autorizou explicitamente os quatro agentes UAT com leituras: Gmail (3 operações), ClickUp (8), Calendar (3), Slack (2). Uma tentativa anterior de executar esse provisionamento foi bloqueada pela revisão automática; só foi executado após consentimento. Os scripts de auditoria emitem somente estados, IDs, nomes de ferramentas, contagens e marcadores sintéticos, sem despejar conteúdo privado.

A pergunta pela lista ClickUp de teste está pendente. Não há autorização de escrita aplicada ao Gestor ClickUp nesta etapa.

## Estado ao encerrar esta etapa

As quatro rotinas criadas no UAT foram verificadas como pausadas pela API, e não há turno pendente no Triador. Os quatro agentes e seus acessos de leitura autorizados permanecem disponíveis. API/web seguem ligadas. O controle agendado usa amostra fixa e marcador sintético: não comprova classificação de dois emails acionáveis, deduplicação de demandas ou criação de tarefas. A autorização de escrita com destino restrito e a execução delegada de efeitos continuam pendentes de implementação/aceite.
