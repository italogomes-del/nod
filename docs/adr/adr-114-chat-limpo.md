# ADR-114 — Chat limpo: na conversa só fala e o que é com você

Status: proposto, parte do servidor (PR 1 do [plano do chat limpo](../plano-chat-limpo.md), PR #390) · Data: 2026-10-18 ·
Migração 0091. A regra da tela, a janela que conta só o chat e os gatilhos de reversão entram no PR 2, junto da primeira
mudança visível, com as emendas das ADR-029, ADR-041, ADR-083 e ADR-110. Era a ADR-113 com a migração 0090; renumerada
em 2026-10-18 porque o PR B da Fase 2 (#392, reações e citação) entra antes com a ADR-113 e a `0090_reacoes.sql`.

## Contexto

Produção, 30 dias até 17/10, conta Gamefik, só contagens: 20.684 itens nas conversas; numa conversa com 20 itens ou mais,
só 59% são falas (mediana de 48 conversas). O print do Eng 1 de 17/10 tinha 20 linhas de sistema e nenhuma fala. O que
mais polui: avisos genéricos (turno interrompido, memória anotada, compactação, bot criado, task fechada), recibos de
aprovação, linhas de frentes e tasks, trocas de IA e de conta, ferramentas negadas e "Respondi ao pedido".

O código não tinha um campo que dissesse o que cada mensagem é: cerca de 45 produtores gravavam `sistema` só com texto, e
a web separava dois casos por regex. Esconder só na web também não servia: a janela da conversa é de 200 mensagens, e numa
conversa como a do Eng 1 elas seriam quase todas avisos.

## Decisão (parte do servidor)

1. **O assunto é gravado na escrita.** `mensagens.assunto` (0091, nulo, CHECK só de forma) guarda o que a mensagem é, numa
   união fechada (`ASSUNTOS`, `src/contracts/destino-no-chat.ts`). `NovaMensagem` exige o assunto **no tipo** para
   `sistema` e `resultado_aprovacao` sem payload: o compilador obriga cada produtor a escolher, sem padrão implícito. Com
   payload, o assunto sai do kind, do payload e da autoria (`assuntoDe`); o `consentimento` da aprovação automática tem o
   mesmo payload do manual e se distingue por `autoria.decidido_por`. `atualizarSistema` e a linha da ligação recalculam o
   assunto quando regravam o payload. Fala é `null`.
2. **A tabela `DESTINO` diz para onde cada assunto vai** (`src/domain/destino-no-chat.ts`, só no servidor): `chat`,
   `anexo` (não vira linha, mas a web precisa dele na janela para desenhar outra coisa: `trabalho_aberto`,
   `frentes_abertas`, `frentes_terminadas`, `recado_a_frente`, `pedido_respondido`) ou `atividade`, com a categoria do
   filtro (frentes, bloqueios, máquina e IA). Limite do plano, troca de IA, computador fora e IA ausente são marcados
   `chat` com destino temporal: a web os esconde quando deixam de valer e a Atividade os lista sempre. Mudar uma regra é
   mudar a tabela, sem regravar o banco. Assunto desconhecido ou nulo fica no chat.
3. **Ficam no chat**, além das falas, da conversa com outros bots, das rotinas e do que é com você: a criação do bot (a
   primeira linha da conversa), o turno que terminou sem resposta (órfão, interrompido por falha, retorno do lote que
   caiu), o recibo automático com item que falhou, a negação terminal e a de plano ausente. As linhas de rotina (criar,
   mudar, pausar, reativar, apagar, mudança não aplicada) ganham o payload `rotina_evento`. Na dúvida, chat.
   **O que pede ação da pessoa fica no chat** (decidido pelo orquestrador em 18/10, no lugar do Marlon, na QA do PR 1; o
   plano mandava os dois para a Atividade): a queda da máquina (`turno.queda_da_maquina`, a linha do card "Retomar") e a
   pergunta vencida (`decisao.vencida`, "você pode reabrir"). Se o card for dispensado ou vencer, a linha continua no chat
   dizendo o que houve. O assunto do "Turno interrompido: {motivo}" sai de uma função só (`assuntoDaInterrupcao`), usada
   pelo produtor e pelo backfill, para a linha nova e a antiga terem o mesmo assunto.
4. **O destino vai pronto no DTO** (`Mensagem.destino`), resolvido pelo servidor na leitura e **só na conversa própria**;
   a sala fica como hoje (lá a conversa entre bots é o conteúdo). A web nunca importa a tabela (ADR-018).
5. **A Atividade do bot** é `GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…`: a página é o dia (sem cursor), até 500
   itens, os mais recentes primeiro, com `truncados` e `diaAnterior` até o nascimento do bot; `contagem=1` devolve só o
   total, com os mesmos filtros. Três fontes: as mensagens da conversa própria com destino `atividade`, `anexo` ou
   temporal; as negações de conector indisponível da `trilha` (uma linha por conector e causa, com "N vezes"), por faixa
   de tempo no índice parcial novo `trilha_negacoes_por_agente`; e os trabalhos que começaram ou terminaram no dia (a
   linha "Abriu a task" do mesmo trabalho não repete). Título e detalhe vêm prontos do servidor. Bot de outra pessoa: 404.
6. **A memória não é fonte da rota**: `pressao_memoria` mora em `events`, que não tem índice, e criar um numa migração que
   roda com o servidor antigo no ar travaria a tabela mais escrita. A Atividade mostra a linha "Agora" do estado que a web
   já tem; o histórico da memória fica fora.
7. **A migração só adiciona** e leva `SET LOCAL lock_timeout = '5s'`: o índice na trilha trava as escritas dela enquanto
   é construído (medido em 2026-10-18 num banco sintético: 282 ms com 500 mil linhas), e sem a trava em 5 s o deploy
   falha e para em vez de segurar o servidor.
8. **O backfill** (`scripts/backfill-assunto.ts`, depois do deploy) reconhece as linhas antigas pelo texto inteiro contra
   os moldes do catálogo de `redacao.ts` e dos textos fixos; a primeira linha da conversa própria é a criação do bot. Sem
   casamento: `sistema.generico`, e o `--seco` imprime quantas foram antes de gravar. `--refazer` corrige um molde errado
   sem migração. `scripts/medir-chat-limpo.ts` é a régua das metas.

## Alternativas descartadas

- **Esconder na web, por texto.** A janela de 200 continuaria cheia de avisos, e a web voltaria a separar por regex.
- **Padrão implícito "sem assunto vai para a Atividade", com teste de grep.** Troca um erro de compilação por um sumiço
  silencioso de um aviso que devia ficar.
- **A tabela importada pela web.** Quebra a regra travada pelo eslint (a web só faz `import type` de `src/`).
- **Cursor por `(em, id)` na Atividade.** Não atravessa as linhas agrupadas da trilha; o dia é a página.
- **Índice em `events` para a memória.** Trava a tabela mais escrita durante a construção.

## Gatilho de reversão

Os gatilhos da tela (relatos de "não vi que o bot foi bloqueado", Atividade aberta logo depois de abrir a conversa em
mais de 30% das aberturas) entram com o PR 2. Para esta parte:

- o `--seco` em produção com mais de 5% das linhas sem payload caindo em `sistema.generico`: os moldes não cobrem o que
  está gravado; acrescentar os que faltam (ou `MOLDES_ANTIGOS`) antes do PR 2;
- a rota da Atividade com p95 acima de 50 ms em produção (ou o `EXPLAIN` com a conversa real do Eng 1 no PR 2): o índice
  coberto `(tenant_id, conversa_id, criado_em) include (assunto, id)` em `mensagens`, numa migração aditiva.
