# Plano: chat limpo

Fase 3 do plano de 17/10 para deixar a conversa do nod mais perto do Rakazo e do Grok Bot. A Fase 1 é o Modo WhatsApp
([ADR-112](adr/adr-112-modo-whatsapp.md)), a Fase 2 a pergunta com botões ([plano](plano-pergunta-com-botoes.md),
PR #389). Esta fase constrói em cima do PR #389 (`web/telas/cartao-pergunta.ts`, `web/telas/pergunta.ts`, "Sua vez" com o
cartão, a pílula "Nina perguntou algo") e não mexe na pergunta.

**A regra.** No chat ficam só:

1. **falas**: os balões do bot e da pessoa, sem as etiquetas "rodou em xxxx" e "catcher" ("não confiável" e "parcial"
   ficam);
2. **conversa com outros bots**: uma linha por troca;
3. **rotinas**: criar, mudar, pausar e apagar, e a falha;
4. **o que é com você**: pergunta, aprovação, proposta, acesso, IA ou computador fora enquanto pede ação;
5. **entregas**: artefato, anexo, captura de tela, ligação.

Todo o resto sai do chat e vai para a **Atividade** do bot, no drawer. Nada é apagado do banco.

Protótipo aprovado pelo Marlon em 18/10: canvas privado "Nod — chat limpo"
(https://claude.ai/artifact/MGpgfzRqG3MkynKzuUqG4e). Telas: "Conversa típica (Clarice)", "Eng 1, o seu print, limpo",
"Celular", "Atividade em Atalhos, abaixo de Trabalhos", "Atividade aberta no drawer", "2C · Agrupada por bot", "3A · O
cartão encolhe com o resultado" e "4 · Progresso na fala + pílula que se alarga" (interativa). O levantamento dos 72
tipos de item que aparecem hoje, com o destino e o caminho de cada um, acompanha o canvas.

Cinco partes, entregues em oito PRs. Cada PR vai para produção sozinho; a divisão e a ordem estão em "Revisão de
engenharia (18/10)", que também lista o que a revisão mudou nas partes abaixo.

## Por que

Produção, 30 dias até 17/10, conta Gamefik, banco só leitura, só contagens:

- **20.684 itens** nas conversas. Numa conversa com 20 itens ou mais, só **59%** são falas (mediana de 48 conversas).
- O que mais polui: 1.700 linhas de sistema genéricas (turno interrompido, memória anotada, compactação, bot criado, task
  fechada, passe, parada), 1.132 recibos de aprovação como linha à parte, 787 linhas de frentes e tasks (abertas,
  terminadas, recados), 683 avisos de troca de IA ou de conta, 635 ferramentas negadas, 279 "Respondi ao pedido", 226 de
  acesso e regra permanente. As 2.363 execuções de rotina sem nada para a pessoa já ficam escondidas.
- O print do Eng 1 de 17/10: 20 linhas de sistema e nenhuma fala (9 negações, 4 "Respondi ao pedido", 5 "Pedido do …",
  dos quais 3 "Pedido do outro bot", e 2 de frentes).

**Metas da fase:** falas ≥ **90%** dos itens visíveis numa conversa típica (mediana das conversas com 20+ itens); a tela
do Eng 1 cai de 20 linhas para **≤ 5**.

**Como medir.** `scripts/medir-chat-limpo.ts` (PR 1), só leitura e só contagens, aplica a tabela `DESTINO` sobre as
mensagens dos últimos 30 dias (os 59% acima são contagem crua do banco; o PR 1 refaz a linha de base com o script e as
regras de hoje, para as metas usarem a mesma régua; o script trata fala de turno com trabalho como escondida e diz no
cabeçalho o que do estado vivo da tela ele não reproduz): por conversa com 20+ itens, quantos itens a conversa mostra e
quantos são falas. Uma troca agrupada (Parte 2) e uma execução de rotina sem nada conta 0 ou 1 item, como na tela.
Repetir depois de cada PR; o número de cada "Pronto quando" vem dele, menos onde a parte diz outra coisa.

## O que o código mostrou (e muda o desenho)

Lido em `origin/main` 08173547 e no PR #389 (`origin/feat/pergunta-com-botoes`, 5c3d2d6b).

- **A janela da conversa é de 200 mensagens, sem "carregar anteriores".** `listarComTurno`
  (`src/repositories/mensagens.repo.ts:154-158`) traz as 200 mais recentes, e `lerConversa`
  (`src/use-cases/enviar-mensagem.ts:180-192`) já documenta que "uma task muito falante empurra as mais antigas para fora
  da janela". Esconder só na web deixaria a conversa do Eng 1 quase vazia: as 200 seriam quase todas avisos, e as falas
  antigas não voltariam. A Parte 1 faz a janela contar só o que o chat mostra.
- **Quase tudo é derivado na web, mas sem um campo que diga o que a mensagem é.** Cerca de 66 lugares gravam mensagem
  `sistema`; uns 45 gravam só texto (`lembrar.ts:46`, `assentar-turno.ts:280` e `:469`, `trabalhos.ts:390`, as rotinas em
  `criar-rotina.ts:200`, `ativar-rotina.ts:65`, `pausar-rotina.ts:32`, `aplicar-proposta-rotina.ts:48/136/182`…). Os
  eventos de rotina, que ficam no chat, são `sistema` sem payload como os que saem. A web separa "texto de sistema" por
  regex em dois casos (`ANOTEI`, `PERMITIU`, `web/telas/conversa.ts:132` e `:151`). A Parte 1 grava o **assunto** de cada
  item na escrita.
- **Conector indisponível não vira mensagem.** Vai só para a `trilha` e para o frame `negacao`
  (`src/use-cases/registrar-negacao.ts:73-98`); a web guarda as 20 últimas em memória (`web/estado/reducer.ts:807-818`).
  A ferramenta negada pelo CLI, sim, é mensagem `negacao` (`src/use-cases/assentar-turno.ts:321-338`). A Atividade lê as
  duas fontes; `GET trilha?dia&agente` (`src/adapters/http/rotas/trilha.ts:14-31`) já faz o recorte por dia e bot.
- **A pouca memória é um evento por pessoa**, `pressao_memoria` em `events` (`src/use-cases/trabalhos.ts:98-107`), sem
  bot, sem conversa e sem índice por tipo. Hoje a pílula entra embaixo da última "Abriu a task"
  (`web/telas/linhas-do-chat.ts:254-262`), que sai do chat: ela precisa de casa nova já na Parte 1.
- **O título da frente.** `abrir_frentes` exige `titulo` do modelo (`src/contracts/ferramentas-frente.ts:17`, até 200
  caracteres). A frente da rede de 2 min ("Virou a frente") usa a mensagem da pessoa
  (`src/use-cases/coordenar-trabalhos.ts:307`), cortada em 80 por `tituloDoTrabalho` (`src/domain/trabalho.ts:30-34`):
  daí "Os resultados estão ficando muito bons…". Nenhum "??" literal no código; o "??" veio do modelo (`minLength 1`
  aceita) ou do próprio texto da pessoa, que em 05/10 mandou "??" ao Leonardo (ADR-110). E o lote não tem título:
  "5 frentes de hero" não existe em lugar nenhum.
- **"Pedido do outro bot" tem duas causas.** Desde a ADR-099 (I7) o pedido de colega não vira trabalho, então
  `u.trabalho?.pedidoPorNome` (`linhas-do-chat.ts:203`) quase nunca existe e o nome sai do autor do `peer_pedido`, que
  não traz nome (`src/contracts/mensagem.ts:49`; `pedir-a-bot.ts:139`). Se o bot que pediu é de outro dono ou foi
  excluído, `agente()` (`linhas-do-chat.ts:43-46`) não o acha; se o `peer_pedido` ficou fora da janela, a unidade é
  "colega" só pela raiz (`linhas-do-chat.ts:93`) e não há autor nenhum.
- **A resposta ao colega não está na conversa do dono.** `responderAoColega` (`src/use-cases/fechar-lote.ts:105-139`)
  entrega o texto a quem pediu e deixa no dono só "Respondi ao pedido de X", com `loteId` e `nome`, sem o texto e sem o
  turno do pedido. A troca aberta da 2C ("Para Ada · 15:09 · …") precisa dos dois.
- **O cartão de aprovação some ao decidir.** Os cards saem de `propostas` pendentes (`propostas.repo.ts:111`) e de "Sua
  vez"; decidido, ele sai da tela e o recibo nasce lá embaixo. `resultado_aprovacao` tem `decisaoId` e `frase`
  (`src/use-cases/decidir.ts:270`), mas não o turno do pedido; `consentimento` tem `conectorId` e as capacidades
  (`conceder.ts:89`), sem o id da proposta; "permitiu para sempre" é `consentimento` sem payload
  (`permitir-sempre.ts:59-63`); os recibos que uma regra aprovou sozinha não têm payload (`pedir-aprovacao.ts:222`,
  `itens-na-maquina.ts:55`).
- **A linha do dono não mostra só frentes.** `renderLinhaDoDono` (`web/telas/linha-do-dono.ts:51-75`) também diz as esperas
  (`esperar_comando`, volta marcada, colega: "Esperando a CI do #845 · 38 min") e a fila de pedidos ("2 pedidos na fila"),
  na prioridade de `linhaDoDono` (`web/lib/dono.ts:63-81`). A decisão 4 fala da pílula das frentes; a Parte 4 leva
  esperas e fila para a mesma pílula, para nada sumir (decisão tomada 2).
- **A parada é ADR-110.** A linha "■ Parado por você" sai para a Atividade, mas a faixa do Parar (`faixa-parada.ts`) fica
  enquanto a parada vale, como a ADR-110 manda.

## Parte 1 · A Atividade e o que sai do chat

A maior. Dois PRs (revisão de 18/10): o **PR 1** leva 1a e a rota de 1b, só servidor, sem nada visível; o **PR 2** leva
a janela de 1b e 1c juntas, porque a janela nova já tira os avisos da resposta e a web precisa da Atividade no mesmo
deploy para eles terem casa.

**1a. O assunto de cada item (servidor).**

- Migração 0091 (o PR B da Fase 2, #392, leva a 0090 de `reacoes` antes; só adiciona, com
  `-- ROLLBACK:` e `SET LOCAL lock_timeout = '5s'`, porque o deploy migra com o servidor antigo ainda no ar):
  `mensagens.assunto text null` e o índice parcial `trilha_negacoes_por_agente (tenant_id, agente_id, em) where kind =
  'negacao'` (a `trilha` só tem a chave primária, `0001_fundacao.sql:78-100`). Nenhum índice novo em `mensagens`:
  `mensagens_por_conversa (tenant_id, conversa_id, criado_em)` (`0002_dominio.sql:259`) serve à janela e ao recorte do dia
  (medido, ver "Revisão de engenharia"). Nada em `events`: a memória não entra na rota (ver 1b).
- `src/contracts/destino-no-chat.ts` (novo): os tipos `Assunto` (união fechada) e `Destino`. A função
  `assuntoDe(kind, payload, autoria)` e a tabela `DESTINO` moram em `src/domain/destino-no-chat.ts` (puro), só no
  servidor: a web só faz `import type` de `src/` (AGENTS.md, eslint; ADR-018), então o servidor resolve o destino na
  leitura e o manda pronto no DTO (`Mensagem.destino`). A tabela é `DESTINO: Record<Assunto, { destino: "chat" |
  "anexo" | "atividade"; categoria: "frentes" | "bloqueios" | "maquina_ia" | null }>`. **`anexo`** (revisão de 18/10) é o que não vira linha no chat mas a web precisa ter na janela
  para desenhar outra coisa: `trabalho_aberto`, `frentes_abertas`, `frentes_terminadas`, `recado_a_frente` e
  `pedido_respondido`. Sem eles a web perde o título e a origem das tasks (`linhas-do-chat.ts:72-74` e `:158-159`), a
  rotina que abriu frentes vira resultado antes da hora (`abriramFrentes`, `:174`), e as Partes 2 e 4b ficam sem âncora.
  Mudar uma regra é mudar a tabela, sem regravar o banco. `null` em `assunto` é fala ou coisa nova: fica no chat.
- **Só a conversa própria.** A sala continua como hoje (lá a conversa entre bots é o assunto, e `passe`, `handoff` e
  "entrou na sala" são o conteúdo; `e2e-catcher.test.ts:397-403` confere). A janela e a web só aplicam o `DESTINO` quando
  `conversas.tipo = 'propria'`.
- `mensagens.criar` (`src/repositories/mensagens.repo.ts`) grava `assunto` a partir de `kind`, `payload` e da autoria (o
  `consentimento` dado pela aprovação automática tem o mesmo payload do manual e só se distingue por
  `autoria.decidido_por`, `conceder.ts:78-89`).
  `NovaMensagem` passa a exigir `assunto` **no tipo** quando `kind` é `sistema` e não há payload (união discriminada): o
  compilador obriga cada um dos ~45 produtores a escolher, sem padrão implícito e sem teste de grep. O
  `atualizarSistema` (`mensagens.repo.ts:254-258`, troca de IA da ADR-108) recalcula o `assunto` quando regrava o
  payload, e o `update` de `ligacoes.repo.ts:235` também. Os que ficam no chat:
  - **rotinas** ganham payload próprio `rotina_evento { rotinaId, acao: "criada" | "mudada" | "pausada" | "ativada" |
    "excluida", nome, resumo }`: `criar-rotina.ts:197`, `ativar-rotina.ts:65`, `pausar-rotina.ts:32`,
    `aplicar-proposta-rotina.ts:48/136/182`. A falha e o bloqueio já são
    `rotina_execucao` com desfecho `falhou`/`bloqueada` (chat);
  - a **criação do bot** (`criar-agente.ts:78-85`, "X está pronto…", "Este agente nasce com identidade de execução
    vazia…" ou o texto do bot que o criou, ADR-104) fica no chat como `agente.criado`: é a primeira linha da conversa, e
    sem ela a conversa nova abre vazia e sem sugestões (`turnos-fila.test.ts:81` e `e2e-catcher.test.ts:163` conferem).
    "Bot criado" na Atividade é a linha na conversa de quem criou (`criar-bots.ts:88`);
  - **o turno que terminou sem resposta para a pessoa** (voz de fora, 18/10): turno órfão tirado da fila ("Nada foi
    feito com ele; se ainda precisar, peça de novo", `redacao.ts:74`), turno interrompido por falha (os motivos de
    `MotivoFalha`, `assentar-turno.ts:466-470`; o produtor sabe o motivo e escolhe o assunto) e "o retorno do lote caiu"
    (`fechar-lote.ts:175`). Interrompido porque a pessoa parou ou porque a mensagem foi lida junto da seguinte
    (`absorvido`) vai para a Atividade;
  - o recibo de **aprovação automática com item que falhou** (`falhou_na_execucao`, `pedir-aprovacao.ts:219-226`,
    `itens-na-maquina.ts:55`): uma ação em nome da pessoa que não saiu. O recibo automático em que tudo saiu vai para a
    Atividade;
  - os demais produtores sem payload são revistos um a um no PR (o compilador lista): `decisao-vencida`
    (`varredor-expiracao.ts:146`, "você pode reabrir") fica no chat porque ainda pede ação (decisão 22; antes ia para a
    Atividade porque o cartão já diz "Sem resposta"); "esta mensagem não rodou" (ADR-110 item 3) fica no chat;
  - a **queda da máquina** (`interromper-por-maquina.ts`, a linha do card "Retomar") fica no chat (decisão 22). O assunto
    do "Turno interrompido: {motivo}" sai de uma função só (`assuntoDaInterrupcao`), usada pelo produtor e pelo backfill.
- Backfill: `scripts/backfill-assunto.ts`, idempotente (`where assunto is null`), por pessoa (`paraCadaPessoa`, uma
  transação escopada por lote de 5.000, como os laços de fundo), toca só as linhas que ganham assunto não nulo (as falas
  ficam como estão). `--seco` imprime só contagens por assunto, nunca texto (regra do banco de produção: nada de ler texto
  de mensagem); `--refazer` recalcula as linhas `sistema` já classificadas, para corrigir um molde errado sem migração.
  Para `sistema` sem payload, `chaveDoTexto(texto)` casa o texto inteiro com os moldes do `CATALOGO` de
  `src/domain/redacao.ts` e com os textos fixos fora dele (`textoRotinaAtiva`, `TEXTO_ROTINA_MUDOU`…). O casamento só
  precisa ser à prova de erro para **os poucos moldes que ficam no chat** (eventos de rotina, criação do bot, "não
  rodou", turno órfão, interrupção por falha, retorno do lote caiu): para esses, o script leva também as versões antigas
  de cada frase (`MOLDES_ANTIGOS`, tiradas do histórico dos arquivos; várias mudaram em outubro, e o PR #389 tira o
  `parei-falta-dado`). Errar entre moldes que vão para a Atividade só troca o filtro, e o item continua em "Tudo". Um
  texto que casa com dois moldes falha o teste. Sem casamento: `sistema.generico`.
- O que vai para a Atividade (categoria entre parênteses):
  - `negacao` `ferramenta_negada` não terminal (bloqueios). `negacao` com `terminal: true` e `plano_ausente` ficam no chat
    (o turno parou; ADR-029, classe "plano de turno ausente");
  - `ia_trocada`, `conta_trocada`, `conta_seguiu`, `conta_escolhida`, `pedido_na_fila_da_cota`, `troca_de_ia` já decidido,
    `limite_do_plano` que já passou ("esteve no limite até 14:00") e `computador_fora_do_ar` que já voltou (maquina_ia);
  - `frentes_abertas`, `trabalho_aberto`, `frentes_terminadas`, `recado_a_frente` (frentes);
  - `pedido_respondido` (sem categoria; destino `anexo`: no chat ele passa a fazer parte da troca da Parte 2). Os
    outros `anexo` (`trabalho_aberto`, `frentes_abertas`, `frentes_terminadas`, `recado_a_frente`) também aparecem na
    Atividade, pela fonte 3 abaixo;
  - `parada`, `passe`, turno interrompido pela pessoa ou lido junto da seguinte (bloqueios). Turno órfão, retorno do lote
    caiu (decisão 10) e interrupção por máquina (decisão 22) ficam no chat;
  - "Anotei …", compactação, bot criado, task fechada para liberar memória, proposta confirmada ou recusada (até o PR 4,
    quando a nova, com payload `proposta_decidida`, passa a ser o cartão encolhido no chat; as antigas ficam na
    Atividade), pendências, inteligência e modo de aprovação, recibo de aprovação automática em que tudo saiu,
    `rotina_execucao` silenciosa (sem categoria: só em "Tudo").
  - `limite_do_plano`, `troca_de_ia`, `computador_fora_do_ar` e `negacao plano_ausente` têm destino que muda com o tempo
    (valem enquanto pedem ação). A tabela os marca `chat`, e a web os esconde quando deixam de valer (já sabe:
    `prontaDepois`, `computadorForaDoAr`, `p.decisao`). A Atividade lista os quatro sempre.

**1b. A janela e a rota da Atividade (servidor).**

- A janela (só na conversa própria): `listarComTurno` passa a trazer as 200 mais recentes **de chat** e, desde a mais
  antiga delas, os `anexo` (até 300), numa consulta de duas passadas no mesmo índice: o corte é o `criado_em` do 200º
  item de chat (`assunto is null or assunto <> all(${NAO_CONTAM})`, `limit 1 offset 199`); a resposta é `union all` dos
  200 de chat com os `anexo` de `criado_em >= corte`. Medido em 18/10 num banco sintético (Postgres 16, 457 mil linhas):
  a conversa do Eng 1 (20 avisos por fala) sai em 4,5 ms com cache e 14 ms frio; 50.000 avisos seguidos depois das
  últimas falas, em 8 ms com cache e 61 ms frio; hoje, 0,9 ms. O `EXPLAIN (ANALYZE, BUFFERS)` com a conversa real do Eng 1
  entra no PR. Os avisos que caem no meio das falas ficam fora da resposta. O "N avisos do sistema · ver"
  (`recolherAvisos`, `web/telas/conversa.ts:806-826`) sai junto: sem sistema genérico no chat, não sobra o que recolher.
  `listarDaConversa` (a leitura do servidor: prompt, Parar, retomadas) não muda.
- As falas dos turnos de task e de frente (voz de fora, 18/10): têm `assunto` nulo, mas a web as esconde (moram na tela
  da task; `lerConversa`, `enviar-mensagem.ts:180-185`, documenta que "uma task muito falante empurra as mais antigas
  para fora da janela"), e um dia de 5 frentes enche a janela delas. Na passada do corte elas **não contam**: o join com
  `turnos` que o select já faz (`coalesce(t.trabalho_id, o.trabalho_id)`, `mensagens.repo.ts:89`) vai também para a
  primeira passada, e fala com trabalho conta como `anexo`. Elas voltam na resposta com os outros `anexo` (até 300 desde
  o corte, os mais recentes), e a web segue escolhendo qual mostrar (a última fala da task, com a etiqueta). Os quatro de
  destino que muda com o tempo e a rotina silenciosa continuam contando; o `medir-chat-limpo.ts` diz quanto da janela a
  web esconde.
- Rota `GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…` → `AtividadeDto { dia, itens, total, truncados,
  diaAnterior: string | null }`, com `ItemDeAtividade { id, em, categoria, titulo, detalhe, vezes?, alvo?: { trabalhoId }
  | { mensagemId } }`. **A página é o dia** (revisão de 18/10: sem cursor; um cursor por `(em, id)` não atravessa as
  linhas agrupadas da trilha): até 500 itens, os mais recentes, e `truncados` diz quantos ficaram de fora ("e mais N
  itens deste dia, no Raio-X"). `diaAnterior` é o dia de antes até o dia em que o bot nasceu (dia vazio diz "Nada neste
  dia"), sem procurar o último dia com atividade. `dia` e `fuso` validados como em `GET trilha` (`trilha.ts:7-8`); bot
  de outra pessoa dá 404 pela RLS. O intervalo do dia é calculado uma vez (`(dia::timestamp at time zone fuso)` até
  `+ 1 dia`) e usado como faixa em `criado_em`/`em`, nunca `(em at time zone fuso)::date = dia`, que não usa índice
  (`trilha.repo.ts:88`). Lê:
  1. as mensagens da conversa do bot com destino `atividade` ou `anexo`, mais as quatro de destino que muda com o tempo,
     no índice de sempre;
  2. as negações `conector_indisponivel` da `trilha` do bot, no índice novo, numa consulta própria (não o
     `trilha.filtrar`, que varre a tabela); uma linha por conector e causa, com "N vezes";
  3. os trabalhos do bot que começaram ou terminaram no dia (`trabalhos_por_conversa`): uma linha por frente ("Terminou
     Hero w5 · estilo 6", "Começou a frente Roteiros de animação"); as mensagens `trabalho_aberto`, `frentes_abertas` e
     `frentes_terminadas` do mesmo trabalho ou lote não repetem.
  A memória não é fonte da rota: `pressao_memoria` mora em `events`, que não tem índice nenhum além da chave primária
  (`0001_fundacao.sql:141-164`), e criar um índice na tabela mais escrita do sistema, numa migração que roda com o
  servidor antigo no ar, trava as escritas dela durante a construção. A Atividade mostra no topo, enquanto vale, a linha
  "Agora · Pouca memória no seu Mac · 2 trabalhos abertos", do estado que a web já recebe (`memoria.mudou`). O histórico
  da memória fica fora (risco aceito). O título e o detalhe vêm prontos do servidor, na redação de hoje (a ADR-029
  continua: nome, causa e relógio).
- A negação continua renderizada (ADR-029), agora na Atividade e no Raio-X. Duas negações seguidas da mesma ferramenta
  pela mesma causa no mesmo turno viram uma linha com "N vezes", como já faz `vezes` no payload.
- `scripts/medir-chat-limpo.ts`: a medição de "Como medir", com a mesma tabela, só contagens.
- Raio-X (para a Parte 5): a execução do turno (o que o driver manda junto do resultado, `0036_modo_dev.sql`, gravada
  sempre, só números) ganha `blocosColados`, quantos blocos o `comporFala` colou acima da final. Vai no PR 1 para a
  semana de medição da Parte 5 já começar com o servidor; a `composicao` não serve, porque é gravada na emissão do plano,
  antes de a fala existir (`emitir-plano-turno.ts:475`).

**1c. A tela (web).**

- `web/telas/detalhes.ts:89-95`: em Atalhos, logo abaixo de "Trabalhos", a linha "Atividade" com "N hoje" à direita
  (`gv-meta`). `NivelGaveta` (`web/estado/reducer.ts:110`) ganha `{ tipo: "atividade" }`, e `nivelDaGaveta`
  (`detalhes.ts:34-38`) o aceita; `qa-epico-188.test.ts` confere que todo `irPara` tem nível. O "N hoje" (o dia inteiro,
  decisão tomada 1) vem de `GET agentes/:id/atividade?dia=…&fuso=…&contagem=1` (só `{ total }`, contagens nas três
  fontes, sem montar itens), pedido quando o drawer abre e relido, com espera de 1 s para juntar rajadas, a cada
  `mensagem.nova`, `trabalho.mudou` ou `negacao` (a de conector chega só por esse frame, `registrar-negacao.ts:73-98`) do
  bot enquanto o drawer está aberto. O frame não ganha `assunto` (seriam ~60 produtores de `mensagem_criada` a mudar).
  Antes de chegar, a linha não mostra número.
- `web/telas/atividade.ts` (novo): o nível "Atividade" com ‹ para voltar, os filtros Tudo / Frentes / Bloqueios /
  Máquina e IA (botões com `aria-pressed`; item sem categoria só em "Tudo"), a lista do dia com a hora à esquerda, título
  em negrito e detalhe em cinza (tela "Atividade aberta no drawer"), e "Dia anterior ›" no fim. O clique leva ao alvo:
  a frente abre a tela dela; a mensagem abre o texto inteiro ali mesmo, com o "Relatar" (ADR-041). A linha que vem da
  trilha (conector indisponível) não tem mensagem e não leva "Relatar" na v1. No celular, o drawer já é folha por cima
  da conversa.
- `web/telas/linhas-do-chat.ts` e `web/telas/conversa.ts`: `planejarLinhas` deixa de desenhar "Abriu a task", "Virou a
  frente", "Começou a frente", "Começou N frentes", "N frentes terminaram", "Repassou um recado", "Respondi ao pedido de"
  e "… terminou · 39 min" (`linhaTerminou`, `:355-359`); `corpoMensagem` (`:164-211`) deixa de ser chamado para
  `negacao` não terminal, `passe`, `parada`, sistema genérico e as linhas de IA que já passaram. Os botões "Fazer aqui" e
  "Fazer depois da …" (`acoesDaAbertura`, `:366-376`) vão para a tela da frente e para a linha dela em Trabalhos.
- A pílula de memória sai de baixo da "Abriu a task" e vira, até a Parte 4, um ponto discreto na linha do dono, com o
  texto no `title` e no nome acessível ("Pouca memória no seu Mac · 2 trabalhos abertos"), levando a Trabalhos. Vermelha
  também é ponto, com o texto dela no nome acessível e na Atividade; nada de faixa nem texto âmbar no chat (decisão
  tomada 5).
- `Mensagem` ganha `destino?: Destino` no DTO, resolvido pelo servidor na leitura; a web decide por ele, nunca por texto
  nem por uma tabela própria. Mensagem sem `destino` (servidor antigo durante o deploy) segue o desenho de hoje.
- Telemetria dos gatilhos (voz de fora, 18/10: sem ela os gatilhos de reversão não medem nada): `TipoLinha`
  (`src/contracts/trabalho.ts:159`, validado em `telemetria-linhas.ts:16`) ganha `"atividade"`; "mostrada" a cada
  abertura de conversa própria, "aberta" quando a pessoa abre a Atividade até 60 s depois (a web conta o tempo; a
  `chaveLinha` é a da abertura). Os PRs 3 e 8 acrescentam `"troca"` e `"pilula"` do mesmo jeito.
- O relato (ADR-041): `janelaAte` (`mensagens.repo.ts:187-198`) lê 100 mensagens cruas; no Eng 1 isso dá umas 5 falas.
  Passa a contar 100 itens de chat, como a janela, e leva junto os de Atividade dos mesmos 15 min, marcados.
- Testes: unit `chat-limpo.test.ts` (as linhas de frente e task, "Respondi ao pedido de", a pílula embaixo da task, a
  regra "tudo que não é balão fica no centro" de `:306-328` e "nenhuma linha contém `msg-sistema`" de `:420` mudam para
  o novo destino), `decisoes-chat.test.ts:444` e `card-pasta.test.ts:139-151` (o recolhimento "N avisos do sistema"
  sai), `conversa-depois.test.ts:212` ("Anotei" sai do chat), `cli-desatualizado.test.ts:256-263`, `ia-fora.test.ts:110-130`,
  `contas-ia.test.ts:108-136` e `troca-de-ia.test.ts` (as linhas de IA que já passaram saem; as funções continuam para a
  Atividade), `trabalhos.test.ts:414-429` (pílula de memória), `um-dono.test.ts:303`, `qa-epico-188.test.ts:15-24`;
  novos: `destino-no-chat` (tabela total sobre os kinds e payloads, `chaveDoTexto` contra cada molde do `CATALOGO` e dos
  `MOLDES_ANTIGOS`, nenhum texto de exemplo casando com dois moldes), `atividade` (filtros, vazio, dia anterior, alvo,
  `truncados`, linha "Agora" da memória), janela de 200 itens de chat com 1.000 avisos no meio. Integração:
  `mensagens.repo` (assunto gravado por produtor, `atualizarSistema` recalcula, janela com `anexo` dentro e fora do corte,
  sala sem filtro, conversa com menos de 200 itens de chat), rota `atividade` (as três fontes, fuso com virada de dia,
  dia inválido 400, bot de outra pessoa 404, 500 itens com `truncados`), backfill (idempotente, `--seco` sem gravar,
  `--refazer`, molde antigo, texto sem casamento). Os testes de integração que conferem texto gravado
  (`frentes-retorno.test.ts:84/109/185`, `frentes-rede.test.ts:66`, `frentes-abrir.test.ts:47/74`,
  `turnos-fila.test.ts:156-280`, `memoria.test.ts:28`) não mudam: o texto continua o mesmo. Os que leem a conversa pela
  rota ou por `lerConversa` mudam onde procuram um item de Atividade: `e2e-catcher.test.ts:202` ("Anotei" passa a ser
  conferido em `GET agentes/:id/atividade`); `e2e-catcher.test.ts:163` e `turnos-fila.test.ts:81` continuam (a criação do
  bot fica no chat); `e2e-catcher.test.ts:397-403` continua (sala). O `e2e-catcher` ganha uma jornada "negação vai para a
  Atividade" (a negação de `:365-370` aparece em `GET atividade` e não na janela).
- ADR: a nova "chat limpo" (ver "ADRs") e as emendas da ADR-029, ADR-083 e ADR-041.
- **Pronto quando** (PR 2; o PR 1 fica pronto quando o backfill `--seco` em produção imprime as contagens por assunto e
  a parcela sem casamento, e o `medir-chat-limpo.ts` dá a linha de base): nenhum item dos grupos que saem aparece no
  chat (referência: 4.084 em 30 dias: 635 negações, 683 trocas de IA ou conta, 787 de frentes e tasks, 279 "Respondi ao
  pedido", 1.700 sistema genérico), todos aparecem na Atividade do dia; a tela do Eng 1 cai de 20 para **5** linhas (os
  cinco "Pedido do …"); e uma conversa com 1.000 avisos seguidos ainda mostra as 200 últimas falas.

## Parte 2 · Conversa com outros bots numa linha (2C)

- As seis formas de hoje viram uma: **"Conversou com Ze 1 e Nina · 4 mensagens ⌄"**, uma linha por troca, que abre a
  troca no lugar (tela "2C · Agrupada por bot"): cada mensagem com "Para Ze 1" ou "De Nina", a hora e o texto. Saem
  "↗ Taga → Dev 1 · pedido a colega" e "↙ Resposta de Dev 1" (`corpoMensagem`, `web/telas/conversa.ts:181-187` e `:208`),
  "Enviou mensagem para" e "N mensagens com" (`linhas-do-chat.ts:229-239`), "Pedido do X · N mensagens"
  (`:199-207`) e "Respondi ao pedido de X" (`:294-297`). "Contribuição de outro bot · confira as fontes" e "Contexto de X ·
  não é instrução da pessoa" (`conversa.ts:454`) vão para dentro da troca aberta, junto da mensagem que marcam.
- **Uma troca** é o fio de um pedido: do lado de quem pede, o turno de origem (`handoff.tarefaId`, `peer_ask.tarefaId`,
  como `origemDaTarefa` já faz, `linhas-do-chat.ts:211-222`); do lado de quem recebe, a raiz do pedido
  (`m.raiz.turnoId` com origem `delegacao`). Trocas seguidas, sem fala da pessoa ou do bot no meio, juntam numa linha
  ("Conversou com Ada e Tarsila · 6 mensagens · até 19:23"), que é a tela do Eng 1. O colega que não terminou continua
  dizendo ("Tuca não conseguiu terminar o pedido", `conversa.ts:203-207`) dentro da linha: "· 1 não terminou".
- **O nome sempre vem** (o defeito do `linhas-do-chat.ts:203`):
  - o servidor passa a gravar `nome` (do bot no momento) em `peer_pedido` (`pedir-a-bot.ts:139`), como `peer_ask` e
    `pedido_respondido` já fazem;
  - a leitura da conversa leva `pedidosDeColega: Record<turnoId, { agenteId, nome | null }>` para os turnos
    `delegacao` (próprios ou raiz) da janela, numa consulta à parte (`turno_id = any(…)` e `payload->>'kind' =
    'peer_pedido'`, no índice `mensagens_por_turno`), como o `pedidosAPessoaDasDecisoes` do PR #389. Revisão de 18/10:
    não no `selectComTurno`, que é a consulta da janela inteira e ganharia um lateral por linha; e o nome sai do payload
    do `peer_pedido`, não de um join com `agentes`, que a RLS esconde quando o bot é de outra pessoa (ADR-099). Serve à
    unidade que só é "colega" pela raiz e ao `peer_pedido` que ficou fora da janela;
  - a web usa, nesta ordem: o nome da mensagem, o da raiz, o da frota. "outro bot" deixa de existir; o último recurso é
    "um colega", como `fechar-lote.ts:128`.
- **A resposta entra na troca.** `pedido_respondido` ganha `resposta` (o texto entregue, cortado em 2.000 com a mesma
  regra do `peer_ask`) e `turnoRaizId` (`fechar-lote.ts:128-135`). A mensagem leva a confiança da fala entregue (se o
  bot leu conteúdo de fora no lote, `nao_confiavel`, ADR-026), não a de sistema. A linha antiga, sem eles, conta como
  mensagem da troca sem texto ("Para Ada · 15:09 · respondido").
- `PlanoMensagem` ganha `{ tipo: "troca"; chave; mensagens }` e o HTML da linha sai de uma função nova em
  `linhas-do-chat.ts`; aberta, a troca é um `<details>` com `data-disclosure` (o estado aberto sobrevive ao re-render, como
  os recibos). A telemetria ganha `TipoLinha` `"troca"` (`src/contracts/trabalho.ts:159`; o servidor valida a lista em
  `src/use-cases/telemetria-linhas.ts:21`), para o gatilho da ADR-083.
- Sala: `handoff` e `passe` da sala continuam como hoje (lá a conversa entre bots é o assunto); a troca agrupada vale na
  conversa própria.
- Testes: unit `chat-limpo.test.ts:94/275-292/327/430/490`, `tarefa-delegada.test.ts:41-59`, `colaboracao.test.ts:19-25`,
  `um-dono.test.ts:159` ("Pedido do Leonardo" na linha do dono é outro texto e fica); casos novos: troca dos dois lados,
  trocas seguidas juntas, fala no meio separa, bot de outro dono com nome, `peer_pedido` fora da janela com nome pela raiz,
  `pedido_respondido` antigo sem texto, colega que não terminou, `peer_pedido` antigo sem `nome` e bot excluído ("um
  colega"). Integração: `pedir-a-bot` grava `nome`, `frentes-retorno` grava `resposta`, `turnoRaizId` e a confiança,
  leitura da conversa com `pedidosDeColega` (bot de outra pessoa com nome, turno sem `peer_pedido`). `e2e-catcher` jornadas
  bot-a-bot (`:414`) e pedido com mensagem (`:445`): conferem os campos novos.
- ADR: emenda da ADR-099 item 8 ("na conversa do dono fica só a linha 'Respondi ao pedido de X'" vira a troca agrupada).
- **Pronto quando:** a tela do Eng 1 cai para **3** linhas (referência: 5 depois da Parte 1; 20 antes) e nenhuma linha diz
  "outro bot" (referência: 3 de 5 no print).

## Parte 3 · O cartão encolhe com o resultado (3A)

- Decidido, o cartão de aprovação, proposta, acesso, consentimento, pasta ou regra **encolhe no lugar** em vez de sumir e
  deixar um recibo lá embaixo (tela "3A"): o título do pedido ("Enviar e-mail para Ingrid Souza · 'Re: Proposta Q4'") e
  uma linha com o resultado ("Aprovado por você · enviado 08:14 ✓", "Recusado por você", "Aprovado · 1 de 3 não saiu ·
  detalhes", "Acesso permitido · Gmail", "Regra nova · sempre permitir editar no Google Sheets", "acme aberta para o Dev
  1"). É o mesmo gesto da pergunta respondida da Fase 2; o cartão encolhido usa as classes de `cartao-pergunta.ts`
  (`respondida`) num componente comum, `web/telas/cartao-encolhido.ts`, sem mexer no da pergunta.
- **Onde fica:** na âncora do pedido, a mesma de quando estava aberto (`ancoraDoPedido`, `web/telas/conversa.ts:905-912`:
  a última fala do turno que pediu). Para isso o recibo leva a âncora:
  - `resultado_aprovacao` já tem a âncora: a mensagem é gravada com `turno_id = decisao.turnoId` (`decidir.ts:265`),
    então nada muda no payload (voz de fora, 18/10);
  - `consentimento` ganha `decisaoId` e `turnoId` (`conceder.ts:89`), e "permitiu para sempre" passa a ter payload
    `regra_permanente { decisaoId, turnoId, acoes }` (`permitir-sempre.ts:59-63`; a web deixa a regex `PERMITIU`,
    `conversa.ts:132`, só para as antigas);
  - `pasta_aberta` já tem `propostaId` (`mensagem.ts:134`) e ganha `turnoId`;
  - proposta confirmada ou recusada (`confirmar-proposta.ts:84/171`, `recusar-proposta.ts:52`) ganha payload
    `proposta_decidida { propostaId, kind, titulo, estado, turnoId }`. A rotina criada pela proposta continua com a linha
    de rotina (Parte 1), logo depois do cartão encolhido.
  - Recibo antigo com payload, sem âncora: encolhido onde está hoje, no fim, com o título da `frase` do payload. Recibo
    antigo sem payload ("permitiu para sempre" antigo, pela regex `PERMITIU`): a linha de hoje, sem encolher. Recibo com âncora cuja fala já saiu da janela:
    encolhido na posição do próprio recibo. Recibo de regra automática (sem payload): Atividade (Parte 1), porque não
    houve cartão. O `consentimento` dado pela aprovação automática (`autoria.decidido_por` de regra) também: Atividade.
- `blocosDoHistorico` (`conversa.ts:867-898`) põe o cartão encolhido no lugar com a mesma mecânica de
  `comPedidosAncorados` (`:919-938`), e a mensagem do recibo deixa de ser desenhada na posição dela. A seção "Preciso da
  sua decisão para continuar" (`sua-vez.ts:621-629`) e "N coisas esperam você" (Fase 2) continuam só para o que está
  aberto.
- "ver o e-mail" do protótipo fica como "detalhes" (os itens, como `reciboDaDecisao` já faz, `conversa.ts:117-123`);
  nenhum conector devolve link hoje e esta fase não mexe em conectores (decisão tomada 4).
- Acessibilidade: o encolher respeita `prefers-reduced-motion`. O cartão encolhido nasce num re-render que vem depois
  do frame `decisao.decidida` e da releitura da conversa, quando o botão clicado já não existe: a web guarda o
  `decisaoId` decidido nesta aba e, no primeiro desenho do cartão encolhido com ele, põe o foco no título (com
  `tabindex="-1"`) e escreve "Aprovado: enviar e-mail para Ingrid Souza" na região `aria-live="polite"` única da
  conversa (a mesma da Parte 4c, fora das regiões que se regravam). Decidido em outro lugar ("Sua vez", outra aba),
  sem foco nem anúncio.
- Testes: unit `conversa-depois.test.ts:186-204` (os recibos viram cartão encolhido), `decisoes-chat.test.ts:102/283`
  ("Acesso permitido"), `card-pasta.test.ts`, `chat-limpo.test.ts:306-328` (`resultado_aprovacao`); novos: cada tipo de
  cartão encolhido, âncora com o turno, âncora fora da janela, recibo antigo no fim, recibo de regra fora do chat,
  re-render sem pulo, foco e anúncio só na aba que decidiu. Integração:
  `decidir`, `conceder`, `permitir-sempre`, `confirmar-proposta`, `recusar-proposta` gravam a âncora. `e2e-catcher`
  aprovação em lista (`:320-370`): o payload novo.
- ADR: emenda da ADR-044 (o registro de autorização continua gravado e legível no cartão encolhido, em "Ver registro de
  autorização") e a ADR nova.
- **Pronto quando:** nenhuma decisão vira linha nova no fim da conversa (referência: 1.132 recibos de aprovação e 226 de
  acesso e regra em 30 dias); depois desta parte, falas ≥ **90%** dos itens visíveis na mediana (referência: 59%).

## Parte 4 · O que o bot está fazendo: progresso na fala e a pílula

**4a. Título curto (servidor e prompt).**

- `abrir_frentes`: `titulo` de cada frente passa a "2 a 5 palavras, como a pessoa diria (ex.: 'Roteiros de animação')".
  O `maxLength` do schema **fica em 200** (`ferramentas-frente.ts:17`, o CHECK da 0063; revisão de 18/10): um teto de 60
  faria a chamada inteira falhar na validação (`validarArgsNod`, `chamar-ferramenta.ts:82`) e o modelo podia desistir
  das frentes e fazer o trabalho na conversa; o tamanho é medido por uma semana e a tela corta com reticências. Campo
  novo opcional `titulo_do_lote` ("o que o lote faz, em 2 a 4 palavras: 'frentes de hero'"), gravado no lote e em
  `frentes_abertas`. `lotes_de_frentes` não tem coluna de título (`0071_frentes.sql:22-33`): migração própria do PR,
  `lotes_de_frentes.titulo text null` com CHECK de 1 a 200, e o `TrabalhoDto` ganha `tituloDoLote` (a pílula precisa dele
  mesmo quando a fala que abriu o lote saiu da janela). Sem ele: uma frente, o título dela; várias, "N frentes".
- `tituloDoTrabalho` (`src/domain/trabalho.ts:30-34`) recusa título sem letra ("??", "...") e cai no reserva.
- Rede de 2 min (`coordenar-trabalhos.ts:307`): o título sai de `tituloProvisorio(texto)` (novo, puro, em
  `src/domain/trabalho.ts`): a primeira oração, até 6 palavras e 40 caracteres, sem saudação e sem pontuação final; sem
  letras, "Frente da conversa". **Sem `nomear_frente`** (voz de fora, 18/10, conferido): a frente da rede é o turno do
  dono promovido, e "o processo segue intocado" (`coordenar-trabalhos.ts:290-293`); ele roda com o catálogo e o prompt
  do plano emitido no despacho, que são os do dono. Uma ferramenta só da frente nunca chegaria ao modelo (é pelo mesmo
  motivo que existe o `resumo-sem-chamada.ts`). O título da frente da rede fica o provisório.
- Testes: unit `domain/trabalho.test.ts:41-43` (título sem letra, `tituloProvisorio`: saudação, pontuação, 6 palavras,
  40 caracteres, só "??"), `chamar-ferramenta` (schema de `abrir_frentes` com `titulo_do_lote`), prompt de referência; integração `frentes-rede.test.ts:60/66/145`
  (o título deixa de ser o texto cru), `frentes-abrir.test.ts`
  (`titulo_do_lote` gravado no lote e no payload; sem ele, "N frentes"); conformidade: o rollback da migração nova. Uma
  rodada de `npm run e2e:aceite` confere que o modelo manda título curto e `titulo_do_lote`; os prompts de
  referência (`npm run prompt:referencia`) mudam e o diff é revisado no PR.

**4b. O progresso mora na fala que abriu as frentes (web).**

- A fala do bot do mesmo turno que gravou `frentes_abertas` (a mesma que `linhaDepoisDaFala` acha, `conversa.ts:761-780`)
  ganha embaixo do balão o bloco de progresso (tela "4"): barra segmentada, um segmento por frente (pronta, rodando,
  parada ou falhou), e "3 de 5 prontas · w3 e w5 rodando · ver as 5", que abre a lista no lugar (prontas com ✓ e hora,
  rodando com o último passo e o tempo, parada com ■). Estados de `trabalhosConhecidos` (`web/lib/trabalhos.ts`) e, para
  frente que já saiu da lista, de `frentes_terminadas`. O último passo é o de `linhaDaFrente`
  (`linha-do-dono.ts:117-129`: `linhaAtual` da atividade ao vivo, senão `situacaoDe`). Cada título abre a frente.
- Frente da rede, que não tem fala antes: o bloco entra embaixo do balão da pessoa que virou a frente.
- A âncora é a mensagem `frentes_abertas`, que chega na janela como `anexo` (Parte 1); sem ela na janela (a fala
  também saiu), não há bloco e a pílula fica à vista. Ordem dentro da fala, com o PR B da Fase 2: balão → bloco de
  progresso → chip de reações (o progresso é conteúdo da fala; a reação é sobre ela).
- **O cartão de atividade ao vivo grande vira uma linha** (`renderCartaoAtividade`, `conversa.ts:587-601`): "Clarice está
  trabalhando · ver etapas", com o ponto que pulsa; "ver etapas" abre o que hoje é o `<details>` (etapas, checklist do
  bot). O vigia (`renderAvisoDoVigia`, `:620-629`) continua à vista, porque pede ação. O cabeçalho "● ao vivo"
  (`cabecalhoDoTurnoVivo`, `:691-698`) sai; o balão em streaming fica.

**4c. A pílula que se alarga (web), no lugar da linha do dono.**

- `renderLinhaDoDono` (`linha-do-dono.ts:51-75`, região `faixa-trabalhos`, `web/main.ts:1027`) dá lugar a
  `web/telas/pilula-do-bot.ts`. Fechada, acima do campo: "● 5 frentes de hero · 3 de 5 prontas". **Some quando a fala
  com o progresso está à vista** e volta quando ela sai. O clique alarga a pílula (largura e altura animadas) com as frentes:
  rodando primeiro, com o último passo e o tempo; depois as prontas com a hora; no pé, "Ver na conversa ↑" (rola até a fala
  e a realça, com `levarAoAlvo`, `web/main.ts:2121-2132`) e "Parar".
- Mais de um lote aberto: a pílula soma ("● 2 lotes · 4 de 7 prontas") e alargada separa por lote. Esperas e fila, que a
  linha do dono mostrava (`linhaDoDono`, `web/lib/dono.ts:63-81`), entram na mesma pílula (decisão tomada 2): o texto
  fechado prioriza as frentes rodando ("5 frentes de hero · 3 de 5 prontas"); sem frentes, mostra a espera com o ponto
  vazado ("◌ Esperando a CI do #845 · 38 min") ou a fila ("1 pedido na fila"). Alargada, abaixo das frentes, as seções
  "Rodando", "Esperando" e "Na fila", com o que a linha aberta mostra hoje (comando, última linha, tentativa N de 3; quem
  pediu). Nada disso fica acima do campo fora da pílula. A pílula some com a fala do progresso à vista só quando não há
  espera nem fila (essas não têm fala-âncora e ficam à vista enquanto valem). "Esperando você" sai da pílula: a
  pergunta tem o cartão e a pílula "Nina perguntou algo" da Fase 2.
- "Parar" abre a mesma lista do Parar do campo (`tituloDoParar`, `conversa.ts:1017-1020`), já marcada com as frentes do
  lote.
- **Visibilidade da fala:** o mesmo esquema da pílula da pergunta do PR #389 (`perguntaNaJanela` em
  `web/lib/rolagem-na-tela.ts`): o elemento do progresso é procurado quando o histórico muda, nunca a cada quadro, e
  medido com `getBoundingClientRect` no evento de rolagem que já existe. Nada de procurar na timeline inteira por quadro
  (ADR-061). As duas pílulas não se cobrem: a da pergunta e a das novas flutuam acima (`lugar-pilula-novas`), esta fica no
  lugar da faixa, colada ao campo.
- **Memória:** o ponto discreto da Parte 1 passa para a pílula e para o bloco de progresso (um ponto cinza ao lado do
  número, com o `title` e o nome acessível), mais o item na Atividade. Nenhuma faixa âmbar.
- Acessibilidade: a pílula é um `<button aria-expanded aria-controls>`; alargada, um `role="region"` com nome ("Frentes de
  Orquestrador de Sites"), foco no primeiro item, Esc fecha e devolve o foco à pílula. Escondida (fala à vista), ela sai
  da árvore de acessibilidade e do Tab com `hidden` (ou `inert` durante a transição), não só com opacidade, como faz o
  protótipo (`pilulaOpacidade` e `pointer-events`). Alargada, ela não some quando a fala entra na vista; o protótipo a
  fecha nesse caso (`aberta: visivel ? false : …`) e, se o foco estava dentro, ele vai para o "ver as N" do bloco na fala.
  O estado aberto sobrevive ao re-render da região `faixa-trabalhos` (guardado no estado da tela, como o
  `data-disclosure`). `prefers-reduced-motion`: alarga sem animação (`movimentoReduzido`, `web/lib/movimento.ts`; CSS com
  a mesma consulta). Uma região `aria-live="polite"` única da conversa, fora das regiões que se regravam, diz só quando
  uma frente termina ("Hero w3 pronta"), nunca a cada passo; a mesma serve à Parte 3. Alvo de 36 px (44 px em
  `web/mobile.css`). Tokens de `web/tokens.css`, nenhuma cor literal. No celular cabe em 390 px (tela "Celular");
  alargada, vira folha como a linha aberta de hoje (`mobile.css:156-160`).
- Desempenho da animação: o protótipo anima `width` e `max-height` (`D4BE2-pilula-alarga`), o que reflui a cada quadro.
  Em produção a pílula alargada é um painel `position: absolute` ancorado acima do campo, com `contain: layout paint`,
  desenhado já no tamanho final; anima-se `clip-path: inset(…)` e `transform`/`opacity`, sem mexer no fluxo da timeline
  nem no campo. `scripts/carga-tela` mede antes e depois (ADR-061).
- Testes: unit `um-dono.test.ts:61-178/347-352` (a linha do dono vira pílula; `sinalDoBot` e a tela Trabalhos por bot
  ficam), `linha-do-dono.test.ts`, `conversa-depois.test.ts:61-67` (cartão ao vivo vira linha; "ao vivo" sai),
  `tela-sob-carga.test.ts:143-144` e `turnos-fantasmas.test.ts:95` (chaves `vivo:` e cabeçalho), `chat-limpo.test.ts:190-205`
  (memória), `trabalhos.test.ts:414-429`, `tela-limpa.test.ts`, `cores-por-token.test.ts`, `foco-forced-colors.test.ts`;
  novos: bloco de progresso (estados, frente fora da lista, rede, sem `frentes_abertas` na janela), pílula (some com a
  fala à vista, não some com espera ou fila, lotes somados, prioridade do texto fechado, seções alargadas, alargar, Esc,
  foco ao fechar sozinha, `hidden` quando escondida, estado aberto depois do re-render, reduzido), visibilidade com a
  fala dentro e fora da janela e com o histórico mudando sem rolagem.
- ADR: emenda da ADR-099 item 10 (a linha centralizada de início e fim de frentes e a linha acima do campo dão lugar ao
  progresso na fala e à pílula) e do gatilho "detalhe das frentes aberto em mais de 30%", que passa a ser medido na
  pílula alargada e em "ver as 5".
- **Pronto quando:** num dia como o do protótipo (5 frentes de hero), o chat não tem nenhuma linha de frente, a pílula só
  aparece com a fala fora da vista, e nenhuma frente nova tem título com mais de 48 caracteres ou igual à mensagem da
  pessoa (referência: a frente da rede tem sempre o texto cru, até 80 caracteres).

## Parte 5 · Etiquetas, divisores de data e a narração

Pequena. Vai depois do PR 2 (o divisor só fica certo sem os avisos no chat); a medição da narração começa no PR 1.

- **Etiquetas:** `badgeExecutor` (`web/telas/conversa.ts:63-68`) sai do balão (`:455-457`, a mesma linha que o PR #389
  reescreve no `renderMensagem`). "rodou em <máquina>" e
  "catcher" continuam no Raio-X e na faixa do modo dev (`faixaDaMensagem`); "não confiável" e "parcial" ficam. Nenhum teste
  fixa hoje essas etiquetas: entra um que prova as duas que saem e as duas que ficam.
- **Divisores de data entre blocos de horário** (como o "Today 00:25" do Grok): além do topo (`conversa.ts:883`), um divisor
  quando o dia muda ou quando passam **30 min** ou mais (decisão tomada 6) entre dois itens **visíveis** ("Hoje 08:00",
  "15:40", "Ontem 22:10", "17/10 15:02"). Calculado depois de esconder o que vai para a Atividade (um aviso escondido não abre bloco). Chave
  `sep:<id da primeira mensagem do bloco>`, para `regiaoPorBlocos` trocar só o que mudou; `LinhaDaConversa` ganha `em`.
  `role="separator"` com o texto inteiro. Testes novos (hoje nenhum fixa `time-sep`).
- **Narração (`NARRACAO_MAX_CHARS`, `src/domain/stream-json.ts:225-255`).** Hoje um bloco de mais de 280 caracteres escrito
  antes da última ferramenta é tratado como relatório e colado acima da resposta final (`comporFala`). A regra salvou o
  caso "escreveu o relatório, chamou `lembrar`, respondeu 'Anotado.'". Com o Modo WhatsApp (respostas de 444 caracteres
  na mediana, ADR-112) duas mensagens curtas viram um balão longo, com o anúncio do que ia fazer em cima ("Vou abrir 5
  frentes…" + o resultado), o contrário do "não anuncie" da `LINHA_WHATSAPP` (`prompt-sistema.ts:257`). Proposta:
  1. medir antes: o Raio-X grava na **execução** do turno quantos blocos `comporFala` colou (`blocosColados`, no PR 1;
     a `composicao` é gravada antes de a fala existir); uma semana com e sem a chave `exp_whatsapp`;
  2. com a chave ligada, colar só quando a resposta final é um toco (até 80 caracteres, o caso "Anotado."); fora disso, o
     bloco fica nas etapas, como narração. Os `obrigatorios` (a resposta a uma mensagem do meio, ADR-083 §6,
     `stream-json.ts:361`) entram sempre, com ou sem a chave. Desligada, nada muda (ADR-112, item 5). Nenhum bloco vira
     balão próprio (decisão tomada 3). `comporFala` continua puro e recebe a chave por parâmetro;
  3. a linha "Progresso" no modo WhatsApp deixa de falar em "relatório" ("Não chame ferramenta depois do relatório",
     `prompt-sistema.ts:443`): "Não chame ferramenta depois da resposta final; se precisar, reescreva-a no fim".
  Testes: `stream-json.test.ts:241-257/305-308` (o limite estrito continua sem a chave; casos novos com a chave: toco de
  80 cola, 81 não cola, `obrigatorio` cola sempre), prompt de referência `conversa-whatsapp`, Raio-X com `blocosColados`
  (integração, PR 1).
- ADR: emenda da ADR-112 (a narração no modo WhatsApp).
- **Pronto quando:** nenhuma fala mostra "rodou em" nem "catcher"; toda conversa com mais de um bloco de horário tem
  divisor entre eles; no modo WhatsApp, a parcela de falas com bloco colado cai à metade da semana medida no passo 1.

## Ordem e dependências

A divisão final em oito PRs, a ordem com o PR #389 e o PR B da Fase 2 e o que cada PR leva estão em "Revisão de
engenharia (18/10)". Em resumo:

```
#389 (Fase 2, PR A) ─ PR B (Fase 2: reações, citação; uma semana depois do #389)
                         │
   PR 1 servidor da Atividade ─ PR 2 janela + Atividade na tela ──┬─ PR 3 troca agrupada
   (pode começar na semana       (depois do PR B)                  ├─ PR 4 cartão encolhido
    de espera do PR B)                                             ├─ PR 7 progresso na fala ─ PR 8 pílula
   PR 5 título curto ─────────────────────────────────────────────┘        (PR 7 precisa do PR 5 e do PR 2)
   (só servidor e prompt; pode ir junto do PR 1)                    └─ PR 6 etiquetas, divisores, narração
```

- O PR 2 vem antes dos visíveis: ele cria a janela que conta só o chat e a Atividade para onde os outros mandam o que
  tiram. Até o PR 8, a linha do dono continua dizendo as frentes, então tirar "Começou N frentes" do chat no PR 2 não
  deixa a pessoa sem saber o que roda.
- PR 3, PR 4 e PR 6 não dependem um do outro.
- O PR #389 entra antes de tudo: o PR 4 usa o desenho do cartão respondido, e o PR 8 divide o espaço com a pílula da
  pergunta.

## ADRs

- **ADR-114, "Chat limpo: na conversa só fala e o que é com você"** (o PR B da Fase 2, #392, leva a ADR-113 de reações
  e citação antes). A parte do servidor entrou no PR 1; a regra da tela e os gatilhos vão no PR 2, junto da primeira
  mudança visível. Fixa
  a regra das cinco coisas, o `assunto` gravado na escrita com a tabela `DESTINO` (chat, anexo, atividade) resolvida no
  servidor, só na conversa própria, a janela que conta só o chat, a Atividade como lugar de tudo o que sai, o cartão que encolhe no lugar, a pílula. Gatilhos de reversão:
  - 3 relatos em 14 dias (ADR-041) de "não vi que o bot foi bloqueado" ou equivalente: a negação volta ao chat como uma
    linha quando o turno termina sem fala do bot depois dela;
  - a Atividade aberta até 60 s depois de abrir a conversa em mais de 30% das aberturas em 2 semanas (`TipoLinha`
    "atividade", PR 2): algo que importava saiu do chat; rever a tabela;
  - a troca agrupada aberta em mais de 30% das vezes em 2 semanas (`TipoLinha` "troca"): as mensagens entre bots voltam a
    aparecer abertas, como o gatilho da ADR-083.
- **ADR-099:** item 8 ("Respondi ao pedido de X" vira parte da troca, Parte 2) e item 10 (linhas de início e fim de
  frentes e a linha acima do campo dão lugar ao progresso na fala e à pílula; "Esperando você" sai da linha; Parte 4).
  O gatilho do detalhe das frentes passa a ser medido na pílula.
- **ADR-083:** item 1 ("uma linha no chat" por trabalho vira um item na Atividade) e item 7 (a etiqueta "da task …" no
  balão de pergunta e resultado fica). O gatilho "tipo de linha aberto em mais de 30%" ganha o tipo "troca".
- **ADR-029:** a negação continua estado renderizado, com nome, causa e relógio, na Atividade (categoria Bloqueios) e no
  Raio-X; no chat fica só a que parou o turno (`terminal`) e a de plano ausente. Conector indisponível passa a ser
  visível fora do modo dev pela primeira vez (hoje só a trilha e 20 frames em memória).
- **ADR-041:** os itens da Atividade que são mensagem levam o "Relatar" (ancorado no id da mensagem, como sempre); a linha
  que vem da trilha não leva na v1. A janela do relato conta 100 itens de chat, como a conversa, e marca os itens dos
  mesmos 15 min que estavam na Atividade e não no chat, porque o relato registra o que a pessoa viu.
- **ADR-044** (Parte 3): o registro de autorização fica dentro do cartão encolhido.
- **ADR-110:** a linha "■ Parado por você" vai para a Atividade; a faixa do Parar, enquanto a parada vale, não muda.
- **ADR-112** (Parte 5): a narração no modo WhatsApp.
- **ADR-045:** não é tocada; a pergunta é da Fase 2.

## Riscos

- **Esconder uma negação de quem precisava agir.** `ferramenta_negada` com `alcance_insuficiente` pode ser falta de acesso
  que só a pessoa dá. Mitigação: o bot já recebe a orientação e pede o acesso pelo `pedir_acesso`, que é cartão no chat;
  a negação terminal fica no chat; o gatilho dos relatos acima.
- **Janela por itens de chat ficar cara.** Uma conversa com dezenas de milhares de avisos entre duas falas faz a consulta
  andar muito pelo índice (medido: 61 ms frio com 50.000 avisos seguidos), e a janela é relida a cada `mensagem.nova`
  (`invalidar`, `reducer.ts:731`). Mitigação: `EXPLAIN` no PR com a conversa do Eng 1; se o p95 passar de 50 ms, o índice
  coberto `(tenant_id, conversa_id, criado_em) include (assunto, id)` (migração aditiva), que deixa o corte numa varredura
  só de índice e a segunda passada buscando só as linhas que voltam. Não um índice parcial com a lista de assuntos de
  chat: ele amarraria o índice à tabela `DESTINO`, e cada mudança de regra pediria migração.
- **Assunto errado no backfill.** Uma mensagem antiga que casa com o molde errado, ou com nenhum, some do chat. O lado
  perigoso é o que devia ficar (rotina criada ou mudada, "não rodou", criação do bot, turno órfão) com a frase de antes.
  Mitigação: `chaveDoTexto` só casa molde inteiro, leva as versões antigas desses moldes, e um texto que casa com dois
  falha o teste; `--seco` em produção imprime as contagens por assunto e quantas ficaram sem casamento antes de gravar;
  `--refazer` corrige sem migração.
- **Mensagem nova sem assunto.** Um aviso novo que devia estar no chat cair na Atividade. Mitigação: `assunto` é
  obrigatório no tipo de `NovaMensagem` para `sistema` sem payload; o compilador barra o produtor que não escolhe.
- **Pílula animada.** Animar largura e altura (como o protótipo) reflui o campo e a timeline. Mitigação: painel absoluto
  com `contain: layout paint` animando `clip-path`/`transform`, não o fluxo; `prefers-reduced-motion` sem animação; medir
  com `scripts/carga-tela` antes e depois.
- **Detecção de visibilidade.** Medir a fala a cada rolagem com muitas falas de progresso. Mitigação: só a fala do lote
  aberto mais recente é observada (como o cartão aberto mais recente da Fase 2); procurada quando o histórico muda.
- **Título do modelo.** A descrição nova do `titulo` muda o comportamento sem eval automático e sem teto no schema. O
  PR 5 mede o tamanho dos títulos novos por uma semana; a tela corta com reticências; a frente da rede tem o
  `tituloProvisorio`.
- **Aba antiga aberta no deploy.** Mensagem sem `destino` e payloads sem os campos novos seguem o desenho de hoje em cada
  parte; nada quebra, só não limpa até recarregar. A aba antiga com o servidor novo recebe a janela sem os avisos e com
  os `anexo`, que ela já sabe desenhar como hoje.
- **Migração com o servidor antigo no ar.** O deploy migra antes de recriar o container (`deploy-gcp.md:28-29`), e cada
  migração roda numa transação (`migrar.ts:59`), sem `CONCURRENTLY`. O índice novo na `trilha` trava as escritas dela
  enquanto é construído. Mitigação: `SET LOCAL lock_timeout = '5s'` (falha e o deploy para, em vez de segurar o
  servidor), e o PR mede antes o tamanho da `trilha` em produção (só contagem). Nenhum índice em `events`.

## Decisões tomadas

Decisões tomadas, 18/10, pelo orquestrador no lugar do Marlon; ele pode reverter:

1. **"Atividade · N hoje" conta o dia inteiro**, como no protótipo; nada de "desde a última visita".
2. **Esperas e fila entram na pílula.** Fechada, o texto prioriza as frentes rodando ("5 frentes de hero · 3 de 5
   prontas"); sem frentes, mostra a espera ("Esperando a CI do #845 · 38 min") ou a fila ("1 pedido na fila"). Alargada,
   as seções "Rodando", "Esperando" e "Na fila" abaixo das tasks. Nada disso fica acima do campo fora da pílula.
3. **Narração no Modo WhatsApp: a menor mudança.** Só cola o texto anterior quando a resposta final é um toco; nenhum
   bloco vira balão próprio.
4. **"ver o e-mail" fica como "detalhes"** (abre o que o item já tem); não mexe em conectores agora.
5. **Pouca memória: ponto discreto** na pílula e na fala, com o texto só dentro da pílula alargada e na Atividade; nada de
   faixa nem texto âmbar no chat (o Marlon não gosta de faixa âmbar). Vale para a amarela e para a vermelha.
6. **Divisor de data a cada 30 min** de pausa entre itens visíveis.

Da revisão de engenharia (18/10), pelo revisor no lugar do Marlon (subagente sem o usuário), que pode reverter qualquer
uma:

7. Terceiro destino, **`anexo`**: vem na janela, não vira linha (o que a web usa para desenhar outra coisa e as falas de
   turno com trabalho).
8. A limpeza vale **só na conversa própria**; a sala fica como hoje.
9. **`assunto` obrigatório no tipo** de `NovaMensagem` para `sistema` sem payload; sem padrão implícito e sem teste de grep.
10. Ficam no chat, além do que o plano já dizia: **a criação do bot**, o **turno que terminou sem resposta** (órfão,
    interrompido por falha, retorno do lote caiu) e o **recibo automático com item que falhou**.
11. O **destino é resolvido no servidor** e vai no DTO; a tabela não é importada pela web.
12. A **rota da Atividade não tem cursor**: a página é o dia, até 500 itens, com `truncados`; "Dia anterior" é sempre o
    dia de antes, até o nascimento do bot. A contagem tem pedido próprio (`contagem=1`).
13. **A memória não é fonte da rota** (nada de índice em `events`): a Atividade mostra a linha "Agora" do estado que a web
    já tem; sem histórico de memória.
14. A **trilha** é lida por consulta própria, com faixa de tempo e um índice parcial novo; a linha dela na Atividade não
    leva "Relatar" na v1.
15. O **`maxLength` do título continua 200** no schema; o pedido de 2 a 5 palavras fica na descrição e é medido.
16. **Sem `nomear_frente`**: a frente da rede fica com o `tituloProvisorio`.
17. `lotes_de_frentes.titulo` numa migração do PR 5, e `TrabalhoDto.tituloDoLote`.
18. O nome de quem pediu vem de **`pedidosDeColega`, consulta à parte**, com o nome do payload do `peer_pedido`.
19. A medição da narração vai na **execução do Raio-X, já no PR 1**; os `obrigatorios` colam sempre.
20. Ordem dentro da fala: **balão → bloco de progresso → reações** (PR B da Fase 2).
21. **Oito PRs**, na ordem de "Divisão final em PRs".

Da QA do PR 1 (#391), decidido pelo orquestrador em 18/10, no lugar do Marlon; ele pode reverter:

22. **O que pede ação da pessoa fica no chat**: a queda da máquina (`turno.queda_da_maquina`, a linha do card "Retomar")
    e a pergunta vencida (`decisao.vencida`, "você pode reabrir") têm destino `chat`, não Atividade (era o P2 da revisão
    pré-merge: se o card fosse dispensado ou vencesse, o "você pode reabrir" sairia do chat junto). Muda só a tabela
    `DESTINO`, sem migração. Produtor e backfill dão à queda o mesmo assunto (`assuntoDaInterrupcao`).

## Fora deste plano

- O cabeçalho do bot (a pílula flutuante do topo) não muda nesta fase.
- A pergunta e "Sua vez" (Fase 2); reações, citação e a barra de ações na fala (Fase 2, PR B).
- "Carregar anteriores" na conversa: a janela continua de 200, agora de itens de chat.
- Contar as negações de conector como mensagem: a Atividade lê a trilha, que é imutável, com o índice novo do PR 1.

## Revisão de engenharia (18/10)

Revisão do plano contra a `main` em 08173547, o PR #389 (`origin/feat/pergunta-com-botoes`, 5c3d2d6b), o plano do PR B
(`docs/plano-pergunta-com-botoes.md`, Partes 3b e 5), as ADRs 099, 083, 029, 041, 044, 110 e 112 e o protótipo aprovado.
A consulta da janela foi medida num banco sintético descartável (Postgres 16 local, apagado depois); produção não foi
tocada. Voz de fora: um subagente Claude (Codex não instalado), com 12 pontos; 10 viraram mudança, conferidos no código.

### O que virou mudança

Arquitetura e dados:

1. **[P1] A janela tiraria da resposta o que a web usa sem desenhar.** `planejarLinhas` lê `trabalho_aberto` e
   `frentes_abertas` para a origem e o título das tasks (`linhas-do-chat.ts:72-74`, `:158-159`) e para não tomar o
   "comecei…" de uma rotina como resultado (`abriramFrentes`, `:174`); a Parte 2 precisa do `pedido_respondido` e a 4b do
   `frentes_abertas`. Mudou: destino `anexo` (decisão 7).
2. **[P1] A sala perderia o conteúdo.** `passe`, `handoff` e "entrou na sala" são `sistema` e iriam para uma Atividade
   que a sala não tem (`e2e-catcher.test.ts:397-403`). Mudou: só a conversa própria (decisão 8).
3. **[P1] A conversa nova abriria vazia.** A primeira mensagem de um bot criado sem entrevista é `sistema` sem payload
   (`criar-agente.ts:78-85`), e "bot criado" ia para a Atividade. Mudou: `agente.criado` fica no chat (decisão 10).
4. **[P1] A web importaria valor de `src/`.** A tabela `DESTINO` "importada pelo servidor e pela web" quebra a regra
   travada pelo eslint (AGENTS.md, "A web só faz `import type` de `src/`"; ADR-018), e o precedente citado não existe
   assim. Mudou: o servidor manda `destino` no DTO (decisão 11).
5. **[P1] Coisas que pedem ação iam para a Atividade.** Turno órfão ("se ainda precisar, peça de novo",
   `redacao.ts:74`), turno interrompido por falha (`assentar-turno.ts:466-470`), retorno do lote que caiu
   (`fechar-lote.ts:175`) e o recibo automático com item que falhou contradizem a regra 4 do próprio plano. Mudou:
   ficam no chat (decisão 10).
6. **[P1] A trilha não tem índice.** Só a chave primária (`0001_fundacao.sql:78-100`), e `filtrar` compara
   `(em at time zone fuso)::date` (`trilha.repo.ts:88`), que varre a tabela a cada abertura do drawer. Mudou: consulta
   própria com faixa e índice parcial (decisão 14).
7. **[P1] O índice em `events` travaria a tabela mais escrita.** `events` não tem índice secundário
   (`0001_fundacao.sql:141-164`), o deploy migra com o servidor antigo no ar (`deploy-gcp.md:28-29`) e cada migração roda
   numa transação (`migrar.ts:59`), sem `CONCURRENTLY`. Mudou: a memória sai da rota (decisão 13).
8. **[P2] As falas de task e de frente enchem a janela.** Elas têm `assunto` nulo e a web as esconde; num dia de 5
   frentes, a janela de 200 "itens de chat" seria quase só delas. Mudou: contam como `anexo` no corte (decisão 7).
9. **[P2] `atualizarSistema` regrava o payload** (`mensagens.repo.ts:254-258`) e o `update` de `ligacoes.repo.ts:235`
   também: os dois recalculam o `assunto`.
10. **[P2] O padrão implícito "sem assunto vai para a Atividade" com teste de grep** troca um erro de compilação por um
    sumiço silencioso. Mudou: o tipo exige (decisão 9).
11. **[P2] O `consentimento` automático tem o mesmo payload do manual** (`conceder.ts:78-89`): `assuntoDe` recebe a
    autoria, e a Parte 3 deixa de dizer que "regra automática = sem payload".
12. **[P2] O backfill não casaria as frases antigas** (várias mudaram em outubro; o #389 tira o `parei-falta-dado`). Mudou:
    `MOLDES_ANTIGOS` só para os moldes que ficam no chat, onde errar faz sumir; o resto erra só de filtro. Roda por pessoa,
    em transação escopada, imprime só contagens.

Rota, tela e frames:

13. **[P2] Cursor por `(em, id)` não atravessa as linhas agrupadas da trilha.** Mudou: a página é o dia (decisão 12).
14. **[P2] O "N hoje" não teria gatilho.** O frame `mensagem.nova` não traz assunto, e a negação de conector chega só pelo
    frame `negacao` (`registrar-negacao.ts:73-98`); recontar refazia a rota inteira. Mudou: `contagem=1`, relida com
    espera de 1 s nos três frames.
15. **[P2] Os gatilhos de reversão não tinham medição.** `atividade_aberta`, "troca" e "pílula" entram em `TipoLinha`.
16. **[P2] O relato anexa quase só aviso**: `janelaAte` lê 100 mensagens cruas (`mensagens.repo.ts:187-198`). Passa a
    contar 100 itens de chat.
17. **[P2] Pílula.** O protótipo anima `width`/`max-height` e esconde só com opacidade; fecha sozinha com o foco dentro.
    Mudou: painel absoluto com `clip-path`, `hidden`/`inert`, regra de foco, uma região `aria-live` única.
18. **[P2] Cartão encolhido**: o botão clicado não existe mais quando o cartão encolhido nasce (re-render depois do frame).
    Mudou: foco e anúncio pelo `decisaoId` decidido nesta aba; âncora fora da janela cai na posição do recibo.
    `resultado_aprovacao` já tem `turno_id` na própria mensagem (`decidir.ts:265`): nada muda no payload.

Título e narração:

19. **[P2] `nomear_frente` nunca chegaria ao modelo**: a frente da rede é o processo do dono, com o catálogo do dono
    (`coordenar-trabalhos.ts:290-293`). Cortada (decisão 16).
20. **[P2] `maxLength` 60 faria `abrir_frentes` falhar** na validação (`chamar-ferramenta.ts:82`) em vez de encurtar
    (decisão 15). `lotes_de_frentes` não tem coluna de título (`0071_frentes.sql:22-33`): migração no PR 5 (decisão 17).
21. **[P2] Medição da narração no lugar errado**: a `composicao` do Raio-X é gravada antes da fala existir
    (`emitir-plano-turno.ts:475`); vai na execução. Os `obrigatorios` (`stream-json.ts:361`) colam sempre (decisão 19).
22. **[P3]** "Sem o terceiro commit nada some do chat" não valia: a janela nova já tira os avisos da resposta. Por isso a
    janela e a tela vão juntas no PR 2.
23. **[P3] Testes que leem a conversa pela rota** e não estavam na lista: `e2e-catcher.test.ts:163/202/397-403` e
    `turnos-fila.test.ts:81`.

A medição de "Como medir" (voz de fora): os 59% de referência são contagem crua do banco, e a meta de 90% é sobre o que a
tela mostra, que depende de estado vivo (trabalhos conhecidos, relógio). O PR 1 roda o `medir-chat-limpo.ts` com as
regras de hoje para a linha de base na mesma régua; o script trata fala de turno com trabalho como escondida e os quatro
de destino temporal pelo estado atual, e diz no cabeçalho o que não reproduz.

### Medição da janela (banco sintético, 18/10)

```
                                   linhas lidas   com cache   frio
hoje (200 mais recentes)                    201      0,9 ms      -
Eng 1, 200 de chat (20 avisos/fala)       5.201      4,5 ms   14 ms
50.000 avisos depois das falas           50.150      8,0 ms   61 ms
idem, índice coberto (include assunto)   50.150      8,3 ms   21 ms  (corte só no índice)
```

Abaixo de 50 ms com cache em todos; o pior caso frio passa. O `EXPLAIN` com a conversa real do Eng 1 entra no PR 2, e o
índice coberto `include (assunto, id)` é a saída se o p95 passar de 50 ms.

### Riscos aceitos

- Falas da rotina silenciosa e os quatro avisos de destino temporal contam na janela depois de deixarem de valer.
- O histórico da memória não fica em lugar nenhum da conversa; só o estado de agora.
- Uma linha antiga de rotina com uma frase que ninguém guardou vai para a Atividade (a rotina continua em Rotinas).
- A linha de conector indisponível na Atividade não leva "Relatar".
- Dia com mais de 500 itens na Atividade: o resto só no Raio-X.
- A migração do PR 1 trava as escritas na `trilha` durante a construção do índice (com `lock_timeout` de 5 s).
- O título das frentes não tem teto no schema; a tela corta.
- A frente da rede fica com o título provisório até o fim.
- As referências de linha deste plano são da `main` 08173547 e andam quando o #389 e o PR B entrarem; quem implementa
  reancora.

### Conflitos com o #389 e o PR B

```
arquivo                          #389 (PR A)                    PR B                         Fase 3
web/telas/conversa.ts            renderMensagem: balão vira     acoesDaMensagem :76-83;      PR 2 corpoMensagem, recolherAvisos;
                                 cartão; linha das etiquetas    trecho do respondeA acima    PR 3 :181-208, :454; PR 4 blocos e
                                 reescrita                      do balão; reações embaixo    âncoras; PR 6 badgeExecutor (mesma
                                                                                             linha do #389); PR 7 cartão ao vivo
web/main.ts                      114 linhas                     ações da fala, menu ⋯        PR 2 gaveta; PR 8 faixa → pílula
web/estado/reducer.ts            -                              respondeA, hidratar-sua-vez  PR 2 NivelGaveta; PR 8 pílula aberta
web/lib/rolagem-na-tela.ts       perguntaNaJanela               -                            PR 8, no mesmo esquema
web/interface.css, mobile.css    sim                            sim                          PR 2, 4, 7, 8
src/contracts/mensagem.ts        pedido_a_pessoa, resposta      respondeA                    PR 1, 3, 4, 5
src/repositories/mensagens.repo  pedidosAPessoaDasDecisoes      (reações)                    PR 1 criar; PR 2 janela, janelaAte
src/use-cases/enviar-mensagem    -                              reações da janela            PR 2 janela; PR 3 pedidosDeColega
src/domain/redacao.ts            tira parei-falta-dado          -                            PR 1 lê os moldes
src/db/migrations                -                              reacoes (0090 provável)      PR 1 (0091), PR 5 (0092)
docs/adr                         emenda 045                     ADR nova (113 provável)      PR 2 ADR nova (114), emendas
tests/unit/web, e2e-catcher      conversa-depois, decisoes,     e2e das ações                PR 2, 3, 4, 7, 8
                                 trabalhos, e2e
```

Ordem de merge: **#389 → PR B → PR 1 → PR 5 → PR 2 → PR 3, PR 4 e PR 6 (qualquer ordem) → PR 7 → PR 8.** O PR 1 e o
PR 5 são só servidor e prompt; podem ser escritos durante a semana de medição que o PR B espera e, se ficarem prontos
antes dele, entrar antes sem conflito real (só o número da migração e a união de payloads). Tudo que mexe na web espera
o PR B, porque os dois reescrevem o `renderMensagem` e a barra embaixo da fala.

### Divisão final em PRs

```
PR  entrega                                  depende de        migração                 sozinho em produção
1   servidor da Atividade: assunto gravado,  - (depois do PR B) mensagens.assunto,       nada visível muda; janela igual;
    rota + contagem, backfill (--seco,                         índice da trilha         backfill roda depois do deploy
    --refazer), medir-chat-limpo, Raio-X
    blocosColados, rotina_evento
2   janela de chat + anexo, Atividade no     PR 1 + backfill   -                        o chat perde os avisos e ganha a
    drawer, linhas de frente fora, ponto                       gravado, PR B            Atividade; reverter = voltar a
    da memória, relato, telemetria,                                                     imagem
    ADR nova, emendas 029/041/083/110
3   troca agrupada (Parte 2), nome sempre    PR 2              -                        "Conversou com Ada e Tarsila";
                                                                                        emenda ADR-099 item 8
4   cartão encolhido (Parte 3)               PR 2, #389        -                        decisões encolhem no lugar;
                                                                                        emenda ADR-044
5   título curto, titulo_do_lote,            -                 lotes_de_frentes.titulo  títulos melhores nas linhas de hoje;
    tituloProvisorio                                                                    e2e:aceite uma vez
6   etiquetas, divisores, narração           PR 2, PR 1 + uma  -                        emenda ADR-112
                                             semana de dados
7   progresso na fala, cartão ao vivo vira   PR 2, PR 5        -                        a linha do dono continua até o PR 8
    linha (4b)
8   pílula que alarga (4c)                   PR 7, #389        -                        emenda ADR-099 item 10
```

Cada um com o seu "Pronto quando" na parte correspondente. O PR 1 fica pronto quando o backfill `--seco` em produção
imprime as contagens e a parcela sem casamento, e o `medir-chat-limpo.ts` dá a linha de base.

### Mapa de testes

```
SERVIDOR                                                   TELA
destino-no-chat (domínio)                                  janela e linhas (PR 2)
 ├ tabela total sobre kinds e payloads              [U]     ├ avisos fora, anexo sem linha, sala igual    [U]
 ├ consentimento manual × automático                [U]     ├ rotina que abriu frentes não vira resultado  [U]
 ├ chaveDoTexto: moldes, antigos, dois moldes       [U]     ├ aba antiga / DTO sem destino                [U]
 └ assunto exigido no tipo (typecheck)          [check]     └ divisor depois de esconder (PR 6)           [U]
mensagens.repo                                             Atividade (PR 2)
 ├ assunto por produtor; atualizarSistema           [I]     ├ filtros, vazio, dia anterior, truncados     [U]
 ├ janela: 1.000 avisos, anexo no corte e fora,             ├ linha "Agora" da memória                    [U]
 │  fala de task conta como anexo, sala, <200 chat  [I]     ├ N hoje relido nos três frames              [U]
 └ janelaAte com 100 itens de chat                  [I]     └ alvo: frente abre, mensagem abre + Relatar   [U]
rota atividade                                             troca agrupada (PR 3)
 ├ três fontes, sem repetir lote, fuso na virada    [I]     ├ dois lados, juntas, fala separa, não terminou [U]
 ├ dia/fuso inválido 400, outra pessoa 404          [I]     └ nome: payload, pedidosDeColega, "um colega"  [U]
 └ contagem=1 igual ao total                        [I]    cartão encolhido (PR 4)
backfill                                                    ├ cada tipo, âncora, fora da janela, antigo   [U]
 └ idempotente, --seco, --refazer, sem casamento    [I]     └ foco e aria-live só na aba que decidiu      [U]
pedir-a-bot / fechar-lote / decidir / conceder /           progresso e pílula (PR 7, PR 8)
 permitir-sempre / propostas: campos novos          [I]     ├ estados, frente fora da lista, sem âncora    [U]
abrir_frentes / tituloProvisorio / lote.titulo   [U][I]     ├ some com a fala à vista, não com espera      [U]
comporFala com a chave; obrigatorios; Raio-X        [U][I]  ├ alargar, Esc, foco ao fechar, hidden, reduzido [U]
migrações: ida e volta do rollback            [conformidade]└ carga-tela antes/depois                 [medição]
e2e-catcher: negação vai para a Atividade; "Anotei" pela rota; bot-a-bot e pedido com mensagem com os campos
novos; aprovação em lista com o cartão encolhido                                                       [E2E]
e2e:aceite (pago, uma vez no PR 5): título curto e titulo_do_lote                                     [EVAL]
```

[U] unit, [I] integração com Postgres, [E2E] `tests/concurrency/e2e-catcher.test.ts`, [EVAL] rodada com o modelo.

### O que já existe e é reaproveitado

`selectComTurno` e o índice `mensagens_por_conversa` (janela), os validadores de `GET trilha`, `trabalhos_por_conversa`,
`paraCadaPessoa` (backfill), `redigir`/`CATALOGO`, a execução do Raio-X, `pedidosAPessoaDasDecisoes` como modelo do
`pedidosDeColega`, `perguntaNaJanela` e a pílula da rolagem do #389, `levarAo`, `movimentoReduzido`, `data-disclosure`,
`regiaoPorBlocos`, `reciboDaDecisao`, `ancoraDoPedido`/`comPedidosAncorados`, `linhaDaFrente`, `tituloDoParar`,
`telemetria-linhas`.

### Fora do escopo (considerado e adiado)

- Falas da rotina silenciosa como `anexo`: só se o `medir-chat-limpo.ts` mostrar a janela tomada por elas.
- Histórico da memória na Atividade: pede índice em `events`.
- Link do resultado nos conectores ("ver o e-mail"): decisão 4.
- "Carregar anteriores" e cursor dentro do dia da Atividade.
- "Relatar" nas linhas da trilha.
- Índice coberto em `mensagens`: só se o `EXPLAIN` real pedir.
- `IntersectionObserver` para a visibilidade da fala: fica o esquema do #389, por consistência.
- Nome da frente da rede dado pelo modelo.

### Falhas em produção

```
caminho                        falha realista                         teste  tratamento                visível?
backfill                       molde antigo não casa                  sim    --seco antes, --refazer   contagem no --seco
janela                         conversa com 50 mil avisos, fria       sim    índice coberto se p95>50  lenta, não errada
rota atividade                 dia com 3.000 negações                 sim    teto 500 + truncados      "e mais N"
migração do PR 1               trilha grande, lock longo              não    lock_timeout 5 s          deploy falha e para
DTO sem destino                aba antiga no deploy                   sim    desenho de hoje           não limpa até recarregar
pílula                         fecha com o foco dentro                sim    foco vai à fala           -
cartão encolhido               fala-âncora fora da janela             sim    posição do recibo         -
pedido_respondido antigo       sem texto                              sim    "respondido"              -
```

Nenhuma falha sem teste, sem tratamento e silenciosa ao mesmo tempo.

### Paralelização

```
faixa A: PR 1 → PR 2 → PR 3 → PR 4 → PR 6 → PR 7 → PR 8   (web/telas/conversa.ts e linhas-do-chat.ts em todos)
faixa B: PR 5                                               (contracts/ferramentas-frente, domain/trabalho, migrations)
```

A e B podem andar em worktrees paralelos; os dois tocam `src/db/migrations` e `src/contracts/mensagem.ts` (número da
migração e a união de payloads), resolvidos no rebase. Dentro da faixa A, os PRs 3, 4 e 6 não dependem um do outro, mas
mexem nos mesmos arquivos de tela: um de cada vez.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 23 issues, 0 critical gaps; todos dobrados no plano |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** voz de fora por um subagente Claude (Codex não instalado): 12 pontos; entraram o destino resolvido no
  servidor, o que pede ação ficando no chat, as falas de task fora da contagem, o corte do `nomear_frente`, a régua da
  medição, a telemetria dos gatilhos, o `negacao` no "N hoje", o relato e o `turno_id` que já existe; o backfill ficou
  mais simples. O ponto da ordem com o #389 já estava coberto.
- **VERDICT:** ENG CLEARED — pronto para implementar o PR 1 depois do #389. As decisões 1 a 6 foram tomadas pelo
  orquestrador e as 7 a 21 pelo revisor, no lugar do Marlon, e podem ser revertidas.

NO UNRESOLVED DECISIONS
