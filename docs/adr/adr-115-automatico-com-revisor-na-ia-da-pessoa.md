# ADR-115 — O Automático com revisor na IA da pessoa (e o Ignorar de verdade)

Status: proposto; parte do servidor no PR 3a do [plano dos modos de aprovação](../plano-modos-de-aprovacao.md), com a
chave `NOD_REVISOR` **desligada**. O laço (PR 3b) roda o revisor na máquina; o PR 4 liga a chave e passa esta ADR a
"aceita"; o PR 6 completa com a parte do "Ignorar todas as aprovações". · Data: 2026-10-18 · Migração 0093.

## Contexto

Produção, 30 dias até 17/10, conta Gamefik, só contagens: 110 comandos no Mac pediram aprovação e **0** foram negados;
234 cartões de aprovação, **4** negados (1,7%). A pessoa aprova quase tudo: o cartão custa espera e quase nunca muda o
desfecho. 66% das horas paradas vêm de rotinas, onde ninguém está olhando. E o Automático de hoje tem o buraco oposto:
desde a ADR-066 ele envia o e-mail que um texto de fora pediu.

A ADR-042 (seção "Revisor-modelo antes de cada ação"), a ADR-059 (alternativas descartadas) e o
`docs/grokbot-comparison.md` ("Auto Review") recusaram um revisor-modelo por três razões: (1) os vazios dele não são
enumeráveis; (2) a lista fecha a superfície; (3) ele queima a cota da pessoa para vigiá-la, ou vira autoridade remota
síncrona. O Marlon decidiu em 18/10 reverter essa recusa, com o revisor rodando na IA da própria pessoa.

## Decisão

1. **O revisor roda no CLI e na conta da pessoa**, na máquina que roda o turno, disparado pelo laço que segura aquele
   turno — nunca num modelo do Nod. O servidor continua sem cliente de modelo de texto e sem chave da Anthropic.
2. **A lista continua decidindo o que vai ao revisor** (`decidirPeloModo` com o revisor ligado, `gatilhoDeRevisao`): no
   Automático, o arriscado (`comandoArriscado`) e o envio para fora depois de conteúdo de fora (`enviaPeloTerminal`, MCP
   da pessoa; a conversa nas últimas 24 h conta). Credencial é **cartão, sem revisor**. O revisor só escolhe entre
   "libera" e "pede"; nunca nega. Erro, demora, teto, falta de revisor na máquina ou texto fora do esquema viram cartão
   (`revisor_falhou`), que é o comportamento de hoje.
3. **A decisão em revisão** (`estado_decisao = 'em_revisao'`, 0093) em três fases: nasce na transação do pedido; o
   veredito chega fora dela; é assentado numa transação nova, sob a trava do turno, e só libera com o turno
   `despachando`, sem Parar, o bot vivo e o modo atual automático. Nenhuma lista da tela vê `em_revisao`; o hook e o
   proxy esperam como esperam a pessoa (sem mudança). O varredor de expiração recolhe a revisão perdida em 2 × o prazo.
4. **O pedido chega pela renovação de 1 s do turno** (`RespostaRenovar.revisoes`, reentregue até `revisoesRecebidas`) e
   o veredito volta por `POST /api/maquina/revisao`. A caixa mora na `PonteInterna` (memória do processo; o banco é a
   verdade). O laço diz que sabe revisar pela presença de `revisa: true`.
5. **A chave da máquina sozinha não aprova.** Hoje nenhuma rota de `/api/maquina/*` aprovava nada; esta é a primeira.
   Na VM a chave é um arquivo do mesmo usuário que roda o bot, e a cerca de credencial é regex. Por isso: um **segredo
   por turno, só na memória do laço**, mandado em toda renovação desde a do `promptSubmitted` (antes de qualquer
   ferramenta do bot), e o veredito leva `prova = HMAC-SHA256(segredo, revisaoId|decisaoId)`. O servidor só amarra um
   segredo enquanto o turno ainda não tinha `prompt_submitted` no banco (revisão do PR 3a): o laço antigo que nunca manda
   um, ou o mapa vazio depois de um reinício, deixam o turno sem revisor (cartão), em vez de deixar o primeiro processo
   do bot que renovar com a chave da máquina amarrar o dele. Dois segredos diferentes para o mesmo turno envenenam: o
   turno perde o revisor e o que estava na caixa vira cartão (logado). O
   servidor amarra o resto: `revisaoId` aleatório de uso único, a máquina da chave, o turno, o prazo, o turno vivo.
6. **O prompt, as partes e o esquema são do servidor** (`pedidoDoRevisor`, `lerVeredito`): confiável (as mensagens da
   pessoa, a rotina que ela criou) separado do não confiável (o comando, os argumentos, o pedido de colega, a rotina
   criada pelo modo), este entre marcas; o "você pediu" só sai do confiável. Tudo redigido (`redigirSegredos`, com os
   padrões novos da revisão de engenharia 15, e as chaves sensíveis dos argumentos trocadas). A máquina devolve texto
   cru; o servidor faz o parse estrito e corta o motivo em 160.
7. **Tetos**: 20 revisões por turno e 300 por pessoa nas últimas 24 h (`NOD_REVISOR_TETO_DIA`); disjuntor por máquina
   (3 falhas seguidas → 10 min de cartão direto); no máximo 2 revisões em voo por máquina; prazo de 60 s.
8. **Codex: sem revisor na v1** (decisão do Marlon, 18/10): o que iria ao revisor vira cartão.
9. **Desligada, nada muda.** Com `NOD_REVISOR` diferente de `ligado`, toda decisão é a de hoje, provado por um teste de
   matriz contra uma cópia congelada da regra de hoje. Com ela ligada, o Automático passa à versão 3 da regra.

### Respostas às três razões da recusa antiga

1. *Os vazios não são enumeráveis* → a lista continua decidindo o que vai ao revisor; o que ele não olha é o mesmo que o
   Automático de hoje já roda sem olhar.
2. *A lista fecha a superfície* → fecha, mas pergunta demais: 0 de 110 comandos negados e 4 de 234 cartões.
3. *Queima a cota ou vira autoridade remota síncrona* (`adr-042:82-85`) → não é autoridade do Nod: roda na máquina e na
   IA da pessoa, o servidor só leva o pedido e amarra o veredito, e a falha vira cartão, nunca negação; a ADR-013 fica
   intacta (o hook já manda cada comando ao servidor desde a ADR-055, e a ADR-059 §3 registrou que isso não a fere); a
   ADR-021 também (a máquina puxa, o servidor nunca disca). **A objeção da cota continua verdadeira e é aceita**: a
   pessoa a aceita ao escolher o Automático, com os tetos e a contagem visível (PR 4).

Reverte de forma explícita: a recusa do revisor-modelo na ADR-042 (`adr-042:80-88`), na ADR-059 (`adr-059:99-102`) e em
`docs/grokbot-comparison.md:104-108`; o gatilho de reversão da ADR-059 "qualquer comando da lista de arriscados rodando no
automático" (`adr-059:128-130`), que deixa de ser defeito quando o revisor libera. A parte do "Ignorar todas" (a
alternativa descartada "Total sem a cerca da credencial", `adr-059:111-113`, e o gatilho "Credencial lida por bot no
total sem card", `adr-059:131`) entra no PR 6.

## Consequências

- Uma rota da máquina passa a aprovar. A fronteira volta a ser a de hoje pelo segredo do turno: quem controla a máquina
  (não o bot dentro dela) já roda o que quiser (ADR-055); o bot sozinho não fabrica um veredito. No instalador da VM,
  `kernel.yama.ptrace_scope` ≥ 1 (PR 3b).
- O revisor gasta a cota da pessoa (estimativa, não medida: 1% a 5% de um turno por revisão).
- Um deploy descarta as revisões em voo (caixa e segredo em memória): viram cartão em até 2 min. Aceito na v1.
- Reverter o código com linhas `em_revisao` no banco deixaria o servidor antigo esperando por elas: o runbook manda
  desligar a chave, esperar 3 min (o varredor recolhe as revisões em voo em 2 × o prazo mais um tique) e só então
  reverter (ou rodar o `update` do rollback da 0093).
- Texto de modelo na tela: o motivo do revisor vai escapado pela web, cortado em 160, com o rótulo "Revisor"; nunca
  decide nada.
- Com a chave ligada e sem máquina que anuncie `revisa`, o arriscado continua cartão, mas o envio pelo terminal depois de
  conteúdo de fora, que hoje roda, passa a cartão. Por isso o PR 4 só liga a chave quando a maior parte dos turnos em
  Automático vier de máquinas com `revisa`.
- Criar ou mudar rotina num turno contaminado vira cartão com a chave ligada (revisão de engenharia 9): a instrução da
  rotina é o "pedido" em que o revisor confia depois.

## Gatilho de reversão

- Duas ações liberadas pelo revisor, contestadas ("Devia ter perguntado", PR 4) e que não se desfazem, no mesmo mês →
  aquele gatilho volta a ser cartão direto, sem revisor.
- O revisor pede mais da metade das revisões em duas semanas → rever o prompt e o que vai a ele.
- Falhas acima de 10% num dia nas máquinas que anunciam `revisa` → alarme; acima de 10% por três dias → a chave desliga
  até a correção.
- As fichas do revisor passam de 10% das fichas dos turnos de uma pessoa numa semana, ou alguém reclama de cota por
  causa dele → rever o modelo, o que vai ao revisor e o teto do dia.
- Um veredito recusado por prova ou segredo inválido (logs `revisao_prova_invalida`, `revisao_segredo_recusado`) →
  alarme e investigação: alguém além do laço falou pela chave da máquina.
