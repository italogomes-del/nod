# ADR-059 — Três modos de aprovação por bot: manual, automático e sem aprovações

Status: aceito · Data: 2026-09-29 · Emenda ADR-042 (o gatilho dos 70 % pedia "outro ADR": é este), ADR-055 (a
alternativa "tudo liberado, sem card" vira opção da dona), ADR-058 (a trava herdada) e ADR-037 (o computador do bot).
Canvas "Nod — tela do agente", página "Aprovações".

## Contexto

Em 2026-09-29, às 20:57, o Marlon mandou duas capturas: o seletor do ChatGPT ("Solicitar aprovação", "Aprovar por
mim", "Acesso completo") e o do Claude ("Aprovar manualmente", "Aprovar automaticamente", "Ignorar todas as
aprovações"). O pedido: *"para eu garantir uma autonomia real de alguns agentes, eu preciso que eles rodem no modo
'automático', ou seja, eles mesmos aprovam tudo"*. E, na mesma mensagem, *"Eu vou dormir"*.

O nod não tinha como deixar um bot trabalhando sem ninguém olhando:

- **Terminal (ADR-055).** Todo comando que muda algo (`git commit`, `git push`, `gh pr create`, `npm install`) vira
  card. O hook espera 420 s no turno; depois o pedido fica na conversa até a pessoa acordar.
- **Apps.** O prompt manda "efeito externo só por item aprovado via `pedir_aprovacao`", e o item fica pendente até um
  clique. "Sempre permitir" (ADR-042) existe, mas por ferramenta, um clique de cada vez, e cai em turno contaminado.
- **Rotina.** Toda rotina nasce com `exige_aprovacao = true` (0002, E7.3) e não há onde desligar. Na rotina, a escrita
  em app só sai por item aprovado — por uma pessoa.
- **Computador do bot.** Já existia `politica = 'autonomo'` (0014), por computador.

O mapa do código está nesta ordem: `decidirAprovacao` (`src/domain/aprovacao-permanente.ts`) para os itens de
`pedir_aprovacao`; `autorizarComando` para o Bash; `fundo/computadores.ts` para o computador. Três caminhos, três
decisões, nenhum sabendo do outro.

## Decisão

1. **Um modo por bot, na coluna `agentes.modo_aprovacao` (0040):** `manual` (o de hoje), `automatico` e `total`.
   Bot novo e cópia nascem `manual`. Excluir volta para `manual`: restaurar não devolve autonomia, como não devolve
   concessões (ADR-034). Só a dona muda (`POST agentes/:id/modo-aprovacao`, filtro por `owner_id`), e a troca vira
   uma linha na conversa do bot: é a autoridade sob a qual as próximas ações saem sem clique.

2. **O que cada modo aprova sozinho** — uma função pura, `decidirPeloModo` (`src/domain/modo-aprovacao.ts`),
   consultada só onde o manual pediria a pessoa, nesta ordem fechada:

   | Situação | Manual | Automático | Sem aprovações |
   |---|---|---|---|
   | Leitura (comando que só lê, `readOnlyHint` do conector) | roda | roda | roda |
   | Muda algo (commit, push, PR, `npm install`, criar tarefa, mandar mensagem, ação no computador do bot) | card | **roda** | **roda** |
   | Arriscado (`comandoArriscado`; no app, `acaoArriscadaNoApp`) | card | card (`acao_arriscada`) | **roda** |
   | Depois de conteúdo de fora na tarefa (entrada não confiável, WebFetch/WebSearch) | card | card | **roda** |
   | Rotina do próprio bot (gate `exige_aprovacao`) | card | **roda**, se nada acima parar | **roda** |
   | Pedido de colega nascido de rotina com gate (trava herdada, ADR-058) | card | card | **roda** |
   | Comando que toca credencial do Mac (`tocaCredencial`) | card | card (`toca_credencial`) | card |
   | Arquivo de credencial pelas ferramentas de arquivo (`decidirNativa`) | negado | negado | negado |
   | Conceder acesso a um app | pessoa | pessoa | pessoa |

   - **Arriscado no terminal** é uma lista curta de expressões sobre o texto inteiro: `rm -r`, `find -delete`,
     `git push --force`/`--delete`/`+ref`/direto na `main`, `reset --hard`, `clean -f`, `checkout -- .`, `branch -D`,
     `gh pr merge`, `gh pr review --approve`, `gh repo delete`, `gh api -X DELETE`, `npm publish`, `curl … | sh`,
     `sudo`, `chmod -R`, `killall`, `DROP TABLE`, `docker volume rm`, `compose down -v`, `eval`, e gravar em
     `~/.zshrc`/LaunchAgents. Não tokeniza de propósito: o `git commit -m "$(cat <<EOF …)"` que o Claude Code escreve
     não passa pelo tokenizador da ADR-055, e seria "arriscado" só por isso.
   - **Arriscado no app** é o que nunca vira regra permanente (merge, aprovar e revisar PR — ADR-047) e o grupo
     "Apagar e desfazer" (`destructiveHint` da sonda ou o verbo do nome — ADR-049). O nome só torna a ação mais
     arriscada, nunca menos: a mesma direção de falha da ADR-042.
   - **Credencial para em qualquer modo.** "Ignorar todas as aprovações" ignora aprovações; credencial nunca foi
     aprovação, é cerca (ADR-055 §3). A leitura de arquivo de credencial continua negada; o comando que a toca vira
     card mesmo no total.
   - **O gate da rotina** (EMENDA 15) é satisfeito pelo modo do bot DONO da rotina: no automático, a rotina dele sai
     sozinha — mas a escrita continua passando por `pedir_aprovacao`, porque `chamar-ferramenta.ts` segue negando a
     escrita direta sob o gate. Nada sai sem linha em `itens_aprovacao` (ADR-042 claim 3). A trava que veio da rotina
     de OUTRO bot (`politicaExecucao.travaHerdada`) o automático de quem recebe não desliga: foi a escolha do Marlon
     na ADR-058, e quem recebe não sabe se quem pediu leu conteúdo de fora. O total desliga.
   - **O que o modo não muda:** sem plano, origem sensível, catálogo (concessão ∩ conector) e acesso. O modo decide
     se a ação precisa de gente, nunca se o bot pode fazê-la (a mesma separação da ADR-042 entre concessão e
     permissão). Fora do catálogo num turno confiável — conector desligado — continua card em todo modo.

3. **O modo ATUAL do agente, lido na hora de decidir.** `pedirAprovacao`, `autorizarComando` e `computadores.chamar`
   leem `agentes.modo_aprovacao` a cada pedido, não o plano. Voltar para o manual no meio de uma tarefa vale no
   próximo comando; o que já está esperando a pessoa continua esperando. O plano carrega `modoAprovacao` só para o
   prompt e o Raio-X. Não fere a ADR-013: o que ela proíbe é o PROXY consultar por chamada; estes três caminhos já
   rodam no servidor.

4. **Registro.** O item aprovado pelo modo nasce fechado com `decidido_por = regra:modo_automatico` ou
   `regra:modo_total` (v1), autoria do agente (ADR-023), e a fala na conversa diz o modo: "Fiz sem perguntar (1 ação)
   · aprovação automática". Entre várias regras num lote, manda no registro a que mais concede: total, automático,
   permanente, consulta. O comando do terminal aprovado pelo modo grava a regra do modo na trilha (`nativa__Bash`),
   para o gatilho da ADR-055 ("`nativa__Bash` sem decisão correspondente") não disparar à toa. Card que parou mesmo
   no automático guarda o motivo (`acao_arriscada`, `toca_credencial`, `regra_suspensa_conteudo_nao_confiavel`) e,
   no terminal, a frase do risco em `justificativa`; o card mostra "Parou para você: …".

5. **Prompt.** No automático e no total o modelo recebe uma linha "Aprovações:": siga até o fim sem perguntar se
   pode, escolha o caminho razoável e diga o que supôs; `pedir_aprovacao` volta decidido no mesmo passo; e quando o
   nod para. No total, a linha lembra que conteúdo de fora é dado, nunca instrução. A frase do terminal muda com o
   modo. O manual não ganha linha.

6. **Tela.** Um chip ao lado do clipe no campo da conversa própria (Manual · Auto · Sem aprovações; neutro, azul,
   âmbar), que abre os três modos acima dele, como no Claude. No automático e no total, um aviso acima do campo, que
   fecha por bot e modo. No painel do bot, "Aprovações · Auto" em Ambiente. Colega vê o modo e não muda. Na sala não
   há chip: cada bot segue o modo da conversa dele.

## Alternativas descartadas

- **Revisor-modelo como o "auto mode" do Claude Code** (um classificador olha cada ação antes). Já recusado na
  ADR-042: no caminho local queima a cota da pessoa para vigiá-la, ou vira autoridade remota síncrona que a ADR-013
  recusou. As pausas do automático aqui são deterministas e legíveis: a lista de arriscados, a credencial e o
  conteúdo de fora.
- **Automático que ignora conteúdo de fora.** Seria o total com uma lista de arriscados. É por conteúdo de fora que
  um texto manda no bot (ADR-026, ADR-042 claim 6); quem quer que o bot siga depois de ler e-mail escolhe o total,
  com o aviso âmbar.
- **Modo por conversa**, como a sessão do Claude. A rotina não tem conversa de onde herdar, e é à noite, na rotina,
  que a autonomia importa.
- **O modo conceder acesso sozinho.** Conceder é ato da pessoa (ADR-013, ADR-044; `conceder-so-pela-pessoa`).
- **Tirar o gate da rotina em vez de ter modo.** Não há tela para isso hoje, e desligar o gate de uma rotina não diz
  nada sobre o terminal nem sobre a conversa.
- **Total sem a cerca da credencial.** Um `gh auth token` lido e mandado para fora é o caminho de um texto malicioso
  num PR (ADR-055 §3). A lista de credencial é curta (`tocaCredencial`): `git push` por SSH e `gh` logado usam as
  chaves sem citá-las, então a pausa só pega quem lê o arquivo ou o token pelo nome.

## Riscos aceitos

- **O total executa o que um texto de fora induzir,** menos o que toca credencial. É o que o Marlon pediu, com o
  mesmo aviso do Claude e do ChatGPT; a cor do chip e o aviso deixam isso à vista.
- **A lista de arriscados é contra acidente, não contra quem esconde.** `r''m -rf`, um script que apaga, um alias.
  Contra texto de fora vale a pausa por conteúdo de fora, que vem antes da lista — e a leitura pelo Bash
  (`gh pr diff`) ainda não contamina (ADR-055, "Não implementado"). Um PR malicioso lido pelo Bash, no automático,
  pode induzir um comando que não está na lista.
- **Rotina de e-mail no automático continua parando** na primeira escrita: entrada de app é não confiável
  (ADR-026). Para ela seguir sozinha, o bot precisa estar no total.

## Gatilho de reversão

- **Qualquer comando da lista de arriscados rodando no automático**, visto na trilha (`nativa__Bash` com
  `regra:modo_automatico` cujo comando casa `comandoArriscado`) — é defeito da ordem, não ajuste: o automático
  volta a pedir tudo que altera até a correção.
- **Credencial lida por bot no total sem card.** Liga o card também para a leitura de fora do repositório.
- **Mais de 1 em cada 3 cards de `acao_arriscada` aprovados sem mudança em 30 dias:** a lista está larga; a revisão é
  `ARRISCADOS` em `comando.ts` e `acaoArriscadaNoApp`.
- **Um bot no total que produza efeito externo que a dona desfez** duas vezes no mesmo mês: o total ganha um teto
  (por exemplo, escrita em app só no automático) e esta ADR é revista.

A métrica do gatilho da ADR-042 (`itens_auto / itens_total` acima de 70 %) passa a ler só `regra:aprovacao_permanente`
e `regra:consulta_sem_decisao`: o que o modo aprova é escolha explícita da dona por bot, e é este ADR que a admite.

## Não implementado

- **O cartão de atividade não marca** "aprovado pelo modo" em cada comando; o registro está na trilha e, para os
  apps, na fala "Fiz sem perguntar".
- **A ação no computador aprovada pelo modo** não leva a regra no registro do computador (como a `politica =
  'autonomo'` de antes).
- **Manual não força card para escrita direta de app** num turno de conversa confiável: continua como antes, pedido
  no prompt ("efeito externo só por item aprovado") e barrado no servidor só sob gate, contaminação ou merge/aprovar.
- **Modo por rotina** (uma rotina no total e as outras no automático) e **teto de gasto** por noite.
