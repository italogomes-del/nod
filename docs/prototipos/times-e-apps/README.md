# Protótipo: times e apps na barra lateral

Protótipo de 07 e 08/11/2026 do conceito de **time** e **apps de time** no Nod, feito com o Marlon para decidir como a
barra lateral (conversas com bots, no modelo do Grok Bot e do WhatsApp) convive com os apps dos bots (o quadro, hoje).
O canvas interativo é https://claude.ai/artifact/6dSYj4vQ9kP8vPx5noQmtr (privado, na conta em que foi criado). Esta
pasta é a cópia que não depende de acesso a ele.

- `telas/`: um PNG por passo de cada jornada, 1440 × 900, gerados de `fonte/` por `renderizar.mjs` (resolve o template
  do canvas em Node e fotografa com o `chrome-headless-shell` do Playwright; não precisa do runtime do canvas).
  `telas/indice.json` lista cada foto com o passo e a explicação que o canvas mostra.
- `fonte/`: o código das telas no formato do canvas de Design (`canvas.json` + um `.dc.html` por tela, todas interativas:
  os passos são os botões do canto inferior esquerdo). Para reabrir num canvas novo, publique estes arquivos sob `project/`.
- As telas usam um CSS próprio, próximo ao app de hoje, não o de `web/`. Os bots, tarefas e falas são de exemplo; os
  ids (ADA-14, MIL-3) são reais, o conteúdo não.

## O conceito

- **Time = quem.** Uma linha na barra com o mosaico 2×2 dos membros e uma conversa em grupo por time. Um bot pode
  estar em vários times; os bots não ficam aninhados sob o time (lista «Bots» própria).
- **App = o quê.** O quadro é o primeiro. Cada app tem um bot anfitrião, que responde por ele. Apps não têm linha na
  barra: ficam na faixa que aparece ao passar o mouse na linha do time, no «⋯» e na pílula («conversa · Quadro ▾»).
- **Bot = conversa particular.** Continua como hoje. Quando o quadro de um bot ganha um segundo membro, ele passa a ser
  app do time e a pílula do bot aponta o time («Time Nod ↗»).
- **Abrir um app recolhe a barra** para a coluna de avatares (o rail), e o app ganha a largura.
- Cores: «com você» (gate humano) é sempre azul; nada de faixa âmbar; dicas de estreia são balões presos ao elemento.

Decisões anteriores que esta direção respeita: pílula com os modos (22/10), «o agente é uma lista de tarefas» (22/10),
revelação progressiva da opção 9 (02/11). O que ela muda: a seção da barra de hoje (Time Nod, Leapy) vira o time.

## As telas

### E4b · A barra: times em mosaico, bots fora, faixa de um clique

A direção escolhida pelo Marlon em 07/11. Times no topo com mosaico 2×2 dos membros; bots numa lista própria, sem aninhar (um bot pode estar em vários times); o quadro não tem linha na barra: aparece na faixa que surge ao passar o mouse na linha do time e na pílula.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `E4b-faixa-um-clique-01-conversa-do-time.png` | Passe o mouse em «Leapy» e veja: nada. Agora na linha «Time Nod»: à direita aparece uma faixa com o glifo do quadro e os avatares dos membros. Um clique no glifo abre o quadro; um clique num avatar abre aquele bot em particular. Fora do hover a faixa some; no time selecionado ela fica. |
| 2 | `E4b-faixa-um-clique-02-quadro.png` | Quadro aberto pela faixa (ou pela pílula). Na barra, o selecionado continua sendo o time. A faixa fica visível enquanto o time está selecionado, então voltar ou pular para a Ada continua a um clique. |
| 3 | `E4b-faixa-um-clique-03-ada-em-particular.png` | Ada em particular: só vocês dois. A pílula aponta para o workflow do time. |

### E5 · A mesma barra com 10 bots e 5 apps

Teste de escala da E4b: a linha do time não muda; a faixa mostra no máximo 3 alvos (app principal, app com pendência para você, «⋯»); o «⋯» abre um painel com os apps e os membros; a pílula vira «conversa · <app atual> ▾».

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `E5-dez-bots-cinco-apps-01-conversa-do-time.png` | Time de 10 bots e 5 apps. Em repouso a linha do time é igual à de antes: mosaico, nome, «· 10 · 5 apps», prévia. No hover, a faixa mostra só o essencial: o Quadro, as Aprovações (porque têm 2 com você) e «⋯». O «⋯» abre um painel inline com os 5 apps e os 10 membros, um clique cada. |
| 2 | `E5-dez-bots-cinco-apps-02-painel-apps-e-membros.png` | Time de 10 bots e 5 apps. Em repouso a linha do time é igual à de antes: mosaico, nome, «· 10 · 5 apps», prévia. No hover, a faixa mostra só o essencial: o Quadro, as Aprovações (porque têm 2 com você) e «⋯». O «⋯» abre um painel inline com os 5 apps e os 10 membros, um clique cada. |
| 3 | `E5-dez-bots-cinco-apps-03-quadro.png` | App «Quadro» aberto: a barra recolhe; na pílula o modo deixa de ser um nome fixo e vira «Quadro ▾», que abre o menu dos 5 apps. Assim a pílula não cresce com o número de apps. |
| 4 | `E5-dez-bots-cinco-apps-04-menu-de-apps.png` | App «Quadro» aberto: a barra recolhe; na pílula o modo deixa de ser um nome fixo e vira «Quadro ▾», que abre o menu dos 5 apps. Assim a pílula não cresce com o número de apps. |
| 5 | `E5-dez-bots-cinco-apps-05-app-metricas.png` | App «Métricas» aberto: a barra recolhe; na pílula o modo deixa de ser um nome fixo e vira «Métricas ▾», que abre o menu dos 5 apps. Assim a pílula não cresce com o número de apps. |
| 6 | `E5-dez-bots-cinco-apps-06-ada-em-particular.png` | Ada em particular, igual. A pílula aponta «Time Nod ↗». |

### J1 · Criar um time: três portas, nenhuma com formulário

Arrastar um bot sobre outro, «+» › Novo time (a grade vira seletor) ou pela fala com o próprio bot. O nome provisório vem dos membros e se edita na própria linha da barra.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J1-nascer-um-time-01-porta-1-arrastar-bot-sobre-bot.png` | Porta 1 · Arrastar um bot sobre outro, como pastas no iPhone. O Xumbrega está sendo arrastado sobre a Ada: a Ada ganha o anel azul e o rótulo diz o que vai acontecer. Clique no passo 2 para soltar. |
| 2 | `J1-nascer-um-time-02-soltou-time-nasce-grupo-abre.png` | Soltou: a linha do time nasce em «Times» com o mosaico dos dois, o nome provisório vem dos membros e o grupo já abre com a Ada chamando o Xumbrega. Um toast oferece «Dar nome» e «Desfazer». O Xumbrega continua na lista de bots (meio apagado só aqui, para você ver que ele não saiu de lá). |
| 3 | `J1-nascer-um-time-03-dar-nome-na-propria-linha.png` | Dar nome: edita-se na própria linha da barra, com o cursor no texto. Nada de formulário. Enter confirma; Esc mantém o nome provisório. |
| 4 | `J1-nascer-um-time-04-porta-2-novo-time.png` | Porta 2 · «+» no topo › «Novo time». A grade de bots vira um seletor: toque em quem entra. Sem formulário de nome: o nome vem dos escolhidos e muda depois pela linha. |
| 5 | `J1-nascer-um-time-05-escolheu-3-criar.png` | Criou com 3: o mosaico mostra os três, o grupo abre, o nome provisório é «Ada, Gil e Xumbrega». Mesmo toast de «Dar nome». |
| 6 | `J1-nascer-um-time-06-porta-3-pela-fala-com-a-ada.png` | Porta 3 · Pela fala, com o próprio bot: «chama o Xumbrega e o Gil pra trabalhar com você». Clique no chip. |
| 7 | `J1-nascer-um-time-07-a-ada-cria-o-time.png` | A Ada cria o time, conta em uma linha, oferece ir para lá ou desfazer. O time nasce com ela como quem chamou. Na barra, a linha já existe. |

### J2 · Adicionar um bot ao quadro cria o time

Não existe «criar time» a partir do quadro: adicionar alguém é o ato. Pelo «→ Ada» no cabeçalho da coluna, arrastando o bot para a coluna, ou pela fala. Resultado imediato, com «Dar nome · Levar para o Time Nod · Desfazer».

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J2-quadro-nasce-no-bot-01-quadro-da-ada-ada-na-coluna.png` | Pela interface: no quadro da Ada, cada coluna tem quem cuida («→ Ada»). Clique nele e escolha o Xumbrega. Não existe botão «criar time»: adicionar alguém ao quadro é o ato. |
| 2 | `J2-quadro-nasce-no-bot-02-escolheu-o-xumbrega-virou-time.png` | Escolheu o Xumbrega: a coluna passa para ele, e uma linha acima do quadro diz o que mudou: virou o time «Ada e Xumbrega». Ali mesmo: «Dar nome», «Levar para o Time Nod» (os dois já estão lá) e «Desfazer». No rail, o mosaico do time surge com anel azul. |
| 3 | `J2-quadro-nasce-no-bot-03-ou-arrastar-o-xumbrega-para-a-coluna.png` | Mesma porta, outro gesto: arrastar o Xumbrega da barra para a coluna. A coluna ganha a borda azul e o rótulo diz o resultado. Soltar faz o mesmo que o passo 2. |
| 4 | `J2-quadro-nasce-no-bot-04-ou-pela-fala-com-a-ada.png` | Pela fala, com a Ada: «coloca o Xumbrega cuidando de Implementando». Clique no chip. |
| 5 | `J2-quadro-nasce-no-bot-05-a-ada-faz-e-conta.png` | A Ada faz e conta em uma linha: o quadro virou do time. Ela oferece nome, levar para o Time Nod, ou desfazer. Não pergunta antes: você já decidiu ao adicionar. |
| 6 | `J2-quadro-nasce-no-bot-06-no-time-conversa.png` | No time: linha de sistema conta a origem; a Ada passa a coluna; o Xumbrega aceita; o evento fica registrado. A pílula da Ada perdeu o modo quadro. |
| 7 | `J2-quadro-nasce-no-bot-07-no-time-quadro.png` | O quadro, agora pela pílula do time. A barra recolhe e o rail mostra o time selecionado. |

### J3 · Um app novo no time, pela fala

«@Frida monta um app de métricas»: quem cria é anfitrião do app e entra no time se não estava. O campo de baixo de um app fala com o anfitrião.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J3-um-app-novo-01-pedir-no-grupo.png` | Um app novo nasce pela fala, no grupo, pedido a um bot. Quem cria vira anfitrião do app. Clique em Enviar. |
| 2 | `J3-um-app-novo-02-frida-cria-o-app.png` | A Frida criou o app e entrou no time por isso. Na barra: «· 2 apps», a faixa ganhou o glifo de Métricas (azul = novo). A pílula e o «⋯» listam o app com o nome da anfitriã. |
| 3 | `J3-um-app-novo-03-metricas-aberto.png` | App aberto: a barra recolhe; a pílula mostra «Métricas ▾». O campo de baixo fala com a anfitriã do app (Frida), não com o time inteiro. |
| 4 | `J3-um-app-novo-04-menu-de-apps.png` | A Frida criou o app e entrou no time por isso. Na barra: «· 2 apps», a faixa ganhou o glifo de Métricas (azul = novo). A pílula e o «⋯» listam o app com o nome da anfitriã. |

### J4 · Entrar e sair do time

Pela fala ou por «⋯» › Membros › ×. App sem anfitrião não existe: ao sair o anfitrião, o time pergunta quem assume. Último bot sai: o time fica vazio e apagado, apps parados; o Nod sugere arquivar.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J4-entrar-e-sair-01-pedir-a-saida-no-grupo.png` | Sair pela fala, no grupo. Clique no chip. Sair nunca apaga o que o bot fez ou disse. |
| 2 | `J4-entrar-e-sair-02-gil-saiu-app-sem-anfitriao.png` | O Gil saiu: linha de sistema, mosaico e contagem mudam. Como ele era anfitrião do app Protótipos, o app não pode ficar sem dono: a Ada pergunta quem assume, com uma opção padrão (ela mesma). |
| 3 | `J4-entrar-e-sair-03-ada-assume-o-app.png` | A Ada assumiu: evento no grupo e o app passa a listar «Ada» no «⋯». |
| 4 | `J4-entrar-e-sair-04-ou-membros.png` | A outra porta: «⋯» › Membros. Cada linha mostra o papel (anfitrião de quê) e um × no hover. Remover quem é anfitrião dispara a mesma pergunta. |
| 5 | `J4-entrar-e-sair-05-ultimo-sai-time-vazio.png` | Quando o último bot sai, o time não some: fica vazio e apagado na barra, com os apps parados, e o Nod sugere arquivar ou chamar alguém. Apagar sozinho seria perder o endereço dos apps. |

### J5 · Uma pessoa no time

Pessoa entra pela mesma porta que um bot. Avatar de inicial em círculo, nunca a forma dos bots. Vê grupo e apps inteiros; muda só o que pode fazer. Card com pessoa é azul «com Marina».

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J5-pessoa-no-time-01-gil-pede-revisao-humana.png` | Um gate humano aparece: o Gil quer revisão de produto. Pessoa entra no time pela mesma porta que um bot. |
| 2 | `J5-pessoa-no-time-02-membro-marina.png` | «⋯» › «+ membro»: a lista mistura bots e pessoas do Nod; pessoa de fora, por e-mail. Clique em Marina. |
| 3 | `J5-pessoa-no-time-03-marina-no-time.png` | Marina entrou: avatar de pessoa (inicial, sem a forma dos bots) no mosaico, na faixa e na lista. A Ada já diz o papel dela e o que está com ela. Pessoa vê o grupo inteiro. |
| 4 | `J5-pessoa-no-time-04-quadro-card-com-marina.png` | No quadro: coluna «Revisar → Marina»; o card dela é azul «com Marina» (gate humano intencional, nunca âmbar). |
| 5 | `J5-pessoa-no-time-05-marina-fala-e-devolve.png` | Marina fala no grupo como qualquer membro; mover o card vira evento. Bots respondem a ela como a você. |
| 6 | `J5-pessoa-no-time-06-ver-como-marina.png` | «Ver como Marina»: o mesmo quadro, mesmo grupo. O que muda é o que ela pode fazer (mover cards, falar; não criar apps nem remover membros). Sem visão reduzida. |

### J6 · Um bot em dois times

Uma conversa particular só; nela o bot separa por time (mosaico + nome). O particular não vaza para os grupos; a memória de um time não vaza para outro.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J6-bot-em-dois-times-01-em-particular-o-que-esta-parado.png` | A Ada está em dois times (mosaicos dos dois na barra). Em particular há UMA conversa: ela responde separando por time, cada bloco com o mosaico e o nome do time, e aponta onde está a pendência. |
| 2 | `J6-bot-em-dois-times-02-em-particular-o-que-fica-entre-nos.png` | O particular é particular: o que você diz à Ada sobre o Leapy não vai para o grupo do Leapy. Ela leva para lá só o que for do trabalho, como proposta. |
| 3 | `J6-bot-em-dois-times-03-no-leapy-como-membro.png` | No Leapy ela é só um membro: fala quando chamada ou quando é anfitriã do app envolvido. A memória do Produto Nod não vaza para cá. |
| 4 | `J6-bot-em-dois-times-04-no-produto-nod-como-membro.png` | No Produto Nod, idem. A pílula da Ada em particular mostra os dois times como atalhos («Produto Nod ↗ · Leapy ↗»). |

### J7 · Enquanto você estava fora

Prévia em negrito; na faixa, o app com pendência em azul e a contagem «com você»; a bandeja ✉ soma times e bots; no grupo, divisor e resumo de 3 linhas da anfitriã; no quadro, coluna «Com você» com a ação no card.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J7-enquanto-fora-01-barra-ao-voltar.png` | Ao voltar: prévias em negrito nos times e bots com novidade; na faixa de cada time, o app com pendência em azul e a contagem «com você». Nada de faixa âmbar. |
| 2 | `J7-enquanto-fora-02-bandeja.png` | A bandeja «✉» (a de hoje) soma times e bots: primeiro «Com você» por app, depois «Não lidos». Cada item leva direto ao lugar. |
| 3 | `J7-enquanto-fora-03-grupo-resumo-da-anfitria.png` | No grupo, um divisor marca quando você saiu, e a anfitriã abre com um resumo de três linhas: feitas, com você, travadas. Resumo é dela, não do sistema. |
| 4 | `J7-enquanto-fora-04-quadro-as-2-com-voce.png` | No quadro, a coluna «Com você» concentra as duas: cada card diz o que espera (aprovar, decidir) e tem a ação no próprio card. |
| 5 | `J7-enquanto-fora-05-aprovou-uma-contagem-cai.png` | Aprovou a ADA-20: a contagem cai na coluna, na faixa da barra e na bandeja, na hora. |

### J8 · Arquivar o time (o inverso da J2)

Uma confirmação: o que fazer com cada app (volta ao anfitrião como quadro do bot, ou arquiva junto). Linha some, toast com Desfazer, histórico pesquisável; a busca encontra arquivados com «Restaurar».

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J8-arquivar-o-time-01-fim-do-ciclo-ou-fala.png` | Duas portas: «⋯» › Arquivar o time, ou pela fala. Clique no chip ou no «⋯». |
| 2 | `J8-arquivar-o-time-02-confirmar-o-que-fazer-com-o-app.png` | Uma confirmação só, com a pergunta que importa: o que fazer com o app. O Quadro tem anfitriã (Ada), então pode voltar a ser quadro dela: o caminho inverso da J2. Histórico nunca se apaga. |
| 3 | `J8-arquivar-o-time-03-arquivado-quadro-volta-a-ada.png` | Arquivado: a linha some da barra, toast com «Desfazer». A pílula da Ada recupera o modo «quadro», com todo o conteúdo. A conversa do time fica pesquisável. |
| 4 | `J8-arquivar-o-time-04-depois-buscar-e-restaurar.png` | Semanas depois: buscar «Lançamentos» encontra o time arquivado, com «Restaurar» e «Ver o histórico». Restaurar traz a linha de volta e o Quadro volta ao time. |

### J9 · Primeiro dia: revelação progressiva

Conta nova vê só um bot. «Times» aparece com o primeiro time; a faixa com o primeiro app; cada estreia tem uma dica presa ao elemento, uma vez só, com «Entendi». Nenhuma tela de configuração.

| Passo | Arquivo | O que mostra |
|---|---|---|
| 1 | `J9-primeiro-dia-01-conta-nova-so-a-ada.png` | Conta nova: a barra é só a Ada e um «outro bot». Sem rótulos «Times» e «Bots», sem bandeja, sem faixa. Nada do que ainda não existe aparece. |
| 2 | `J9-primeiro-dia-02-segundo-bot.png` | Segundo bot: a grade ganha o Xumbrega. Ainda sem «Times». A Ada diz, na conversa, como juntar os dois. |
| 3 | `J9-primeiro-dia-03-arrastar-primeiro-time.png` | O primeiro time nasce pelo gesto (ou pela fala): anel azul e rótulo, como na J1. |
| 4 | `J9-primeiro-dia-04-times-aparece-com-dica-presa.png` | O rótulo «Times» aparece pela primeira vez, com uma dica presa à linha (balão com seta, não faixa âmbar). «Entendi» e ela some para sempre. |
| 5 | `J9-primeiro-dia-05-primeiro-app-dica-na-faixa.png` | O primeiro app: a faixa aparece pela primeira vez com o glifo em azul e outra dica presa, só uma vez. |
| 6 | `J9-primeiro-dia-06-semanas-depois.png` | Semanas depois: dois times, quatro bots, «Bots» como lista. A barra da E4b, chegou aqui sem nenhuma tela de configuração. |

## Regras em aberto para o Marlon validar

1. Gatilho do time pelo quadro: qualquer segundo membro (bot ou pessoa). «Levar para o Time Nod» só aparece se os dois já
   são membros de um mesmo time.
2. Quem chamou é o padrão para assumir um app órfão; pausar é a alternativa.
3. Quem cria um app entra no time automaticamente.
4. O último bot a sair deixa o time vazio e apagado, com apps parados; não apaga.
5. Pessoa de fora do Nod entra por e-mail; dentro, pela mesma lista que os bots.
6. O resumo de «enquanto você estava fora» é da anfitriã, não do sistema.
7. Restaurar um time arquivado devolve o app que tinha voltado ao bot.
8. Painel do «⋯» inline (empurra a lista) ou popover flutuante: inline no toque, a confirmar no mouse.
9. Conversa é uma por time; os eventos dizem de qual app vêm.

Relacionado: o projeto P-NOD-15 «Quadro-agente» no Linear e o plano [NOD-460](../../planos/nod-460-quadro-tela-cheia.md) do quadro em tela cheia.
