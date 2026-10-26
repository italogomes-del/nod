# ADR-115 — O Automático com revisor na IA da pessoa (e o Ignorar de verdade)

Status: proposto; parte do servidor no PR 3a do [plano dos modos de aprovação](../plano-modos-de-aprovacao.md), com a
chave `NOD_REVISOR` **desligada**. O laço (PR 3b) roda o revisor na máquina; o PR 4 liga a chave e passa esta ADR a
"aceita"; o PR 5 leva o revisor aos apps (seção abaixo); o PR 6 completa com a parte do "Ignorar todas as aprovações"
(seção "O Ignorar todas de verdade", 2026-10-19, sem migração). · Data: 2026-10-18 · Migrações 0093 e 0094 (PR 5).

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
automático" (`adr-059:128-130`), que deixa de ser defeito quando o revisor libera. Pela parte do "Ignorar todas"
(PR 6, abaixo): a alternativa descartada "Total sem a cerca da credencial" (`adr-059:111-113`) vira a decisão, e o
gatilho "Credencial lida por bot no total sem card" (`adr-059:131`) vira o comportamento pedido.

## PR 5 (2026-10-19): o revisor nos apps

Emenda a ADR-066 e o item 4 da emenda de 2026-09-30 da ADR-059 (as duas registram o mesmo). Atrás da mesma chave.

1. **O caminho dos apps ganha o revisor** (`decidirAprovacao` e `decidirLote` com `revisor`, só com a chave ligada, o
   modo atual automático e quem chama sabendo esperar: a chamada direta e o `pedir_aprovacao` da ferramenta). Vão a ele
   o **apagar ou arquivar num app em qualquer origem** — o alívio da conversa (`conversaComAPessoa`) sai, porque o A4 é
   exatamente o apagar pedido na conversa (decisão 4 do Marlon) — e o **envio para fora** (`envioParaForaNoApp`: toda
   escrita que não é ler nem apagar) **depois de conteúdo de fora** (o turno, a entrada ou a conversa nas últimas 24 h):
   é o que conserta o "o Auto obedece um e-mail" (o A3). Sem a chave, a decisão de hoje, provada por uma matriz contra a
   cópia congelada da regra de antes (`tests/unit/domain/revisor-nos-apps.test.ts`).
2. **"Sempre permitir" vem antes do modo num turno limpo** (a ordem de `decidirAprovacao` não muda): a regra da pessoa
   pula o revisor ali e não num turno contaminado. No **envio para fora** a regra também cai quando só a conversa leu
   conteúdo de fora nas últimas 24 h (revisão do PR 5, 2026-10-19): a marca do turno não vê o e-mail que a sessão
   retomada carrega, e uma regra antiga no envio (de um cartão do manual) pularia o revisor no A3. Por isso o cartão do revisor só oferece "Sempre permitir" onde ele
   serve — **no apagar de app num turno limpo** (`sempreServe`, decisão 8 do Marlon), gravado no item (0094,
   `itens_aprovacao.sempre_serve`); falso no envio, no turno contaminado e no cartão de falha. A tela e
   `podeVirarRegra` leem a marca, não recalculam.
3. **A chamada direta não volta mais "peça aprovação"** quando vai ao revisor: vira uma decisão de um item em revisão e
   o proxy espera o `{ aguardar }` de sempre. O lote do `pedir_aprovacao` vai inteiro numa revisão só, com todos os
   itens e o resumo que o bot escreveu (não confiável); lote misto continua perguntando tudo (ADR-042): o item que já pede
   a pessoa leva o lote ao cartão sem chamar o revisor. A mesma ação de app (conector, ferramenta e argumentos) que já
   levou "pede", foi negada ou venceu na cadeia vai direto ao cartão.
4. **Quatro passos**, como o lote automático do NOD-263: a fase 1 pede (na transação da chamada; o pedido entra na caixa
   depois do commit); a fase 3 FECHA a decisão por `regra:revisor` sob a trava do turno; o efeito roda FORA de transação
   (`executarLiberacao`, sob o contexto de log da dona); o desfecho é ASSENTADO numa transação nova
   (`assentarLoteAutomatico`, idempotente, com nova tentativa se o banco estiver ocupado). A fala "Fiz sem perguntar ·
   o revisor liberou" vai para a Atividade. O item que roda no gh do Mac (ADR-048) fica sem desfecho e o Mac o puxa.
5. **Codex sem revisor** e o MCP da pessoa no Codex: cartão (`FRASE_SEM_REVISOR_NO_CODEX`), como no terminal.

**Risco aceito.** Se o servidor reiniciar entre a fase 3 (fechou por `regra:revisor`) e o assentamento, o item fica
liberado e sem desfecho — a mesma janela que o lote automático já tem desde o NOD-263. Nunca reenviado (ADR-009). O
seguimento é um desfecho "incerto" gravado pelo varredor, fora deste plano. O erro depois do aceite (banco ocupado
esgotado, falha de infraestrutura) fica no log (`desfecho_nao_gravado`, `revisao_execucao_falhou`) com o item sem
desfecho, pela mesma razão.

**Gatilho de reversão (PR 5).** Uma exclusão num app liberada pelo revisor e contestada que não se desfaz → o apagar do
app volta a ser cartão direto no Automático (sem revisor), como o primeiro gatilho acima.

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
- (PR 6) Uma credencial lida no total e mandada para fora sem a pessoa ter pedido, vista na Atividade → a credencial
  volta a ser cerca no total.

## O Ignorar todas de verdade (PR 6, 2026-10-19)

**Contexto.** Decisões do Marlon de 18/10: no "Ignorar todas as aprovações" nada pede aprovação, nem a credencial do Mac
(e os 28 bots que já estão no total passam à regra nova no deploy, com uma linha na conversa de cada um); no Automático a
credencial é sempre cartão; subir um arquivo de credencial a um app continua recusado. Até aqui o comando que toca
credencial virava cartão em todo modo, e o arquivo de credencial era negado no próprio hook, que não sabe o modo
(`nativas.ts`). Produção, 30 dias até 17/10: 44 paradas por credencial.

**Decisão.**
1. **`decidirPeloModo`: o total aprova também a credencial**, com ou sem a chave do revisor; `regra:modo_total` na
   versão 2. Só a chave do próprio nod (`tocaChaveDoNod`) continua cartão no total.
2. **O hook manda a credencial ao servidor.** `decidirNativa` deixa de negar a leitura e a gravação de arquivo de
   credencial e o MCP da pessoa que cita uma: devolve `permitir` com `credencial`, e o hook confirma no servidor.
   `autorizarComando`: manual nega com a frase de sempre (o manual não muda); automático vira cartão, sem revisor (a
   leitura espera como a gravação já esperava); total roda e registra.
3. **Confirmação explícita** (revisão de engenharia do plano, item 12). O hook novo só deixa a credencial passar com
   `{ ok: true, credencial: "permitida" }`, na primeira consulta ou na segunda, depois do cartão aprovado. Servidor
   antigo (revertido) responde `{ ok: true }` cru ao Read: o hook nega com a frase de sempre. Hook antigo (app ou motor
   ainda não atualizados, ADR-100) continua negando sozinho: o lado seguro. A rota só aceita o campo nas nativas em que
   o hook o manda.
4. **Registro.** Toda ação que o total roda e que o manual pediria vai para `acoes_pelo_modo` (`modo = 'total'`,
   veredito nulo, sem decisão), com o gatilho: `credencial`, `arriscado` (com a frase de `comandoArriscado`),
   `fora_da_pasta`, `comum`. Texto redigido (`resumoDeTexto`), nunca na trilha.
5. **Onde a pessoa vê.** A Atividade do bot ganha a quarta fonte e o filtro "Sem aprovação" (o que o total rodou, o que
   o revisor liberou, e os apps e acessos aprovados pelo modo). A fala do turno ganha a linha discreta do protótipo (Y1,
   Y2), só para a credencial e o arriscado: "Usou o token do GitHub do seu Mac · ver na Atividade" (`qualCredencial`;
   "desta máquina" na VM). "ver na Atividade" abre o dia da ação no filtro novo. O menu e a confirmação falam das
   credenciais.
6. **Cercas fixas que continuam no total**: git fora da pasta do bot (hook), o laço com `sleep` (rota, antes do modo),
   os três passes, login/2FA/CAPTCHA/senha no computador do bot, fora do catálogo e sem plano, mudar o modo só pela dona
   (e `gerir_bots` → total é cartão), mandar arquivo de credencial a um app (`arquivo-do-mac.ts`), a chave do próprio
   nod, e o `esperar_comando` com credencial (roda fora do CLI e não passa pelo hook).
7. **Os bots que já estão no total** ganham uma linha na conversa (`aprovacao.total_credenciais`, no chat), uma vez, por
   `scripts/aviso-total-credenciais.ts`, que roda no `deploy.sh` depois de o servidor novo ficar saudável. O bot posto no
   total depois do deploy não a ganha: a troca de modo já disse a regra nova.

**Consequências.** O app do Mac precisa de release para ler e gravar arquivo de credencial no total (o hook roda no app);
o motor da VM se atualiza com o deploy. Até lá, no Mac, o comando com credencial já roda no total (quem decide o comando
é o servidor) e o arquivo de credencial segue negado. Reverter o PR 6 é voltar a linha da credencial no total em
`decidirPeloModo`: com o servidor revertido, o hook novo nega (item 3).

**Riscos aceitos.** Um texto de fora pode levar o bot no total a usar uma credencial — é o pedido, com a confirmação no
menu, a pílula âmbar, a linha na fala, a Atividade e a instrução no prompt de nunca mandar uma credencial para fora.

**Gatilho de reversão** (o último da lista "Gatilho de reversão"): uma credencial lida no total e mandada para fora sem a pessoa ter
pedido, vista na Atividade → a credencial volta a ser cerca no total.
