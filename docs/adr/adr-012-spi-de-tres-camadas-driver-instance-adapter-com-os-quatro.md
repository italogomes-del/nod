# ADR-012 — SPI de três camadas Driver / Instance / Adapter, com os quatro sinais de aceitação obrigatórios no contrato

**Frente** Execução · **Status** decidido · **Épicos** E10, E1, E2, E5, E9

## Decisão

Driver é fábrica estática (decodeConfig, defaultConfig, create), Instance é conta viva com credencial e catálogo de modelos, Adapter é o runtime de conversa (sendTurn, interruptTurn, respondToRequest, onEvent). Falha ao criar instância vira snapshot 'indisponível' no CATÁLOGO, nunca falha de boot — mas escolha SALVA apontando para provedor indisponível NÃO é trocada silenciosamente: manda a pessoa ao setup. CORREÇÃO AO CONTRATO ORIGINAL: o Adapter é OBRIGADO a reportar os quatro sinais de aceitação por turno, para que a classificação do E9 seja do harness e não de cada driver. Enquanto contracts/ não estiver estável, é trabalho de UMA pessoa.

## Contexto

E10.1 é P0 e exige as três camadas; E10.3 exige chave por tenant com ambiente do executor vazio; E10.5 exige que a escolha salva não seja trocada em silêncio. As três camadas modelam 'a Leapy tem uma assinatura e três chaves, e cada cliente pode ter a sua' sem gambiarra.

## Alternativas rejeitadas

### Duas camadas (Driver + Adapter) com credencial como parâmetro de cada turno

Quebra o isolamento de E2. O comentário do SPI é explícito: 'create é dono de TODO o estado por instância; duas chamadas de create não compartilham nada' (server/contracts.ts). Com credencial por turno, processos e sockets de broker de dois tenants compartilham as mesmas estruturas, e vazamento entre clientes deixa de ser bug e vira consequência de desenho.

### Uma camada: sendTurn(motor, credencial, texto)

Não tem onde pendurar o catálogo de modelos por tenant, o fluxo de autenticação, o snapshot de saúde nem o dispose. As três camadas seriam reinventadas em seis meses com nomes piores.

### Contrato com Effect/streams como o upstream original

O próprio OpenMausBot desistiu e registrou: 'de-Effect-ado: Promises em vez de Effect, callbacks de listener em vez de Stream' (contracts.ts, cabeçalho). Para 2-3 engenheiros, Promise + callback é o que se depura às duas da manhã.

### Degradação suave uniforme (sombra indisponível para tudo, inclusive escolha salva)

E10.5 decide o oposto no caso específico: 'uma escolha salva que aponta para provedor indisponível NÃO é trocada silenciosamente: manda a pessoa ao setup, porque uma escolha salva é intencional'. Sombra para o CATÁLOGO, interrupção visível para a ESCOLHA.

## Evidência

server/contracts.ts (526 linhas) é o arquivo inteiro. A degradação está em server/harness/registry.ts, load(): driver desconhecido ou decodeConfig que lança viram ShadowInstance com reason, e o comentário manda não remover porque 'esse comportamento é o que torna as configurações compatíveis para frente e para trás'. RESSALVA HONESTA: só o driver Claude tem retomada de sessão (grep por classifyResumeFailure no servidor todo retorna apenas claude.ts); o contrato NÃO obriga um driver a informar o estado de aceitação. É lacuna do contrato original, não escolha dele. MEDIDA DE CENTRALIDADE: contracts.ts é tocado por 83 arquivos entre server/, src/ e shared/ — com 2-3 engenheiros é o ponto onde todo trabalho paralelo colide.

## Consequências

- O evento de runtime já traz o que E4, E5 e E8 precisam, e não é coincidência: turn.completed carrega 'denials?: string[]' (contracts.ts:114 — literalmente o que foi NEGADO de E8.4) e request.resolved carrega 'source: user | auto | timeout | system | unavailable | peer' (contracts.ts:174 — quem decidiu). Copiar os dois campos com os mesmos nomes, literalmente.
- Adicionar um motor vira 'um arquivo em drivers/ mais um registro' — para 2-3 engenheiros é a diferença entre suportar dois motores e suportar cinco.
- dispose() por instância significa que trocar a chave de um cliente derruba só os processos dele; sem isso, girar credencial é manutenção com janela.
- AUTORIA COMPOSTA entra aqui e nenhuma frente a modelou: o evento precisa carregar quem escreveu quando um agente publica sob procuração de uma pessoa (E11.2, E6). O 'source' do request não é autoria da mensagem. O documento de épicos marcou isso como obrigatório na primeira migração porque retrofitar 'reescreve toda renderização de mensagem e toda regra que pergunta foi uma pessoa?'.

## Reversibilidade

irreversível na prática. Todo driver, toda a UI e toda a trilha passam a falar esse vocabulário de eventos, e mudar a forma do RuntimeEvent depois de ter eventos gravados significa migrar a trilha — que é o artefato que o produto vende. Vale gastar mais tempo AGORA nos nomes dos campos de evento do que em qualquer outra coisa.

## Revisitar quando

Quando o segundo driver de verdade precisar de um campo que o RuntimeEvent não tem. O teste: é campo genérico (evento base) ou específico do motor (raw.payload)? O campo 'raw' existe para adiar essa decisão sem sujar o contrato.

