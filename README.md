# nod

> Um lugar onde agentes preparam decisões e uma pessoa decide — com registro de quem decidiu, por quê, e se havia alguém olhando.

**Ferramenta interna da Leapy.** Cada colaborador usa a LLM que já está credenciada na própria máquina — Claude Code, Cursor ou Codex. O nod pilota, nunca vê a credencial. Virar SaaS é plano próximo, e a arquitetura protege isso sem pagar o custo agora. Ver [interno primeiro](docs/internal-first.md).

Repositório de artefatos de produto. **Ainda não há código.**

---

## O problema

Quem opera uma equipe de agentes de IA descobre rápido que o gargalo não é a capacidade deles — é a atenção de quem decide. Doze agentes trabalhando a noite inteira produzem, de manhã, uma pilha de coisas que pararam esperando alguém dizer sim ou não.

Hoje essa pilha está espalhada: um pedaço num chat, outro num e-mail, outro numa aba que ninguém abriu. E a pior parte não é o que está na pilha — é o que **não** está: a rotina que não rodou, o agente que ficou fora do ar, a tarefa que falhou em silêncio.

O nod é o lugar onde essa pilha tem um dono, um relógio e um fim.

## A tese

O produto abre numa **fila**: todas as decisões que esperam você, atravessando todas as empresas onde opera, mais antiga no topo, cada uma com quanto tempo está esperando e quanto falta para ser recusada automaticamente. Abaixo dela, escrito com o mesmo peso, **o que não aconteceu**.

Quando um agente termina um trabalho, ele não devolve um parágrafo para você ler na diagonal — devolve uma **lista de itens** que você marca e desmarca um a um. Tudo que toca dado de um jovem aprendiz chega desmarcado, com o agente explicando em primeira pessoa por que desmarcou.

Quando ele esgota o que consegue fazer sozinho, ele **para**, diz o que falta e quem pode destravar, e não tenta de novo.

## Princípios

1. **Vazio nunca significa vazio.** Todo silêncio — não executou, fora do ar, esperando há dois dias — aparece escrito.
2. **O agente nunca devolve um parágrafo quando a resposta é uma decisão.** Lista tipada, item a item, com o botão contando ao vivo.
3. **O teto é um limite, não uma sugestão.** Quando o agente bate no que não alcança, ele encerra o turno e nomeia o que falta. Nunca tenta outro caminho.
4. **Autorização mora na conversa, não num painel.** Quem concede é quem estava lá, e “quem autorizou você?” se responde rolando a tela para cima.
5. **Cor é escassa e a fila tem fim.** Azul é não lido de gente, âmbar é a bola com você, cinza é todo o resto — inclusive agente trabalhando.

---

## O que tem aqui

### Produto

| | |
|---|---|
| [`docs/product-spec.html`](docs/product-spec.html) | **O documento de produto.** 5 jornadas, 12 épicos, 69 histórias com critérios de aceite, mockups e diagramas, faseamento e o que se herda de cada referência. |
| [`prototypes/fleet-is-home.html`](prototypes/fleet-is-home.html) | **O protótipo vigente.** Cinco telas navegáveis: a fila como tela inicial, o canal com a calha de agentes, o teste do composer, a bandeja de aprovação e o estado de repouso. |
| [`prototypes/history/`](prototypes/history/) | As seis versões anteriores, com o registro de por que cada uma foi descartada. |

### Arquitetura

| | |
|---|---|
| [`docs/adr/`](docs/adr/) | **18 decisões de arquitetura**, uma por arquivo. Cada uma com alternativas rejeitadas, evidência de código e reversibilidade honesta. |
| [`docs/architecture.html`](docs/architecture.html) | As mesmas decisões em formato visual, com diagrama do sistema. |
| [`docs/skeleton.md`](docs/skeleton.md) | A árvore de pastas, as funções puras, a disciplina de código e os sete primeiros commits. |
| [`docs/grokbot-comparison.md`](docs/grokbot-comparison.md) | **O Grok Bot muda alguma decisão?** Não — e as seis emendas baratas que a comparação revelou, incluindo uma contradição entre o E2.4 e o ADR-013. |
| [`docs/internal-first.md`](docs/internal-first.md) | **A revisão para uso interno.** O que mudou quando o executor saiu do container e foi para a máquina de cada pessoa, a ponte app↔servidor, e as três coisas impossíveis de retroagir. |
| [`docs/distribution-and-local-execution.md`](docs/distribution-and-local-execution.md) | **Alvos de distribuição e execução local.** Por que não é monorepo, por que um app web não alcança o CLI da sua máquina, e a ordem web → PWA → app nativo. |
| [`docs/inherited-from-leapy.md`](docs/inherited-from-leapy.md) | **O que herdamos do monorepo da Leapy.** 14 práticas verificadas nos arquivos, o veredito sobre pacote único *vs* workspaces, e os 8 ADRs que mudaram por causa disso. |

Os HTML são autocontidos — abra no navegador, sem build.

### As três decisões que precisam ser acertadas de primeira

1. **A forma do registro de decisão** e dos identificadores que atravessam o fio. É o que o produto vende e o que a trilha imutável congela — migrá-lo depois é migrar a prova.
2. **O que pode entrar na trilha imutável**, decidido com o jurídico *antes* do schema. A trilha é imutável por trigger e trata dado de menor sob LGPD: as duas coisas só coexistem se ela aceitar apenas enum, uuid, timestamp e numérico, com o texto humano vivendo numa tabela irmã apagável.
3. **O modo do pooler, o tamanho do pool e a política de deploy.** Não é um ADR bonito, mas cinco decisões de quatro frentes dependem dele.

## Decisões de arquitetura de navegação

O produto **abre na frota**, não num canal. As empresas são lugares que você visita a partir dela — invertendo quem é anfitrião e quem é hóspede. Dois motivos:

1. A aposta de que as pessoas vão conversar mais com agentes do que com outros humanos, e o agente vira centralizador de conversas.
2. O produto precisa servir quem **não quer trocar de ferramenta de chat**. A área de espaço de trabalho é opcional; dá para adotar só a frota e manter o Slack da empresa.

A **calha** de 88px à direita mostra quem precisa de você. Ela é reservada permanentemente no grid — nunca muda de largura, e por isso não tem como atrapalhar o campo de texto.

## Referências estudadas

O desenho saiu da leitura de dois produtos open source e da documentação de um terceiro, não de suposição:

- **[Grok Bot](https://docs.x.ai/grok-bot/overview)** (xAI) — a régua de minimalismo. Seis conceitos no vocabulário inteiro. Se uma capacidade não cabe em “conversa com o agente” ou “detalhes da conversa”, ela não vira tela de primeiro nível.
- **[OpenMausBot](https://github.com/milind-soni/OpenMausBot)** (~248k linhas TS) — a camada de agentes: normalização de múltiplos provedores num stream canônico, modos de aprovação fail-closed, e o teto de conversa que escala para a pessoa em vez de tentar de novo.
- **[Buzz](https://github.com/block/buzz)** (~367k linhas Rust, Block) — o modelo de colaboração: agentes como membros com escopo por canal, e workflows com aprovação humana como passo de primeira classe.

Cada afirmação técnica no documento foi verificada contra o código, com caminho de arquivo. Onde a documentação e o código divergiam, o código venceu.

## Estado

Especificação. Nenhuma linha de produção escrita.

O faseamento estimado é de **27 a 29 semanas** para os oito épicos originais, mais **11 a 15 semanas** para os quatro épicos de infraestrutura — com dois deles (sobreviver ao restart, credenciais por tenant) obrigatoriamente na primeira fase, porque são propriedades do fundamento e são caros de adicionar depois.

## Próximos passos

- [ ] **Fixar a forma do registro de decisão** e os identificadores — bloqueia a primeira migração
- [ ] **Definir com o jurídico o que pode entrar na trilha imutável** — retenção e direito ao esquecimento antes do schema
- [ ] Decidir modo do pooler, tamanho do pool e rolling *vs* recreate no PaaS
- [ ] Métricas de sucesso por épico — precisa de números reais da operação
- [ ] Validar a procuração com duas ou três pessoas antes de soltar para o time
