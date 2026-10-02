# Histórico — seis versões descartadas

Cada uma foi rejeitada por um motivo específico. O registro existe porque **as razões valem mais que os desenhos**: se alguém propuser de novo uma dessas direções, aqui está o que aconteceu quando tentamos.

---

## v1 — Fila de decisões
[`v1-decision-queue.html`](v1-decision-queue.html)

Primeira tentativa. Cinco telas: conversa, pendências, contexto, rotina, registro.

**Por que caiu:** tratava o agente como interlocutor individual e não modelava nada do que acontece de verdade — nem agentes conversando entre si, nem canais com pessoas. O print da operação real mostrou *"5 mensagens com 3 Bots"* e *"Enviou mensagem para Taga"*: existia uma organização de agentes que o desenho ignorava.

**O que sobreviveu:** aprovação como lista tipada com checkbox, item com dado pessoal desmarcado por padrão, silêncio como estado renderizado.

## v2 — Lista única
[`v2-single-list.html`](v2-single-list.html)

A tese era abandonar o interlocutor como unidade: uma lista só, onde `#geral` com o time inteiro e uma cadeia `Taga → Marola → Dev 3` são a mesma coisa.

**Por que caiu:** elegante no papel, ilegível no uso. Com 8 canais, 20+ DMs e 12 agentes, misturar tudo numa lista não é fusão — é sumiço.

**O que sobreviveu:** a fita de procedência, a régua de fôlego, o contador *Sua vez*, o selo de procuração.

## v3 — Quem mais lê
[`v3-who-else-reads.html`](v3-who-else-reads.html)

Uma régua visual: rostos à direita da linha são as pessoas além de você que leem aquela conversa. Sem rosto, ninguém além de você.

**Por que caiu:** respondia *"quem lê esta conversa"* quando a pergunta real era *"quem pode acionar este agente"*. São eixos diferentes — um agente só seu e um agente que atende o time inteiro podem estar os dois numa conversa de dois, e a régua dava faixa vazia para ambos.

**O que sobreviveu:** o par cheio/vazado para distinguir pessoa de agente, e a jornada de criar um agente pessoal em 3 cliques e 2 frases.

## v4 — Duas abas
[`v4-two-tabs.html`](v4-two-tabs.html)

Aba **Time** fiel ao Slack, aba **Meus agentes** no estilo GrokBot. O `#` literal voltou.

**Por que caiu:** não errou — foi superado. A frota não podia viver dentro de uma empresa, porque os agentes são da pessoa, não da conta.

**O que sobreviveu:** quase tudo da aba Time. E o mecanismo de **convidar, não promover**: um agente pessoal é convidado para um canal no mesmo campo onde se convida uma pessoa, chega de mãos vazias e pede acesso na frente de todos.

## v5 — O Cais
[`v5-the-quay.html`](v5-the-quay.html)

Multi-empresa com a frota numa coluna fixa à direita — a única que não muda ao trocar de conta.

**Por que caiu:** também não errou. O painel de juízes escolheu esta por 3 votos a 1, mas na comparação direta a opção *Frota é Casa* ganhou por inverter quem é anfitrião.

**O que sobreviveu:** o rail de empresas, o *Sua vez* global atravessando contas, os brasões de empresa no avatar do agente, e a trava de que a memória do canal não volta para a frota — de onde sai, de graça, o isolamento entre empresas.

## v6 — Destino ou partida
[`v6-destination-or-origin.html`](v6-destination-or-origin.html)

Não é um protótipo: é a comparação lado a lado entre duas opções que pareciam idênticas no diagrama. Três telas de cada.

**A diferença:** as duas usam o mesmo mecanismo — um slot no rail que troca a tela. O que muda é **por onde o produto abre**. Slot Zero abre na empresa e a frota é onde você vai; Frota é Casa abre na frota e as empresas são onde você vai.

**A escolha:** Frota é Casa, por dois motivos — a aposta de que agentes viram centralizadores de conversa, e a necessidade de servir quem não quer trocar de ferramenta de chat.

---

## Bônus — os seis rascunhos
[`sketches-six-layouts.html`](sketches-six-layouts.html)

Seis lugares possíveis para a frota numa janela multi-empresa, em diagramas comparáveis: O Cais, Slot Zero, A Régua, A Doca, Dois Palcos, Frota é Casa.

A pergunta que separou os seis não foi estética: **quanto da frota você vê quando nada está acontecendo.** Três das seis compravam proeminência a crédito de atividade — ficam visíveis quando os agentes trabalham e apagam quando não. Encontrar acontece no silêncio, não no barulho.
