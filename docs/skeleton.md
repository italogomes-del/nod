# Esqueleto

O que commitar antes de escrever lógica. Derivado dos [ADRs](adr/), principalmente o [ADR-018](adr/adr-018-core-puro-guardado-pelo-compilador-pacote-unico-esqueleto.md).

## Árvore

```
nod/
├── package.json                 # UM pacote. Sem workspaces (ADR-018).
├── tsconfig.base.json           # strict, target moderno, paths
├── tsconfig.core.json           # types: [] e lib sem DOM — o COMPILADOR guarda o core
├── tsconfig.server.json         # include: core, db, http, drivers, agent, contracts
├── tsconfig.web.json            # include: web, contracts (só type)
├── eslint.config.js             # fronteiras que o compilador não cobre (db/ ↛ http/)
├── Dockerfile                   # CLI pinado por versão EXATA. SEM as libs do Chrome.
├── Dockerfile.browser           # imagem separada para E11 (~30 libs Chrome)
├── .github/workflows/ci.yml     # tipos, lint, unit, conformidade de RLS, fumaça do CLI
│
├── contracts/                   # O ARTEFATO MAIS CARO. Uma pessoa só até estabilizar.
│   ├── evento.ts                # RuntimeEvent: denials[], source, AUTORIA COMPOSTA
│   ├── decisao.ts               # DecisaoId = { tenantId, id } — o par, sempre
│   ├── item-aprovacao.ts        # item tipado: estado, origem, autoria da marcação
│   ├── turno.ts                 # os 4 sinais de aceitação como campos obrigatórios
│   └── frame.ts                 # frame SSE com tenantId no envelope
│
├── core/                        # ZERO I/O. Recebe `now` como parâmetro. Testável sem nada.
│   ├── dado-pessoal.ts          # classifica por ORIGEM. Default: TOCA. (ADR-002)
│   ├── aprovacao-item.ts        # monta itens; origem sensível nasce desmarcada
│   ├── parada-alcada.ts         # negação TERMINAL vs TRANSITÓRIA (E5.1)
│   ├── retomada-turno.ts        # classifyResumeFailure + mayReplay (E9.1)
│   ├── fila-frota.ts            # ordenação, agrupamento por empresa, estado do item
│   ├── relogio.ts               # os DOIS relógios: decisão (parede) e execução (trabalho)
│   ├── rotina-janela.ts         # instante canônico do cron + fuso IANA (E7.2/E7.6)
│   ├── canal-responde.ts        # política de 3 valores; menção sempre vence (E12.1)
│   ├── canal-orcamento.ts       # 4 regras + quebra-anel; rotina isenta (E12.3)
│   ├── montagem-ferramentas.ts  # catálogo ∩ agente ∩ alcance do canal (E6.4/E12.4)
│   ├── ambiente-executor.ts     # allowlist nomeada; parte de {} (E10.3)
│   └── redacao.ts               # texto de recusa que encerra, nunca convida
│
├── db/                          # Postgres. Único helper de transação com SET LOCAL.
│   ├── tx.ts                    # abre transação + SET LOCAL nod.tenant_id. ÚNICO caminho.
│   ├── migrations/
│   │   ├── 0001_fundacao.sql    # RLS, partições 24m, trilha+trigger+CHECK, busca
│   │   └── _make_tenant_table.sql # coluna + ENABLE + FORCE + policy, num script só
│   ├── conformidade.test.ts     # pg_policies, pg_constraint, pg_proc (A-RLS-1..5)
│   ├── rebuild-busca.sql        # lê expressão do catálogo, dropa, recria (ANTES de precisar)
│   └── repos/                   # uma função por consulta, predicado explícito sempre
│
├── http/                        # rotas, SSE, snapshot REST
│   ├── sse.ts                   # buffer POR TENANT; entrega recebe tenant como argumento
│   ├── snapshot-frota.ts        # o endpoint de toda abertura fria
│   └── rotas/
│
├── agent/                       # execução de turno
│   ├── despacho.ts              # reivindica (tx curta) → roda FORA de tx → assenta
│   ├── mcp-proxy.ts             # O PONTO DE DECISÃO: monta, classifica, corta, aprova
│   ├── varredor-expiracao.ts    # idempotente por constraint
│   └── scheduler-rotina.ts      # reivindicação única por (tenant, rotina, instante)
│
├── drivers/                     # SPI: um arquivo por motor + um registro
│   ├── spi.ts                   # Driver / Instance / Adapter
│   └── claude-cli.ts
│
└── web/                         # reducer puro + transporte encapsulado
    ├── estado/reducer.ts        # (estado, acao) → estado. Sem I/O, sem Date.now().
    └── lib/live-events.ts       # transporte atrás de interface de 4 campos + JITTER
```

## Disciplina

1. core/ não importa I/O, e quem garante isso é o COMPILADOR (tsconfig próprio sem @types/node e sem lib DOM), não uma regra de lint que se desliga com um comentário.
2. Toda decisão do produto é função pura que recebe `now` como parâmetro. Date.now() nunca aparece dentro do core — é o que torna a expiração da fila e a janela da rotina testáveis sem esperar tempo passar.
3. Nenhuma query pega conexão do pool fora do helper db/tx.ts, que faz SET LOCAL nod.tenant_id antes da primeira leitura. É a disciplina que substitui o lint frágil do Buzz.
4. O predicado tenant_id = $1 é escrito em toda query mesmo com RLS ligada. RLS é rede de segurança para o predicado esquecido, não substituto dele — e é o predicado que escolhe o plano.
5. Todo identificador que sai do servidor é o par (tenant_id, id), inclusive na URL. Nada resolve por id sozinho.
6. Estado negativo é escrito, nunca ausência. Item vencido aparece em cinza com desfecho; agente fora do ar aparece como linha com horário; rotina que não rodou aparece com a frase de que nada foi enviado. Nenhuma área em branco.
7. O default é sempre fechado: dado não classificado TOCA dado pessoal; tipo não listado NÃO entra no índice de busca; sinal ambíguo de turno é 'pode ter causado efeito'; capacidade não concedida é negação terminal.
8. A trilha aceita enum, uuid, timestamp e numérico — nunca texto livre, garantido por CHECK. A prosa mora em tabela irmã apagável.
9. Exclusão mútua é estado persistido com prazo absoluto, nunca lock de linha segurado pelo tempo do turno. Nenhuma operação prende conexão do pool por mais de alguns segundos.
10. Toda garantia do produto (aprovação tipada, classificação de negação, corte de contexto) mora no proxy MCP, no servidor. Nenhuma depende de o motor cooperar nem de o modelo obedecer a uma mensagem de erro.
11. Teste ao lado do arquivo. Arquivo de teste acima de ~600 linhas é sinal de que o módulo testado precisa ser quebrado — o valor não é o número, é forçar a conversa antes de virar index.ts.
12. Migração é SQL numerado e imutável, aplicado sob trava, com compatibilidade para frente e para trás em dois deploys — porque o rollback é um botão e o código antigo volta para o schema novo.

## As funções puras

Recebem `now` como parâmetro. Zero I/O. É o que torna a expiração da fila e a janela da rotina testáveis sem relógio.

- core/dado-pessoal.ts — recebe a procedência (conector, fonte, concessão) e decide se toca dado de aprendiz. Classifica por ORIGEM, nunca por texto. Conector que não declarou: TOCA. É a entrada de quase todas as outras.
- core/aprovacao-item.ts — recebe a proposta do agente e a classificação de origem, devolve N itens tipados com estado inicial. Decide quais nascem desmarcados e monta a justificativa. Nunca devolve um campo de texto único.
- core/parada-alcada.ts — recebe o motivo da negação e devolve TERMINAL (encerra o turno, nenhuma outra ferramenta é chamada) ou TRANSITÓRIA (o modelo recebe o erro e segue). É a decisão que distingue falta de alçada de falha técnica.
- core/retomada-turno.ts — recebe os quatro sinais (attempted, rejected, promptSubmitted, producedOutput) e o contador de reenvio, devolve 'before-accept' | 'after-accept' | 'unknown' e se pode reenviar. Nenhum caminho lê texto de erro; existe teste que falha se a string influenciar.
- core/fila-frota.ts — recebe as decisões visíveis à pessoa e `now`, devolve a fila agrupada por empresa com estado por item (pendente, vencido, reaberto) e a ordem. Decide o que aparece em cinza e o que aparece em âmbar. Nunca suprime item vencido.
- core/relogio.ts — decide, para cada tipo de prazo, se ele conta tempo de parede (relógio de DECISÃO, não pausa com humano olhando) ou trabalho (relógio de EXECUÇÃO, pausa em aprovação). É a função que impede o watchdog de turno de matar uma decisão pendente legítima.
- core/rotina-janela.ts — recebe expressão cron e fuso IANA, devolve o instante canônico da janela. Dois processos com a mesma entrada chegam ao mesmo valor: é a âncora determinística da reivindicação única. Recusa offset numérico.
- core/canal-responde.ts — recebe texto, membros e política de três valores, devolve quem responde. Menção explícita sempre vence. É função pura sobre texto, sem nenhuma entrada ou saída.
- core/canal-orcamento.ts — recebe o estado persistido do orçamento do canal e um post candidato, devolve permitir, recusar ou entrar em resfriamento. Quatro regras (duplicata, anel de três, ritmo, posts não respondidos desde a última fala humana). Post de rotina é isento.
- core/montagem-ferramentas.ts — recebe catálogo do tenant, allowlist do agente e alcance calculado do canal, devolve a lista de ferramentas do turno. Ausente significa 'tudo que o nível acima permite'; lista vazia significa nada. Retira a ferramenta de contatar agente quando a profundidade máxima foi atingida.
- core/ambiente-executor.ts — recebe (tenant, agente, canal) e devolve um Record montado a partir de objeto VAZIO, com nomes de uma allowlist fixa. Tem teste que coloca uma chave no ambiente do servidor e prova que ela não sai daqui.
- core/redacao.ts — recebe o motivo de uma recusa e devolve o texto em português, redigido para encerrar a tentativa e nunca para convidar nova tentativa. Catálogo de chaves, sem string literal na lógica.

## Primeiros commits

1. Esqueleto e travas: a árvore completa, os quatro tsconfig (com tsconfig.core.json sem @types/node e sem lib DOM), eslint com as fronteiras que o compilador não cobre, CI rodando tipos + lint + unit. Nenhuma lógica ainda. Prova que a trava do core funciona: um arquivo em core/ que tenta importar node:fs e não compila.
2. contracts/ — só os tipos, decididos por UMA pessoa e revisados por todos: RuntimeEvent com denials[] e source copiados literalmente de contracts.ts:114 e :174; autoria composta na forma da mensagem; DecisaoId como par { tenantId, id }; os quatro sinais de aceitação do turno como campos obrigatórios; item de aprovação com estado, origem e autoria da marcação. É o commit mais caro do repositório e o único que não deve ser feito com pressa.
3. Migração 0001, tudo junto e nada depois: _make_tenant_table com coluna + ENABLE + FORCE + policy restritiva; events particionada com 24 meses e SEM catch-all; trilha com trigger de imutabilidade e CHECK proibindo texto livre; tabela irmã de prosa; configuração de busca portuguese+unaccent como objeto de banco; índice GIN com escopo de tenant; UNIQUE de reivindicação de rotina; UNIQUE de idempotência de expiração; colunas dos quatro sinais e do contador de reenvio; todas as unique e FK incluindo tenant_id (A-RLS-5).
4. db/tx.ts e db/conformidade.test.ts: o único helper de transação, e o teste que percorre pg_class, pg_policies, pg_constraint e pg_proc provando que toda tabela com tenant_id tem policy restritiva, que nenhuma unique ou FK esqueceu tenant_id, e que não existe SECURITY DEFINER fora da lista vazia. Mais um teste que abre duas transações com tenants diferentes e prova que a consulta sem WHERE devolve só as linhas do tenant setado. Sem estes dois, o resto é fé.
5. db/rebuild-busca.sql: o procedimento genérico de rebuild da coluna gerada (ler a expressão do catálogo via pg_attrdef, dropar, recriar com format), escrito ANTES do primeiro uso. O Buzz só o escreveu na terceira vez, depois de duas migrations feitas na mão. Custa uma hora agora.
6. Os doze arquivos de core/ com assinatura, tipo de entrada, tipo de saída, corpo que lança 'não implementado', e o .test.ts irmão com o caso ADVERSARIAL já escrito e marcado como pendente: o item que toca dado de aprendiz nascendo desmarcado, a rotina sem resposta que NÃO envia, o turno que pode ter causado efeito e não se reexecuta, o anel de três agentes, o item vencido que continua visível. O CI conta quantos testes estão pendentes e mostra o número.
7. Dockerfile com o CLI pinado por versão EXATA, sem as libs do Chrome, mais Dockerfile.browser separado; o job de fumaça no CI que roda um turno real contra a imagem antes de promover; o health check de boot que decifra uma credencial de teste e falha o deploy se não conseguir; e a tabela de flag floors copiada.

## Stack

| Camada | Escolha | Por quê | Rejeitado |
|---|---|---|---|
| Linguagem e runtime | **TypeScript estrito em Node LTS, um único pacote npm sem workspaces** | Um deployable só, 2-3 engenheiros, e os tipos do contrato mudam junto com a UI que os mostra. O OpenMausBot tinha pnpm-workspace.yaml e mesmo assim manteve o código principal como pastas do pacote raiz — o repo que tinha a ferramenta escolheu não usá-la. | Rust (o Buzz prova que dá, com 32 crates e ~90k linhas num só, mas é outro perfil de time); workspaces com pacotes internos (custo fixo sem o ganho, que só aparece com um segundo deployable); dois repositórios (dois PRs coordenados para cada mudança de campo) |
| Banco e isolamento | **Postgres gerenciado (Supabase), RLS restritiva com FORCE, role NOBYPASSRLS, SET LOCAL por transação, pooler em modo transação** | Com dados de menores e 3 engenheiros, disciplina de query não sobrevive — o próprio Buzz admite que o fence dele é 'lint-and-review, not a compiler fence' e a prova formal dele repousa num axioma que o schema não satisfaz. Gerenciado dá backup, PITR e upgrade de graça, que para um time de três é a diferença entre ter e não ter recuperação de desastre. | tenant_id sem RLS (o que o Buzz fez e onde ficou devendo); banco por cliente (mata a fila global de E3 e multiplica migração por 70); Supabase Auth e Realtime (Auth amarra um modelo de identidade que em E1 e E6 é peculiar; Realtime entrega diff de linha, não evento de domínio tipado); SECURITY DEFINER como escape de performance (A-RLS-4 diz que é o mecanismo de furar RLS) |
| Migração de schema | **Arquivos SQL numerados e imutáveis, aplicados na subida sob trava consultiva, com teste de conformidade contra o catálogo** | Nenhum gerador de ORM entende RLS: reconcilia tabelas e colunas e ignora políticas, então o buraco de segurança fica invisível na ferramenta que deveria vê-lo. O Buzz escolheu SQL bruto mesmo com tipagem forte em Rust (migration.rs:15 é sqlx::migrate! sobre 44 arquivos). | Migrações geradas por ORM a partir de schema em TypeScript; script manual no deploy (duas instâncias aplicam a mesma migração duas vezes); migração destrutiva automática (torna o rollback impossível) |
| Busca | **tsvector com configuração própria unaccent + portuguese_stem, coluna GENERATED STORED, GIN com escopo de tenant, allowlist positiva** | Conteúdo em português escrito por gente com pressa: 'simple' não acha 'aprendizes' buscando 'aprendiz' nem 'avaliação' buscando 'avaliacao'. A forma vem do Buzz (coluna gerada como fonte única, sem indexador sidecar para manter coerente); a configuração é escolha nossa e não tem precedente lá. | 'simple' como o Buzz (escolha de paridade com o Typesense antigo, não de qualidade); motor externo (o custo não era a busca, era a coerência de um indexador paralelo que precisa aprender sozinho as regras de privacidade); GIN de coluna única confiando em BitmapAnd (isola conteúdo mas não a existência: o tempo de resposta vira canal lateral); denylist de tipos sensíveis (a 0008 do Buzz teve que invertê-la) |
| Tempo real | **SSE com frames numerados (<streamId>:<seq>), buffer de replay em memória POR TENANT, comandos por POST** | ~130 linhas no servidor contra 1142 só para o ciclo de vida de uma conexão WebSocket no Buzz, mais 2144 de fanout Redis — e o Buzz, depois de tudo isso, perde evento em silêncio quando um receptor fica para trás (main.rs:982 incrementa um contador e loga um warn). | WebSocket (8x o código para menos garantia); polling (a fila fica atrasada em relação ao prazo que ela mesma mostra); Supabase Realtime (diff de linha, não evento tipado, e um segundo lugar onde o isolamento pode vazar); buffer global sem tenant (é como o código de referência faz e é vazamento entre empresas) |
| Estado do cliente | **Reducer único e puro, transporte encapsulado atrás de interface de 4 campos, streaming de token fora do reducer em contexto próprio** | A invariante mais importante do nod cruza fronteiras — um card decidido some da fila global e vira linha de trilha, atomicamente. Um reducer único torna isso impossível de errar pela metade. E a razão teste/código do OpenMausBot é ~55% justamente porque o reducer é chamável direto, sem montar React. | React Query / SWR (a frota é fluxo de eventos, não cache de GETs; invalidar joga fora a informação que o evento trazia); vários stores pequenos (a sincronização manual entre eles é onde nasce 'decidi e continua na fila'); efeito dentro do reducer (destrói a testabilidade, e o OpenMausBot resistiu explicitamente) |
| Execução de agente | **CLI do fornecedor como processo filho no container, API key por tenant, versão exata pinada, atrás do SPI Driver/Instance/Adapter** | claude.ts:185 prova que CLI e chave por tenant são eixos independentes: dá para ter CLI, billing por tenant e zero login ao mesmo tempo. O loop de agente próprio custa ~1.600 linhas no OpenMausBot e ~27.400 no Buzz, e entrega menos capabilities. | API direta reescrevendo o loop (o produto secundário que engole 3 engenheiros); ACP por stdio (é um CLI por baixo do mesmo jeito, só troca o protocolo); Box / cloud computer (boxagent.ts:294 devolve 'unavailable' para toda aprovação, o que mata E4 e E5); CLI por tag flutuante (o rollback da imagem deixa de reverter o CLI) |
| Ferramentas e credencial de conector | **MCP por stdio com proxy no servidor entre os dois processos, credencial cifrada no Postgres com chave única do secret manager, ambiente do executor montado do zero** | mcp-gate.ts:9-15: em motor de CLI de fornecedor a chamada de ferramenta e o resultado nunca passam pelo harness — o proxy é o ÚNICO lugar onde dá para ver, ou encolher, o que uma ferramenta põe no contexto. Logo é onde a aprovação tipada, a classificação de negação e a trilha de E8 existem. | Agente declarando os próprios servidores MCP (exfiltração com cara de configuração); filtrar só no prompt (instrução, não controle); MCP por HTTP remoto (o próprio OpenMausBot ainda não suporta e diz por quê); envelope KEK/DEK com rotação (máquina que 3 engenheiros não mantêm); herdar process.env e apagar (falha por omissão a cada variável nova) |
| Fila, rotina e travas | **Tudo no Postgres: fila por conversa com três estados e prazo absoluto, reivindicação de rotina com UNIQUE (tenant, rotina, instante), expiração idempotente por constraint** | A fila precisa ser lida junto com a trilha e o estado da decisão nas MESMAS transações — no Postgres, 'enfileirei' e 'registrei que enfileirei' são atômicos. E E7.6 exige exatamente um registro por janela mesmo com dois containers sobrepostos. | Fila em memória como o Buzz (restart perde a fila e o conhecimento de qual turno estava em voo); Redis (um serviço com estado a mais e conciliação entre dois estados duráveis, que é onde nascem efeitos duplicados); SELECT FOR UPDATE segurando o lock durante o turno (esgota o pool) |
| Deploy e operação | **Um container num PaaS gerenciado (Railway ou Fly), recreate em vez de rolling na Fase 1, Dockerfile honesto que roda em qualquer lugar** | docs/deploy-vps.md tem 397 linhas e server/caddy.ts 221 só para o TLS; o chart do Buzz tem ~1000 linhas de configuração antes da primeira linha de produto. Com 2-3 engenheiros, todo minuto operando systemd é minuto que não vira E4/E5. Recreate torna três ADRs corretos de graça. | VPS com Compose + Caddy; Kubernetes com Helm (imitação de escala que não existe); fleet com um processo por cliente (custo de operação linear no número de clientes, e a fila global de E3 não sobrevive a ele); web e worker em containers separados no dia um |
| Observabilidade | **Sete métricas ligadas a promessa de produto, um alarme externo de disponibilidade que pagina, rótulos como union fechado em TypeScript, coletor hospedado escolhido por nome** | CPU não sabe que uma pendência expirou porque ninguém olhou — o container fica saudável enquanto o produto falha em silêncio. E a métrica de idade da pendência mais velha é a falha que perde cliente e é invisível sem instrumentação. | Só o painel padrão do PaaS; OpenTelemetry completo com tracing distribuído (com um container, trace distribuído rastreia uma coisa só); Prometheus autogerenciado (mais um serviço com volume para quebrar às três da manhã); rótulo como Record<string,string> (é por onde o id de aprendiz vaza para um sistema fora do Postgres, fora da RLS e com retenção própria) |
