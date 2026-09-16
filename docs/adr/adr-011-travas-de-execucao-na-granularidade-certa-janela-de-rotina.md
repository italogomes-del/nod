# ADR-011 — Travas de execução na granularidade certa: janela de rotina única e expiração idempotente

**Frente** Execução · **Status** decidido · **Épicos** E7, E3, E9, E8

## Decisão

Reivindicação de janela de rotina como tabela própria com UNIQUE (tenant_id, rotina_id, instante_agendado), onde o instante é derivado deterministicamente do cron mais o fuso IANA — dois processos avaliando a mesma janela chegam ao MESMO valor e só um registra. Toda rotina carrega fuso IANA nomeado e a persistência RECUSA offset numérico; tudo é expresso como cron, inclusive 'todo dia às 8h'. O varredor de expiração é idempotente por constraint única sobre (decisao_id, tipo_de_evento), não por convenção, e processa vencimentos atrasados sem duplicar.

## Contexto

E7.6 é aceite escrito, não preocupação futura: 'Dado um rolling restart com dois containers sobrepostos, quando a rotina das 8h dispara, então existe exatamente UM registro de execução para aquela janela'. E7.2 exige fuso IANA com recusa de offset numérico. E o varredor escreve numa trilha imutável onde linha duplicada NÃO PODE ser apagada.

## Alternativas rejeitadas

### Confiar que um container só resolve (a trava por conversa basta)

A colisão de rotina é por (organização, rotina, instante), não por conversa — a trava de turno não a cobre. E mesmo com recreate no deploy (ADR-001), ter a constraint certa agora custa uma migração e permite rolling depois sem mudar o modelo. Sem ela, o primeiro rolling deploy dispara a rotina das 8h duas vezes.

### Igualdade de instante em vez de janela

Dois processos calculam 'agora' em milissegundos diferentes e produzem chaves diferentes. O Buzz resolveu com a âncora determinística e o comentário explica: 'o instante retornado é o horário agendado do próprio cron, não o agora, então todo pod avaliando a mesma expressão na mesma janela calcula o mesmo valor, tornando-o uma âncora determinística segura para disparo no máximo uma vez entre pods'.

### Tipos 'diário' e 'intervalo' além de cron

ARMADILHA CONFIRMADA na verificação de origem de E7.2: só o tipo 'cron' carrega fuso; 'diário' e 'intervalo' usam o fuso do servidor. Ou seja, 'todo dia às 8h' expresso como diário dispararia no fuso do container. Padronizar tudo em cron com fuso obrigatório, ciente de que isso herda o caminho de código menos exercitado no catch-up.

### Idempotência do varredor por lógica de aplicação ('checo antes de escrever')

É a condição de corrida clássica, e a consequência aqui é permanente: numa trilha imutável por trigger (ADR-004), a linha duplicada não sai. Sob LGPD isso é dado inexato retido indefinidamente, que é infração distinta e mais difícil de defender que um bug.

## Evidência

E7.6 e E7.2 são aceites literais dos épicos. A âncora determinística por janela está verificada no Buzz e a nota de honestidade do próprio épico registra que 'o desenho foi confirmado, a implementação da reivindicação no banco não foi aberta'. E3.2 confirma que o varredor é do zero: 'a tabela tem a coluna de prazo e o enum tem o valor expirado, mas NÃO EXISTE VARREDOR — a expiração só é checada preguiçosamente quando alguém tenta aprovar, então um pendente que ninguém abre fica pendente para sempre'.

## Consequências

- A precisão da expiração é a granularidade do job. Com filtro de leitura que já mostra o estado correto (ADR-007), o job cuida de materializar o evento e a notificação, não de esconder o item.
- Todo timestamp que sai do servidor é UTC com offset explícito. O Brasil tem fuso único hoje, mas o formato ingênuo é a fonte clássica de bug de prazo — e aqui prazo é o produto.
- E7.6 exige também que uma execução em curso não seja sobreposta pela janela seguinte, e que o fato seja registrado. É estado na mesma tabela de reivindicação.
- A idempotência por constraint é o que torna o job seguro mesmo com sobreposição de containers, o que por sua vez torna rolling deploy uma configuração e não uma reescrita.
- LACUNA QUE NENHUMA FRENTE COBRIU E QUE PRECISA DE DECISÃO DE PRODUTO: o que acontece com o relógio de decisão durante indisponibilidade da plataforma. Ficar 2h fora não só interrompe o serviço — expira decisões, e a trilha imutável registra 'ninguém decidiu' por culpa nossa. Precisa de suspensão de relógio registrada como fato.

## Reversibilidade

barata para adicionar as constraints hoje (são duas UNIQUE), cara depois: exige limpar as execuções duplicadas já registradas, e numa trilha imutável 'limpar' não é DELETE.

## Revisitar quando

Quando a granularidade de expiração precisar ficar abaixo de 30s, ou quando o catch-up de rotinas atrasadas começar a produzir rajadas — aí a conversa é sobre o que fazer com janelas perdidas, não sobre a trava.

## Revisão — investigação do monorepo da Leapy

**O que muda.** Registrar que a estratégia de testes do nod tem TRÊS modos, não dois: unitário puro, integração-sob-rollback (a esmagadora maioria) e concorrência-com-duas-conexões (poucos arquivos, com limpeza própria). Trava de reivindicação só se prova com duas transações simultâneas disputando a mesma linha, e o withRollback tem um envelope só.

**Motivo.** É limite da técnica, não defeito, e precisa ser escrito para ninguém tentar espremer o teste do ADR-011 dentro do rollback e concluir erradamente que a trava funciona. A Leapy tem o precedente do modo correto em update-vaga-empresa-notice.test.ts, que abre duas transações de verdade e usa `SET LOCAL lock_timeout = '250ms'` para provar o bloqueio. Junto vem o aviso medido de nunca apertar o `max` do pool, que enfileira transações concorrentes e deixa esses testes verdes provando nada.

Ver [o que o nod herda da Leapy](../inherited-from-leapy.md).
