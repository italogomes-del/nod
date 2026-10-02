# Jornada 02 — Bots se chamam: delegação, @menção e workflows entre bots

> **Estado:** rascunho detalhado · **Definida em:** 2026-09-16 · **Motiva:**
> [evidência E-02-a](evidencias/README.md) (print "Marola coordena Ressaca e Review").
>
> **Quebra em épicos:** [jornada-02-epicos.md](jornada-02-epicos.md).

## Norte / valor para o usuário

Você pergunta a **um** bot; ele, para te responder, **aciona outros bots**, cada um dono de um pedaço
do problema, e devolve uma resposta sintetizada — com você vendo quem falou com quem. É a experiência
do print E-02-a: você pergunta ao **Marola** se o PR #399 foi mergeado, e ele coordena **Ressaca** e
**Review** para responder.

## Correção de design (2026-09-16): entre os SEUS agentes, é automático e sem menção

Princípio do dono: **para agentes privados (mesmo dono), o default é qualquer agente poder chamar
qualquer outro — "como mágica", sem você precisar citar ninguém.** Exatamente como um humano que
precisa de uma informação que outro humano tem: pergunta e aguarda a resposta. O bot deve fazer igual,
por conta própria.

O que o código **já garante** (verificado):

- **Mesmo dono passa sem procuração.** `src/use-cases/perguntar-a-bot.ts:33` só exige procuração
  quando `alvo.ownerId !== remetente.ownerId`. Entre os seus bots, a chamada é livre por default.
- **Sem @menção obrigatória.** `perguntar_a_bot` é uma **ferramenta que o próprio bot invoca**,
  escolhendo o alvo. O humano não precisa mencionar nada. A @menção é só um **direcionamento
  opcional** (em sala, ou quando você quer guiar) — **não** é o mecanismo da mágica.

O que **falta** para a mágica acontecer de fato:

- **Descoberta de agentes (roster que o modelo enxerga).** Para o bot escolher a quem perguntar sem
  você citar, ele precisa **ver** os seus outros agentes: nome + para que serve / o que sabe. Sem esse
  diretório no contexto, o modelo não tem como rotear "quem tem essa informação?". Esta é a peça-chave
  nova desta jornada (vira épico próprio).

## Decisão de design (2026-09-16): "aguardar" é inbox assíncrono, NUNCA bloqueio

A pergunta era: quando um bot pergunta a outro e aguarda, ele deve **bloquear** (síncrono) ou receber
a resposta numa **continuação** (assíncrono)? **Decidido: assíncrono, no modelo de caixa de entrada.**

O motivo é o caso concorrente. Enquanto o Marola espera o Ressaca sobre o #399, chegam uma pergunta de
outro bot (QA) e uma sua. Bloquear (síncrono) faria o Marola **congelar** e te ignorar até o Ressaca
responder — head-of-line blocking. Um humano ocupado não faz isso: dispara a pergunta e **segue
atendendo a caixa de entrada**; quando a resposta chega, ela **retoma** aquela tarefa.

```
SÍNCRONO (rejeitado — bloqueia):          ASSÍNCRONO (escolhido — inbox):
Você → Marola:  399 mergeado?             Você → Marola:  399 mergeado?
Marola: 🧊 espera o Ressaca               Marola: dispara p/ Ressaca+Review; tarefa-399 = aguardando
QA → Marola:    (na fila, sem resposta)   QA → Marola:    Marola responde (outro assunto)
Você → Marola:  e o 409? (sem resposta)   Você → Marola:  e o 409? → Marola responde
Ressaca: (responde) → Marola descongela   Ressaca: 399 entrou 14:35 → Marola RETOMA a tarefa-399
```

**Ser "interrompido" por bot e por humano enquanto aguarda não é bug — é o comportamento correto.**
O `entregar-resposta-peer.ts` já faz o round-trip por continuação; esta decisão o confirma como o
modelo, e não um `await` bloqueante.

Só é natural com **três disciplinas** (o trabalho de design desta jornada):

1. **Um agente por vez.** Nunca dois turnos do mesmo bot em paralelo — senão incoerência. A **fila por
   conversa** (ADR-010) já serializa dentro de uma conversa; falta garantir a serialização **através**
   das conversas do bot (seu DM + conversa própria + perguntas peer).
2. **Cada "aguardando" é uma tarefa etiquetada.** A resposta do Ressaca retoma **a tarefa-399**, não o
   que o bot estiver fazendo no instante — é a ligação tipada que `perguntar-a-bot` já cria.
3. **Prioridade na caixa.** Pergunta de **humano** fura a fila à frente de pergunta de bot; a resposta
   aguardada retoma o próprio fio. Sem isso, você fica atrás de bots na fila.

## Decisão de design (2026-09-16): modo squad — profundidade até 2, com retorno ao originador

Entre os **seus** agentes (mesmo dono, mesma cota), o teto de profundidade sobe de **0|1** para **2**.
Cross-owner continua **0|1** (mais estrito — o motivo do teto, ADR-025, só vale entre donos diferentes).

Regra do modo squad:

- **Profundidade máxima 2.** A cadeia pode descer dois saltos: A→B→C. Em profundidade 2 (o C), as
  ferramentas de salto somem — o C responde **com o que sabe**, não encadeia um quarto.
- **Dead-end volta ao ORIGINADOR.** Se ninguém na cadeia sabe, o "não sei" **sobe de volta até quem
  originou a pergunta** (o A, cujo turno nasceu da fala humana). Não morre no meio nem vira silêncio.
- **O originador decide a próxima tentativa.** O A, ao receber o dead-end, decide se tenta **outro**
  agente. Essa retentativa é um **novo galho a partir do A**, não um aprofundamento — por isso **não
  conta** contra o teto de profundidade.
- **Backstop por orçamento, não por contagem.** Como o A pode retentar lateralmente, o freio real é o
  **orçamento do canal** (gasto), não o número de tentativas. A **guarda de anel fica sempre** (loop é
  sempre bug, nunca workflow).

```
Você → Marola       [0]
   Marola → Ressaca [1]   Ressaca não sabe
      Ressaca → QA  [2]   QA também não sabe (e não pode encadear um 4º)
   ← "ninguém soube" sobe de volta ao Marola (originador)
Marola [continuação, COM direito a re-perguntar] decide: tento o Review?
   Marola → Review  [1]   novo galho — não aprofunda a árvore
```

**Por que 2 basta por ora:** um salto (0|1) obriga o originador a saber de antemão quem tem a
resposta; dois saltos deixam um agente delegar para um especialista que ele conhece melhor, mantendo
o humano a no máximo dois passos do fundo. Mais que isso afunda a árvore sem ganho claro.

> **Revisto em 2026-09-30 ([ADR-063](../adr/adr-063-pedido-entre-bots-ate-tres-passes.md)):** virou código com
> outra conta. A profundidade vai até 3, e cada passe soma 1, inclusive a resposta que volta ao originador. Não há
> orçamento por fio nem guarda de anel: o laço fica limitado pela profundidade. Entre donos diferentes continua um
> salto só, como abaixo.

Implicações (a resolver quando virar código):

- `src/domain/montagem-ferramentas.ts`: o corte das ferramentas de salto passa de `profundidade >= 1`
  para `>= 2` no modo squad.
- `src/use-cases/perguntar-a-bot.ts` e `entregar-resposta-peer.ts`: a profundidade do turno
  enfileirado hoje é **fixa em 1**; precisa **incrementar com a cadeia** (profundidade do pai + 1).
- O turno de continuação **do originador** precisa **manter** o direito de re-perguntar (hoje a
  continuação nasce profundidade 1 e perde as ferramentas de salto). Retornar-ao-originador ≠ descer.
- O "ninguém soube" precisa ser um **desfecho de primeira classe** que desenrola até o originador, não
  um texto solto que o próximo modelo tenta interpretar.

## O achado (leia antes de tudo)

**Nesta feature, o nod está à FRENTE do OpenMausBot no motor, e ATRÁS na experiência.** Isso inverte a
lógica da Jornada 01:

- **OMB:** só tem **channels organizacionais** — *"cada channel tem seu transcript, instruções
  compartilhadas, pasta de trabalho, regras de responder e roster editável de bots"*. É **coexistência**,
  não **interação**. O README do OMB **não** descreve @menção entre bots, handoff, um bot que chama e
  recebe resposta de outro, nem delegação. O OMB é *"inspired by Grok Bot"*, mas não carregou a
  feature de multi-bot interativo que o Grok promove.
- **nod:** já tem os **primitivos de bot-a-bot no domínio**, verificados no código:
  - `perguntar_a_bot` — pergunta de 1 salto a outro bot; entre donos diferentes exige **procuração**
    (ADR-025), o turno do alvo nasce `origem: peer`, `profundidade: 1`, entrada `nao_confiavel`
    (ADR-026), e a resposta volta por uma **ligação tipada** (`src/use-cases/perguntar-a-bot.ts`).
  - `encaminhar` / passe — handoff tipado, com **teto de 3 handoffs por rodada** sem fala humana
    (`src/domain/rodada-sala.ts`), para os bots não conversarem sozinhos sem você.
  - **salas de 2–6 bots** — membership por grant (ADR-027), **@menção vence** as políticas de
    responder (`quemResponde`), **orçamento de canal**.
  - **guarda de anel** — o domínio recusa A→B→C no terceiro remetente distinto (EMENDA-L9 §6).
  - **autoria composta** (ADR-023) — todo evento registra quem falou e em nome de quem.

**Conclusão:** aqui **não se copia o OMB** — copiá-lo seria um downgrade. A referência a perseguir é a
**experiência do Grok Bot** (capturada no print E-02-a). O trabalho do nod é **expor** os primitivos
que já existem na UX de chat e adicionar a camada de **"skills de workflow" + "quem eu posso chamar"**
que o dono descreveu.

## Como o OMB resolve isso × como o nod resolve

| | OpenMausBot | nod (hoje) |
|---|---|---|
| Bots juntos | channels (transcript/roster compartilhados) | **salas de 2–6 bots** com grant por membro |
| Um bot chama outro | **não descrito** | `perguntar_a_bot` (1 salto, com procuração) |
| Handoff entre bots | **não descrito** | `encaminhar` / passe tipado, teto 3/rodada |
| @menção direciona | regras de "responder" por channel | **@menção vence** (`quemResponde`) |
| Evitar loop infinito de bots | não descrito | **guarda de anel** + orçamento de canal |
| Auditoria de quem falou | log NDJSON | **autoria composta** + trilha imutável |
| Autoridade entre donos diferentes | — | **procuração** (ADR-025), fail-closed |

O que falta no nod é tudo **experiência e configuração**, não motor:
1. a UX de chat com bots como contatos e o fio de delegação visível (o print);
2. **"quem eu posso chamar"** como configuração explícita do agente (hoje é procuração no banco, sem UI);
3. **skills de workflow nomeadas** (o `/skill`) — que foram **cortadas** desta rodada (README, EMENDA 24).

## Persona & pré-condições

- **Persona:** Marlon pergunta ao bot **Marola** (Tech Lead) sobre o status de um PR; espera que o
  Marola saiba **a quem recorrer** (Ressaca para release, Review para o PR) sem ele orquestrar à mão.
- **Pré-condições:** os bots existem, com **instruções claras** (o que faço, o que não faço, quem
  posso procurar) e **procurações** entre donos onde necessário; uma sala ou o caminho de
  `perguntar_a_bot` disponível.

## A jornada, passo a passo (perspectiva do usuário)

1. **Você pergunta a um bot.** No chat com o Marola: *"399 já foi mergeado?"*
2. **O bot decide a quem recorrer** — guiado pelas próprias instruções e pela lista de quem ele pode
   chamar. O Marola aciona **Ressaca** (release) e **Review** (PR) via `perguntar_a_bot`/@menção.
3. **Você vê o fio da delegação.** A UI mostra `Marola → Ressaca` e `Marola → Review`, com as falas de
   cada um marcadas como vindas de outro bot (não de você).
4. **Os bots respondem — e podem perguntar de volta.** Ressaca confirma o merge e **pergunta** se deve
   rodar o Workflow `acme-releases` de novo; a pergunta escala a você (a garantia do nod).
5. **O teto protege contra bots tagarelando.** Se a cadeia passar de 3 saltos sem você, o próximo vira
   passe `teto_canal` — a conversa volta para você em vez de girar entre bots.
6. **O Marola sintetiza e devolve.** Uma resposta só, com o rastro de quem contribuiu.
7. **Tudo no cartório.** Cada @menção, delegação, resposta e passe vira trilha com autoria composta —
   quem perguntou, quem respondeu, sob procuração de quem, e quem pagou a cota (ADR-025).

## Capacidades introduzidas (de → para)

| Feature (do Grok/print) | nod hoje | Nesta jornada |
|---|---|---|
| **Um bot pergunta a outro por conta própria** (sem você citar) | `perguntar_a_bot` no domínio; **mesmo dono já passa sem procuração** | **descoberta de agentes**: roster que o modelo enxerga (nome + para que serve), pra ele rotear sozinho |
| Bots como contatos num app de chat | web em regiões, foco na frota | UX de sala/contatos com fio de delegação visível |
| Recebe a resposta e continua | resposta volta como turno de continuação (assíncrono) | decidir se "aguardar" deve parecer síncrono; expor o fio |
| @menção entre bots (direcionar) | `quemResponde` no domínio | @menção como **atalho opcional** (autocomplete), não o mecanismo |
| "Quem eu posso chamar" (entre donos diferentes) | procuração no banco, sem UI | config explícita; **entre os seus, o default é todos** |
| Skills de workflow (`/`) | **cortadas** (EMENDA 24) | trazer skills nomeadas de workflow de volta |
| Instruções "faço / não faço / procuro X" | prompt-sistema livre | seção estruturada no perfil do agente |

## Fora de escopo

- **Delegação sem teto** (bots conversando indefinidamente sem a pessoa) — o teto de 3/rodada e a
  guarda de anel ficam. A jornada **expõe**, não afrouxa, esses limites.
- **Bot-a-bot cruzando tenants** — um tenant só nesta rodada.

## Impacto arquitetural & ADRs afetados

Diferente da Jornada 01, esta jornada é quase toda **completar o que o nod já projetou**, não reverter:

- **ADR-025 (quem pede × quem paga), ADR-026 (não-confiável), ADR-027 (sala/grant), ADR-023 (autoria
  composta) — CONSTRUÍDOS SOBRE, não revertidos.** A jornada os leva à superfície.
- **EMENDA 24 (skills nomeadas fora desta rodada) — REVERTIDA.** As "skills de workflow" voltam. Isso
  precisa de ADR próprio (formato da skill, quem pode invocar, como se compõe com o plano de turno).
- **Pendência registrada em `perguntar-a-bot.ts` — RESOLVER:** hoje `gastoHoje = 0` (o teto diário de
  procuração não é contado, por falta de rota). Esta jornada liga o contador de cota ao ADR-025.

**A linha vermelha (herdada):** por mais que os bots se chamem, a cadeia sempre precisa **poder voltar
à pessoa** — é o que o teto de handoff e a guarda de anel garantem. Bots que se resolvem sozinhos sem
caminho de volta é exatamente o que o orçamento de canal existe para impedir.

## Evidência

[E-02-a — Marola coordena Ressaca e Review](evidencias/jornada-02-bots-chamando-bots-marola-pr399.png)
(descrição em [evidencias/README.md](evidencias/README.md)).

## Critérios de aceite

1. Você pergunta a um bot e ele aciona **outros dois** via `perguntar_a_bot`/@menção; a UI mostra o
   **fio da delegação** (`Marola → Ressaca`, `Marola → Review`).
2. Um bot acionado **consegue perguntar de volta** à pessoa (a garantia do nod).
3. A cadeia passa de 3 saltos sem fala humana → vira passe `teto_canal` e volta à pessoa.
4. Cada bot tem uma seção de **instruções** ("faço / não faço / posso procurar X") e a lista de quem
   pode chamar é **explícita e auditável**.
5. Existe ao menos uma **skill de workflow nomeada** que um bot invoca (o `acme-releases` do print é o
   exemplo-alvo).
6. Toda delegação/resposta/passe está na **trilha** com autoria composta e cota atribuída (ADR-025).

## Perguntas em aberto

- **Descoberta de agentes:** o que o roster mostra ao modelo (nome + descrição curta? capacidades?
  memórias?) e como isso entra no plano de turno (ADR-024) sem estourar contexto.
- ~~**"Aguardar" síncrono × continuação assíncrona**~~ → **DECIDIDO** (2026-09-16): inbox assíncrono,
  nunca bloqueio, com serialização por agente + retomada por tarefa + prioridade de humano. Ver a
  seção "Decisão de design". Fica pendente só: como o bot **sintetiza** quando consulta dois bots.
- **Modo squad — profundidade:** ~~0|1 ou mais?~~ → **DECIDIDO** (2026-09-16): profundidade até **2**
  entre os seus agentes, dead-end volta ao originador, retentativa lateral não aprofunda. Ver a seção
  "Decisão de design — modo squad".
- **Modo squad — handoff em sala e orçamento:** o teto de **3 handoffs/rodada** também sobe (ou vira
  só orçamento) entre os seus agentes? Princípio já acordado (backstop por **orçamento do canal**, não
  por contagem; guarda de anel fica). **Deixado em aberto de propósito por ora** (dono, 2026-09-16): o
  valor do teto de gasto — por rodada/tarefa/dia — será fixado depois.
- ADR novo para **skills de workflow nomeadas**: formato, quem invoca, como compõem com o plano de
  turno (ADR-024) e com a allowlist do agente.
- Decisão de produto pendente do **ADR-027**: o dono de um bot membro vê o **log inteiro** da sala ou
  só as falas do próprio bot?
- Ligar o **contador de cota diária** de procuração (hoje `gastoHoje = 0`).
