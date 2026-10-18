# ADR-114 — Chat limpo: na conversa só fala e o que é com você

Status: proposto; parte do servidor no PR 1 do [plano do chat limpo](../plano-chat-limpo.md) (PR #390), a tela, a janela
e os gatilhos no PR 2 (ver **Emenda do PR 2**), a troca agrupada no PR 3 (ver **Emenda do PR 3**), o cartão encolhido no
PR 4 (ver **Emenda do PR 4**), as etiquetas e os divisores de data no PR 6 (ver **Emenda do PR 6**) · Data: 2026-10-18 · Migração 0091. A regra da tela, a janela que conta só o chat e os gatilhos de reversão entram no PR 2, junto da primeira
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

## Emenda do PR 2 (2026-10-18) — a janela, a tela e os gatilhos

**A regra da tela.** No chat da conversa própria ficam só as falas, a conversa com outros bots, as rotinas, o que é com
você e as entregas. A web decide pelo `destino` do DTO, nunca por texto nem por uma tabela própria:

1. `atividade` não aparece no chat. `anexo` também não vira linha (sai "Abriu a task", "Virou a frente", "Começou a
   frente", "Começou N frentes", "N frentes terminaram", "Repassou um recado", "Respondi ao pedido de" e o
   "… terminou · 39 min" acima do resultado), mas continua dando o título e a origem das tasks, e a rotina que abriu
   frentes não vira resultado antes da hora. A linha "Rotina executou" (`rotina.execucao`) também é `anexo` (revisão do
   PR 2): a execução silenciosa não grava linha nenhuma, então é ela que diz à web que a execução teve resultado; fora da
   janela, o balão "da rotina …" virava "rodou 1 vez · nada para você". Os três de destino que muda com o tempo que a web sabe medir saem quando
   deixam de valer: o limite do plano que passou (`limiteVigente`), a troca de IA decidida e o computador que voltou. A
   negação de plano ausente fica sempre: depois de a IA voltar ela ainda diz "mande a mensagem de novo" (diverge do plano,
   que a punha entre os quatro que somem).
2. Sem aviso genérico no chat, sai o recolhimento "N avisos do sistema · ver". A sala e a mensagem sem `destino` (servidor
   anterior durante o deploy) seguem o desenho de antes, com o recolhimento.
3. A pílula de memória, que morava embaixo da última "Abriu a task", vira um ponto discreto na linha do dono, com a frase
   no `title` e no nome acessível, levando a Trabalhos (o disco cheio que segura tudo leva a Este Mac ou a Máquinas). Amarela
   e vermelha são ponto; nada de faixa nem texto âmbar no chat (decisão tomada 5). O bot sem linha do dono, com trabalho
   aberto, ganha uma linha só com o ponto. "Fazer aqui" e "Fazer depois da …" vão para o topo da tela da task e para a
   linha dela em Trabalhos.

**A janela conta só o chat.** `listarComTurno` com `comDestino` traz as 200 mais recentes que são item de chat (assunto
nulo ou de destino `chat`, menos a fala do bot num turno de trabalho, que conta como `anexo`) e, desde a mais antiga delas,
os `anexo`, até 300; os `atividade` ficam fora da resposta. Quando os anexos batem no teto, o mais antigo deles vira o
piso e os itens de chat de antes dele também saem (revisão do PR 2): a janela encurta, mas não fica com a fala da pessoa
sem o resultado da task, sem a pergunta da task ou sem a linha "Rotina executou". Duas CTEs `materialized` e um join pela chave primária — com
`id in (… union all …)` o Postgres refazia a passada dos anexos para cada linha da conversa (medido em 2026-10-18 num banco
de teste: conversa sintética do Eng 1, 300 falas com 20 avisos cada, 6.300 linhas; 20 s e 5,5 milhões de buffers com o
`in`, 5 ms de execução com o join; `listarComTurno` inteiro em 11 ms de mediana, e 46 ms com 50.000 avisos depois das
falas). O índice coberto `include (assunto, id)` não foi preciso. O `EXPLAIN` com a conversa real do Eng 1 fica para
quando houver leitura de produção (esta entrega não tocou produção).

**Sem o backfill.** O PR 2 pode entrar antes de o `backfill-assunto.ts` rodar em produção. Por isso:

- no SQL da janela, a linha sem assunto conta como item de chat — conservador: nada some por causa da janela; numa
  conversa antiga cabem menos itens visíveis até o backfill rodar (no limite, a janela é a das 200 mais recentes, como
  antes do PR 2);
- na leitura, a linha sem assunto ganha o assunto que o backfill gravaria (`assuntoNaLeitura`, que chama
  `assuntoDaLinhaAntiga`: kind, payload, autoria e o texto contra os moldes; a primeira linha `sistema` da conversa é a
  criação do bot), e o destino sai dele. O aviso antigo sai do chat na tela já no deploy;
- a Atividade lista a linha sem assunto pelo mesmo caminho (entra como candidata quando não é fala e fica se o assunto
  lido é da Atividade), e a contagem resolve as candidatas do mesmo jeito, então `contagem=1` e o `total` continuam
  batendo.

Quando o backfill rodar, o assunto gravado é o mesmo que a leitura calcula e nada muda na tela; só a janela das conversas
antigas volta a caber 200 itens visíveis. `tests/integration/janela-do-chat.test.ts` cobre os dois casos.

**A Atividade no painel.** Em Atalhos, logo abaixo de Trabalhos, "Atividade · N hoje" (só no bot da pessoa; o número é o
dia inteiro, decisão tomada 1, pedido por `contagem=1` com o painel à vista e relido, juntado numa releitura por segundo,
nos frames `mensagem.nova`, `negacao` e `trabalho.mudou` do bot). O nível mostra o dia: filtros Tudo / Frentes / Bloqueios /
Máquina e IA (`aria-pressed`; item sem categoria só em "Tudo"), a hora, o título e o detalhe, "N vezes", a linha "Agora" da
memória no topo de hoje, "e mais N itens deste dia, no Raio-X", "Dia anterior ›" (e "‹ Dia seguinte" num dia passado). A
frente abre a tela dela; a mensagem abre ali mesmo o texto inteiro (`ItemDeAtividade.texto`, quando o detalhe o corta) com
o "Relatar"; a linha da trilha não leva "Relatar" (decisão 14).

**O relato** conta 100 itens de chat, como a janela, e leva junto o que estava na Atividade nos mesmos 15 min, desde o
corte, marcado `naAtividade` no trecho (emenda da ADR-041).

## Emenda do PR 3 (2026-10-18) — a conversa com outros bots numa linha

Na conversa própria, a conversa com outros bots é uma linha por troca, "Conversou com Ze 1 e Nina · 4 mensagens ⌄", que
abre no lugar (protótipo "2C · Agrupada por bot"); a regra, a resposta do lote e o nome estão na emenda da ADR-099 item 8.
Na web: `PlanoMensagem` ganha `{ tipo: "troca", chave, agenteId, mensagens }`, o HTML sai de `htmlTroca`
(`web/telas/linhas-do-chat.ts`) e `juntarTrocas` junta as vizinhas na ordem da tela (depois de "a linha desce para depois
da fala que a anunciou", que vale também para a troca que começa num `handoff`); aberta, é um `<details data-disclosure>`,
e o estado aberto sobrevive ao re-render. A mensagem sem `destino` (sala, servidor de antes) segue com as linhas de antes.
`TipoLinha` ganha `"troca"` (validado em `telemetria-linhas.ts`): "mostrada" a cada troca desenhada (`troca:<chave>`) e
"aberta" quando a pessoa abre a troca, para o gatilho de 30% da ADR-083. Nenhuma migração: os campos novos são do payload.

## Emenda do PR 4 (2026-10-18) — o cartão encolhe com o resultado

Decidido, o cartão de aprovação, proposta, acesso, pasta ou regra **encolhe no lugar** (protótipo "3A", escolhido pelo
Marlon) em vez de sumir e deixar um recibo no fim: o título do pedido e uma linha com o resultado ("Aprovado por você ·
feito 08:14 ✓", "Recusado por você", "Aprovado · 1 de 3 não saiu", "Acesso permitido · Gmail", "Regra nova", "acme
aberta para o Dev 1", "Confirmado por você"). É o gesto da pergunta respondida: `web/telas/cartao-encolhido.ts` usa as
classes do cartão dela (`cartao-pergunta respondida`, `pq-escolhida`, `pq-estado`) sem mexer em `cartao-pergunta.ts`.
"ver o e-mail" do protótipo é "detalhes" (os itens; decisão tomada 4); o acesso e a regra levam "Ver registro de
autorização" (emenda da ADR-044).

**Onde fica.** Na âncora do pedido: a última mensagem do turno que pediu **antes do recibo** — a mesma de quando o cartão
estava aberto (`ancoraDoPedido`); o turno que segue depois da decisão ("Enviado.") fica depois do cartão. O recibo leva
o turno: `resultado_aprovacao` já é gravado no turno da decisão; o `consentimento` do pedido ganha `decisaoId`, `turnoId`
e `frase`; "permitiu para sempre" ganha o payload `regra_permanente { decisaoId, turnoId, acoes }`; `pasta_aberta` ganha
`turnoId`; a proposta confirmada ou recusada (`confirmar-proposta.ts`, `confirmar-perfil.ts`, `recusar-proposta.ts`) ganha
`proposta_decidida { propostaId, tipo, titulo, estado, turnoId }` (o turno da proposta ou, na de rotina, o da decisão de
mesmo id) e o assunto novo `proposta.resultado`, de destino `chat`; as de antes, sem payload, continuam
`proposta.decidida` na Atividade. Sem turno (recibo antigo com payload, consentimento sem pedido) ou com a âncora fora
da janela, o cartão encolhe na posição do próprio recibo. O "permitiu para sempre" antigo (sem payload) continua a linha
de antes; o recibo automático e o consentimento da aprovação automática continuam na Atividade (não houve cartão). O
cartão aberto de mesmo id não é desenhado enquanto "Sua vez" não foi relida, e o pedido ainda aberto do mesmo turno vem
depois do já encolhido. "Preciso da sua decisão para continuar" continua só para o que está aberto.

**Foco e anúncio.** O cartão encolhido nasce num desenho depois do frame e da releitura, quando o botão clicado já não
existe: o clique **na conversa** guarda o id decidido (`web/lib/foco-do-encolhido.ts`, 2 min) e, no primeiro desenho do
cartão com ele, o foco vai ao título (`tabindex="-1"`) e a região `aria-live` única da conversa (`#anuncio-pergunta`)
diz "Aprovado: …"; com o foco já no campo, só o anúncio. Decidido em "Sua vez" ou em outra aba, nada. Só esse cartão
anima o encolher, uma vez, e `prefers-reduced-motion` desliga.

**Divergências do plano.** O "Pedido aberto; nada foi concedido ainda." da confirmação de um pedido de acesso
(`confirmar-proposta.ts`, a conexão e o pedido antigo) não vira cartão encolhido: confirmar só abre a decisão, o cartão
segue aberto, e a linha fica na Atividade como antes (ADR-044: "Confirmado… vale" mentia). O campo do tipo da proposta é
`tipo`, não `kind` (o nome é do discriminante do payload). O consentimento leva também a `frase` do pedido, para o título
do cartão não depender de reler a decisão. O cartão da regra tem o título "Sempre permitir editar no Google Sheets" e o
resultado "Regra nova", em vez da linha única do plano, porque o título é o pedido em todos os cartões. Nenhuma migração.

**Gatilho de reversão.** 3 relatos em 14 dias (ADR-041) de "não vi o resultado da aprovação" ou equivalente — o cartão
encolheu lá em cima, na fala que pediu, longe do fim onde a pessoa olhava: o recibo volta a ser também uma linha no fim
(a tela "3C" do protótipo), com o cartão encolhido no lugar.

## Emenda do PR 6 (2026-10-18) — etiquetas e divisores de data; a narração fica para depois

**Etiquetas.** "rodou em <máquina>" e "catcher" saem do balão: quem usa o Nod não precisa saber em que máquina a resposta
rodou. O dado continua o mesmo (a autoria da fala, ADR-016) e aparece na faixa do modo dev, ao lado do custo, e no
cabeçalho do Raio-X (`ondeRodou`, `web/telas/modo-dev.ts`; o botão da faixa leva `data-onde`). O "onde" é o da última
fala do bot no turno (`ondeDoTurno`), não o da mensagem que leva a faixa: o recibo da aprovação, gravado com a autoria
padrão do agente, diria "catcher" (revisão do PR 6). A faixa fica na última mensagem do turno que não é da pessoa: o
recibo da aprovação que a pessoa decide depois da fala leva a autoria dela e, contado como o último, deixava o turno sem
faixa (QA do PR 6). "não confiável" e "parcial" ficam: dizem algo do texto que a pessoa está lendo. A linha
efêmera do turno vivo antes da primeira ferramenta ("trabalhando · catcher · 3 s") não é fala e fica como está.

**Divisores de data** (como o "Today 00:25" do Grok; protótipos Main e F1). Além do topo, um divisor quando o dia muda ou
quando passam 30 min ou mais (decisão tomada 6) entre dois itens à vista: "Hoje 08:00" no topo e na troca de dia, só
"15:40" no mesmo dia, "Ontem 22:10", "17/10 15:02" e, de outro ano, "17/10/2025 15:02". Regras:

1. Calculado sobre os blocos já na ordem da tela, depois de esconder o que foi para a Atividade ou é `anexo`, de juntar as
   trocas e de encolher os cartões (`comDivisores`, `web/telas/divisores-de-data.ts`): um aviso escondido não abre bloco
   nem segura um bloco aberto. O topo é o primeiro item à vista, não a primeira mensagem da janela.
2. A pausa conta desde o último instante já mostrado: o fim da troca ("até 15:09"), do fio e dos avisos recolhidos da sala
   (`LinhaDaConversa` ganha `em` e `ate`); a linha que desce para depois da fala que a anunciou é mais antiga e não abre
   bloco, nem na virada do dia. O `ate` só vale até o item à vista seguinte: a troca fica na posição do pedido, e a resposta
   do colega que chega horas depois não esconde os divisores da conversa embaixo dela (revisão do PR 6). Para isso o bloco
   leva os instantes que mostra (`instantes`: a troca, a junta, o fio) e a pausa conta do último deles antes do item
   seguinte (QA do PR 6: cortar o `ate` no próprio item seguinte zerava a pausa, e a conversa das 23:45, 44 min depois da
   troca das 23:00, ficava sem divisor). A linha que junta várias execuções de rotina ("rodou 5 vezes · 09:10 a 09:50") conta pelo instante da primeira:
   o plano dela não leva as mensagens. O bloco sem tempo — o pedido ancorado e o cartão encolhido que subiu para a fala
   que pediu — fica embaixo do divisor da fala a que pertence: decidido três horas depois, o divisor entra depois do
   cartão, antes do "Enviado.".
3. A pausa é a mesma constante que separa duas trocas vizinhas (`PAUSA_QUE_ABRE_BLOCO_MS`, que substitui
   `PAUSA_QUE_SEPARA_TROCAS_MS` de `linhas-do-chat.ts`): na tela do Eng 1, as trocas das 15:02, das 15:40 e das 17:20 são
   três linhas, cada uma embaixo do seu divisor. A troca de dia também separa duas trocas (23:50 e 00:10).
4. Chave `sep:<id da primeira mensagem do bloco>` (o topo era `sep`): a fala nova sem pausa não mexe em nenhum bloco; com
   pausa, entram o divisor dela e ela. Quando a mensagem mais antiga sai da janela, o divisor do topo nasce de novo com a
   chave nova (um `<div>` a mais refeito; antes ele ficava).
5. `role="separator"` com o texto inteiro no `aria-label` ("Hoje 15:40"), mesmo quando só a hora aparece.
6. A linha "Novas" fica embaixo do divisor: quando vem no bloco da mensagem e quando fica sozinha no lugar da mensagem que
   sumiu (esse bloco não tem tempo; o divisor do item seguinte entra antes dele).
7. **Vale também na sala** e na conversa sem `destino` (servidor de antes): lá nada some, e o divisor só marca as pausas.
   Decidido nesta entrega (o plano não dizia): a sala não perde nada, e uma régua de tempo só para as duas é mais simples
   de explicar.
8. "Hoje" e "Ontem" leem o relógio da máquina, como `textoFormatado`, e não `estado.agora`: o histórico é lembrado com o
   dia de extra (`partesDaTimeline`, `web/main.ts`), e ler `estado.agora` o refaria inteiro a cada tick de 15 s
   (`divisores-de-data.test.ts` prova com `lembrar`).

Estilo: `.time-sep[role="separator"]`, 12 px em `--ink-3`, mais perto do bloco de baixo, como no protótipo; o divisor da
tela da task, sem `role`, continua como antes. Nenhuma migração, nenhum contrato novo.

**Adiado: a narração.** `NARRACAO_MAX_CHARS`/`comporFala` com a chave do Modo WhatsApp (colar só quando a resposta final
é um toco de até 80 caracteres), a linha "Progresso" sem "relatório" e a emenda da ADR-112 não entram neste PR. O plano
exige uma semana de medição de `blocosColados` antes (a execução do Raio-X grava desde o PR 1, em produção em 18/10), e o
Marlon decidiu medir o Modo WhatsApp em produção até ~20/10 sem mudar o comportamento dele no meio. Nem
`src/domain/stream-json.ts` nem `src/domain/prompt-sistema.ts` mudaram. Entra num PR próprio, com a medição em mãos; o
critério do plano ("a parcela de falas com bloco colado cai à metade da semana medida") vale para ele.

**Gatilho de reversão.** 3 relatos em 14 dias (ADR-041) de "não sei onde o bot rodou" fora do modo dev: a etiqueta volta
ao balão só quando a fala rodou numa máquina diferente da de costume do bot (`maquinaPadraoId`). Relatos de conversa
"picada" pelos divisores: a pausa sobe para 60 min, mudando só a constante.

## Gatilhos de reversão (PR 2)

- 3 relatos em 14 dias (ADR-041) de "não vi que o bot foi bloqueado" ou equivalente: a negação volta ao chat como uma
  linha quando o turno termina sem fala do bot depois dela.
- A Atividade aberta até 60 s depois de abrir a conversa em mais de 30% das aberturas em 2 semanas: algo que importava
  saiu do chat; rever a tabela. Medido pela telemetria das linhas: `TipoLinha` "atividade", uma "mostrada" a cada abertura
  da conversa própria (`atividade:<conversa>:<instante>`) e a "aberta" com a mesma chave (`web/lib/atividade-do-bot.ts`);
  a taxa aparece no Modo dev junto das outras.
- A janela da conversa com p95 acima de 50 ms em produção: o índice coberto `(tenant_id, conversa_id, criado_em) include
  (assunto, id)` em `mensagens`, numa migração aditiva.
