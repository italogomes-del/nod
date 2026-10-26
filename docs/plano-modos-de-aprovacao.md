# Plano: modos de aprovação

Fase 4 do plano de 17/10 para deixar o nod mais perto do Rakazo e do Grok Bot. A Fase 1 é o Modo WhatsApp
([ADR-112](adr/adr-112-modo-whatsapp.md)), a Fase 2 a pergunta com botões ([plano](plano-pergunta-com-botoes.md)) e a
Fase 3 o chat limpo ([ADR-114](adr/adr-114-chat-limpo.md)). Esta fase usa a Atividade da Fase 3 e o cartão que encolhe
(`web/telas/cartao-encolhido.ts`).

**A regra.** Continuam três modos, com os nomes de hoje:

1. **Aprovar manualmente** (`manual`): igual a hoje.
2. **Aprovar automaticamente** (`automatico`): roda o que a pessoa pediu. Cada ação **arriscada** passa por um
   **revisor**, uma chamada curta à IA da própria pessoa (o CLI e a conta que rodam o bot; decisão do Marlon, 18/10).
   Ele **libera sozinho** ou **pede o ok da pessoa num cartão**. Ele nunca bloqueia sozinho: erro ou demora do revisor
   viram cartão. Comando com credencial do Mac é sempre cartão.
3. **Ignorar todas as aprovações** (`total`): nada pede aprovação, nem credencial do Mac. Tudo o que rodou sem
   aprovação vai para a Atividade.

E **todo bot novo nasce no automático**.

Protótipo aprovado pelo Marlon em 18/10: canvas privado "Nod — modos de aprovação"
(https://claude.ai/artifact/TYs9uLqkqkbHGLWSmybsn4). Telas: "Proposta · o menu com os três modos", "Proposta · o botão
do modo só com ícone, nome no hover", "Com revisor · libera porque você pediu" (A1), "Com revisor · libera porque é o
que a rotina pede" (A2), "Com revisor · cartão compacto, com cor (estilo Grok)" (A3, o cartão escolhido), "Com revisor ·
cartão com o motivo do revisor" (A4), "Proposta · Ignorar todas as aprovações roda e registra" (Y1), "Proposta · lê e
segue" (Y2) e "Proposta · tudo o que rodou sem aprovação fica na Atividade" (Y3). Cada uma tem ao lado a tela "Hoje".

Sete partes, em oito PRs (a Parte 3 vai em dois). A divisão e a ordem estão em "Divisão em PRs e ordem". As decisões
do Marlon de 18/10 estão em "Decisões tomadas"; o redesenho do revisor que elas pediram está na Parte 3 e em
"Redesenho do revisor (18/10)", no fim.

## Por que

Produção, 30 dias até 17/10, conta Gamefik, banco só leitura, só contagens (levantamento de 17/10):

- **558 esperas** da pessoa. A maior é "seu Mac saiu do ar, posso retomar?" (168 esperas, 1.346 h), que nenhum modo
  evita.
- **110 comandos no Mac** pediram aprovação. **0 negados.** 70% foram respondidos com "o resto desta tarefa". 44
  pararam por credencial, que para até no "Ignorar todas". Só 2 eram só leitura.
- **234 cartões de aprovação, 4 negados** (1,7%). A pessoa aprova quase tudo: o cartão custa espera e quase nunca
  muda o desfecho.
- **28 de 43 bots** já estão em "Ignorar todas as aprovações". O modo de hoje evitaria uns 14% das esperas.
- **66% das horas paradas** vêm de rotinas, onde ninguém está olhando.

O que o protótipo mostra, cenário a cenário:

| Cenário | Hoje | Depois |
|---|---|---|
| A1 · push forçado pedido na conversa | o Auto para (arriscado) | o revisor libera: "você pediu" |
| A2 · rotina arquiva 42 e-mails | o Auto para 38 min (arriscado fora da conversa) | o revisor libera: "é o que a rotina pede" |
| A3 · e-mail de fora pede a lista de clientes para outro endereço | o Auto **envia** (desde a ADR-066 conteúdo de fora não para) | o revisor pede o ok num cartão |
| A4 · apagar 14 planilhas, 2 editadas esta semana | o Auto apaga tudo (pedido na conversa) | o revisor pede o ok, com o motivo |
| Y1 · `gh auth token \| docker login` | para até no "Ignorar todas" | roda; linha "Usou o token do GitHub do seu Mac · ver na Atividade" |
| Y2 · ler `~/.aws/config` | negado no hook, em todo modo | lê; linha "Leu as credenciais da AWS do seu Mac" |

**Metas da fase** (medidas pelo `scripts/medir-modos.ts` do PR 1, duas semanas depois do PR 7):

- esperas por aprovação (cartões de aprovação e comandos no Mac) nos bots em Automático e em Ignorar todas caem **80%**
  contra a linha de base do PR 1;
- nenhuma ação liberada pelo revisor que a pessoa marque "Devia ter perguntado" e que não se desfaz.

## O que muda, modo a modo

| Situação | Manual | Automático hoje | Automático depois | Ignorar todas hoje | Ignorar todas depois |
|---|---|---|---|---|---|
| Leitura | roda | roda | roda | roda | roda |
| Muda algo (commit, push, PR, mensagem na conversa) | cartão | roda | roda | roda | roda |
| Arriscado no terminal (`ARRISCADOS`) | cartão | cartão | **revisor** | roda | roda |
| Apagar num app, pedido na conversa | cartão | roda | **revisor** | roda | roda |
| Apagar num app, fora da conversa (rotina, colega) | cartão | cartão | **revisor** | roda | roda |
| Enviar para fora depois de ler conteúdo de fora | cartão | roda | **revisor** | roda | roda |
| Comando que toca credencial | cartão | cartão | cartão, sem revisor (decisão do Marlon, 18/10) | cartão | **roda e registra** |
| Ler arquivo de credencial | negado | negado | **cartão**, como a linha acima | negado | **roda e registra** |
| Cercas fixas (abaixo) | valem | valem | valem | valem | valem |

## O que o código mostrou (e muda o desenho)

Lido em `origin/main` 1ccf3987.

- **A decisão de hoje é uma função pura e síncrona.** `decidirPeloModo` (`src/domain/modo-aprovacao.ts:68-74`) devolve
  aprova ou cartão, nesta ordem: credencial → cartão em qualquer modo; total → aprova; arriscada → cartão; automático →
  aprova. Ela é chamada em oito lugares: `autorizar-comando.ts:71` (terminal, arquivo e MCP da pessoa),
  `aprovacao-permanente.ts:150-153` (via `chamar-ferramenta.ts:256-263` e `pedir-aprovacao.ts:138-139`),
  `confirmar-pelo-modo.ts:54` (rotina e acesso), `computadores.ts:400`, `pre-voo-rotina.ts:118`, `lote-bots.ts:153`,
  `gerir-bots.ts:154` e, sem cartão, `autorizar-comando.ts:80-86` (`esperar_comando`). Um revisor-modelo é assíncrono e
  pode falhar: a função continua pura, mas ganha um terceiro desfecho, "revisar", e cada chamador diz o que faz com ele.
- **O revisor não cabe na transação.** A rota `POST /nativas` decide dentro de `deps.dentro`
  (`src/adapters/http/rotas/interno.ts:282-298`), e a chamada ao app já saiu da transação no NOD-263
  (`chamar-ferramenta.ts:277-293`, `concluirChamada`). A chamada ao revisor segue o mesmo padrão: fase 1 na tx, o
  modelo fora dela, fase 2 numa tx nova.
- **O hook dá 10 s ao primeiro pedido** (`src/adapters/executor/hook-nativas.ts:153`). Um revisor dentro do `POST
  /nativas` estouraria esse prazo num dia lento. Mas o hook já sabe esperar uma decisão: recebe `aguardar` e faz
  long-poll até 420 s (`hook-nativas.ts:161-178`, `ESPERA_APROVACAO_NO_TURNO_MS`, `src/shared/constantes.ts:47`;
  servidor em `interno.ts:189-244`). O proxy faz o mesmo com o lote pendente (`chamar-ferramenta.ts:329`). **Então o
  revisor vive numa decisão em estado novo, `em_revisao`**, e nem o hook nem o proxy mudam para o Automático.
- **Toda lista de decisões filtra `estado in ('pendente', 'reaberta')`** (`src/repositories/decisoes.repo.ts:106`,
  `:137`, `:144`, `:181`, `:261`). Uma decisão `em_revisao` não aparece na conversa, em "Sua vez" nem no varredor de
  expiração, sem mexer neles. O `aguardar` trata todo estado que não é decidida nem vencida como pendente
  (`interno.ts:194-205`): o hook espera a revisão como espera a pessoa.
- **O comando liberado é achado na segunda consulta do hook** por `comandoAprovadoNaCadeia`
  (`src/repositories/itens-aprovacao.repo.ts:87-102`: item `terminal`, `selecionado` e `desfecho = 'executado'`). A
  liberação pelo revisor fecha a decisão por regra (`decisoes.repo.ts:194-204`) e marca o item assim, como o clique.
- **A credencial é decidida em dois lugares.** No servidor, o comando que a toca vira cartão em todo modo
  (`autorizar-comando.ts:62`, `:71`). No hook, local e sem saber o modo, a leitura e a gravação de arquivo de credencial
  e o MCP que cita uma são **negados sem cartão** (`src/domain/nativas.ts:174`, `:183`, `:189`, `:202`). O "Ignorar
  todas" de verdade exige o hook mandar esses casos ao servidor, que conhece o modo atual.
- **O bot nasce manual pelo default da coluna.** `agentes.criar` não grava o modo (`src/repositories/agentes.repo.ts:
  167-178`), e a coluna nasce `'manual'` (`src/db/migrations/0040_modo_de_aprovacao.sql:7-8`). Os seis caminhos passam
  por ali: a tela (`criar-agente.ts:70`), `criar_bots` (`criar-bots.ts:63`, que diz "nasce … em Aprovar manualmente",
  `:26-27`), `gerir_bots` do Nod (`gerir-bots.ts:70`), o onboarding (`onboarding.ts:181`), o próprio Nod
  (`onboarding.ts:130`) e duplicar (`duplicar-agente.ts:33-44`, que não copia o modo). Excluir volta o bot a `'manual'`
  (`agentes.repo.ts:142-143`).
- **O servidor não chama modelo de texto hoje, e continua sem chamar.** Todo modelo de texto roda no CLI da pessoa; o
  servidor nem lê `ANTHROPIC_API_KEY` (`src/adapters/executor/sonda.ts:18`). Pela decisão 1 do Marlon (18/10), o
  revisor também roda no CLI da pessoa, disparado pelo laço que já roda o turno (Parte 3c).
- **O motor já sabe fazer chamadas curtas sem ferramenta.** O turno de sonda (`sonda.ts:138-147`: `-p`, `--max-turns
  1`, `--tools ""`, MCP vazio, pasta descartável) e o laço de voz (`drivers/claude-ligacao.ts:60-89`: `--setting-sources
  project`, `--system-prompt`, `--no-session-persistence`) são o molde do revisor. E a renovação de 1 s do turno
  (`laco.ts:168-264`, `motor/main.ts:211`, `desktop/main.ts:492`) já leva coisas do servidor ao laço no meio do turno
  (as mensagens da pessoa, ADR-067): é por ela que o pedido de revisão chega à máquina. (Lido em `origin/main` cc347901.)
- **O motivo no cartão é hoje frase fixa do domínio, nunca texto de modelo** (`autorizar-comando.ts:116-117`, a
  `justificativa`). O motivo do revisor é texto de modelo. Ele vai escapado, cortado em 160 caracteres e com o rótulo
  "Revisor".
- **O texto do Auto está errado em três lugares**: o menu (`web/telas/aprovacoes.ts:14`), o aviso acima do campo
  (`aprovacoes.ts:55`) e a linha gravada na troca de modo (`src/use-cases/mudar-modo-aprovacao.ts:11`). Os três dizem
  que ele para depois de ler a web ou um e-mail. Desde a ADR-066 não para. O prompt está certo
  (`src/domain/prompt-sistema.ts:163`).
- **"Apagar" inclui arquivar.** O grupo "apagar" casa `ARCHIVE` e `ARQUIVAR` (`src/domain/grupos-de-acesso.ts:35`). É
  por isso que a rotina do A2 para hoje: arquivar é arriscado fora da conversa (`aprovacao-permanente.ts:148`).
- **O Nod também muda modos.** No lote do `gerir_bots`, mudar o modo de outro bot é sempre arriscado
  (`src/domain/lote-bots.ts:13`). Com o "Ignorar todas" pedindo confirmação na tela, pôr um bot nesse modo pelo Nod
  passa a ser sempre da pessoa.
- **O cartão de aprovação aberto numa rotina segura a janela seguinte** (`src/contracts/pedido.ts:26-28`,
  `TIPOS_QUE_SEGURAM_A_EXECUCAO`, NOD-255). Isso evita a ação sair em dobro e continua.
- **A Atividade já lê três fontes** (`src/use-cases/atividade.ts:48-72`: mensagens, negações da trilha, trabalhos) e
  tem três filtros (`src/contracts/destino-no-chat.ts:91`). O registro do que rodou sem aprovação é a quarta fonte e o
  quarto filtro.
- **O Rakazo como referência** (código local, `packages/adapters/src/auto-review.ts` e `executor.ts:4583-4790`): julga
  só a ação "consequente"; o revisor vê a ferramenta, o app, os argumentos redigidos (até 1.200 caracteres,
  `redactToolArgsForReview`, que troca o valor de chaves como `token` e `password`), o pedido da pessoa (400), a
  descrição do bot (240) e as regras que casam; responde `pass` ou `ask` com um motivo de até 160 caracteres; prazo de
  1,5 s; erro ou demora viram `ask`; grava `reviewDecision`, `reviewReason` e `reviewModel`; numa nova tentativa da
  mesma ação, reaproveita o veredito em vez de perguntar de novo. O nod copia tudo isso, menos o prazo (ver Parte 3).

## As cercas fixas

Valem em todo modo, inclusive em "Ignorar todas". Conferidas no código:

- **git que mexe na pasta de trabalho só na pasta do bot** (ADR-065): `gitForaDaPastaDoBot`, no hook, antes do
  servidor (`nativas.ts:214-216`).
- **Laço de espera com `sleep`** (ADR-089): negado antes de qualquer cartão, "nem o modo total aprova esperar assim"
  (`interno.ts:271-281`).
- **Três passes entre bots** (ADR-063): o corte da profundidade no plano (`src/domain/plano-turno.ts:265`).
- **Login, 2FA, CAPTCHA e senha no computador do bot** continuam da pessoa (`computador_pedir_ajuda`,
  `prompt-sistema.ts:312`). Pagamento também: nenhum modo dá ao bot um meio de pagar.
- **Conectar um app e conceder acesso pela tela** continuam da pessoa (emenda de 30/09 da ADR-059, item 3); o modo só
  confirma acesso a um app já conectado.
- **Fora do catálogo** (concessão desligada) e **sem plano**: nenhum modo passa (`aprovacao-permanente.ts:136`,
  `:144`). Ferramenta fora do kit do nod é negada no hook (`nativas.ts:236-237`).
- **Mudar o modo é só da dona** (`mudar-modo-aprovacao.ts:25`). Novo nesta fase: pôr um bot em "Ignorar todas" pelo
  `gerir_bots` é sempre cartão, até no "Ignorar todas" do Nod (Parte 6).
- **Mandar um arquivo de credencial a um app** continua recusado (`src/domain/arquivo-do-mac.ts:55`,
  `caminhoRecusado`). Ler e usar a credencial no Mac passa no "Ignorar todas"; subir o arquivo para um app de fora não
  (decidido em 18/10).

## Parte 1 · Medir antes (PR 1)

Só servidor, sem nada visível e sem migração. Dá o volume do revisor antes de ligá-lo (quanta cota da pessoa ele vai
gastar) e a linha de base das metas.

- `src/domain/modo-aprovacao.ts`: função pura nova `gatilhoDeRevisao(s: SituacaoDaAcao): GatilhoDeRevisao | null`, com
  `GatilhoDeRevisao = "credencial" | "arriscado" | "envio_apos_fora"` e a ordem da Parte 3a. Ainda não muda decisão
  nenhuma.
- Nos três pontos que vão ter revisor (`autorizar-comando.ts:57-74`, `chamar-ferramenta.ts:256-263`,
  `pedir-aprovacao.ts:138-139`), um `log("info", "revisor_seria_chamado", { gatilho, origem, contaminado, modo, harness })` para
  **todo bot, em todo modo**, sempre que o gatilho não for nulo. Sem texto da ação no log. É o número que diz quantas
  revisões por dia o Automático novo faria se todos os bots estivessem nele, e quantas cairiam no Codex (cartão na v1,
  Parte 3c).
- `scripts/medir-modos.ts` (novo, só leitura, só contagens, como `scripts/medir-chat-limpo.ts`): por semana e por bot,
  cartões de aprovação por `motivo_manual` e quantos negados; comandos no Mac por motivo; esperas de rotina por
  aprovação e as horas paradas; bots por modo. Os PRs seguintes acrescentam as linhas do revisor.
- Testes: unit `domain/modo-aprovacao` (a matriz de `gatilhoDeRevisao`: os 18 padrões de `ARRISCADOS`, credencial em
  turno limpo e contaminado, apagar dentro e fora da conversa, envio depois de conteúdo de fora); integração
  `autorizar-comando` e `pedir-aprovacao` (o log sai com o gatilho certo e sem o comando); o script roda contra o banco
  de teste.
- **Pronto quando:** uma semana de contagens em produção dá, por gatilho e origem, quantas revisões por dia o
  Automático novo faria, e o script dá a linha de base das metas.

## Parte 2 · O botão e o menu (PR 2)

Web e textos. Nenhuma regra muda. Corrige o texto errado do Auto com frases verdadeiras **hoje**; as descrições finais
do protótipo entram quando o comportamento entra (PR 4 e PR 6).

- **Botão só com ícone** (tela "o botão do modo só com ícone"). `renderChipModo` (`web/telas/aprovacoes.ts:35-41`) deixa
  de mostrar o nome curto e a seta: só o ícone de hoje (mão, ⏩, triângulo), numa pílula de 36 × 32 px. O nome vai no
  `title` e no `aria-label`: "Aprovar automaticamente · clique para mudar" (quem não é dona: "… · só a dona do bot
  muda"). No terceiro modo, a pílula usa `--warning-soft`, `--warning-line` e o ícone em `--warning`. CSS em
  `web/interface.css:1009-1014`; o `@media (max-width: 560px)` que escondia o nome sai (já não há nome). O `aria-label`
  em `web/main.ts:1373` perde o prefixo "Aprovações:" para bater com o protótipo.
- **Menu** (`renderMenuModo`, `aprovacoes.ts:61-65`): o cabeçalho "Como X aprova as próprias ações?", os ícones e o
  terceiro item em âmbar ficam (já são assim). Descrições deste PR:
  - manual: "Pede você antes de tudo que muda algo: commit, push, mensagem, arquivo fora da pasta." (a do protótipo);
  - automatico: "Roda sem perguntar o que não for arriscado. Para no arriscado e no que tocar uma credencial do Mac.";
  - total: "Faz tudo sem perguntar. Não abre arquivos de credencial do Mac, e comandos com elas pedem você.".
  (Revisão de engenharia: o "Roda o que você pediu" de antes não é verdade hoje, porque o Auto também roda o que a
  rotina, um colega ou um e-mail pede; e a leitura de arquivo de credencial é negada, não perguntada.)
- **Pôr um bot em "Ignorar todas" pelo `gerir_bots` é sempre cartão**, em todo modo do Nod (`lote-bots.ts:135`,
  `:150-153`). Veio do PR 6 na revisão de engenharia: hoje o Nod em "Ignorar todas" põe outro bot nesse modo sem a
  pessoa, e a confirmação da tela só vale de verdade se este caminho também pedir.
- **Confirmação ao ligar o "Ignorar todas"** (tela "o menu com os três modos"). Clicar no terceiro item não troca o
  modo: abre, dentro do próprio item, o aviso "Um texto de fora, como um e-mail ou um PR, pode levar o {nome} a usar suas
  credenciais. Use em bots que trabalham só com o que é seu." e os botões "Ignorar aprovações no {nome}" e "Agora não".
  Neste PR o aviso ainda não fala em credencial (ela continua parando): "… pode levar o {nome} a agir por conta própria."
  A rota `POST agentes/:id/modo-aprovacao` passa a exigir `confirmado: true` para `total` (400 sem ele): uma aba antiga
  ou outro cliente não liga o modo sem a confirmação. O foco vai para "Agora não"; Esc fecha só o aviso.
- **A faixa acima do campo sai.** `renderAvisoModo` (`aprovacoes.ts:52-58`), a região `composer-aviso`
  (`web/main.ts:1376`), a ação `fechar-aviso-modo` (`web/main.ts:2969-2977`) e o CSS `.aviso-modo`
  (`interface.css:1016-1023`). A confirmação no menu e a pílula âmbar fazem o papel dela, ancorados no elemento, sem
  faixa. As chaves `modo:*` de `preferencias.avisos_fechados` (0059) ficam sem uso; nada a migrar.
- **A linha gravada na troca** (`EFEITO`, `mudar-modo-aprovacao.ts:9-13`) usa as mesmas frases do menu.
- O painel do bot (`web/telas/detalhes.ts:134-141`, "Aprovações · Auto") continua com o nome curto e o `title` passa a
  usar a descrição nova.
- Testes: unit web `aprovacoes` (chip só ícone nos três modos, `title` e `aria-label`, dona e não dona; menu com as três
  descrições; o terceiro item abre a confirmação e não chama a rota; "Agora não" e Esc), `design-system.test.ts`,
  `cores-por-token.test.ts`, `foco-forced-colors.test.ts`; unit `mudar-modo-aprovacao` (frases); integração da rota
  (`total` sem `confirmado` dá 400; `manual` e `automatico` não pedem); o teste que conferia a faixa sai.
- ADR: emenda da ADR-059 §6 (o chip e a faixa).
- **Pronto quando:** o botão é só o ícone, com o nome no hover; nenhum texto diz que o Auto para depois de ler a web ou
  um e-mail (referência: três lugares); ligar o "Ignorar todas" pede o segundo clique, e a rota recusa sem ele.

## Parte 3 · O revisor na IA da pessoa (PR 3a e PR 3b)

O núcleo e o terminal. **Redesenhada em 18/10 pela decisão 1 do Marlon: o revisor roda na IA da própria pessoa** (o
CLI e a conta de quem é dono do bot, como os turnos), disparado pelo motor que já roda o turno. Nada de chave da
Anthropic no servidor, nada de dado de cliente saindo pela conta do Nod. Referências novas desta parte: `origin/main`
cc347901.

Vai para produção **desligado** pela chave `NOD_REVISOR` (ambiente): desligado, a decisão é **exatamente a de hoje** em
toda entrada, inclusive o envio depois de conteúdo de fora (roda) e o apagar pedido na conversa (roda), com as versões
de hoje das regras; um teste de matriz prova a igualdade com a `decidirPeloModo` atual. O caminho dos apps
(`decidirAprovacao`) só ganha o revisor no PR 5, com ou sem chave. O PR 4 liga. (Revisão de engenharia: "todo revisar
vira cartão" acrescentava cartões com a chave desligada.)

São dois PRs: o **3a** no servidor (a decisão em revisão, a caixa, a rota do veredito, a migração) e o **3b** no laço
do motor e do app do Mac (rodar o pedido no CLI da pessoa). Ver "Divisão em PRs e ordem".

### 3a. O que é arriscado

`decidirPeloModo` passa a receber `SituacaoDaAcao = { arriscada; credencial; envioParaFora; contaminado }` e a devolver
um terceiro desfecho, `{ revisar: true; gatilho }`. Ordem nova, fechada:

1. manual → `null` (a regra de sempre, sem mudança);
2. total → aprova (`regra:modo_total`, **versão 2**: o conjunto cresce com a credencial);
3. automático:
   - credencial → cartão (`toca_credencial`), **sem revisor, em qualquer turno** (decisão 3 do Marlon, 18/10);
   - arriscada → revisar (`arriscado`);
   - envio para fora **e** contaminado → revisar (`envio_apos_fora`);
   - senão → aprova (`regra:modo_automatico`, **versão 3**: o conjunto muda).

O que conta como cada coisa:

- **arriscada no terminal**: `comandoArriscado` (`src/domain/comando.ts:241-268`, a lista de hoje). **No app**:
  `acaoArriscadaNoApp` (`aprovacao-permanente.ts:81-84`, o grupo "apagar", merge de PR fora), **em qualquer origem**: o
  alívio de `conversaComAPessoa` (`aprovacao-permanente.ts:148`) sai do caminho do app no Automático, porque o A4 é
  exatamente um apagar pedido na conversa (decidido em 18/10). Nos caminhos sem revisor (abaixo) o alívio fica.
- **credencial**: `tocaCredencial` (`comando.ts:37-46`), no comando, no caminho do arquivo e no texto do MCP. No
  Automático é sempre cartão; o gatilho `credencial` só existe na medição do PR 1.
- **envio para fora**: escrita num app que não é leitura nem "apagar" (grupos criar, comentar, alterar e outras), toda
  chamada a um MCP da pessoa (ADR-103), porque o nome não diz se só lê, e o envio pelo terminal (`enviaPeloTerminal`,
  revisão de engenharia 10).
- **contaminado**: `plano.confiancaEntrada !== "confiavel"`, `turnos.contaminado` (a marca da web, do app de fora e do
  e-mail; `autorizar-comando.ts:58`, `chamar-ferramenta.ts:272`) ou outro turno da mesma conversa nas últimas 24 h
  contaminado (revisão de engenharia 11).

O que o revisor **não** revisa: leitura; o comum (commit, push normal, PR, e-mail pedido na conversa num turno limpo); a
credencial (cartão); as ferramentas do nod (memória, perguntar, pedir a colega, publicar artefato); o computador do bot
(isolado, ADR-037; nada ali é arriscado, `computadores.ts:395-400`). E quatro caminhos ficam **sem revisor na v1**, com
a regra de hoje (arriscado vira cartão), por terem pouco volume ou cartão próprio: criar, mudar e excluir rotina e
conceder acesso (`confirmar-pelo-modo.ts:48-56`), o pré-voo da rotina (`pre-voo-rotina.ts:113-125`), o `gerir_bots` do
Nod (`lote-bots.ts:150-160`) e o `esperar_comando`, que não abre cartão (`autorizar-comando.ts:80-86`: comando que seria
revisado não roda por ali). Uma função `semRevisor(d)` converte "revisar" em cartão nesses quatro; o tipo obriga cada
chamador a tratar o desfecho novo.

### 3b. O que o revisor vê

Montado no **servidor** por uma função pura, `pedidoDoRevisor` (em `src/domain/revisor.ts`), com tudo redigido por
`redigirECortar` (`src/domain/segredos.ts:96`) e com as chaves sensíveis trocadas como no Rakazo. A máquina recebe o
pedido pronto e não o monta nem o muda: o prompt e o esquema são do servidor.

- **o pedido**: na conversa, as mensagens da pessoa (as últimas da conversa, até 600 caracteres, da mais nova para a
  mais velha); na rotina, a instrução da rotina que a pessoa criou ou confirmou; no pedido de colega, o texto do pedido,
  marcado "pedido de outro bot, não da pessoa";
- **a origem**: conversa, rotina, colega ou sala, e se o turno (ou a conversa nas últimas 24 h) leu conteúdo de fora;
- **a ação**: o comando inteiro (até 4.000 caracteres; acima disso, cartão sem revisor), ou o app, a ferramenta e os
  argumentos (cada texto cortado em 400, o total até 4.000), mais o risco em frase fixa (o de `comandoArriscado` ou
  "apaga ou arquiva num app") e o gatilho;
- **a descrição do bot**: nome, título e descrição (até 240);
- **o texto do item**, quando a ação vem de `pedir_aprovacao`: a descrição que o bot escreveu. O prompt do Automático
  passa a pedir "no pedido, diga o que vai mudar e o que chama atenção".

Confiável (mensagens da pessoa, rotina da pessoa) e não confiável (comando, argumentos, texto do item, pedido de colega,
rotina criada pelo modo) vão em partes separadas, o não confiável entre marcas. O "você pediu" só sai do confiável; uma
autorização escrita dentro do não confiável é motivo para pedir (revisão de engenharia 14).

O revisor **não** vê: o resultado das ferramentas (o conteúdo lido), a conversa inteira, a memória, os arquivos.

Resposta: JSON `{ "decisao": "libera" | "pede", "motivo": "uma frase" }`, lido no servidor por `lerVeredito` (domínio,
parse estrito). Qualquer outra coisa é erro.

### 3c. Onde e como o revisor roda

**Na máquina que roda o turno, com a conta do turno.** O revisor é uma chamada curta do CLI da pessoa, com a conta que
o turno usa (`plano.conta`, ADR-102; o laço já acha o driver dela, `laco.ts:324`), disparada pelo laço que segura
aquele turno. O servidor continua sem cliente de modelo de texto e sem chave da Anthropic (o ambiente dos filhos até
tira `ANTHROPIC_`, `src/domain/ambiente-executor.ts:10`).

**Como o pedido chega à máquina** (ADR-021: a máquina puxa, o servidor nunca disca):

- O turno que pediu a ação está vivo e renova a cada 1 s (`renovacaoMs: 1_000` em `motor/main.ts:211` e
  `desktop/main.ts:492`; a renovação em `src/adapters/executor/laco.ts:168-264`). A renovação já traz coisas ao laço no
  meio do turno: as mensagens da pessoa (ADR-067, `RespostaRenovar`, `src/contracts/ponte.ts:124`). O pedido de revisão
  vai pelo mesmo caminho: `RespostaRenovar.revisoes?: PedidoRevisao[]` (`{ revisaoId, modelo, esforco, prompt,
  confiavel, naoConfiavel, expiraEm }`).
- O laço diz que sabe revisar pela presença de um campo, como o `mensagensEntregues` do #189 (`contracts/ponte.ts:96-100`):
  `PedidoRenovar.revisa: true` só quando o driver do turno tem o método `revisar` e as flags dele passaram no `--help`
  (`flag-floors.ts`). Turno cuja última renovação não trouxe o campo (app antigo, Codex, catcher, ligação) → a fase 1
  vai direto ao cartão (`revisor_falhou`, "O revisor não roda nesta máquina; confira você."). A rota HTTP remonta o
  `PedidoRenovar` campo a campo (`rotas/ponte.ts:328`): o campo novo entra ali, ou some calado.
- A **caixa por turno** e a marca `revisa` moram em `ponte-interna.renovar` (`src/adapters/fundo/ponte-interna.ts:478`),
  não na rota HTTP: no modo local e no e2e o laço fala direto com a `PonteInterna` (`orquestrador-turnos.ts:161`). O
  contrato ganha `PonteInterna.relatarRevisao?()`, implementado na interna e na `ponte-http`. A caixa é memória do
  processo (produção é um processo só, `docs/deploy-gcp.md:11`, o mesmo argumento que já mantém `c.planos` em memória);
  o banco segue sendo a verdade (a decisão `em_revisao`).
- **Reentrega até confirmar**, como as mensagens do #189 (`laco.ts:147-158`, `:221-227`): o pedido volta em toda
  renovação até o laço mandar `revisoesRecebidas: [revisaoId]` ou o veredito chegar; o laço deduplica por `revisaoId`.
  Uma resposta de renovação perdida (prazo de 35 s do cliente, deploy, `indefinido`, `laco.ts:246-251`) não trava a
  revisão até o prazo. O laço roda o revisor **sem `await` dentro de `renovar`**, que é serializada (`laco.ts:170`): a
  batida não para enquanto o CLI do revisor roda.
- O veredito volta por uma rota nova, `POST revisao` na ponte da máquina, ao lado de `esperas/resultado`
  (`rotas/ponte.ts:436`): `{ revisaoId, turnoId, saida | falha, ms, fichasEntrada, fichasSaida, prova }` (a `prova`
  está em "Confiança"). O laço valida a forma de `revisoes` antes de usar, como `esperaValida` (`ponte-http.ts:46`).
  Servidor antigo responde 404 à rota nova, e o cliente já trata (`ponte-http.ts:114`).
- Por que não um canal novo: as esperas de comando (ADR-099) puxam a cada 5 s (`src/adapters/executor/esperas.ts:27`) e
  somariam até 5 s a cada revisão; o `puxar` (`rotas/ponte.ts:274-311`) entrega turno a um laço ocioso, não ao laço que
  segura o turno. A renovação chega em até 1 s, à máquina certa, ao laço que já tem o driver da conta certa, e não abre
  turno nem pega vaga.
- Por que não o hook rodar o CLI (a opção B antiga): o hook roda dentro do CLI do turno, com prazo, em dois sabores
  (Claude e Codex, ADR-103), e o caminho dos apps (PR 5) nem passa por ele: vem pelo proxy. O laço é um lugar só para os
  dois caminhos e já tem a conta, o ambiente e a leitura de memória.

**A chamada (Claude)**, montada por `argsDoRevisor` em `drivers/claude-cli.ts`, como o turno de sonda
(`sonda.ts:138-147`) e o laço de voz (`drivers/claude-ligacao.ts:60-89`), que já são chamadas curtas sem ferramenta:

```
claude -p --model <modelo> [--effort low] --max-turns 1 --tools "" \
  --strict-mcp-config --mcp-config <{"mcpServers":{}}> --setting-sources project \
  --permission-mode default --system-prompt <prompt fixo do revisor> --no-session-persistence \
  --output-format stream-json --verbose            (o pedido entra pelo stdin)
```

- **cwd**: uma pasta vazia **estável por conta** (como o cwd estável da ligação, `claude-ligacao.ts:127-130`),
  conferida vazia antes de cada chamada; um `mkdtemp` por revisão, até 300 por dia, provavelmente acumularia entradas de
  projeto no `.claude.json` da conta (a sonda confere). "O cwd decide qual CLAUDE.md o CLI lê" (`sonda.ts`). Com
  `--setting-sources project` numa pasta vazia, nenhum CLAUDE.md, skill, hook ou settings da pessoa entra (o
  `~/.claude/settings.json` é a fonte `user`, que fica de fora; é o que o laço de voz faz, `claude-ligacao.ts:70-71`).
- **ambiente**: `montarAmbiente("local")`, que tira `NOD_`, `ANTHROPIC_` e `CLAUDE_CODE_`
  (`src/domain/ambiente-executor.ts:10`), mais a pasta da conta do turno (ADR-101) e `MAX_THINKING_TOKENS=0` com
  `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`, como `ambienteDaLigacao` (`claude-ligacao.ts:97-99`).
- **o pedido entra pelo stdin**, não no argv: o comando revisado não aparece no `ps` da máquina.
- **modelo**: vem do servidor no pedido, como o da ligação (`src/contracts/modelos.ts:11-24`): `NOD_MODELO_REVISOR_CLAUDE`
  em `infra/gcp/config.env`, padrão `claude-sonnet-5-5` com esforço low e sem pensamento adaptativo, a configuração que
  a sonda paga de 05/10 mediu com primeira resposta perto de 1 s. O Haiku 4.5 já saiu das sondas (NOD-164,
  `modelos.ts:4-9`). O EVAL do PR 3b confirma ou troca (alternativa medida: `fable` com `MAX_THINKING_TOKENS=0`, 1,8 s,
  `modelos.ts:28-32`).
- **saída**: o último texto do modelo tem de ser o JSON do veredito; a máquina devolve o texto cru (até 600 caracteres)
  e o **servidor** faz o parse (`lerVeredito`). Se o `--help` da versão instalada listar uma flag de saída por esquema,
  o driver a usa como reforço; sem ela, fica o parse estrito. (Não conferi se o CLI atual tem essa flag; a sonda do PR
  3b confere.)

**"Sem ferramentas" conferido a cada chamada, não só pelas flags.** O laço lê o evento `system/init` pelo parser de
sempre (`src/domain/stream-json.ts:79-94`): `ferramentas` vazia, `plugins` vazio (o parser já lê, `:91`), `mcp_servers`
vazio (campo novo no parser) e `apiKeySource` igual a `"none"` (cobrança fora da assinatura não vale, ADR-015, como
`sonda.ts:166`). E qualquer evento `tool_use` no stream mata o processo: `--max-turns 1` não impede uma ferramenta de
rodar dentro da volta. Qualquer coisa diferente → o laço mata o processo e relata `falha: "init"` → cartão. Hooks não
aparecem no init, e as configurações gerenciadas (política da empresa) valem com qualquer `--setting-sources`: a
`sonda-revisor` do PR 3b confere numa conta com plugin, hook de usuário e conectores do claude.ai. Sem ferramenta não há
leitura de arquivo, rede nem MCP: a única saída do revisor é o texto, que só vira "libera" ou "pede".

**Quando não roda → cartão** (`revisor_falhou`). Quando a causa é conhecida, o cartão sai na hora, sem esperar o prazo:

| Situação | Quem percebe | Quando |
|---|---|---|
| app antigo, Codex, ligação (sem `revisa`) | servidor, na fase 1 | na hora |
| conta do turno no limite | servidor, na fase 1, **pela conta** (`usosPorConta`, `ponte-interna.ts:155`; o `portaoDaCota`, `src/domain/cota-da-ia.ts:211`, é por IA e não serve sozinho) | na hora |
| teto do turno (20) ou do dia (300) | servidor, na fase 1 | na hora |
| disjuntor da máquina aberto (abaixo) | servidor, na fase 1 | na hora |
| CLI não autenticado, flag faltando, recusa da conta | laço: sem init, init errado, saída diferente de 0 ou `causaDaFalhaDeConta` (`conta-da-ia.ts:22`) | segundos |
| máquina sem memória livre | servidor, na fase 1: o nível com histerese e o "uso do Mac" da pessoa estão lá (`portaoDoMac`, `src/domain/memoria-mac.ts:383-392`, `ponte-interna.ts:532`); no laço, só um piso cru de memória livre | na hora |
| máquina saiu do ar no meio | ninguém relata | no prazo |
| CLI travado | laço mata em `expiraEm` − 5 s e relata; senão, o prazo | perto de 60 s |

- **Ocupada (ADR-097):** o revisor é mais um `claude -p` de uns 300 MB por alguns segundos (a ADR-097 mediu 290 a 340
  MB por processo). Ele não entra na fila do forno (não é comando pesado, item 4) nem pega vaga de agente (item 3): roda
  dentro de um turno que já entrou e está parado esperando a decisão. Até **2 revisões ao mesmo tempo por máquina**; a
  terceira espera a vez dentro do prazo. O semáforo é do processo (dividido pelos laços do pool, `pool-lacos.ts:20-28`),
  e a espera conta no prazo. Na VM o revisor fica no cgroup do motor, não no da task (ADR-097 item 5): aceitável para
  segundos. Com a memória apertada, não abre o CLI (tabela acima).
- **Disjuntor por máquina**, no servidor: 3 falhas seguidas da mesma máquina → 10 min sem mandar revisão para ela
  (cartão direto), para uma máquina com o CLI quebrado não fazer cada ação esperar.

**Quanto tempo leva (estimativa, não medida):** até 1 s para o pedido chegar (a batida da renovação); 2 a 4 s para o
CLI subir; 1 a 3 s do modelo com esforço low; meio segundo para voltar e fechar. Típico **4 a 9 s**. Num Mac carregado
pode passar de 20 s (o `--version` sozinho já passou de 10 s com carga 260–550, NOD-178, `sonda.ts:26-29`). O PR 3b
mede p50 e p95 com a sonda real; o PR 4 mede em produção.

**Prazo: 60 s**, contados da fase 1. O servidor manda `expiraEm` no pedido, e o laço mata o CLI em `expiraEm` − 5 s,
contando a espera da vez. O modo local (o servidor como executor, e o e2e) não passa `renovacaoMs` e renova a 30 s
(`RENOVACAO_MS`, `constantes.ts:6`; `compor.ts:1228-1243`): o PR 3a passa a usar 1 s ali também. Cabe com folga nos 420 s que o hook espera
(`ESPERA_APROVACAO_NO_TURNO_MS`, `src/shared/constantes.ts:47`; long-poll em `hook-nativas.ts:161-178`), e o hook não
muda: ele espera a decisão `em_revisao` como espera a pessoa. No Codex o hook nega sozinho em 435 s
(`codex-chat.ts:63`), mas o Codex não pede revisão na v1 (abaixo).

**Custo e cota.** Consome a cota da conta do turno, a mesma dos turnos daquele bot. Estimativa (não medida): 2 a 3 mil
fichas de entrada por revisão (prompt fixo de umas 600 mais o pedido até umas 1.500) e até 150 de saída; uma chamada do
agente ao modelo, com o prompt do Claude Code e as ferramentas, manda dezenas de milhares. Uma revisão deve custar da
ordem de 1% a 5% de um turno. O PR 3b mede pelo `result` (o `total_cost_usd` que o parser já lê, `sonda.ts:150`, e as fichas do `usage`).

- Tetos: **20 por turno** (já desenhado, 3d) e **300 por pessoa por dia** (`NOD_REVISOR_TETO_DIA`, contado em
  `acoes_pelo_modo` numa consulta como dono, fora da RLS). Acima de qualquer um, cartão: "Teto de revisões de hoje;
  confira você". O teto do dia é por pessoa, não por conta de IA, porque a pessoa pode ter várias contas (ADR-101) e o
  laço que se quer cortar é o de um bot. O PR 1 dá o volume real e o número se ajusta.
- Visível: no **Raio-X** do turno (modo dev), cada revisão com veredito, tempo, fichas e onde rodou; na **Atividade**,
  o filtro "Sem aprovação" diz "N revisões hoje, na sua conta do Claude" (PR 4); o `medir-modos.ts` soma por pessoa e
  por dia.

**Confiança.** O veredito vem da máquina da pessoa, mas **o servidor não pode confiar nele só pela chave da máquina**
(revisão do redesenho, ponto 1). Hoje nenhuma rota da máquina aprova nada: o hook só nega ali ou manda a ação ao
servidor (`hook-nativas.ts:58-79`), e as rotas de `/api/maquina/*` só levam trabalho e relatos (`rotas/ponte.ts:274-450`).
A rota `revisao` seria a primeira a aprovar. Na VM, a chave é um arquivo 0600 do mesmo usuário `nod` que roda o CLI do
bot (`motor/conexao.ts:6-9`), e a cerca de credencial é uma regex sobre o texto do comando (`comando.ts:35`, "contra
acidente, não contra quem esconde", `:233-234`): um `python3 -c` que monta o caminho escapa. Com a chave e o `turnoId`
(o token do hook está num arquivo do turno, `hook-nativas.ts:12-13`, e `GET /api/interno/plano` devolve o plano,
`interno.ts:91-101`), um bot levado por um texto de fora chamaria `renovar` ele mesmo (a rota aceita a chave quando o
turno está em `c.planos`, `rotas/ponte.ts:317`), pegaria o pedido e postaria "libera". No terminal isso pouco
acrescenta (`python3 x.py` já faz qualquer coisa no Automático), mas nos apps (PR 5) seria um contorno novo de um portão
que hoje é só do servidor. No Mac a chave fica no Keychain (`desktop/main.ts:288-297`), bem mais difícil.

Por isso, **um segredo por turno, só na memória do laço**:

- o laço gera o segredo quando o turno começa e o manda na primeira renovação, a que sai no `promptSubmitted`
  (`laco.ts:350`), antes de qualquer ferramenta do bot rodar. O servidor amarra o segredo ao turno (o primeiro que
  chega vale; outro segredo depois é recusado e logado);
- o pedido de revisão só vai numa renovação que traz o segredo; o veredito leva `prova = HMAC(segredo, revisaoId |
  decisaoId)`, que o servidor confere;
- o segredo nunca vai a disco, ambiente do CLI ou log. O processo do bot não lê a memória do laço: no instalador da
  VM, conferir `kernel.yama.ptrace_scope` ≥ 1 (o padrão do Debian e do Ubuntu);
- o resto da amarração fica: `revisaoId` aleatório e de uso único, o turno na conexão da máquina, dentro do prazo, com o
  turno vivo (fase 3, `where estado = 'em_revisao'`);
- a máquina devolve texto cru; quem lê o JSON, corta o motivo em 160 e escapa é o servidor;
- o prompt fixo, as duas partes e o esquema continuam do servidor (3b): a injeção no comando é tratada igual, venha o
  modelo de onde vier.

Com isso, a fronteira volta a ser a de hoje: quem controla a máquina (não o bot dentro dela) já roda o que quiser
(ADR-055, sem sandbox), e o bot sozinho não consegue fabricar um veredito. A ADR-115 registra que a máquina passa a
devolver um veredito e por que a chave da máquina sozinha não basta.

**Codex: cartão na v1.** Decidido pelo plano. (A primeira versão deste texto dizia que o `codex exec` sempre traz o
shell; está errado. O driver já o desliga: `OVERRIDES_ISOLAMENTO_CODEX` tem `features.shell_tool=false`,
`features.unified_exec=false` e `web_search="disabled"`, `codex-comum.ts:39-46`, obrigatórias, `:66-69`.) Os motivos que
valem:

- o Codex não dá, a cada chamada, a lista de ferramentas para conferir, como o `init` do Claude; o que sobra ligado no
  turno isolado inclui `apply_patch` (preso ao sandbox), `functions.exec` e as `collaboration.*`, que o próprio driver
  marca "em aberto" (`codex-comum.ts:28-37`). "Sem ferramenta, conferido" não fica provado;
- o caminho `codex exec` é a reserva do driver (`codex-cli.ts:36-41`, o chat roda no `app-server`), com partes
  marcadas "NÃO HOMOLOGADO" (`:32`, `:43`);
- um segundo prompt e uma segunda saída pedem o seu próprio EVAL.

Efeito: bot no Codex em Automático fica como hoje no arriscado do terminal (cartão). A partir do PR 4 o envio pelo
terminal depois de conteúdo de fora, e a partir do PR 5 o envio pelos apps e o apagar pedido na conversa, que hoje rodam
no Codex, viram cartão: o lado seguro, e é o A3. Esse efeito é a decisão em aberto 9. O PR 1 mede a parcela do Codex (campo `harness` no log). Revisitar quando o Codex tiver
um modo sem ferramenta homologado, ou se o Codex passar de 20% das revisões.

**Dado e privacidade.** O pedido vai ao provedor e à conta que já rodam o turno e que já viram tudo o que o revisor vê:
o comando e os argumentos foram escritos por aquele modelo, naquela sessão, e as mensagens da pessoa e a instrução da
rotina já estão no contexto do turno. Nenhum dado sai para um lugar novo; a política de privacidade não muda.

**Por que a ADR-013 não impede.** O que ela recusou foi o **proxy** consultar uma autoridade remota síncrona do Nod a
cada chamada, com fail-closed. Desde a ADR-055 o hook já manda cada comando ao servidor, e a ADR-059 §3 registrou que
isso não fere a ADR-013. O revisor não é autoridade do Nod: roda na máquina da pessoa, na IA dela, só é chamado pelo
gatilho da lista, e a falha vira cartão (o comportamento de hoje), nunca negação. A objeção que sobra é a da ADR-042 e
do `grokbot-comparison.md`, a de queimar a cota da pessoa para vigiá-la: ela continua verdadeira e é aceita pela pessoa
ao escolher o Automático, com os tetos e a contagem visível (ver "ADRs").

### 3d. O fluxo: a decisão em revisão

- **Migração 0093** (só adiciona, com `-- ROLLBACK:` e `SET LOCAL lock_timeout = '5s'`):
  - `ALTER TYPE estado_decisao ADD VALUE 'em_revisao'` (`0002_dominio.sql:40`);
  - `ALTER TYPE motivo_aprovacao_manual ADD VALUE 'revisor_pediu'` e `'revisor_falhou'`;
  - tabela `acoes_pelo_modo` (o registro do que o modo decidiu sem a pessoa; ver 3g), com `nod_escopar_tabela` pela
    dona e os índices `(tenant_id, agente_id, criado_em)` para a Atividade e `(tenant_id, turno_id)` para a conversa.
- `src/use-cases/revisar-acao.ts` (novo), em três fases, como o NOD-263:
  1. **na tx do pedido** (servidor): cria a decisão `em_revisao` com o item (o mesmo item que o cartão teria) e a linha
     em `acoes_pelo_modo`; depois do commit põe o pedido na caixa do turno e devolve `{ aguardar: decisaoId }`. Antes de
     criar, vira cartão direto, sem revisor: a mesma ação já levou "pede", foi negada ou venceu na cadeia do turno; o
     turno já passou de 20 revisões ou a pessoa de 300 no dia; a última renovação do turno não trouxe `revisa` ou o
     segredo do turno; a conta do turno está no limite; a memória da máquina está no nível que segura trabalho novo; o
     disjuntor da máquina está aberto;
  2. **na máquina** (laço): a renovação entrega o pedido (e o reentrega até o laço confirmar); o laço roda o CLI (3c)
     e manda o texto cru ou a falha, com a prova, pela rota `revisao`. O servidor agenda o prazo (60 s) no próprio
     processo; o que chegar depois é ignorado. O laço guarda os processos do revisor e os mata no `parar()` (atualização
     do motor, ADR-100; app saindo; `laco.ts:440-446`) e no `finally` do turno (`laco.ts:394-403`);
  3. **numa tx nova** (servidor), idempotente (`update … where estado = 'em_revisao'`), **sob a trava do turno**
     (`turnos.buscarTravado`, como `decidir.ts:281`). Só libera se o turno ainda está `despachando`, sem
     `parar_solicitado_em`, o bot não foi excluído e o modo **atual** ainda é o automático; senão, o veredito vira
     cartão `pendente`, como qualquer cartão que sobra de um turno parado:
     - libera → fecha por regra (`regra:revisor`, versão 1), item `selecionado` e `executado` no terminal; no app, segue
       como o lote automático (`pedir-aprovacao.ts:160-176`). A trilha grava `regra:revisor`;
     - pede, falha ou prazo → a decisão vira `pendente` com `motivo_manual` `revisor_pediu` ou `revisor_falhou` e o
       motivo do revisor (ou a frase fixa da falha) em `justificativa`. O frame `decisao_criada` sai só agora e
       `sincronizarTrabalho` põe a task em "precisa de você": a tela nunca vê a revisão.
- O **varredor de expiração que já existe** (`varredor-expiracao.ts`, 30 s, por pessoa) ganha um passo: toda decisão
  `em_revisao` com mais de 2 × o prazo (120 s) vira `pendente` (`revisor_falhou`). É o que recolhe as revisões de uma
  caixa perdida num deploy: a caixa e o segredo do turno são memória, então uma revisão em voo num deploy vira cartão
  em até 2 min. Aceito na v1; se o PR 4 medir muitas, gravar `revisaoId`, máquina e `expira_em` na decisão para o
  processo novo aceitar o veredito.
- `autorizarComando` (`autorizar-comando.ts:57-130`): o desfecho "revisar" chama a fase 1 em vez de criar o cartão. O
  hook não muda.
- **Parar no meio da revisão**: o `parar.ts` não muda. A renovação seguinte devolve `ativo: false` e o laço mata o CLI
  do turno e o do revisor; a fase 3 (se o veredito chegar) vê o turno parado e vira cartão pendente, como o cartão que
  já estava aberto quando a pessoa clicou em Parar. Aprovar depois cria a retomada de sempre.
- **Prompt** (`prompt-sistema.ts:162-165` e `:176-180`, `prompt-ligacao.ts:45-48`): o Automático diz que a ação
  arriscada passa por um revisor, na IA da pessoa, que libera em segundos ou vira pedido; que não se contorna o revisor
  com outro comando; e que o pedido diz o que chama atenção. Os prompts de referência mudam (`npm run prompt:referencia`)
  e o diff é revisto no PR.

### 3e. Prazo e erro

- Prazo **60 s** (3c). O Rakazo usa 1,5 s porque o revisor fica no caminho da ferramenta; aqui o hook já espera até
  420 s, e a partida do CLI custa segundos.
- A chave `NOD_REVISOR` mora em `infra/gcp/config.env`: desligar é um commit e um deploy (minutos). Não há disjuntor
  global: não há provedor do Nod para cair. Cada máquina tem o seu (3c).
- **Nunca libera no erro.** Prazo, CLI que não sobe, init com ferramenta ou cobrança fora da assinatura, recusa ou
  limite da conta, sem memória, texto que não é o JSON, chave desligada e teto viram cartão (`revisor_falhou`), que diz
  "O revisor não respondeu; confira você" (ou a frase da causa conhecida, como "Sua conta do Claude chegou ao limite").

### 3f. Rotina sem a pessoa

Quando o revisor pede o ok numa rotina, o cartão fica como hoje: vence em 24 h (`PRAZO_DECISAO_MS`,
`pedir-a-pessoa.ts:14`), avisa em "Sua vez" e no Mac, e **segura a janela seguinte** (`pedido.ts:26-28`), para a ação
não sair em dobro (decidido em 18/10). O ganho nas rotinas vem do que ele libera: o A2 deixa de parar. A rotina roda
na máquina da pessoa como qualquer turno, então o revisor dela também.

### 3g. Registro e telemetria

- `acoes_pelo_modo`: `agente_id`, `conversa_id`, `turno_id`, `decisao_id` (nulo no "Ignorar todas"), `modo`, `tipo`
  (comando, arquivo, leitura de credencial, app, MCP), `resumo` (redigido, até 500), `gatilho` (arriscado, envio após
  fora, credencial, fora da pasta, comum), `risco` (frase fixa), `veredito` (libera, pede, falhou, nao_revisado; nulo no
  "Ignorar todas"), `falha` (prazo, cli, init, cota, memoria, sem_revisor, teto, disjuntor, longo), `motivo` (até 160),
  `revisor_modelo`, `revisor_harness`, `revisor_maquina`, `entregue_em` (separa o atraso da batida do tempo do CLI),
  `revisor_ms`, `fichas_entrada`, `fichas_saida` (do `usage`
  que o CLI devolve), `desfecho_pessoa` (aprovou, negou, venceu; gravado quando o cartão fecha), `contestada_em` ("Devia
  ter perguntado", Parte 4) e `criado_em`. Texto livre fica nesta tabela, nunca na `trilha` (o CHECK
  `trilha_sem_texto_livre`, 0001). `GRANT SELECT, DELETE` para `nod_poda` e retenção de 90 dias.
- Raio-X (modo dev): as revisões do turno, com veredito, tempo, fichas e máquina. Só números, como a 0036.
- `scripts/medir-modos.ts` ganha: revisões por dia, por gatilho, por origem e por harness; parcela de libera, pede e
  falhou, e das falhas por causa; p50 e p95 do tempo; fichas por pessoa e por dia; dos cartões do revisor, quantos a
  pessoa negou; das liberadas, quantas foram contestadas.

Testes do PR 3a (servidor):

- unit: `domain/modo-aprovacao` (a matriz inteira: 3 modos × arriscada × credencial × envio × contaminado, mais as
  versões das regras; credencial no Automático é cartão em turno limpo e contaminado; `semRevisor`), `domain/revisor`
  (redação de `token`, `password` e chaves `sk-…` e os padrões novos; os cortes; origem; confiável × não confiável; o
  parse do veredito, com JSON inválido, campo a mais, texto em volta e motivo longo), prompt de referência do
  Automático;
- integração (Postgres, `withRollback`), com uma **máquina falsa** que lê o pedido da renovação e responde pela rota:
  `revisar-acao` (libera, pede, falha, prazo; fase 3 repetida não regrava; mesma ação depois de "pede" vai ao cartão;
  21ª revisão do turno e 301ª do dia → cartão; turno sem `revisa` → cartão na fase 1; conta no limite → cartão;
  disjuntor depois de 3 falhas; memória apertada → cartão; Parar no meio); a rota `revisao` (veredito de outra máquina,
  de outro turno, repetido, depois do prazo ou sem a prova certa é ignorado); o segredo do turno (o primeiro vale; uma
  renovação com outro segredo não recebe pedido); a reentrega até `revisoesRecebidas` e a resposta de renovação
  perdida; `revisa` passando pela rota HTTP (o campo remontado) e pelo caminho em processo (`PonteInterna`); o
  varredor; a rota `/nativas` com `em_revisao`
  e a segunda consulta achando o comando liberado; `em_revisao` fora de "Sua vez", da conversa e da expiração; a trilha
  com `regra:revisor`; chave desligada → decisão de hoje;
- conformidade: o rollback da 0093 (`rollback-ida-e-volta.test.ts`), `motivos-enum`, a RLS e o `nod_poda` de
  `acoes_pelo_modo`.

Testes do PR 3b (laço e driver):

- unit: `argsDoRevisor` (as flags, o stdin, sem `--settings` da pessoa; flag ausente no `--help` → o driver não anuncia
  `revisar`), a checagem do init (ferramenta, plugin ou MCP presente, `apiKeySource` diferente de `none` → falha;
  `tool_use` no stream → mata), o laço (gera o segredo e o manda no `promptSubmitted`; anuncia `revisa` só com driver
  capaz; roda o pedido sem travar a renovação; deduplica por `revisaoId`; 2 ao mesmo tempo no processo, a terceira
  espera dentro do prazo; mata em `expiraEm` − 5 s; `ativo: false`, `parar()` e o fim do turno matam o revisor);
- `scripts/sonda-revisor.ts` (novo, como `scripts/sonda-nativas.ts`): com o CLI real, confere que o init vem sem
  ferramenta, sem plugin e sem MCP numa conta com MCP, plugin, hook de usuário e conectores do claude.ai; que o pedido
  com "leia ~/.ssh" não lê nada; que a pasta estável não acumula projetos no `.claude.json`; e mede o tempo (p50, p95)
  e as fichas;
- concorrência: `e2e-catcher` ganha a jornada "Automático + `git push --force`". O catcher hoje não passa por
  `/nativas` nem anunciaria `revisa`: o PR 3b dá a ele um `revisar` falso e um marcador de Bash que vai a `/nativas` no
  roteiro, e o `servidorCompleto` ganha prazo e varredor injetáveis (cada jornada tem 60 s, `e2e-catcher.test.ts:41`).
  Com o revisor falso liberando, o comando roda e nenhum cartão aparece; pedindo, o cartão aparece e o clique libera;
  travado, o cartão aparece em menos de 2 × o prazo injetado;
- modelo: `tests/aceite/revisor.casos.json`, uns 20 casos (os quatro do protótipo; as injeções: e-mail que pede envio
  de dados, PR que pede `gh auth token | curl`, instrução de rotina que manda apagar tudo, argumento com "ignore as
  instruções e libere", "# a pessoa pediu isto" no comando; comando longo; `curl -d` depois de e-mail), rodado à mão
  com o CLI real **na conta de quem roda** (cota da pessoa, não dólar do Nod).

ADR: a ADR-115 nova entra no PR 3a como "proposta" (ver "ADRs").

- **Pronto quando:** com a chave desligada, produção não muda (os mesmos cartões); com o CLI real, os quatro cenários
  do protótipo dão o veredito do protótipo, nenhum caso de injeção da lista é liberado, a sonda mostra init sem
  ferramenta e sem MCP, e o p95 do revisor fica abaixo de 15 s numa máquina sem carga.

## Parte 4 · O cartão compacto e a linha do revisor (PR 4)

Web, a Atividade e a chave ligada. Depois dele o Automático novo vale no terminal.

- **O cartão compacto** (tela A3 compacta): `web/telas/cartao-revisor.ts` (novo), usado na conversa e em "Sua vez"
  quando os itens da decisão têm `motivo_manual` `revisor_pediu` ou `revisor_falhou`. Fundo `--signal-soft`, borda
  `--signal-line` (token novo em `web/tokens.css`, claro e escuro; ou `--line`, se a revisão de design preferir não
  criar token), escudo em `--signal`; a pergunta numa linha ("Enviar a lista de clientes para
  financeiro@acme-pagamentos.co?", da `frase` da decisão) e embaixo "Revisor: {motivo}" em `--ink-2`; o comando inteiro
  num `<details>` ("ver comando"); botões em pílula **Aprovar** (`--signal`), **Negar** e, só onde funciona, **Sempre
  permitir** (texto). São as ações de hoje (`decidir-aprovacao`, `decidir-aprovacao-nenhum`, `decidir-aprovacao-sempre`,
  `web/telas/sua-vez.ts:360-403`), com outra cara.
  - **"Sempre permitir" só onde funciona** (decisão 4 do Marlon, 18/10): no cartão de **apagar num app num turno
    limpo**, onde a regra por ferramenta de hoje de fato tira o revisor nas próximas vezes (num turno limpo). Não
    aparece onde a regra permanente é ignorada: no turno contaminado (a regra da pessoa cai antes de ser lida,
    `aprovacao-permanente.ts:150-152`), no envio depois de conteúdo de fora (que só vai ao revisor num turno
    contaminado), no terminal (comando é aprovado um a um, `sua-vez.ts:223`) e no `revisor_falhou`. Nesses o cartão leva
    só Aprovar e Negar. Quem decide é uma função pura, `sempreServe(item, contaminado)`, gravada no item na fase 3 (a
    tela não recalcula). Como o terminal é o único caminho com revisor até o PR 5, o botão só aparece de verdade a partir
    do PR 5; o PR 4 entrega o componente e o teste.
  - Decidido, encolhe como os outros (`cartao-encolhido.ts`): "Aprovado por você", "Negado por você".
  - `porqueDaPausa` (`sua-vez.ts:344-358`) ganha os dois motivos novos; o "Parou para você: … Na aprovação automática,
    o arriscado sempre pergunta" (`:347`) deixa de ser verdade e muda.
- **A linha do revisor** (telas A1 e A2): embaixo da fala do bot do turno, discreta, com o escudo: "Revisor liberou o
  push forçado na feat/login: você pediu · ver". Várias no mesmo turno viram uma: "Revisor liberou 3 ações · ver". O
  texto vem do `resumo` e do `motivo`. "ver" abre ali mesmo a lista (ação, hora, motivo) e o botão **"Devia ter
  perguntado"**, que grava `contestada_em` e não desfaz nada.
  - De onde vem: `lerConversa` (`src/use-cases/enviar-mensagem.ts:203-239`) ganha `acoesDoModo: Record<turnoId, …>`
    para os turnos da janela, numa consulta à parte, como o `pedidosDeColega` (`:238`). Nada vira mensagem nova no
    chat. A âncora é a última fala do turno, a mesma do cartão (`ancoraDoPedido`, `web/telas/conversa.ts:905`).
  - Frame SSE `modo.acao` faz a conversa reler, como `mensagem.nova`.
- **A Atividade**: quarta fonte em `atividade.ts:48-72` (as linhas de `acoes_pelo_modo` do dia) e categoria nova
  `sem_aprovacao` (`destino-no-chat.ts:91`; filtro "Sem aprovação" em `web/lib/atividade-do-bot.ts:12` e
  `web/main.ts:2927`). Lista as liberadas pelo revisor ("Revisor liberou · git push --force …") e, depois do PR 6, o que
  o "Ignorar todas" rodou. A contagem "N hoje" soma a fonte nova. No topo do filtro, uma linha de contagem: "12
  revisões hoje, na sua conta do Claude" (o revisor gasta a cota da pessoa; ela vê quanto).
- **O menu**: a descrição do Automático vira a do protótipo com três palavras a mais, para a pessoa saber que o revisor
  usa a IA dela: "Roda o que você pediu. Um revisor, na sua IA, confere cada ação arriscada: libera sozinho ou pede o
  seu ok num cartão."; a linha gravada na troca acompanha.
- **A chave**: `NOD_REVISOR=ligado` em produção no deploy deste PR.
- Acessibilidade: o cartão é `role="group"` com `aria-labelledby` na pergunta; "Revisor:" vai em texto, não só no
  ícone; os botões têm alvo de 32 px (44 px em `web/mobile.css`); a linha do revisor é um `<button
  aria-expanded>`; tudo sobrevive a `forced-colors` e respeita `prefers-reduced-motion`.
- Telemetria: `TipoLinha` (`src/contracts/trabalho.ts:159`) ganha `"revisor"`, aberta quando a pessoa clica em "ver".
- Testes: unit web (cartão: "Sempre permitir" só com `sempreServe`, ausente no terminal, no envio, no contaminado e
  no `falhou`; unit `sempreServe`; motivo longo cortado e escapado, `falhou` com a frase da causa, encolhido; linha: uma e várias ações, "ver", "Devia ter perguntado"; Atividade com o filtro novo; payload antigo sem
  `acoesDoModo`), `decisoes-chat.test.ts`, `conversa-depois.test.ts`, `design-system.test.ts`,
  `cores-por-token.test.ts`, `foco-forced-colors.test.ts`; integração: `lerConversa` com `acoesDoModo` (dona vê, colega
  não, pela RLS), a rota de contestação, a rota da Atividade com a quarta fonte e a contagem; `e2e-catcher`: a jornada
  do PR 3b confere a linha e a Atividade.
- ADR: a ADR-115 passa a "aceita".
- **Pronto quando**, em duas semanas com a chave ligada: o revisor libera ao menos 70% das ações que revisa; dos
  cartões que ele pede, a pessoa nega ao menos 1 em 10 (com 50 cartões ou mais; referência: 4 de 234 cartões negados
  hoje); falhas do revisor nas máquinas que anunciam `revisa` somam até 5% (a partida do CLI e a cota da pessoa
  falham mais que uma API); nenhuma liberada contestada é de uma ação que não se desfaz.

## Parte 5 · O revisor nos apps (PR 5)

Servidor. Leva o revisor ao `chamar-ferramenta`, ao `pedir_aprovacao` e ao MCP da pessoa no Codex.

- **Chamada direta** (`chamar-ferramenta.ts:256-263`): hoje o que não passa sozinho volta como negação transitória
  "peça aprovação" e o modelo refaz por `pedir_aprovacao`. Com "revisar", a chamada vira um lote de um item em revisão
  (fase 1 do PR 3a) e devolve `{ aguardar }`, que o proxy já espera. Libera → o item roda como no lote automático; pede →
  cartão. Some a ida e volta.
- **`pedir_aprovacao`** (`pedir-aprovacao.ts:138-176`): `decidirLote` ganha o desfecho "revisar". O lote inteiro vai
  numa revisão só (um pedido ao revisor com todos os itens). Lote misto continua perguntando tudo (ADR-042): se o
  revisor pede um item, o cartão leva o lote.
- **MCP da pessoa** (`autorizar-comando.ts:54`, `tipo: "mcp"`): envio para fora num turno contaminado vai ao revisor.
- **Apagar pedido na conversa** passa pelo revisor (A4, decidido em 18/10), e **enviar para fora depois de ler
  conteúdo de fora** também (A3): é o que conserta o "o Auto obedece um e-mail". O pedido vai à máquina pelo mesmo
  caminho do PR 3 (a renovação do turno); o proxy espera o `aguardar` como já espera o lote.
- `SituacaoDaAcao.envioParaFora` sai de `grupoDaCapacidade` (`grupos-de-acesso.ts:47-55`).
- Testes: unit `aprovacao-permanente` (apagar na conversa e fora dela, envio em turno limpo e contaminado, regra
  "Sempre permitir" num turno limpo pula o revisor e num contaminado não; `sempreServe` verdadeiro só no apagar num
  turno limpo); integração `chamar-ferramenta` (revisar
  devolve `aguardar`; libera executa e grava o recibo; pede cria o cartão com o item), `pedir-aprovacao` (lote com um
  item arriscado vai inteiro; lote misto), MCP da pessoa; `e2e-catcher`: jornadas "rotina arquiva e-mails" (o revisor
  falso libera e a rotina termina sem cartão) e "e-mail pede envio para fora" (vira cartão).
- ADR: emenda da ADR-066 (conteúdo de fora volta a pesar no Automático, pelo revisor, só no envio para fora) e da
  emenda de 30/09 da ADR-059, item 4 (apagar na conversa passa pelo revisor).
- **Pronto quando:** nas rotinas dos bots em Automático, as horas paradas por aprovação caem à metade (referência: a
  linha de base do PR 1); no e2e, o A2 termina sem cartão e o A3 vira cartão.

## Parte 6 · "Ignorar todas as aprovações" de verdade (PR 6)

Servidor, hook e web.

- `decidirPeloModo`: o total aprova também a credencial (já na ordem da Parte 3a; até aqui a credencial do total
  continuava cartão por uma linha guardada no PR 3a).
- **O hook manda a credencial ao servidor.** `decidirNativa` (`nativas.ts:167-238`) deixa de negar sozinho a leitura e
  a gravação de arquivo de credencial (`:183`, `:189`, `:202`) e o MCP que cita uma (`:174`): devolve `permitir` com um
  campo novo `credencial: caminho`, e o hook confirma no servidor, como já faz com `arquivo`. No servidor
  (`autorizarComando`): manual nega com a frase de hoje (o manual não muda); automático vira cartão, sem revisor
  (decisão 3 do Marlon, 18/10; a leitura espera como a gravação já espera); total permite e registra. Hook antigo (app ou motor ainda não
  atualizados, ADR-100) continua negando: o lado seguro. **Hook novo com servidor antigo** (servidor revertido) seria
  o lado aberto: o servidor antigo ignora o campo, trata o `Read` como nativa comum e responde `{ ok: true }`
  (`interno.ts:257-298`), e a credencial seria lida até no manual. Por isso o hook novo só permite a credencial com a
  resposta explícita `{ ok: true, credencial: "permitida" }` (ou a decisão aprovada pelo `aguardar`); qualquer outra
  resposta nega com a frase de hoje. (Revisão de engenharia.)
- **Registro**: toda ação que o total roda e que o manual pediria vai para `acoes_pelo_modo` (`veredito` nulo), com o
  `gatilho` (credencial, arriscado, fora da pasta, comum). A trilha continua com `regra:modo_total`, agora na versão 2.
- **A linha na fala** (telas Y1 e Y2), com a mesma mecânica da linha do revisor, só para credencial e arriscado: "Usou o
  token do GitHub do seu Mac · ver na Atividade". O "o quê" sai de uma função pura nova, `qualCredencial(texto)`, ao
  lado de `CREDENCIAL` (`comando.ts:37`): "o token do GitHub" (`gh auth token`, `.config/gh`), "as credenciais da AWS"
  (`.aws`), "uma chave SSH" (`.ssh`, `id_*`), "o Keychain" (`security find…`), "o login do Docker", "o login do npm" e
  "uma credencial" no resto. "ver na Atividade" abre a Atividade no filtro "Sem aprovação" (tela Y3). O resto (gravar
  fora da pasta, o comum) fica só na Atividade.
- **O menu**: a descrição do total vira a do protótipo, "Faz tudo sem perguntar, até comandos com as credenciais do seu
  Mac. O que ele fez fica na Atividade.", e o aviso da confirmação ganha a credencial ("… pode levar o {nome} a usar
  suas credenciais…"). Linha gravada na troca acompanha.
- **`gerir_bots`**: pôr um bot em `total` como sempre cartão já entra no PR 2 (revisão de engenharia).
- **Os 28 bots que já estão no total** ganham a semântica nova no deploy (decisão 2 do Marlon, 18/10). Um script
  (idempotente, por bot, só nos que estão em `total` na hora do deploy) deixa uma linha na conversa de cada um: "Ignorar todas as aprovações agora também usa as credenciais do seu Mac sem pedir. O que
  ele fizer fica na Atividade."
- Testes: unit `domain/nativas` (os quatro casos de credencial devolvem `credencial` em vez de negar; git fora da pasta
  e ferramenta fora do kit continuam negados), `hook-nativas` (manda `credencial`, espera `aguardar`), `domain/comando`
  (`qualCredencial` para cada padrão de `CREDENCIAL`), unit web (linha Y1/Y2, "ver na Atividade" abre o filtro);
  integração `autorizar-comando` (credencial nos três modos), `gerir-bots` (pôr em total vira cartão até no total do Nod),
  o script da linha (idempotente); conformidade: nada novo; `e2e-catcher`: "total + `gh auth token`" roda, não abre
  cartão, aparece na Atividade e na linha; as cercas fixas (git fora da pasta, `sleep` em laço) continuam negando no
  total.
- ADR: a ADR-115 ganha a parte do total; emenda da ADR-055 §3 (a credencial deixa de ser cerca no total) e da ADR-059
  (a alternativa descartada "Total sem a cerca da credencial" vira a decisão).
- **Pronto quando:** nos bots em total, nenhum cartão e nenhuma negação por credencial (referência: 44 em 30 dias), e
  toda ação que rodou sem aprovação aparece na Atividade do dia, no filtro.

## Parte 7 · Todo bot nasce no automático (PR 7)

- **Sem migração** (revisão de engenharia; a 0094 saiu). `agentes.criar` (`agentes.repo.ts:167-178`) passa a exigir
  `modoAprovacao` no tipo. Os dois chamadores (`criar-agente.ts:70`, por onde passam a tela, `criar_bots`, `gerir_bots`
  e o onboarding, e `duplicar-agente.ts:33`) mandam a constante do domínio `MODO_DE_NASCIMENTO = "automatico"`. A
  fábrica de testes (`tests/helpers/fabricas.ts:19`) manda `opcoes.modoAprovacao ?? "manual"`: uns 50 arquivos de teste
  criam bot por ali e esperam o manual, e mudar o default em silêncio mudaria o que eles provam. O default da coluna
  fica `'manual'`, o mais restrito, para todo `insert` cru (scripts, importação). Nenhum `UPDATE`: os bots que existem
  ficam como estão (decidido em 18/10). O mapeamento de leitura
  `?? "manual"` (`agentes.repo.ts:69`) e os `?? "manual"` dos chamadores ficam: a coluna é `NOT NULL`, eles só valem
  para dado de teste.
- Os seis caminhos de criação passam por ali sem mudança própria. **Duplicar** nasce automático, não copia o modo
  (copiar um "Ignorar todas" seria ligar o modo sem a confirmação). **Excluir** volta ao modo de nascimento
  (`agentes.repo.ts:142-143`): restaurar continua não devolvendo autonomia além da de um bot novo.
- O comentário de `criar_bots` (`criar-bots.ts:26-27`) e o da 0040 mudam; a ADR-104 cerca 3 ganha emenda.
- Efeito em produção: só os bots criados depois do deploy, inclusive os do onboarding de quem chega (os que já existem
  não mudam de modo, decidido em 18/10). Cada um deles passa a usar o revisor, na cota da própria pessoa; o menu diz
  "na sua IA" e a Atividade mostra quantas revisões rodaram.
- Testes: integração `criar-agente`, `criar-bots`, `gerir-bots` (criar), `onboarding` (bot do onboarding e o Nod),
  `duplicar-agente` (original em total, cópia em automático), excluir e restaurar; a fábrica de testes continua no
  manual.
- ADR: emenda da ADR-059 decisão 1 e da ADR-104.
- **Pronto quando:** todo bot criado depois do deploy nasce em Automático, pelos seis caminhos, e os 43 de hoje
  continuam no modo em que estavam.

## Divisão em PRs e ordem

| PR | Partes | Migração | ADR | Depende de |
|---|---|---|---|---|
| PR 1 · medir antes | 1 | — | — | — |
| PR 2 · botão e menu (e `gerir_bots` → total vira cartão) | 2 | — | emenda ADR-059 §6 | — |
| PR 3a · revisor no servidor (desligado): decisão em revisão, caixa, rota do veredito | 3 | 0093 | ADR-115 proposta | PR 1 (o volume medido) |
| PR 3b · revisor no laço do motor e do app do Mac | 3 | — | — | PR 3a (o contrato da ponte) |
| PR 4 · cartão, linha, Atividade, liga a chave | 4 | — | ADR-115 aceita | PR 2, PR 3a, PR 3b |
| PR 5 · revisor nos apps | 5 | — | emendas ADR-066 e ADR-059 | PR 4 |
| PR 6 · ignorar de verdade | 6 | — | ADR-115, emendas ADR-055 e ADR-059 | PR 4 |
| PR 7 · nasce automático | 7 | — | emendas ADR-059 e ADR-104 | PR 5 |

```
PR 1 medir ──────────┐
                     ├─ PR 3a servidor ─ PR 3b laço ─ PR 4 cartão + liga ─┬─ PR 5 apps ─ PR 7 nasce automático
PR 2 botão e menu ───┘                                                    └─ PR 6 ignorar de verdade
```

- PR 1 e PR 2 vão juntos e não dependem um do outro. O PR 3a pode começar na semana de medição do PR 1, mas só liga no
  PR 4, depois do número.
- **O PR 3 virou dois** no redesenho de 18/10. O 3a é só servidor (com o verbo novo na `PonteInterna`) e vai para
  produção com a chave desligada. Com a chave ligada e sem máquina que anuncie `revisa`, o arriscado continua cartão,
  mas o envio pelo terminal depois de conteúdo de fora, que hoje roda, passa a cartão: por isso o PR 4 só liga a chave
  quando a maior parte dos turnos em Automático vier de máquinas com `revisa` (medido pelo log do PR 3a). O 3b
  é só `src/adapters/executor` (laço e driver Claude), `motor/` e `desktop/`: sem o servidor mandar pedido, o laço só
  passa a anunciar `revisa`. O motor da VM se atualiza sozinho com o deploy (ADR-100); **o app do Mac precisa de uma
  release**, e até a pessoa atualizar, os turnos no Mac dela seguem no cartão (o comportamento de hoje no terminal).
- O PR 1 e o PR 2 não mudam com o redesenho. O PR 4 muda pouco (a contagem na Atividade, "na sua IA" no menu, o
  "Sempre permitir" só onde funciona). O PR 5 usa o caminho do PR 3 sem mudança própria. O PR 6 perde a credencial do
  Automático no revisor (é cartão). O PR 7 não muda.
- O PR 7 vem depois do PR 5 para "nasce automático" querer dizer o automático novo também nos apps. Antes disso, um bot
  novo no automático de hoje enviaria o e-mail do A3.
- O número da migração é o livre hoje (a última é a 0092); se outro PR entrar antes, sobe. Só o PR 3a migra.
- Cada PR vai para produção sozinho. Reverter o PR 3a e o PR 4 é desligar a chave; o PR 3b se reverte sozinho (sem
  pedido, nada roda); o PR 6 se reverte voltando a linha da credencial no total.

## ADRs

- **ADR-115, "O automático com revisor na IA da pessoa e o ignorar de verdade"** (nova; proposta no PR 3a, aceita no
  PR 4, completada no PR 6). Decide que o revisor roda no CLI e na conta da pessoa, disparado pelo laço do turno, e não
  num modelo do Nod (decisão 1 do Marlon, 18/10). Reverte de forma explícita:
  - a recusa do revisor-modelo na ADR-042 (seção "Revisor-modelo antes de cada ação", `adr-042:80-88`), na ADR-059
    (alternativas descartadas, `adr-059:99-102`) e em `docs/grokbot-comparison.md:104-108` ("Auto Review"), que ganha
    uma nota apontando para a ADR nova;
  - a alternativa descartada "Total sem a cerca da credencial" (`adr-059:111-113`);
  - o gatilho de reversão da ADR-059 "qualquer comando da lista de arriscados rodando no automático" (`adr-059:128-130`),
    que deixa de ser defeito: agora roda quando o revisor libera;
  - o gatilho de reversão da ADR-059 "Credencial lida por bot no total sem card" (`adr-059:131`), que vira o
    comportamento pedido (revisão de engenharia: faltava na lista).

  Responde às três razões da recusa antiga: (1) os vazios do revisor não são enumeráveis → a **lista continua decidindo
  o que vai ao revisor**; o revisor só escolhe entre liberar e perguntar, nunca nega, e o que ele não olha é o mesmo que
  o Automático de hoje já roda sem olhar; (2) a lista fecha a superfície → fecha, mas pergunta demais: 0 de 110 comandos
  negados e 4 de 234 cartões; (3) **queima a cota da pessoa para vigiá-la, ou vira autoridade remota síncrona**
  (`adr-042:82-85`) → não é autoridade remota do Nod: roda na máquina e na IA da pessoa, o servidor só leva o pedido e
  amarra o veredito, e a falha vira cartão (o comportamento de hoje), nunca negação; a ADR-013 fica intacta. **A objeção
  da cota continua verdadeira e é aceita**: a pessoa a aceita ao escolher o Automático (e o bot novo nasce nele, com o
  menu dizendo "um revisor, na sua IA"), com teto por turno e por dia e a contagem na Atividade. O Nod não paga nada e
  nenhum dado sai para um lugar que o turno já não mandou.

  Riscos aceitos: o revisor pode liberar um arriscado que a pessoa não liberaria; ele gasta a cota da pessoa (estimativa
  de 1% a 5% de um turno por revisão, até 300 por dia); no Codex não há revisor na v1 (cartão); no total, um texto de
  fora pode levar o bot a usar uma credencial (é o pedido do Marlon, com confirmação, pílula âmbar, linha na fala e
  Atividade).

  Gatilhos de reversão:
  - duas ações liberadas pelo revisor, contestadas ("Devia ter perguntado") e que não se desfazem, no mesmo mês → aquele
    gatilho volta a ser cartão direto, sem revisor;
  - o revisor pede mais da metade das revisões em duas semanas → ele só troca um cartão por outro; rever o prompt e o
    que vai a ele;
  - falhas acima de 10% num dia nas máquinas que anunciam `revisa` → alarme; acima de 10% por três dias → a chave
    desliga até a correção;
  - as fichas do revisor passam de 10% das fichas dos turnos de uma pessoa numa semana, ou alguém reclama de cota por
    causa dele → rever o modelo, o que vai ao revisor e o teto do dia;
  - uma credencial lida no total e mandada para fora sem a pessoa ter pedido, vista na Atividade → a credencial volta a
    ser cerca no total;
  - um veredito recusado por prova ou segredo inválido → alarme e investigação: alguém além do laço falou pela chave da
    máquina.
- **ADR-059**: §6 (o chip e a faixa, PR 2), decisão 1 (nasce automático; excluir volta ao automático, PR 7), §2 (a
  tabela, PR 3 e PR 6) e o item 4 da emenda de 30/09 (PR 5).
- **ADR-066**: no Automático, conteúdo de fora volta a pesar, pelo revisor, só no envio para fora (PR 5).
- **ADR-055 §3**: a credencial deixa de ser cerca no total (PR 6).
- **ADR-104**: o bot criado por `criar_bots` nasce automático (PR 7).
- **ADR-013**: não é tocada. A ADR-115 registra por que o revisor na máquina da pessoa não é a autoridade remota que
  ela recusou (3c).
- **ADR-021**: não é tocada. O pedido chega à máquina pela renovação que ela já faz; o servidor não disca.

## Riscos

- **O revisor liberar o que não devia.** Um texto de fora pode tentar convencê-lo, pelo pedido do colega, pelo texto do
  item ou pelos argumentos. Mitigação: ele não vê o conteúdo lido; tudo vai marcado como dado; a origem e a contaminação
  vão explícitas; credencial nem passa por ele; o CLI do revisor roda sem ferramenta, conferido no init a cada chamada;
  os casos de injeção do PR 3b; a contestação e o primeiro gatilho.
- **O revisor falhar ou demorar na máquina da pessoa.** CLI que sobe devagar num Mac carregado, conta no limite, app
  antigo. Vira cartão, que é o comportamento de hoje; a causa conhecida sai na hora, sem esperar o prazo; o disjuntor
  por máquina evita esperar 60 s a cada ação. Alarme pelo terceiro gatilho e pela medição do PR 1 em diante.
- **O revisor gastar a cota da pessoa.** Teto de 20 por turno e 300 por dia, a contagem na Atividade, as fichas no
  Raio-X e no `medir-modos.ts`, chave para desligar. O quarto gatilho de reversão vigia a parcela.
- **App do Mac desatualizado.** Até a release do PR 3b chegar a cada Mac, os turnos ali seguem no cartão. Some com a
  atualização; o motor da VM se atualiza sozinho (ADR-100).
- **Texto de modelo na tela.** O motivo do revisor é texto livre. Escapado, cortado em 160, com o rótulo "Revisor", sem
  link, nunca usado para decidir nada.
- **Decisão presa em revisão.** O varredor de 30 s e a fase 3 idempotente. Teste do servidor reiniciando no meio.
- **Hook antigo.** Até o app e o motor atualizarem, o total ainda nega arquivo de credencial no hook. Lado seguro; some
  sozinho com a atualização (ADR-100).
- **Mudança para os 28 bots em total.** Eles passam a usar credenciais sem pedir no dia do PR 6 (decisão 2 do Marlon,
  18/10). Mitigação: a linha na conversa de cada um.
- **Mais ações sem a pessoa nos bots novos.** Nascer no automático faz commit, push e e-mail sem cartão desde o primeiro
  dia. É a escolha do Marlon; o revisor cobre o arriscado e o envio para fora depois de ler algo de fora.
- **O motivo do A4 depende do bot.** Sem o bot escrever no item o que chama atenção, o revisor não sabe que duas planilhas
  foram editadas esta semana. O prompt pede; o caso entra no conjunto do PR 3b.
- **Privacidade.** Resolvida pela decisão 1: o pedido vai ao provedor e à conta que já rodam o turno e já viram o
  comando, os argumentos e as mensagens. A política de privacidade não muda.

## Decisões tomadas

### Pelo Marlon (18/10)

As oito decisões que estavam em aberto. A numeração é a antiga, para as referências do texto e da revisão.

1. **O revisor roda na IA da própria pessoa** (o CLI e a conta de quem é dono do bot, como os turnos), não num modelo
   do Nod. Nada de chave da Anthropic no servidor nem dado de cliente saindo pela conta do Nod. Redesenho na Parte 3c e
   em "Redesenho do revisor (18/10)". (A recomendação do plano era Haiku na chave do Nod; saiu, com o teto global em
   dólar e a cláusula de privacidade.)
2. **Bots que já existem não mudam de modo**; só os novos nascem automáticos. (Recomendação do plano, aceita.)
3. **Os 28 bots em "Ignorar todas" passam à regra nova no deploy do PR 6**, com uma linha na conversa de cada um.
4. **Apagar pedido na conversa, no Automático, passa pelo revisor** (o A4). (Recomendação do plano, aceita.)
5. **Credencial no Automático: sempre cartão na v1**, sem revisor, em turno limpo ou contaminado. A leitura de arquivo
   de credencial no Automático passa de negada a cartão (PR 6).
6. **Rotina parada em cartão do revisor segura a janela seguinte**, como hoje. (Recomendação do plano, aceita.)
7. **Subir arquivo de credencial para um app continua recusado** no "Ignorar todas". (Recomendação do plano, aceita.)
8. **"Sempre permitir" no cartão compacto só onde funciona**: no apagar num app num turno limpo. Não aparece onde a
   regra permanente é ignorada (turno contaminado, envio depois de conteúdo de fora), nem no terminal nem no cartão de
   falha.

### Pelo plano

Pelo agente que escreveu o plano, no lugar do Marlon; ele pode reverter qualquer uma:

1. O revisor vive numa **decisão `em_revisao`**: hook e proxy não mudam para o Automático.
2. **Prazo de 60 s** (era 15 s com o modelo do Nod; com o CLI da pessoa a partida custa segundos), não 1,5 s: o hook já
   espera 420 s.
3. Quatro caminhos ficam **sem revisor na v1** (rotina e acesso pelo modo, pré-voo, `gerir_bots`, `esperar_comando`),
   com a regra de hoje.
4. O revisor **não vê o resultado das ferramentas**.
5. **A faixa acima do campo sai**; o aviso fica na confirmação do menu.
6. **A rota exige `confirmado: true`** para ligar o total.
7. (Substituída pela decisão 8 do Marlon.)
8. **A linha na fala**: no automático, toda liberação do revisor; no total, só credencial e arriscado; o resto só na
   Atividade.
9. **Duplicar nasce automático** e não copia o modo; **excluir volta ao automático**.
10. **Pôr um bot em total pelo Nod** é sempre cartão.
11. **Lote misto** continua perguntando tudo, numa revisão só.

Do redesenho de 18/10 (detalhes em "Redesenho do revisor (18/10)"):

25. O pedido chega à máquina **pela renovação do turno** (1 s), não por canal novo; o veredito volta por uma rota nova
    da ponte. O laço anuncia `revisa` pela presença do campo.
26. **O revisor roda na máquina e na conta do turno**, não em qualquer máquina da pessoa.
27. A chamada é `claude -p` **sem ferramenta, sem MCP, sem settings da pessoa**, numa pasta vazia, com o pedido no
    stdin; o init é conferido a cada chamada.
28. **O modelo vem do servidor** (`NOD_MODELO_REVISOR_CLAUDE`), padrão Sonnet 5.5 com esforço low, como a ligação.
29. **Codex: cartão na v1** (sem lista de ferramentas por chamada para conferir, `collaboration.*` e `apply_patch` ainda
    ligados, EVAL próprio; a primeira justificativa, "sempre tem o shell", estava errada e saiu).
30. **Tetos de 20 por turno e 300 por pessoa por dia**; sem teto em dólar.
31. **O servidor faz o parse do veredito**; a máquina devolve texto cru.
32. **Disjuntor por máquina** (3 falhas → 10 min de cartão direto), no lugar do disjuntor global.
33. **Até 2 revisões ao mesmo tempo por máquina**, fora da fila do forno; memória apertada e conta no limite → cartão,
    decididos no servidor.
34. **O PR 3 vira dois** (3a servidor, 3b laço).
35. O menu do Automático ganha **"na sua IA"** e a Atividade mostra **quantas revisões rodaram**.
36. **Segredo por turno na memória do laço** e prova HMAC no veredito: a chave da máquina sozinha não aprova.
37. **Reentrega do pedido até o laço confirmar**; o revisor roda sem travar a renovação.
38. A caixa mora na **`PonteInterna`**; o modo local passa a renovar a 1 s.
39. O PR 4 só liga a chave com a maior parte dos turnos em Automático vindo de máquinas com `revisa`.

## Decisões em aberto para o Marlon

9. **Codex no Automático a partir do PR 4.** Sem revisor no Codex na v1 (decisão 29 do plano), o envio depois de
   conteúdo de fora (pelo terminal no PR 4, pelos apps no PR 5) e o apagar pedido na conversa (PR 5), que hoje rodam no
   Codex, viram cartão (o A3 e o A4). Recomendo
   **cartão**: é o lado seguro e o A3 é justamente o "Auto obedece um e-mail". Alternativa: nesses dois gatilhos o Codex
   segue como hoje (roda sem revisor), e o buraco do A3 fica aberto só no Codex. Não bloqueia o PR 1, o PR 2 nem o
   PR 3; o PR 1 dá quantas vezes isso aconteceria.

## Revisão de engenharia (18/10)

Revisão do plano contra a `main` em 1ccf3987, as ADRs 013, 026, 042, 044, 059, 062, 065, 066, 089, 097, 103, 104, 113 e
114 e o protótipo aprovado (cartão escolhido: `A3-revisor-compacto`). Voz de fora: um subagente Claude (Codex não
instalado), com 17 pontos; 13 viraram mudança, todos conferidos no código. Onde este bloco e o texto acima discordam,
vale este bloco; as mudanças que alteram uma parte já foram escritas nela, marcadas "revisão de engenharia".

**Depois das decisões do Marlon de 18/10**, o revisor saiu do servidor e foi para a IA da pessoa. Os pontos 7, 8 (a
parte do disjuntor), 17 e 18 e as decisões 16 e 22 abaixo falam do revisor no servidor e foram **substituídos** pelo
"Redesenho do revisor (18/10)", no fim; ficam aqui como registro, marcados. Onde discordam, vale o redesenho.

### O que virou mudança

Arquitetura do revisor:

1. **[P1] Com a chave desligada, o PR 3 mudava a produção.** "Todo revisar vira cartão" transformava em cartão o envio
   depois de conteúdo de fora e o apagar pedido na conversa, que hoje rodam (`modo-aprovacao.ts:68-74`,
   `aprovacao-permanente.ts:148`). Mudou: desligada, a decisão é a de hoje em toda entrada, com as versões de hoje;
   teste de matriz contra a função atual; o caminho dos apps só muda no PR 5 (Parte 3, abertura).
2. **[P1] A fase 3 liberava sem olhar o turno.** Se o turno caiu, parou ou o modo virou manual durante a revisão, um
   "libera" fechava a decisão com o item `executado` sem ninguém rodar, e a continuação do varredor diria "a pessoa
   decidiu…" com o nome dela (`decidir.ts:181`, `:218-221`; fere a ADR-023). Mudou: fase 3 sob a trava do turno
   (`buscarTravado`), libera só com o turno `despachando`, sem `parar_solicitado_em`, bot vivo e modo atual automático;
   senão, cartão pendente. Isso também resolve o Parar sem código novo em `parar.ts` (3d).
3. **[P1] O bot podia tentar até o revisor liberar.** Só a revisão em curso era reaproveitada; depois de "pede" e de uma
   negação, o mesmo comando (ou com um espaço a mais) ganhava outro sorteio. Mudou: qualquer "pede", negação ou
   vencimento da mesma ação na cadeia do turno manda direto ao cartão; teto de 20 revisões por turno; o revisor recebe
   quantas ações do turno ele já mandou para a pessoa. O reaproveitamento "em curso" saiu: não tem chave única e o hook
   não repete o POST (3d).
4. **[P1] O comando aprovado de gravar arquivo nunca é achado na segunda consulta do hook** (bug de hoje, sem teste).
   `comandoAprovadoNaCadeia` compara `destino.argumentos.comando` (`itens-aprovacao.repo.ts:98`), mas o item de arquivo
   guarda `{ arquivo }` (`autorizar-comando.ts:115`) com o texto `Gravar …` (`:98`): a segunda consulta abre outro
   cartão e o hook responde "não liberou" (`hook-nativas.ts:173-174`). A Parte 6 herdaria o laço na leitura de
   credencial. Mudou: o PR 3 compara `i.texto_original` com o texto do pedido (vale para comando, arquivo e MCP), com
   teste de aprovar e repetir nos três tipos. A liberação **do revisor** vale só no turno em que foi dada e enquanto ele
   não ficou contaminado depois dela; a da pessoa segue valendo na cadeia, como hoje.
5. **[P1] O caminho dos apps tem quatro passos, não três** (PR 5). Liberar um item de app é chamar o app depois da
   fase 3: tx que fecha → efeito fora da tx (`executarEfeito`, `exigirForaDaTx`) → tx que assenta
   (`assentarLoteAutomatico`), como o lote automático do NOD-263. A fala "Fiz sem perguntar" que o assentamento escreve
   vai para a Atividade (chat limpo) e não repete a linha do revisor. Reinício entre o fechamento e o efeito deixa o
   item sem desfecho; é a mesma janela que o lote automático já tem hoje e fica fora deste plano (ver "Fora do escopo").
6. **[P2] `em_revisao` escapa de consultas que deviam pegá-la.** Excluir o bot vence só `pendente`/`reaberta`
   (`agentes.repo.ts:154`): a revisão de um bot excluído ainda liberaria. `fecharPorRegra` só fecha
   `pendente`/`reaberta` (`decisoes.repo.ts:198-201`). As checagens de "esperando alguém"
   (`entregar-resposta-peer.ts:144`, `pedir-acesso.ts:63`) não contam a revisão. Mudou: excluir vence também
   `em_revisao`; a fase 3 usa um update próprio (`where estado = 'em_revisao'`); um ajudante `decisaoEmAberto(estado)`
   (pendente, reaberta, em_revisao) para as checagens de espera, e as listas da tela continuam filtrando só pendente e
   reaberta.
7. **[P2] O varredor de 15 s era um laço novo.** Produção é uma VM só, com deploy que recria o processo
   (`deploy-gcp.md:11`, `:29-38`): a fase 2 no próprio processo serve, e o varredor de expiração que já roda a cada
   30 s por pessoa ganha o passo do `em_revisao` velho (3d). Fila de 8 revisões simultâneas; disjuntor de 5 falhas
   (3e). *(Substituído em 18/10: a fase 2 roda na máquina; o varredor fica; a fila de 8 e o disjuntor global saem, e
   entram 2 por máquina e o disjuntor por máquina.)*
8. **[P2] "A chave desliga na hora" não é verdade.** O ambiente vem do `config.env` no deploy. Mudou o texto, e o
   disjuntor cobre a queda do provedor (3e; *substituído em 18/10: não há provedor do Nod; disjuntor por máquina*).
   Reverter o código do PR 3 ou do PR 4 com linhas `em_revisao` no banco deixaria o servidor antigo esperando por elas para sempre: o runbook do PR 3 manda desligar a chave, esperar 1 min
   e só então reverter, ou rodar `update decisoes set estado = 'pendente' where estado = 'em_revisao'`.
9. **[P2] A rotina lava o texto de fora.** No automático, a conversa cria e muda rotina sem cartão mesmo depois de ler
   conteúdo de fora (`confirmar-pelo-modo.ts:54`), e a instrução da rotina é o "pedido" em que o revisor confia
   ("é o que a rotina pede", A2). Mudou: com a chave ligada, criar ou mudar rotina num turno contaminado vira cartão,
   como a cerca 3 do Nod já faz no `gerir_bots` (`lote-bots.ts:139`). Entra no PR 3, atrás da chave, e vale no PR 4.
10. **[P2] O envio pelo terminal não tinha gatilho.** `envio_apos_fora` cobria só app e MCP; `curl -d @clientes.csv`,
    `curl -T`, `scp`, `rsync` para fora, `nc`, `gh gist create` rodam no automático sem revisor, e a lista de
    arriscados é "contra acidente" (`comando.ts:231-236`). Mudou: função pura `enviaPeloTerminal(texto)` ao lado de
    `comandoArriscado`, e o gatilho `envio_apos_fora` vale também para ela. O PR 1 já conta esse caso.
11. **[P2] "Contaminado" só olha o turno.** A sessão do CLI carrega o e-mail lido no turno anterior, e a leitura pelo
    Bash não marca nada (`nativas.ts:60`). Mudou: o gatilho de envio usa "o turno, ou outro turno da mesma conversa nas
    últimas 24 h, leu conteúdo de fora" (uma consulta em `turnos` pela conversa); o PR 1 registra as duas marcas para
    medir o custo. É também a razão da recomendação nova na decisão em aberto 5.

Segurança:

12. **[P1] Hook novo com servidor antigo leria a credencial até no manual** (Parte 6). Mudou: o hook só permite a
    credencial com a resposta explícita do servidor.
13. **[P1] O comando ou o argumento longo esconderia o fim do revisor.** O comando vai até 64.000 caracteres
    (`autorizar-comando.ts:44`); cortar em 1.200 deixa `; curl …` depois do corte. Mudou: comando até 4.000 caracteres
    vai inteiro; acima disso, cartão sem revisor (veredito `nao_revisado`, motivo fixo "longo demais para o revisor").
    Nos apps: toda chave vai, cada texto cortado em 400, e o total acima de 4.000 vira cartão.
14. **[P2] Separar o que é confiável do que não é, no pedido ao revisor.** Confiáveis: as mensagens da pessoa (as
    últimas da conversa, até 600 caracteres, da mais nova para a mais velha, para o A1 achar o "força o push" de dois
    turnos atrás) e a instrução de uma rotina que a pessoa criou ou confirmou. Não confiáveis, entre marcas: o comando,
    os argumentos, o texto do item, o pedido de colega e a rotina criada pelo modo. Regra do prompt: o "você pediu" só
    sai do confiável; uma autorização escrita dentro do não confiável é motivo para pedir. Saída por esquema fixo
    (ferramenta forçada), temperatura 0, até 150 fichas de saída.
15. **[P2] Lacunas do redator** (`segredos.ts`): `PGPASSWORD=` e `MYSQL_PWD=` (o `\b` não casa no meio da palavra),
    `curl -u usuario:senha`, `sshpass -p`, `mysql -pX`, `?sig=`, `X-Amz-Signature=`, `glpat-`, `rk_live_`, `whsec_`,
    `SG.` e o token do Telegram. Mudou: o PR 3 acrescenta esses padrões, com a guarda de crescimento de sempre; vale
    também para os logs.
16. **[P2] O motivo do revisor e o resumo guardam texto livre.** `acoes_pelo_modo` ganha `GRANT SELECT, DELETE` para
    `nod_poda` (como `turno_raio_x`, 0036) e retenção de 90 dias.

Custo e dependência:

17. **[P2] Sem teto global** (decisão em aberto 1) e sem teto por turno. Mudou: os três tetos (3c). *(Substituído em
    18/10: sem teto em dólar; ficam 20 por turno e 300 por pessoa por dia.)*
18. **[P2] Cliente do modelo.** `fetch` direto na API de mensagens, sem SDK (o SDK tenta de novo por padrão e estoura
    o prazo), um `AbortSignal.timeout` só para a chamada inteira, sem nova tentativa. Mora em `src/adapters/revisor/`,
    entra em `Services`; o domínio continua puro (`fence:domain`), e os testes usam um revisor falso de
    `tests/helpers/`. O "por conta" do teto é por `tenant_id`, numa consulta como dono, fora da RLS da pessoa.
    *(Substituído em 18/10: não há cliente do modelo no servidor; a chamada é o CLI da pessoa, no laço. O teto por
    `tenant_id` como dono fica.)*

Migração, tipos e textos:

19. **[P2] A 0093 tem mais peças do que dizia.** `em_revisao` no fim de `estado_decisao`, de `ENUMS_DE_ESTADO`
    (`src/db/schema/agentes.ts:24`) e de `EstadoDecisao` (`contracts/decisao.ts:21`); `revisor_pediu` e
    `revisor_falhou` no fim de `motivo_aprovacao_manual` e de `MOTIVOS_APROVACAO_MANUAL` (o gate `motivos-enum` compara
    a ordem). Nenhum valor novo usado na mesma transação (nada de índice parcial com `'em_revisao'`). O rollback recria
    os tipos como a 0088, tirando e devolvendo o `DEFAULT 'pendente'` de `decisoes.estado` em volta da troca; o índice
    `decisoes_sua_vez` é refeito pelo `ALTER COLUMN … TYPE`. Índice novo `(tenant_id, turno_id)` em `acoes_pelo_modo`
    para o `acoesDoModo` da conversa, além do da Atividade.
20. **[P1] A 0094 mudaria o sentido de uns 50 arquivos de teste.** A fábrica cria bot por `agentes.criar`
    (`tests/helpers/fabricas.ts:19`). Mudou: sem migração; o tipo exige o modo e a fábrica fica no manual (Parte 7).
21. **[P2] A trilha do comando liberado gravaria `regra:chamada`.** A segunda consulta do hook passa por "aprovado"
    (`interno.ts:286-288`). Mudou: quando a decisão achada foi fechada por `regra:revisor`, a trilha leva
    `regra:revisor`.
22. **[P2] O texto do PR 2 ainda mentia**, e o Nod em "Ignorar todas" punha outro bot nesse modo sem a pessoa. Mudou o
    texto, e o `gerir_bots` subiu para o PR 2.
23. **[P2] A fase 3 que pede tem de soltar a task.** O cartão que nasce da revisão emite `decisao_criada` e roda
    `sincronizarTrabalho` (a task vai a "precisa de você"), como `FERRAMENTAS_QUE_PEDEM_A_PESSOA`
    (`chamar-ferramenta.ts:235`).
24. **[P3]** Uma fonte só para o gatilho: a `decidirPeloModo` do PR 3 chama a `gatilhoDeRevisao` do PR 1. A ADR-115
    reverte também o gatilho "Credencial lida por bot no total sem card" da ADR-059. O PR 1 subconta a credencial,
    porque o hook nega a leitura de arquivo sem ir ao servidor: o script soma as negações anotadas pelo hook. O PR 4
    mede "nega ao menos 1 em 10" só com 50 cartões ou mais.
25. **[P3]** Todo MCP da pessoa depois do primeiro, no mesmo turno do Codex, cai em `envio_apos_fora` (a própria
    chamada marca o turno, `interno.ts:296`). O PR 1 conta a origem `mcp` à parte; se ela dominar, o assunto volta.

### Decisões tomadas pela revisão

No lugar do Marlon, técnicas; ele pode reverter qualquer uma (a numeração continua a das "Decisões tomadas pelo
plano"):

12. Chave desligada = decisão de hoje, provada por teste de matriz.
13. Fase 3 sob a trava do turno; libera só com turno vivo e modo atual automático; senão, cartão. O Parar não muda.
14. Sem reaproveitamento "em curso"; "pede", negação ou vencimento na cadeia mandam direto ao cartão; teto de 20 por
    turno.
15. Comparar o texto do item na segunda consulta (conserta a gravação aprovada de hoje); liberação do revisor só no
    turno e enquanto ele está limpo.
16. Varredor de expiração existente em vez de laço novo; fila de 8; disjuntor de 5 falhas por 2 min. *(Substituída em
    18/10 pelas decisões 32 e 33; o varredor fica.)*
17. Comando acima de 4.000 caracteres e argumentos grandes vão ao cartão, sem revisor.
18. Pedido ao revisor em duas partes, confiável e não confiável; saída por esquema fixo.
19. Criar ou mudar rotina num turno contaminado vira cartão quando a chave está ligada.
20. `enviaPeloTerminal` entra no gatilho de envio; o "contaminado" do gatilho olha a conversa nas últimas 24 h.
21. Hook novo exige a confirmação explícita da credencial.
22. `fetch` sem SDK, sem nova tentativa; cliente em `src/adapters/revisor/`; segredo em `NOD_REVISOR_CHAVE`.
    *(Substituída em 18/10 pelas decisões 25 a 28: sem cliente, sem segredo.)*
23. Sem migração no PR 7; o default da coluna fica `'manual'`.
24. `gerir_bots` → total vira cartão já no PR 2.

### Mapa de testes

```
SERVIDOR                                                         TELA
modo-aprovacao (domínio)                                         chip e menu (PR 2)
 ├ chave desligada = função de hoje, matriz inteira       [U]     ├ só ícone, title/aria, dona e não dona     [U]
 ├ ligada: 3 modos × arriscada × credencial × envio ×             ├ total abre a confirmação, Esc, Agora não  [U]
 │  contaminado (turno, conversa 24 h) × origem           [U]     └ faixa removida                            [U]
 ├ gatilhoDeRevisao, enviaPeloTerminal                    [U]    cartão compacto (PR 4)
 ├ credencial no Automático = cartão, limpo e contaminado [U]     ├ Sempre permitir só com sempreServe        [U]
 └ semRevisor nos quatro caminhos                         [U]     │  (apagar de app, turno limpo)
revisor (domínio)                                                 ├ motivo longo, escapado; falhou            [U]
 ├ redação: padrões novos, JSON aninhado, guarda O(n)     [U]     └ encolhido, forced-colors, mobile 44 px    [U]
 ├ cortes: 4.000 inteiro, acima = nao_revisado            [U]    linha do revisor e Atividade (PR 4, PR 6)
 ├ confiável × não confiável; rotina pela pessoa × modo   [U]     ├ uma e várias, ver, Devia ter perguntado   [U]
 └ parse: JSON inválido, campo a mais, motivo longo       [U]     ├ payload antigo sem acoesDoModo            [U]
revisar-acao (Postgres)                                           ├ filtro Sem aprovação, N hoje              [U]
 ├ libera/pede/falha/prazo/teto dia e turno/chave         [I]     ├ Y1/Y2: qualCredencial, ver na Atividade   [U]
 ├ máquina falsa: renovação reentrega até confirmar; rota            └ "N revisões hoje, na sua conta" e "na sua
 │  do veredito; outra máquina/turno/repetido/atrasado               IA" no menu                              [U]
 │  ignorado; sem prova/segredo → ignorado               [I]
 ├ sem revisa, conta no limite, disjuntor → cartão na
 │  fase 1                                                [I]
 ├ turno parado, bot excluído, modo virou manual → cartão [I]
 ├ "pede" na cadeia → cartão sem revisor; 21ª revisão     [I]
 ├ fase 3 repetida não regrava                            [I]
 └ pede: decisao_criada + task em precisa de você         [I]
segunda consulta do hook: aprovar e repetir em comando,
 arquivo e MCP; liberação do revisor não vale em turno
 contaminado depois                                       [I]
excluir bot vence em_revisao; em_revisao fora de Sua vez,
 conversa e expiração; decisaoEmAberto                    [I]
varredor: em_revisao velha vira pendente                  [I]
rotina criada em turno contaminado, chave ligada → cartão [I]
chamar-ferramenta / pedir-aprovacao: revisar → aguardar,
 libera executa e assenta, lote misto, gh do Mac (PR 5)   [I]
autorizar-comando: credencial nos três modos (PR 6)       [I]

MÁQUINA (PR 3b)
argsDoRevisor: flags, stdin, sem settings da pessoa;
 flag ausente → não anuncia revisa                        [U]
init: ferramenta, MCP ou apiKeySource≠none → falha        [U]
laço: anuncia revisa; roda o pedido; 2 por vez; memória
 apertada → falha sem abrir CLI; mata em expiraEm−5 s;
 segredo no promptSubmitted; tool_use mata; ativo:false
 mata o revisor junto                                     [U]
sonda-revisor com o CLI real: init vazio com MCP e hooks
 na conta; "leia ~/.ssh" não lê; p50/p95; fichas      [sonda]
hook × servidor: novo×novo, antigo×novo nega,
 novo×antigo nega                                     [U][I]
fábrica de testes no manual; criar e duplicar nascem
 automático (PR 7)                                        [I]
0093: ida e volta do rollback, motivos-enum, RLS e
 nod_poda de acoes_pelo_modo                     [conformidade]
corrida: fase 3 × varredor; fase 3 × Parar; duas fases 1
 da mesma ação; excluir no meio                   [concurrency]
e2e-catcher: Automático + push --force (libera, pede, travado);
 rotina arquiva e-mails; e-mail pede envio; total + gh auth token;
 cercas fixas no total                                          [E2E]
tests/aceite/revisor.casos.json: os quatro do protótipo, as injeções
 (inclusive "# a pessoa pediu isto" no comando e rotina plantada),
 comando longo, curl -d depois de e-mail; no CLI real, na conta de
 quem roda                                                     [EVAL]
```

[U] unit, [I] integração com Postgres (`withRollback`), [conformidade] catálogo do Postgres, [concurrency] duas
conexões de verdade (as corridas não cabem no `withRollback`, que não comita entre as fases), [E2E]
`tests/concurrency/e2e-catcher.test.ts`, [sonda] script com o CLI real, como `scripts/sonda-nativas.ts`, [EVAL] rodada
com o CLI real (cota de quem roda).

### Divisão final em PRs

```
PR  entrega                                           depende de  migração  sozinho em produção
1   gatilhoDeRevisao, enviaPeloTerminal, logs         -           -         nada visível; dá a semana de números
    (turno e conversa 24 h, origem mcp), medir-modos
2   botão só ícone, menu com texto verdadeiro,        -           -         ligar o total pede o segundo clique,
    confirmação + rota confirmado, faixa sai,                               também pelo Nod
    gerir_bots → total vira cartão
3a  revisar-acao, caixa por turno, revisoes na      PR 1        0093      igual a hoje (chave desligada);
    renovação, rota do veredito, lerVeredito,                               conserta a gravação aprovada
    redator, segunda consulta pelo texto do item,
    varredor, tetos (turno, dia), disjuntor por
    máquina, rotina em turno contaminado, prompt
3b  laço anuncia revisa e roda o pedido,              PR 3a       -         nada (sem pedido do servidor);
    argsDoRevisor, checagem do init, 2 por máquina,                         motor da VM se atualiza, app do
    memória, sonda-revisor, EVAL, release do app                            Mac precisa de release
4   cartão compacto (Sempre permitir só onde serve),  PR 2, 3a,   -         Automático novo no terminal
    linha do revisor, Atividade com a contagem,       3b
    "na sua IA" no menu, contestação, liga a chave
5   revisor nos apps (quatro passos), MCP da pessoa   PR 4        -         A2 sem cartão, A3 vira cartão
6   ignorar de verdade, hook com confirmação          PR 4        -         total sem credencial parando
    explícita, qualCredencial, linha Y1/Y2
7   nasce automático, tipo exige o modo               PR 5        -         só os bots novos
```

Ordem: **PR 1 e PR 2 juntos → PR 3a (escrito na semana de medição) → PR 3b → PR 4 → PR 5 e PR 6 (qualquer ordem) →
PR 7.**

### O que já existe e é reaproveitado

O long-poll `aguardar` do hook e do proxy (o proxy trata `aguardar` de qualquer ferramenta, `proxy.ts:181`), a fase
fora da tx do NOD-263 (`executarEfeito`, `assentarLoteAutomatico`, `assentarComNovaTentativa`), `buscarTravado` e a
continuação única da 0032, o varredor de expiração e `paraCadaPessoa`, `redigirECortar`, o filtro de ambiente dos
filhos, o modelo de rollback de enum da 0088, `sincronizarTrabalho`, `cartao-encolhido.ts` e as três ações de decisão
da tela, a Atividade de três fontes. Do redesenho de 18/10: a renovação de 1 s do turno e o seu "campo presente = o app
sabe" (#189), o turno de sonda e o laço de voz como molde da chamada curta, o parser do `init`, a régua de memória da
máquina (`portaoDoMac`), o portão da cota (`portaoDaCota`) e o modelo vindo do servidor como o da ligação.

### Fora do escopo (considerado e adiado)

- Marcar o turno quando o Bash lê de fora (`gh pr view`, `curl`): muda o manual, que passaria a pedir até a leitura.
  Fica como pré-requisito para o revisor da credencial no Automático.
- O item de app sem desfecho depois de um reinício entre fechar e executar: janela que o lote automático já tem.
  Seguimento: um desfecho "incerto" que o varredor grava, sem reenviar (ADR-009).
- Interruptor da chave sem deploy (configuração lida a cada revisão): o disjuntor por máquina cobre a máquina
  quebrada; o resto aceita minutos.
- Revisor no Codex (decisão 29; decisão em aberto 9).
- Revisor numa máquina diferente da do turno (outra máquina da pessoa ociosa): soma roteamento e conta de outra máquina
  por um ganho que só existe quando a do turno está apertada.
- Manter um CLI do revisor aquecido por máquina para cortar a partida: só se o p95 do PR 4 passar de 15 s.
- Revisor nos quatro caminhos sem revisor (rotina e acesso pelo modo, pré-voo, `gerir_bots`, `esperar_comando`).

### Falhas em produção

```
caminho              falha realista                        teste  tratamento                      visível?
fase 2 (máquina)     CLI lento ou travado, Mac carregado   sim    mata em expiraEm−5 s; prazo     cartão "confira você"
fase 2 (máquina)     CLI sem login, conta no limite        sim    falha na hora; disjuntor        cartão com a causa
fase 2 (máquina)     init com ferramenta ou MCP            sim    laço mata e relata falha        cartão
fase 2 (máquina)     máquina caiu no meio                  sim    prazo 60 s                      cartão (e o turno cai)
fase 2               deploy no meio da revisão             sim    caixa some; varredor            cartão em até ~2 min
rota do veredito     veredito de outra máquina ou velho    sim    amarrado a revisaoId e turno    ignorado
rota do veredito     bot forja "libera" com a chave da VM  sim    segredo do turno + prova HMAC   ignorado + alarme
renovação            resposta com o pedido se perde        sim    reentrega até confirmar         não (segundos a mais)
fase 3               turno parou durante a revisão         sim    trava do turno → cartão         cartão, como hoje
fase 1               bot repete até liberar                sim    pede na cadeia → cartão         cartão
pedido ao revisor    segredo sem padrão no redator         sim*   padrões novos; corte depois     não (* só os conhecidos)
pedido ao revisor    injeção no comando ou no item         EVAL   confiável × não; esquema fixo   veredito errado possível
hook novo            servidor revertido                    sim    confirmação explícita           nega com a frase de hoje
teto                 bot em laço gastando a cota           sim    20 por turno, 300 por dia       cartão
reversão do código   em_revisao órfã                       não    runbook: chave off, update      hook espera e solta
app liberado         reinício entre fechar e executar      não    herdado do NOD-263              item sem desfecho
```

O único caso sem teste, sem tratamento e silencioso ao mesmo tempo é o último, e ele já existe hoje no lote automático.

### Paralelização

```
faixa A: PR 1 → PR 3a → PR 5 → PR 7    (src/domain, src/use-cases, src/repositories, migrations, rotas da ponte)
faixa C: PR 3b                          (src/adapters/executor, motor/, desktop/; começa quando o contrato do 3a entra)
faixa B: PR 2 → PR 4 → PR 6            (web/telas, web/main.ts, interface.css; o PR 6 também hook e domain/nativas)
```

O PR 4 espera o 3a e o 3b, e o PR 6 espera o PR 4: as faixas se cruzam ali. O 3b pode ser escrito em paralelo com o
3a se o contrato (`PedidoRevisao`, `revisa`, a rota) entrar primeiro num commit à parte. Em paralelo de verdade só o PR 1 com o PR 2, e o
PR 5 com o PR 6 (os dois tocam `autorizar-comando.ts` e `modo-aprovacao.ts`: rebase do segundo).

### Riscos aceitos

- O revisor pode liberar um arriscado que a pessoa não liberaria; o EVAL e a contestação medem.
- No total, um texto de fora pode levar o bot a usar uma credencial (o pedido do Marlon, com confirmação, pílula âmbar,
  linha e Atividade).
- A marca de conteúdo de fora segue sem ver a leitura pelo Bash; a credencial no Automático segue cartão por isso
  (agora decisão do Marlon).
- O revisor gasta a cota da pessoa (decisão 1 do Marlon), com teto e contagem visível.
- ~~Dado pessoal sai para a Anthropic pela conta do Nod~~: não se aplica mais (decisão 1).
- As referências de linha são da `main` 1ccf3987, e as do redesenho da cc347901; quem implementa reancora.

## Redesenho do revisor (18/10)

As decisões do Marlon de 18/10 (ver "Decisões tomadas") tiraram o revisor do servidor. Este bloco resume o que mudou e
registra a revisão de engenharia curta feita só sobre o redesenho. Onde discorda da "Revisão de engenharia (18/10)"
acima, vale este bloco. Referências: `origin/main` cc347901.

### O que mudou

- **Onde roda:** no laço do motor (VM) ou do app do Mac que já roda o turno, com o CLI e a conta do turno: `claude -p`
  sem ferramenta, sem MCP, sem settings da pessoa, numa pasta vazia, pedido pelo stdin, saída JSON lida no servidor
  (Parte 3c). O pedido chega pela renovação de 1 s do turno, reentregue até o laço confirmar; o veredito volta por uma
  rota nova da ponte, com a prova do segredo do turno.
- **O que saiu do plano:** o segredo `nod-anthropic-revisor` no Secret Manager e a variável `NOD_REVISOR_CHAVE`; o
  cliente `fetch` em `src/adapters/revisor/`; o teto global em dólar e o gatilho de US$ 50 por mês; a fila de 8 no
  servidor e o disjuntor global; o ponto "dado pessoal para a Anthropic na política de privacidade" (o dado vai ao
  provedor e à conta que a pessoa já usa nos turnos, que já viram o comando e as mensagens).
- **O que entrou:** o desfecho "sem `revisa`" (cartão na fase 1), a caixa por turno na `PonteInterna`, a rota
  `revisao`, o segredo por turno, a checagem do init a cada chamada, os tetos de 20 por turno e 300 por pessoa por dia,
  o disjuntor por máquina, 2 revisões por máquina, o prazo de 60 s com `expiraEm`, a contagem na Atividade e o "na sua
  IA" no menu.
- **Codex:** cartão na v1 (decisão 29; decisão em aberto 9).
- **PRs:** o PR 3 vira 3a (servidor) e 3b (laço, motor e app do Mac, com release do app). O PR 1 e o PR 2 não mudam; o
  PR 4 muda pouco; o PR 5, o 6 e o 7 só nos textos e na credencial do Automático.
- **ADR-115:** o revisor não é autoridade remota síncrona do Nod; a objeção da cota (ADR-042) continua e é aceita pela
  pessoa ao escolher o Automático; a ADR-013 e a ADR-021 ficam intactas.

### Revisão de engenharia do redesenho

Voz de fora: um subagente Claude, só sobre a Parte 3 redesenhada, conferindo contra o código. 13 achados (1 P1, 6 P2,
6 P3); 12 viraram mudança, todos conferidos no código antes de entrar; 1 ficou como risco aceito.

1. **[P1] A chave da máquina passaria a aprovar, e na VM o bot alcança a chave.** Nenhuma rota de `/api/maquina/*`
   aprova nada hoje (`rotas/ponte.ts:274-450`); a chave do motor é um arquivo 0600 do mesmo usuário que roda o bot
   (`motor/conexao.ts:6-9`); a cerca de credencial é regex (`comando.ts:35`); a rota `renovar` aceita a chave com o
   turno em `c.planos` (`rotas/ponte.ts:317`). Um bot levado por um texto de fora poderia pegar o pedido e postar
   "libera". Mudou: segredo por turno só na memória do laço, amarrado no `promptSubmitted` (`laco.ts:350`), prova HMAC
   no veredito, `ptrace_scope` ≥ 1 na VM, gatilho de reversão na ADR-115 (3c, "Confiança"). A primeira versão do
   parágrafo ("confia como confia no hook") estava errada: o hook nunca aprova.
2. **[P2] A entrega "uma vez" se perdia** numa resposta de renovação que não chega (`ponte-http.ts:103`,
   `laco.ts:246-251`) e travava até o prazo; e o revisor dentro de `renovar` travaria a batida (`laco.ts:170`). Mudou:
   reentrega até `revisoesRecebidas`, como as mensagens do #189; o revisor roda sem `await`.
3. **[P2] A caixa estava só na rota HTTP.** No modo local e no e2e o laço fala direto com a `PonteInterna`
   (`orquestrador-turnos.ts:161`), e a rota remonta o `PedidoRenovar` campo a campo (`rotas/ponte.ts:328`). Mudou: a
   caixa e a marca `revisa` em `ponte-interna.renovar`; `PonteInterna.relatarRevisao?()`; o campo na rota.
4. **[P2] A justificativa do Codex estava errada.** O driver já desliga o shell (`codex-comum.ts:39-46`). Mudou o texto
   e a decisão 29; o "cartão na v1" fica pelos motivos que valem (sem lista de ferramentas por chamada,
   `collaboration.*` em aberto, EVAL próprio).
5. **[P2] A checagem do init não cobria plugins** (`stream-json.ts:91`), e `--max-turns 1` não impede uma ferramenta.
   Mudou: `plugins` vazio, `--permission-mode default`, `tool_use` no stream mata, a sonda testa com plugin, hook de
   usuário e conectores do claude.ai.
6. **[P2] O modo local renova a 30 s** (`constantes.ts:6`, `compor.ts:1228-1243`) e estouraria o prazo. Mudou:
   `expiraEm` no pedido, o laço mata em `expiraEm` − 5 s contando a espera da vez, e o modo local renova a 1 s.
7. **[P2] O e2e do PR 3b não rodaria:** o catcher não passa por `/nativas` e a jornada tem 60 s
   (`e2e-catcher.test.ts:41`). Mudou: `revisar` falso no catcher, marcador de Bash pelo `/nativas`, prazo e varredor
   injetáveis.
8. **[P3] Memória e cota no lugar errado:** `portaoDoMac` precisa do "uso do Mac" e da histerese, que estão no servidor
   (`memoria-mac.ts:383-392`), e `portaoDaCota` é por IA, não por conta (`cota-da-ia.ts:211-219`). Mudou: as duas
   checagens na fase 1, a cota por conta (`usosPorConta`, `ponte-interna.ts:155`).
9. **[P3] "Nada muda com a chave ligada" era impreciso:** sem `revisa`, o envio pelo terminal depois de conteúdo de fora
   passa a cartão. Mudou o texto, e o PR 4 só liga a chave com a maior parte dos turnos vindo de máquinas com `revisa`.
   A decisão em aberto 9 passa a valer a partir do PR 4.
10. **[P3] Um deploy descarta as revisões em voo** (caixa e segredo em memória). **Risco aceito na v1**: viram cartão
    em até 2 min; se o PR 4 medir muitas, gravar `revisaoId`, máquina e `expira_em` na decisão (3d).
11. **[P3] Processos do revisor órfãos** no `parar()` do laço (`laco.ts:440-446`). Mudou: o laço os guarda e mata no
    `parar()` e no fim do turno.
12. **[P3] Um `mkdtemp` por revisão** provavelmente acumula projetos no `.claude.json` da conta. Mudou: pasta vazia
    estável por conta, conferida vazia; a sonda confere o acúmulo.
13. **[P3] Telemetria e testes:** `entregue_em` em `acoes_pelo_modo`; testes de resposta perdida, `revisa` pela rota
    HTTP e em processo, segredo do turno e init com plugin. Entraram no PR 3a e no PR 3b.

Conferido e certo pela voz de fora: a renovação segue batendo enquanto o hook espera (é um `setInterval` à parte,
`laco.ts:264`, e o long-poll roda no processo do hook, `hook-nativas.ts:163-178`); o `em_revisao` cai no "pendente" do
`aguardar` (`interno.ts:205-219`); o laço tem o `registro` da conta do turno (`laco.ts:324-330`) e dois processos na
mesma conta já são o normal do pool (`pool-lacos.ts:20-28`); o revisor fora da fila do forno com teto de 2 faz sentido;
a ordem 3a → 3b → 4 e a reversão estão coerentes.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | CLEAR (PLAN) | 25 issues na 1ª; 13 no redesenho do revisor (1 P1), 12 dobrados e 1 aceito |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** nas duas rodadas, voz de fora por um subagente Claude (Codex não instalado). Na primeira, 17 pontos
  (ver "Revisão de engenharia (18/10)"). No redesenho, 13 pontos; o mais grave foi dela: a rota do veredito faria da
  chave da máquina uma aprovadora, e na VM o bot alcança a chave. Também dela: a reentrega, a caixa na `PonteInterna`,
  a justificativa errada do Codex, os plugins no init, o modo local a 30 s e o e2e que não rodaria.
- **VERDICT:** ENG CLEARED — pronto para implementar o PR 1 e o PR 2, que não mudaram. O PR 3a e o PR 3b estão
  desenhados com o revisor na IA da pessoa. As decisões 1 a 8 do Marlon (18/10) estão em "Decisões tomadas"; as do
  plano (1 a 11, 25 a 39) e da revisão (12 a 24) podem ser revertidas por ele. Fica em aberto a decisão 9 (Codex), que
  não bloqueia o PR 1, o PR 2 nem o PR 3.
