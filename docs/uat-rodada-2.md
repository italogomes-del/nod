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
| UAT-06 | Peça consulta a um colega; expanda a linha de colaboração. | Contagem discreta, colega correto, pedido e resposta acessíveis; conclusão normal permanece no chat. | P0 |
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

Resultados desta rodada serão registrados abaixo conforme execução. Evidência anterior não conta como
nova execução: o disparo real da Nina às 13:00 foi validado na implementação e está documentado em
`primeira-versao.md`; será citado separadamente quando útil.

### Registro de defeitos encontrados

| Defeito | Reprodução | Correção e reteste |
|---|---|---|
| UAT-D01 | Bot recém-criado mostrava placeholder “o bot” mesmo após o nome carregar. | Atualização apenas do atributo placeholder, preservando valor/foco; reteste incluído no UAT-01. |
| UAT-D02 | Buscar Chico continuava mostrando todos os contatos. `display:flex` sobrepunha `hidden`; atualizações também reaplicavam o filtro lateral sobre o seletor. | Regra global `[hidden]`, filtros com escopos separados e busca preservada durante re-render. Reteste: apenas Chico no seletor; lista lateral intacta. |
| UAT-D03 | Busca sem correspondência deixava o catálogo sem explicação. | Mensagem de nenhum resultado com orientação; limpar busca restabelece oito apps. |
| UAT-D04 | Conectar sem chave focava um input que era substituído ao mostrar o aviso. | Foco aplicado após renderizar o aviso de configuração; reteste incluído no UAT-10. |

Observação de qualidade do modelo: no teste de colaboração, Chico antecipou uma sugestão própria
antes da chegada dos colegas, deixando explícito que ainda não tinham respondido. Depois recebeu
Lume e Cora e fez a consolidação real. A contagem e as contribuições estão corretas; a concisão
dessa espera continua sendo um ponto de melhoria, sem atribuir a hipótese a uma resposta recebida.

### Apoio automatizado reproduzível

`npm run uat:regressao` executa 15 testes: 13 jornadas com servidor completo/catcher e MCP local,
mais dois testes de contrato Composio e isolamento das credenciais. Em 17/09, 14:06–14:07, todos
passaram. O provedor Composio é simulado nesses dois testes; o banco/RLS e o servidor são reais.
