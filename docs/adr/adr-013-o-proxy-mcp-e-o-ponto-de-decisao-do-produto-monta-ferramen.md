# ADR-013 — O proxy MCP é o ponto de decisão do produto: monta ferramentas, classifica negação, corta contexto e constrói a aprovação tipada

**Frente** Execução · **Status** decidido · **Épicos** E2, E4, E5, E6, E10, E11, E12

## Decisão

Todo servidor MCP roda no servidor, com a credencial injetada lá e nunca visível ao agente, e o proxy fica ENTRE os dois processos. Ele carrega quatro responsabilidades: (1) montar as ferramentas do turno como catálogo do tenant ∩ allowlist do agente ∩ ALCANCE CALCULADO do canal, reverificado na BORDA DO DESPACHO e não no enfileiramento; (2) classificar cada negação em TERMINAL (teto de canal, capacidade desligada — encerra o turno, nenhuma outra ferramenta é chamada) ou TRANSITÓRIA (erro devolvido ao modelo, que segue); (3) cortar resultado de ferramenta acima do orçamento ANTES de entrar no contexto; (4) construir a aprovação tipada item a item, porque é onde a procedência do dado é conhecida. Nomes reservados pelo sistema são recusados na escrita, não filtrados na montagem.

## Contexto

E5.1 é P0 e exige as duas classes de negação com comportamentos OPOSTOS. E6.4 exige alcance derivado dos membros e reverificado na borda de cada chamada. E2.5 exige teto de contexto por resultado de ferramenta. E4.1 exige item tipado como entidade de primeira classe. Todas as quatro se encontram no mesmo lugar.

## Alternativas rejeitadas

### Aprovação tipada e classificação de negação como CAPABILITY do motor, com degradação

Transforma duas garantias incondicionais em propriedades opcionais. E4.1 diz que a resposta aprovável É uma lista de itens tipados — não 'quando o motor suporta'. E4.2 exige classificação POR ORIGEM, que é conhecimento do servidor. E5.1 exige que a terminal encerre o turno, o que é o harness cortando, não o motor cooperando. E E10.4 fecha a porta: 'Nenhuma decisão sobre ferramenta ou aprovação é tomada por comparação com nome de motor'.

### Cada agente declara seus próprios servidores MCP livremente

Quebra o isolamento por tenant: o agente escolhe com que credencial fala e para onde os dados de aprendiz vão — exfiltração com cara de configuração. O OpenMausBot fecha pelo nome: mcp-registry.ts:28 isHarnessOwnedMcpEnvName bloqueia OMB_/OGB_/ELECTRON_RUN_AS_NODE, porque um servidor custom com um desses nomes 'could redirect a built-in proxy or receive that proxy's bearer' (mcp-registry.ts:23-26).

### Filtrar ferramentas apenas no prompt

É instrução, não controle. O padrão certo é o do OpenMausBot: prompt e execução saem da MESMA função (index.ts:1608 e index.ts:5338/7047 chamam customMcpServers(cfg, bot.mcpServers)), de modo que o agente nunca é informado de uma ferramenta que não tem — que é a falha que E5.1 manda distinguir.

### 'Política do canal' como lista de ferramentas configurada

E6.4 exige mais forte: alcance derivado da composição VIVA do canal, com o aceite 'Dado que um membro que ampliava o alcance saiu do canal, quando o alcance é recalculado, então ele não contribui mais'. Lista configurada não recalcula. E com a fila durável (ADR-010), um turno enfileirado pode despachar depois de o agente perder alcance — por isso a reverificação é na borda do despacho.

## Evidência

O padrão de interseção existe: config.ts:1050 customMcpServers(cfg, only) cruza catálogo com lista do bot, config.ts:1054 'if (only && !only.includes(name)) continue', e a semântica está documentada em store.ts:724-727: 'Absent = every enabled server... an empty list = none'. A defesa decisiva para o nod é mcp-gate.ts:9-15: 'on every vendor-CLI engine the tool call and its result never pass through the harness at all. The CLI runs the server itself and appends the raw answer to the session it owns. Standing between the two processes is the only place the harness can see, or shrink, what a tool puts into the model's context.' Como o nod usa CLI de fornecedor (ADR-014), o proxy é o ÚNICO ponto onde a trilha de E8 vê a chamada de ferramenta e o único onde E2.5 pode cortar. Segunda defesa a copiar: mcp-bridge.ts:11-13, enquanto a pessoa tem o controle, 'a tools/call do agente é respondida com uma recusa aqui e nunca encaminhada' — mecanismo que E11.2 precisa. E o padrão de pedido de credencial é E6 quase pronto: shared/credential-request.ts:1-5 'The id is the entire authority surface: agents never choose a config path, label, URL, or arbitrary field name', com alvos fixos e teste provando que __proto__ é recusado.

## Consequências

- 'Que ferramentas esse agente tinha às 14h32' vira consulta às três entradas, não arqueologia — que é o que E8 precisa e o que a LGPD cobra num incidente.
- A função de montagem é a MESMA para prompt e execução, senão o agente é informado de ferramenta que não tem e inventa que tentou.
- E2.4 exige que capacidades do conector sejam ligáveis UMA A UMA, todas começando desligadas, com o complemento enumerado por escrito ('exatamente o que o agente não poderá fazer'), e capacidade desligada gerando negação TERMINAL. O proxy é quem aplica.
- O proxy é caminho crítico: se cair, todo agente perde todas as ferramentas ao mesmo tempo. Precisa do watchdog de transporte morto que mcp-bridge.ts:32 já modela (BRIDGE_INACTIVITY_MS).
- A identidade de execução é o PAR agente×canal e isso DEPENDE do spike E2.1 — este ADR declara a dependência em vez de antecipar o desenho.
- A dimensão de canal não tem implementação de referência em nenhum dos dois repos (o mais próximo é 'peers' em store.ts:707-715, que limita quem o bot CONTATA, não que ferramentas tem). Precisa de teste próprio.

## Reversibilidade

média para a função de montagem (isolada e trocável), cara para a FORMA da política, que vaza para o banco e para a tela de configuração. A convenção ausente-significa-tudo é a parte cara: uma vez que 70 clientes tenham agentes sem lista explícita contando com 'tudo', inverter para 'ausente significa nada' exige escrever a lista de cada agente antes de virar a chave, sob pena de todos pararem juntos.

## Revisitar quando

Quando a política de canal precisar de condição além de nome de ferramenta (horário, tipo do dado tocado, quem está na sala). Aí a interseção de listas acabou e o que se quer é regra avaliada — hora de decidir conscientemente, não de empilhar mais um if.

