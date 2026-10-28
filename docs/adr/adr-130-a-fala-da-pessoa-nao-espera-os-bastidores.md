# ADR-130 — A fala da pessoa não espera os bastidores

Status: proposta · Data: 2026-10-26 · Emenda a [ADR-099](adr-099-um-dono-por-bot.md) (item 1, a rotina e o pedido de
colega na fila do dono) e a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) §3 (a faixa da conversa); toca
a [ADR-100](adr-100-o-motor-se-atualiza-sozinho.md) (a drenagem).

## Contexto

Em 26/10 o Marlon mandou à Ada uma mensagem que ficou com "Na fila · Ada lê quando terminar o turno atual", com a pílula
"Esperando Leonardo · 21 d · 1 pedido na fila". O relato é de toda hora. Lido no código (main bb4e0858):

- **A conversa do bot tinha uma faixa só** (`reivindicar`, ADR-083 §3): um turno sem trabalho espera qualquer outro sem
  trabalho da mesma conversa que esteja `despachando`. A pessoa passa na frente dos pendentes (ADR-099 I6), mas não de
  quem já roda.
- **Rotina e pedido de colega rodam nessa faixa.** Desde a ADR-099 (I7, revista), a rotina é "um turno curto rodar
  <rotina>" na conversa do dono, sem trabalho; o `pedir_a_bot` vira a triagem do outro bot, também na conversa dele.
  "Curto" é instrução, não regra: o bot faz ali o que acha rápido, e nada corta.
- **Esses turnos não ouvem a pessoa no meio.** A mensagem nova só entra no turno vivo de conversa ou retomada de
  conversa (`aceitaMensagemNaSessao`, ADR-067, revisto no #189 porque "uma esperou 71 min no diário"). Na rotina, a fala
  espera o fim.
- **A rede de 2 min não os alcança.** `promoveNaRede` só promove turno de conversa (ADR-083 §2); rotina, delegação, peer
  e o retorno do lote ficam na faixa até terminar. O item 3 da ADR-099 ("o dono fica leve") não tem trava.
- **A Ada é o caso pior, não a exceção.** Ela tem três rotinas (de hora em hora, a cada 30 min e a cada 2 h) e orquestra
  quatro colegas: cada pedido deles e cada retorno de lote é mais um turno na faixa dela. Com centenas de pessoas e
  bots com rotinas, a faixa da conversa fica ocupada a maior parte do tempo e a pessoa é quem espera.
- **A drenagem do motor também segura a pessoa.** Para se atualizar (ADR-100), o motor para de puxar tudo por até 10 min;
  em 18/10 isso acontecia a cada hora na VM, sem aviso na tela.

O que já existia e torna a separação barata: a triagem de rotina e de colega **não usa a sessão do CLI da conversa** nem a
grava (emitir-plano-turno.ts, sessao-do-turno.ts, ADR-044/047). Os dois turnos rodando juntos não disputam sessão; a
serialização era só a regra da faixa.

## Decisão

1. **A conversa do bot tem duas faixas: a da pessoa e a dos bastidores.** Um turno da conversa (sem trabalho) só espera
   outro da MESMA faixa. Cada faixa continua serial; as duas rodam em paralelo, como já rodam a conversa e a sala.
   - **Bastidores:** origem `rotina`, `delegacao` ou `peer`, ou sob procuração (`nasceNosBastidores`, domain/triagem.ts).
   - **Herança:** a retomada e a repetição herdam a faixa do turno que continuam (`retoma_turno_id` ou `contaminadoDe`).
     A retomada de uma rotina que perguntou fica nos bastidores; o retorno do lote aberto pela pessoa fica com a pessoa.
   - **Coluna** `turnos.bastidores` (0121), gravada no INSERT; a migração preenche as linhas antigas subindo a cadeia.
   - Uma regra só em SQL (`faixaOcupadaSql`) para o `reivindicar`, o varredor de órfãos, o fundo preso e o "na fila".
2. **A fala da pessoa ainda espera a própria faixa.** Com um turno dela rodando, a mensagem nova entra nele pela sessão
   viva (ADR-067) ou espera, e a rede de 2 min promove o turno longo a frente. Nada disso muda.
3. **O turno da pessoa sabe o que roda nos bastidores.** A parte volátil do prompt ganha uma linha: "Agora, nos
   bastidores desta conversa, você mesmo atende em paralelo: a rotina "…" (há 12 min); o pedido de Leonardo (agora há
   pouco). Não refaça esse trabalho aqui…". Sem bastidores, o prompt não muda (os prompts de referência ficam iguais).
4. **A drenagem do motor não segura a pessoa.** Drenando, o laço continua puxando com `soDaPessoa`: o `reivindicar` só
   entrega a faixa da pessoa na conversa, a ligação e o turno com `pessoa_esperando`. O fundo (rotina, colega, frentes,
   tasks) espera a atualização, como antes. Servidor antigo ignora o campo.

## Limites

- **Dois turnos do mesmo bot escrevem na mesma conversa ao mesmo tempo.** A fala da rotina já sai marcada "da rotina" e a
  do colega vai para a troca agrupada (ADR-114); a tela já desenha um bloco ao vivo por turno (`blocosAoVivo`).
- **Mesma pasta.** A triagem e o turno da pessoa trabalham na pasta do bot, como a conversa e a sala já faziam. O
  trabalho pesado continua indo para frentes, cada uma na sua pasta.
- **Bastidores serial.** Uma rotina longa ainda segura o próximo pedido de colega do mesmo bot. Promover a triagem longa
  a frente (a rede de 2 min para os bastidores) é o passo seguinte, medido antes.
- **O retorno do lote aberto pela pessoa** segue na faixa dela e fora da rede (NOD-293); ele ouve a pessoa no meio.
- **A pílula "Esperando <colega> · 21 d"** é outro defeito: o pedido a colega sem resposta conta para sempre (NOD-276).
  Fica para o plano dos pedidos a colega (tabela própria, com fim e prazo).

## Gatilho de reversão

- Relato de trabalho duplicado porque a pessoa pediu o que a rotina já fazia, mais de uma vez por semana com a linha dos
  bastidores no prompt: voltar a faixa única para a rotina (a delegação fica nos bastidores).
- A espera da fala da pessoa (`despachado_em − criado_em` dos turnos de conversa com mensagem de origem; a linha
  `fala_esperou` do servidor registra as acima de 10 s) com p95 acima de 30 s sem máquina fora do ar: a causa está noutro
  lugar, e esta ADR não basta.

## Alternativas rejeitadas

- **Promover a triagem para frente quando a pessoa fala** (a rede de 2 min disparada pela fala, para toda origem). Cada
  origem tem regra própria na promoção (o lote do retorno, a resposta ao colega, a janela da rotina), e a pessoa ainda
  espera a próxima renovação. A faixa separada não precisa de exceção.
- **Pôr a fala da pessoa dentro do turno da rotina.** Mistura o modo e o catálogo da rotina com o pedido da pessoa e a
  marca de conteúdo de fora (ADR-047); é o que o #189 tirou.
- **Interromper a rotina quando a pessoa fala.** Perde trabalho e custo, e a rotina recomeça do zero.
- **Voltar a rotina e o pedido de colega a trabalhos (ADR-083 S7).** Perde o dono que decide na entrada (ADR-099 1a);
  os bastidores mantêm o dono, só sem bloquear a pessoa.
