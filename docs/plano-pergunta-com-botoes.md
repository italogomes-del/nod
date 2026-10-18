# Plano: pergunta com botões

Fase 2 do plano de 17/10 para deixar a conversa do nod mais perto do Rakazo e do Grok Bot (a Fase 1 é o Modo WhatsApp,
[ADR-112](adr/adr-112-modo-whatsapp.md)). A pergunta do bot à pessoa (`pedir_a_pessoa`) vira um cartão no padrão do Grok
Bot: a pergunta como título, um × para dispensar, a lista de opções com letras A, B, C e D (a que o bot recomenda em A,
com a etiqueta "Recomendo") e "Ou responda no chat abaixo". Respondida, o cartão encolhe para a opção escolhida com ✓.
Some o resto que hoje cerca a pergunta. Cinco partes, em dois PRs (ver "Divisão em PRs").

Protótipo aprovado pelo Marlon em 18/10: canvas "Nod — pergunta com botões"
(https://claude.ai/artifact/GLKzNYGiZRr3VGhBLQ7nuF, privado na conta em que foi criado). Telas: "E2 · Como o Grok Bot",
"Depois de responder", "Duas perguntas abertas", "Pergunta fora da tela", "Sua vez com botões", "Celular" e "Responder,
reagir e mais ações".

## Por que

Números de produção (18/09 a 17/10, conta Gamefik, leitura só leitura do banco):

- 71 pedidos à pessoa em 30 dias (44 perguntas, 19 faltas de dado, 8 permissões); 539 horas de bot parado.
- 84% das perguntas já vêm com `opcoes`, mas só **25%** das respostas foram um clique numa opção. As opções não acertam o
  que a pessoa quer, e a tela não ajuda: uma pergunta ocupa quatro camadas (balão com "Parei aqui", botões com duas
  frases de instrução, faixa acima do campo repetindo a pergunta, seletor "Responder à pergunta | Outro assunto").
- **47%** das faltas de dado foram fechadas no ×: o bot pede o que não devia, ou pede mal ("parei: falta …; quem destrava:
  …; não vou tentar de novo").
- Em conversa a pessoa responde em 36 s (mediana); em rotina, 110 min.

Como medir: o mesmo cálculo da análise de 17/10 (`resposta_a_pedido.texto` igual a uma das `opcoes` do
`pedido_a_pessoa` de mesmo `decisaoId`), por semana; a Parte 1 grava isso no payload para não depender de SQL. Semanas
anteriores à Parte 1 (payload sem `via`) continuam pelo SQL.

## Divisão em PRs

- **PR A = Partes 1 a 4**, com a Parte 3 só no caso de duas ou mais perguntas abertas (3a). Sem migração: reverter é
  voltar a imagem.
- **PR B = Parte 5** mais a citação de uma fala qualquer (3b), que só tem porta de entrada com o "Responder" da barra
  de ações. Leva a migração de `reacoes` e a ADR nova.
- Dentro do PR A, a Parte 2 não tira a citação "1 de 2" (`renderCitacao`) nem o "Responder a esta" antes de a 3a
  entrar: nenhum commit do PR deixa duas perguntas abertas sem dizer a qual a mensagem responde.

## Parte 1 · A pergunta bem feita (PR A)

Só servidor e prompt; a tela não muda. Vem primeiro porque a qualidade da opção é o que mais pesa no clique.

- `src/contracts/pedido.ts`: a descrição do schema passa a dizer "prefira opções: sempre que 2 a 4 respostas cobrirem,
  mande `opcoes`, escritas como a pessoa responderia; omita só quando a resposta for livre (um nome, um texto, um link)".
  Campo novo `recomendada` (inteiro, índice em `opcoes`): "quando você tiver uma recomendação, marque qual e diga o motivo
  em uma frase no `texto`; não cite letra nem posição da opção, o nod põe a recomendada em primeiro". O `texto` é a fala
  do bot ("Qual é o processo de lançamento do gamefik? Pode ser um link ou duas linhas."), nunca o molde.
  `ArgsPedirAPessoa` ganha `recomendada?: number`. O comentário de `MAX_OPCOES` (:36-39, "quatro cabem numa linha do
  balão") muda para a lista.
- `src/use-cases/pedir-a-pessoa.ts`: `normalizarPedidoAPessoa` (:44-54) roda ANTES do schema
  (`chamar-ferramenta.ts:158-159`), então é ali que `recomendada` entra; campo que ela não copia some. `normalizarOpcoes`
  (:22-36) descarta repetidas e longas, então o índice desloca: a normalização devolve `{ opcoes, recomendada? }`,
  segue a recomendada pela chave (a repetida que saiu aponta para a gêmea que ficou), **reordena para a recomendada
  ficar em A** e grava `recomendada: 0` no payload `pedido_a_pessoa` (:168). Índice inválido, opção recomendada que saiu
  por tamanho ou lista vazia: `recomendada` some, sem erro.
- O molde sai da tela: `fraseDoPedido` (:72-81) passa a gravar em `decisoes.frase` o `texto` **inteiro** (a coluna é
  `text` sem limite; quem mostra corta: `avisos.ts` já corta o corpo, a fila corta no CSS). Sem corte no banco porque a
  entrada da retomada (`responder-decisao.ts:92`) cita `d.frase`, e a retomada de rotina roda em sessão nova: cortada, o
  bot perderia a própria pergunta. Sai a entrada `parei-falta-dado` de `redacao.ts` (:54, :140) e o teste dela.
  `perguntarSemNovidade` (`me-chame-as.ts:137`), o outro produtor de `pedido_a_pessoa`, passa a gravar o texto de
  `perguntaDoAlarme` como frase, no lugar de `fraseDoAlarme`. Os cortes do molde antigo na web
  (`linha-do-dono.ts:172`, `pergunta.ts:103`) ficam: decisões abertas e vencidas de antes do deploy ainda têm o molde.
- `resposta_a_pedido` (`responder-decisao.ts:101`) ganha `via: "opcao" | "texto"` e, com `via: "opcao"`, `opcao`
  (índice). Calculado em `retomarComResposta` (fase 2, que roda pela dona e lê a conversa): `pedidoAPessoaDaDecisao(
  d.turnoId, d.id)` e uma comparação pura em `src/domain` com a mesma normalização de `normalizarOpcoes` (espaços e
  caixa). Sem `turnoId` (pergunta da sala esfriada) ou sem balão: sem `via`. `via` quer dizer "o texto é uma das
  opções" (clique, letra ou digitado igual), que é a mesma régua da medição. A rota `responder` continua recebendo só
  `texto`; um `via` no corpo é ignorado. A EMENDA 16 da ADR-045 continua: a resposta é texto, nunca id de botão.
- `src/contracts/mensagem.ts:121` e `:128`: os campos opcionais (`recomendada`; `via`, `opcao`). jsonb, sem migração
  (ADR-045). Payload antigo sem eles é o caso comum por semanas: sem etiqueta "Recomendo", ordem como veio, e a web
  compara o texto com as opções para saber qual marcar com ✓.
- Testes: unit `pedir-a-pessoa` (recomendada remapeada depois de repetida e longa, reordem para A, índice inválido,
  recomendada sem opções), `chamar-ferramenta` (:131 espera o molde na frase), `domain/redacao` (:15 sai), nova unit da
  comparação; integração `perguntas-conversa` (:36 espera o molde; passa a provar frase = texto, `via` e `opcao` no
  jsonb, `via` do corpo ignorado) e `me-chame-as`; conformidade `capabilities-consumidas`.
- **Pronto quando:** em três semanas de uso ou 30 perguntas com opções (o que vier depois; uma semana tem umas 9),
  metade das perguntas com opções respondidas são uma opção (referência: 25%) e menos de um quarto das faltas de dado são
  dispensadas (referência: 47%), sem a mediana do tempo parado por pergunta subir (referência: 36 s em conversa, 110 min
  em rotina). O PR A junta as Partes 1 a 4, então o número é do conjunto, não só do prompt.

## Parte 2 · O cartão na conversa (PR A)

- `web/telas/pergunta.ts`: `rodapeDaPergunta` (:34-64) dá lugar ao cartão. Aberta: título (o `texto`, quebra em várias
  linhas, sem reticências), × (a ação `dispensar` que hoje é "Deixar pra lá"), lista com letra, etiqueta "Recomendo" na
  A quando `recomendada` existe, "Ou responda no chat abaixo" ("Responda no chat abaixo" sem opções). Da 2ª rodada do
  fio, uma linha discreta "2ª rodada" no cartão (a faixa que dizia a rodada sai; o gatilho do fio na ADR-045 depende
  dela). Respondida por opção (`via: "opcao"` ou texto igual a uma opção no payload antigo): o cartão encolhe para a
  opção com ✓ e a fala da pessoa **não** sai como balão, como na tela "Depois de responder". Respondida por texto: o
  cartão encolhe para "Respondida" e a fala da pessoa fica onde está, com o rótulo de hoje. Vencida: "Sem resposta ·
  Reabrir", apagado. Deixada pra lá: encolhe para o título com "Deixada pra lá". Encerrada: título, sem opções. Fora de
  "aberta", nenhuma opção é clicável.
- O estado do cartão sai primeiro de `ConversaDto.fios` (vem com a conversa: `esperando_voce` na última decisão do fio,
  `deixada_pra_la`, `vencida`) e só depois de "Sua vez". Hoje, antes de "Sua vez" carregar, toda pergunta parece
  encerrada (`estadoDaPergunta`, `web/lib/perguntas.ts:94-100`); com o cartão, as opções apareceriam um instante depois
  e a conversa pularia.
- `web/telas/conversa.ts:461-468`: o balão `.pergunta` vira o cartão; o `texto` deixa de sair também como balão comum.
- Saem da conversa: "Parei aqui até você responder" e "ou responda com suas palavras" (:42-44), a faixa
  (`renderFaixaPergunta` :114-128, `renderFaixaLendo` :135), o seletor (`renderTopoComposer` :156-168) e a nota
  "Sua próxima mensagem responde…" (`aparenciaDoComposer` :229-240). O status "Esperando você" do cabeçalho fica.
  `renderEspera` (:187-211, "N coisas esperam você") fica só para os outros pedidos (aprovação, acesso), sem as linhas de
  pergunta: a pergunta já está no cartão.
- Letra digitada: com uma pergunta aberta e opções, "A", "b", "B." ou "c)" sozinhos no campo viram o texto da opção no
  cliente antes de `api.responder` (a resposta continua texto). Letra além do total vai como digitada. Uma função só em
  `web/lib/perguntas.ts`, usada pelo campo da conversa e pelo campo de "Sua vez".
- Mensagem digitada com uma pergunta aberta continua indo como resposta (o padrão de hoje em `modoDoComposer`,
  `web/lib/perguntas.ts:112-125`); o agente já separa resposta de assunto novo e de pedido de explicação. Duas ou mais
  abertas: Parte 3. Mensagem com anexo vai como mensagem comum e a pergunta segue aberta (a rota `responder` só leva
  texto; é o que o "Outro assunto" fazia), e o clipe deixa de desligar (`MOTIVO_SEM_ANEXO` sai).
- Pedido de ajuda do computador (`src/adapters/fundo/computadores.ts:381`), o terceiro produtor de `pedido_a_pessoa`:
  a resposta é "Assumir controle", não texto. O cartão dele, reconhecido pelo `ajudaDecisaoId` do computador
  (`src/contracts/computador.ts:13`), não diz "Ou responda no chat abaixo" e leva o "Assumir controle"; com ele aberto, a
  mensagem digitada vai como mensagem comum. Sem isso, uma mensagem qualquer fecharia a ajuda e o bot retomaria com o
  controle ainda em `aguardando_pessoa` (`computadores.ts:290-296`).
- Prazo: "vence em N" aparece no cartão (e em "Sua vez") só quando falta menos de 2 h. A faixa, o `renderEspera` e a
  Sua vez eram os únicos lugares que mostravam o prazo; sem nenhum, a recusa automática (decisão 4) ficaria muda.
- Clique duplo e corrida: as opções ficam desligadas enquanto `ocupado` (`agir`, `web/main.ts:562`); pergunta que venceu
  ou foi respondida em outra aba devolve o 409 de hoje e o cartão se redesenha pelo frame SSE.
- Pergunta fora da tela: a pílula das novas (`web/lib/rolagem.ts:16-24`, `rolagem-na-tela.ts`) ganha o caso "Ze 2
  perguntou algo ↓", que leva à pergunta com `levarAo` (`web/main.ts:2122-2132`). Só aparece se o cartão está no DOM
  (pergunta fora da janela carregada: sem pílula; "Sua vez" responde).
- Acessibilidade: o cartão é `role="group"` com `aria-labelledby` no título; cada opção é um `<button>` com a letra em
  `aria-hidden` e ", recomendada" em texto só para leitor de tela; o × tem `aria-label="Deixar a pergunta pra lá"` e
  `title="Fecha sem responder; nada é retomado"`, alvo de 24 px (44 px em `web/mobile.css`). Depois de responder ou
  dispensar, o foco vai para o campo da conversa e uma região `aria-live="polite"` diz "Resposta enviada: …". O
  encolher respeita `prefers-reduced-motion`; o anel de foco é `--focus-ring` e sobrevive a `forced-colors`.
- CSS em `web/interface.css` (:437-475 e :497-513) e `web/mobile.css` só com os tokens de `web/tokens.css`; nada de
  âmbar, nenhuma cor literal. O protótipo usa dois valores fora dos tokens: `#f4f4f5` (fundo da letra e da etiqueta) vira
  `--surface-raised`, e `#8e8e96` como cor de texto (letra, ×, "Ou responda…") vira `--ink-3` (contraste 4,6:1 sobre
  `--surface-raised`, contra 2,9:1). O modo escuro vem dos tokens.
- Testes: `tests/unit/web/perguntas-conversa.test.ts`, `fio-da-pergunta.test.ts`, `conversa-depois.test.ts`,
  `tela-limpa.test.ts`, `decisoes-chat.test.ts`, `um-dono.test.ts`, `chat-limpo.test.ts`, `trabalhos.test.ts`,
  `design-system.test.ts`, `cores-por-token.test.ts`, `foco-forced-colors.test.ts`,
  `tests/integration/perguntas-conversa.test.ts` e o `e2e-catcher`. Casos novos: cada estado do cartão; balão da pessoa
  escondido com `via: "opcao"`; payload antigo sem `recomendada`/`via`; cartão aberto antes de "Sua vez" carregar; letra
  dentro e fora do total; anexo com pergunta aberta vira mensagem comum; opção desligada enquanto ocupado; pílula;
  pedido de ajuda do computador; "vence em" só com menos de 2 h.
- ADR: emenda da ADR-045 nas seções "perguntas viram conversa" (:121-187) e "fio da pergunta" (:197-278), com a faixa e o
  "Outro assunto" saindo, o anexo indo como mensagem comum e os gatilhos de reversão revistos (ver "Revisão de
  engenharia").
- **Pronto quando:** uma pergunta é um elemento só na tela (referência: quatro camadas) e o clique chega à meta da Parte 1.

## Parte 3 · "Respondendo"

**3a (PR A).** Caixa presa ao campo, no padrão do Grok: "Respondendo" + trecho + ×, com duas ou mais perguntas abertas,
já apontando para a mais recente (a ADR-045 dizia a mais antiga; muda na emenda), com "Trocar". Substitui a citação
"1 de 2" (`renderCitacao` :145-150) e o Esc de "Outro assunto" (`web/main.ts:3459`). O × manda a mensagem como assunto
novo. `EscolhaComposer` (`web/estado/reducer.ts:156`, :286) mantém `alvoId`, e o × da caixa usa o `outroAssunto` de
hoje; a troca de `outroAssunto` por `respondeA` fica para a 3b.

**3b (PR B).** A pessoa escolheu "Responder" numa fala qualquer (Parte 5): a mensagem ganha `respondeA: { mensagemId,
trecho }` no payload; a conversa desenha o trecho acima do balão e a entrada do turno leva "(respondendo a: «trecho»)".
Hoje não existe citação genérica (o único rótulo é "respondendo à pergunta das HH:MM", `pergunta.ts:76-79`). Regras:

- O servidor recalcula o `trecho` a partir de `mensagemId` (o do cliente é ignorado), confere que a mensagem é da mesma
  conversa e corta no tamanho do rótulo.
- Citar uma fala `nao_confiavel` (conteúdo de conector ou de outro bot) faz o turno nascer não confiável (ADR-062): a
  citação não lava a confiança do trecho.
- `hidratar-sua-vez` (`web/estado/reducer.ts:1013-1016`) apaga a escolha do campo nas conversas sem pergunta aberta;
  `respondeA` não pode sumir por ali.
- `respondeA` de uma fala que não é a pergunta vai como **mensagem comum** mesmo com pergunta aberta, e a pergunta segue
  aberta. É o que faz o "Abrir task com isto" chegar ao bot como pedido, não como resposta.

- **Pronto quando:** com duas perguntas abertas, sempre se sabe a qual a mensagem vai responder sem seletor (PR A); uma
  fala antiga pode ser respondida e o bot recebe a citação (PR B).

## Parte 4 · O cartão na Sua vez (PR A)

- `SuaVezDto.itens` (`src/contracts/api.ts:79`) passa a trazer `texto`, `opcoes`, `recomendada` e a origem do pedido,
  todos opcionais (aba aberta com a web antiga continua funcionando). Lidos numa consulta só por um método novo
  `mensagens.pedidosAPessoaDasDecisoes(turnoIds)` (`turno_id = any(…)` e `payload->>'kind' = 'pedido_a_pessoa'`, no índice
  `mensagens_por_turno`), no lugar de uma `pedidoAPessoaDaDecisao` (`mensagens.repo.ts:217`) por item, também em
  `tests/helpers/repos-memoria.ts`. A origem é a genérica que a consulta da conversa já calcula (`raiz.origem`,
  `mensagens.repo.ts:79-82`): "rotina", "pedido de outro bot". Nome e hora ("rotina das 8h", "pedido do Milton") ficam
  para depois: custam a cadeia de `rotinaDoTurno` por item.
- `web/telas/sua-vez.ts` `renderItem` (:477-499): cabeçalho com avatar, nome, "há N" e a origem, "Abrir conversa" e ×;
  o mesmo cartão da Parte 2, clicável, respondendo por `api.responder`. Sem opções: o campo de resposta que hoje só a
  decisora que não é dona vê (:455-459) vale para todas.
- Sem balão legível, o cartão mostra a `frase` (que pela Parte 1 já é a fala do bot) e o campo: a decisora designada que
  não é dona da conversa (a RLS de `mensagens` não a deixa ler o balão, `0002_dominio.sql:252`), a pergunta da sala
  esfriada (`postar-na-sala.ts:132`, sem balão) e as perguntas de antes da ADR-045. Para a decisora que não é dona, sem
  "Abrir conversa".
- Saem a etiqueta âmbar (:492), o "vence em" fixo (:481; o prazo de 24 h continua, como ordem da fila, e volta a aparecer
  com menos de 2 h, como na Parte 2) e o botão único "Responder na conversa". Da 2ª rodada, o cartão diz "2ª rodada" ao
  lado de "Abrir conversa": a explicação do bot está na conversa, não na fila.
- O campo em todos os cartões de "Sua vez" (tela "Sua vez com botões") desfaz a regra da emenda de 24/09 da ADR-045 de
  não ter segunda caixa de texto na lista; a emenda da Parte 2 registra isso também.
- Testes: unit web de "Sua vez" (cartão com e sem opções, decisora que não é dona sem opções nem "Abrir conversa",
  pergunta sem balão, letra no campo), integração `repos/decisoes-sua-vez` e `fio-da-pergunta` (a consulta em lote devolve
  o balão certo com dois pedidos no mesmo turno e nada para a decisora que não é dona).
- **Pronto quando:** dá para responder qualquer pergunta da fila sem abrir a conversa; a fila não mostra molde nem âmbar.

## Parte 5 · Ações na fala (PR B)

- A barra que aparece ao passar o mouse (`acoesDaMensagem`, `web/telas/conversa.ts:76-83`, hoje só o besouro
  `relatar-mensagem`) vira: reagir, responder (Parte 3b), reportar (o mesmo `abrirReportarBug`, ícone de bandeira) e ⋯.
- Menu ⋯ com ícone em cada item: Copiar texto (`copiar-texto`, `web/main.ts:2509`), Abrir task com isto, Lembrar disso
  (`POST agentes/:id/memoria`, `api.criarMemoria`) e Ver no Raio-X (só no modo dev, o `abrir-raio-x` de hoje).
- Reações: tabela nova `reacoes` (tenant, mensagem, pessoa, emoji, criado_em; FK `(tenant_id, mensagem_id)`; uma por
  pessoa e emoji). `nod_escopar_tabela` com a mesma perna extra de `mensagens` (quem é da sala lê as reações dela); pôr e
  tirar só a própria. Rota para pôr e tirar, frame SSE que diz o que mudou, as reações da janela carregada lidas numa
  consulta junto da conversa, chip embaixo da fala ("👍 1"). Migração só adiciona, com `-- ROLLBACK:`.
- "Abrir task com isto": manda ao bot "abre uma task com isto" citando a fala (3b), como mensagem comum, e o bot usa
  `abrir_task`.
- ADR nova para reações e citação; a ADR-041 registra o relato saindo do besouro para a bandeira.
- **Pronto quando:** as quatro ações funcionam na web e no Mac; reportar continua levando o estado técnico (ADR-041).

## Ordem

PR A: 1 → 2 + 3a → 4, nessa ordem de commits (a 4 usa o cartão da 2). PR B depois da medição de uma semana do PR A.

## Decisões tomadas

Do Marlon, em 18/10:

1. Com uma pergunta aberta, a mensagem digitada vai como resposta (comportamento de hoje), não como assunto novo.
2. O bot não vê as reações na v1.
3. "Abrir task com isto" passa pelo bot: a web manda o pedido citando a fala e o bot usa `abrir_task`.
4. O prazo de 24 h com recusa automática fica.

Da revisão de engenharia (18/10), no lugar do Marlon, que pode reverter qualquer uma:

5. A citação genérica (3b) vai para o PR B: sem o "Responder" da Parte 5 ela não tem porta de entrada.
6. A decisora que não é dona fica sem opções em "Sua vez" (vê a fala do bot e o campo). A alternativa era copiar
   `opcoes` para uma coluna nova em `decisoes`, com migração no PR A, para um caso raro.
7. A origem em "Sua vez" sai genérica no PR A ("rotina", "pedido de outro bot").
8. `decisoes.frase` guarda o texto inteiro, sem corte.
9. Mensagem com anexo, com pergunta aberta, vai como mensagem comum.
10. "Vence em" volta ao cartão só com menos de 2 h (o protótipo não tem prazo nenhum).
11. O "Pronto quando" da Parte 1 passa a ser medido em três semanas ou 30 perguntas com opções, com o tempo parado como
    trava.

## Revisão de engenharia (18/10)

Revisão do plano contra o código da `main` em 08173547. O que virou mudança acima:

- **Recomendada perdida no caminho.** `pedir_a_pessoa` é normalizada antes do schema (`chamar-ferramenta.ts:158`) e
  `normalizarPedidoAPessoa` só copia os campos que conhece: sem mexer nela, `recomendada` nunca chega ao caso de uso.
- **Segundo produtor.** `perguntarSemNovidade` (`me-chame-as.ts:136-150`) também grava `pedido_a_pessoa`, com frase
  própria; entrou na Parte 1.
- **Frase cortada quebraria a retomada de rotina**, que só sabe o que a entrada diz (`responder-decisao.ts:92`).
- **`via` no lugar certo.** A fase 1 da resposta roda como decisora e não lê a conversa; a fase 2 roda pela dona e lê.
  `opcao` (índice) entrou junto: é o que o cartão respondido precisa para marcar o ✓ e o que mede se a recomendada acerta.
- **Tela "Depois de responder"**: o balão da pessoa some quando a resposta é uma opção. O plano não dizia.
- **Estados do cartão**: faltavam "deixada pra lá", a rodada do fio, `renderEspera` e o salto antes de "Sua vez" carregar.
- **Anexo** com pergunta aberta não tinha destino depois que o modo resposta deixa de ser visível.
- **Sua vez em lote**: `pedidoAPessoaDaDecisao` é uma por decisão; o lote é um método novo no mesmo índice. A RLS de
  `mensagens` esconde o balão da decisora que não é dona, e a origem "rotina das 8h" não tinha de onde vir.
- **Cores**: dois valores do protótipo fora de `tokens.css`, um deles com contraste abaixo de 4,5:1 em texto de 13 px.
- **Citação (PR B)**: trecho vindo do cliente e fala não confiável citada como entrada confiável; e a citação de uma fala
  qualquer, com pergunta aberta, iria como resposta à pergunta, que é o contrário do "Abrir task com isto".
- **Terceiro produtor**: o pedido de ajuda do computador (`computadores.ts:381`) se responde com "Assumir controle".
- **Prazo mudo**: o plano tirava os três lugares que mostram o prazo e mantinha a recusa automática.
- **Medição**: uma semana dá umas 9 perguntas com opções; 25% contra 50% nessa amostra é ruído. O clique também sobe por
  ancoragem na A recomendada e pela letra digitada, sem a pergunta ficar melhor; daí a trava no tempo parado.
- **Testes que quebram e não estavam na lista**: `chamar-ferramenta` :131, `domain/redacao` :15, integração
  `perguntas-conversa` :36, `trabalhos`, `design-system`, `cores-por-token`, `foco-forced-colors`, `repos-memoria`.

Riscos aceitos:

- Pedidos vencidos: referência de 11% em 30 dias. Se passar de 15% em duas semanas mesmo com o "vence em" das últimas
  2 h, o prazo volta a aparecer sempre.
- Pergunta aberta fora da janela carregada da conversa: sem faixa e sem pílula, sobra o "Esperando você" do cabeçalho e
  "Sua vez". Raro (a pergunta costuma ser a última fala do bot).
- Com uma pergunta aberta não há sinal no campo de que a próxima mensagem responde (decisão 1). Gatilho (substitui o da
  ADR-045 sobre "Outro assunto"): 3 relatos em 14 dias (ADR-041) de mensagem que virou resposta sem querer, e a caixa
  "Respondendo" passa a aparecer também com uma pergunta só.
- O × mais à vista pode subir as dispensas. A meta da Parte 1 (menos de um quarto das faltas de dado dispensadas) é o
  número que acusa.
- Reordenar para a recomendada ficar em A pode desencontrar um texto que cite posição; a descrição proíbe e o risco é de
  frase estranha, não de resposta errada (a resposta é o texto da opção).
- A descrição nova do `pedir_a_pessoa` muda o comportamento do modelo sem eval automático; a medição semanal da Parte 1
  é o eval. Uma rodada de `npm run e2e:aceite` antes do merge confere que `recomendada` chega ao payload.

Fora do escopo: os N+1 que já existem em `listarSuaVez` (aprovações e propostas por item); atalho de teclado A–D sem
foco no campo; nome e hora da origem em "Sua vez"; opções para a decisora que não é dona; o bot ver reações.

O que já existe e é reaproveitado: a rota `responder` e as duas fases, `ConversaDto.fios` (estado do cartão),
`raiz.origem` da consulta da conversa, `levarAo` e a pílula da rolagem, `agir`/`ocupado` contra clique duplo, os
testes de token e de foco.

Cobertura planejada (PR A):

```
SERVIDOR                                             TELA
pedir-a-pessoa                                       cartão na conversa
 ├ recomendada: remap, reordem, inválida, vazia [U]   ├ aberta / respondida opção / respondida texto [U]
 ├ frase = texto inteiro, 3 tipos            [U][I]   ├ vencida + Reabrir / deixada pra lá / encerrada [U]
 └ me-chame-as: frase = texto do alarme         [I]   ├ antes de "Sua vez" carregar (sem salto)       [U]
retomarComResposta                                    ├ payload antigo sem recomendada/via            [U]
 ├ via opcao + opcao / via texto                [I]   ├ letra A–D, fora do total, anexo               [U]
 ├ sem turnoId: sem via                         [I]   └ fluxo pergunta → clique → retomada        [E2E catcher]
 └ via no corpo ignorado (EMENDA 16)            [I]  Sua vez
pedidosAPessoaDasDecisoes                             ├ com/sem opções, sem balão, decisora não dona  [U]
 ├ dois pedidos no mesmo turno                  [I]   └ responder pela fila                           [U][I]
 └ decisora não dona: vazio (RLS)               [I]  3a: duas abertas, mais recente, Trocar, ×       [U]
```

[U] unit, [I] integração com Postgres, [E2E] `tests/concurrency/e2e-catcher.test.ts`. Modelo: rodada única de
`e2e:aceite` (pago) para o `recomendada`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 17 issues, 0 critical gaps; todos dobrados no plano |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** voz de fora por um subagente Claude (Codex não instalado): 10 pontos, 7 já cobertos; entraram o
  pedido de ajuda do computador, o prazo mudo, a medição e o `hidratar-sua-vez` apagando a citação.
- **VERDICT:** ENG CLEARED — pronto para implementar o PR A. As decisões 5 a 11 foram tomadas pelo revisor no lugar do
  Marlon (subagente sem o usuário) e podem ser revertidas.

NO UNRESOLVED DECISIONS
