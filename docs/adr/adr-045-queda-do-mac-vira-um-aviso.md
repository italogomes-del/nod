# ADR-045 — A queda do Mac vira um aviso, não um card por turno

Status: aceito · Data: 2026-09-24 · Emenda ADR-007, ADR-010, ADR-011 e ADR-017. EMENDA 16 inalterada.

## Contexto

Medido no banco diário em 24/09: 43 decisões `retomar_turno` em 7 dias, 100% de turnos de ROTINA
interrompidos por `maquina_sem_contato`, quase todas de madrugada. É o "dark wake": o Mac acorda por
instantes, o agendador (no mesmo processo) dispara, o Mac volta a dormir no meio do turno. Ao acordar,
o varredor de lease criava um card "Retomar" **e** uma mensagem por turno; 24 h depois o varredor de
expiração escrevia outra. Retomar uma rotina não faz sentido — a próxima janela já roda sozinha — e
a frase "o computador parou de responder" era lida como o computador DO BOT (ADR-037).

A mesma queda chegava por três caminhos, com três desfechos diferentes: o varredor (card + mensagem),
a entrega que chega com o lease vencido antes do varredor (mensagem de "trabalho incompleto" e, na
rotina, execução `falhou`) e a entrega tardia depois do varredor (a fala cortada entrava no chat).
Responder a um pedido de rotina gravava uma SEGUNDA linha de execução para a mesma janela.

## Decisão

**Incidente não é decisão.** A falta de infraestrutura vira UM aviso com começo e fim (tabela
`incidentes`, 0021), nunca um card por turno. Quedas a menos de 3 h uma da outra mesclam no mesmo
aviso (a medição de 24/09); fechado, ele fica 12 h em "Sua vez" ou até "Entendi". Aviso fechado E
dispensado não recebe queda nova — a próxima abre outro. No modo compartilhado o servidor nota a queda
com o Mac ainda fora: o aviso fica EM CURSO (`voltou_em` nulo, um por pessoa pelo índice
`incidente_em_curso`) até o varredor ver a máquina puxando de novo (contato mais novo que
`OFFLINE_MS`); a web relê "Sua vez" a cada tick enquanto houver aviso em curso, sem evento novo. No
modo local o varredor roda no próprio Mac, então notar já é ter voltado.

**Uma regra só** (`src/use-cases/interromper-por-maquina.ts`): rotina → execução `interrompida`
(desfecho novo, silencioso como `sem_novidade`), sem decisão e sem mensagem; conversa → a retomada
anterior da MESMA conversa fecha por `regra:retomada_substituida` (inclusive reaberta — `fecharPorRegra`
passa a aceitar `reaberta`) e nasce uma, com a frase; sempre → o aviso e a métrica `pos_restart`
(contada na borda). As três portas terminam igual: o varredor; a entrega NÃO-sucesso com o lease
vencido e sem Parar (`desfechoDaEntrega` → `maquina_sem_contato`; sucesso é trabalho terminado); e a
entrega tardia, cuja fala cortada de rotina não entra no chat (o sucesso tardio entra: o entregável da
rotina é a fala). A ordem das travas é a mesma nas portas: linhas de turno → trava por pessoa dos
incidentes → decisões (conversas) → janelas (rotinas) → o incidente. O varredor interrompe TODOS os
órfãos antes de qualquer consequência, então nunca segura a trava por pessoa esperando uma linha de
turno; decisões antes de janelas é a ordem do varredor de expiração (`vencerPendentes` → janela do
gate), que acorda junto depois de uma noite de sono.

**Uma linha por janela.** `registrarDesfechoRotina` trava a janela (`rotinaJanelas.travar`, FOR UPDATE)
e atualiza a execução dela se já existe (`daJanela` + `atualizarDesfecho`): o desfecho mais recente
substitui o anterior.

**Uma execução aberta por rotina, no agendador.** Com o turno da janela anterior pendente ou rodando,
o disparo agendado só reagenda (log `rotina_janela_pulada`). "Executar agora" e "Permitir e rodar
agora" (ADR-044) são atos da pessoa e nunca são pulados.

**O agendador espera 3 min ao acordar.** Relógio que salta mais de 3 intervalos entre dois ticks é o
processo que ficou suspenso; a espera corta o "dark wake" na origem. Definido, NÃO medido: o log
`processo_acordou {parado_ms}` existe para medir.

**Servidor reiniciado não é o Mac.** No modo compartilhado, turno cujo último sinal (lease − LEASE_MS)
é de antes de o processo subir cai como `reinicio_servidor`, sem aviso do Mac (`pos_restart` com
origem `restart_servidor`). No modo local reiniciar o servidor É fechar o nod no Mac.

**Nomes.** `maquina_sem_contato` → "seu Mac parou de responder (repouso, sem rede ou nod fechado)";
o botão do cabeçalho vira "Computador do bot"; o glossário define os dois e o "aviso".

**Limpeza (0021).** As `retomar_turno` abertas de turnos de rotina (e das retomadas deles, até 5
saltos) fecham por `regra:rotina_nao_retoma`, com o desfecho de ADR-042, entre NO FORCE/FORCE em
`decisoes` e `turnos` (regra da 0005).

## Alternativas descartadas

- **Manter o card de rotina e vencer mais cedo.** Continua um card por turno, só some antes; o
  problema é existir.
- **Registrar a queda de rotina como `falhou`.** Mistura erro da rotina com o Mac dormindo e dispara o
  texto "falhou por erro técnico" no chat — o flood que esta decisão acaba.
- **Impedir o Mac de dormir (power assertion).** Troca bateria por rotina; é decisão da pessoa, não do
  produto, e não resolve rede caída nem nod fechado.

## Validação

`tests/integration/varredor-lease.test.ts` (conversa: um Retomar e um aviso; duas quedas → um
Retomar, a anterior reaberta fechada por regra; rotina: 0 decisões, 0 mensagens, 1 `interrompida`,
idempotente; compartilhado: `reinicio_servidor` sem aviso, aviso em curso fechado na volta),
`incidentes` (mescla em 3 h, fechado+dispensado abre outro, índice único, RLS, "Sua vez", 404, limpeza
da 0021 executada do próprio arquivo), `rotina-scheduler` (21 janelas → 20; janela pulada),
`rotina-gate` (responder → uma linha), `turnos-fila` (lease vencido no `desfechoDaEntrega`); unit
`incidente`, `presenca`, `redacao`, `assentar-turno-queda`, `disparar-rotina`, web `incidentes`;
concorrência `varredor-lease-entrega` (as duas ordens de trava e cinco rodadas simultâneas: exatamente
uma `interrompida`, sem impasse); conformidade `motivos-enum` e `rls` pegam o enum e a tabela novos;
`rotas-http` ("Entendi" em aviso desconhecido ou id fora do formato → 404, nunca 500).

Verde em 2026-09-24, sobre a `main` com #44–#47: lint, typecheck (4 projetos), fence:domain; unit
108 arquivos/603 testes, integration 74/272, conformidade 8/58, concurrency 20/68 (1 pulado).

## Gatilho de reversão

- Se, em 14 dias de log, mais de 10% das rotinas disparadas nos 10 min depois de um `processo_acordou`
  terminarem `interrompida` por `maquina_sem_contato`, 3 min é pouco: subir a espera. Se nenhuma
  terminar assim e houver `processo_acordou` com `parado_ms` < 10 min em horário de uso, a espera só
  atrasa: baixar.
- Se uma rotina acumular `rotina_janela_pulada` por mais de 24 h seguidas, a guarda está escondendo
  um turno pendente preso: dar prazo ao turno de rotina pendente em vez de pular para sempre.
- Se aparecer mais de um aviso em curso por pessoa (o índice recusa: erro 23505 em log), a trava por
  pessoa foi contornada — rever quem chama `incidentes.abrir`.

## Não implementado

O aviso do computador do bot (PR3). A volta da máquina no modo compartilhado é notada pelo varredor
de lease (até 15 s depois do contato), não por evento. Sucesso tardio de rotina já derrubada entra no
chat, mas a execução continua `interrompida`. As retomadas de `retomarTurno` e `assentarAprovacao`
continuam gravando `confiavel` (ADR-044, "Não implementado").

## Emenda de 2026-09-24 — perguntas viram conversa

**Contexto.** A pergunta de `pedir_a_pessoa` chegava duas vezes na conversa: a mensagem com o molde da
E5.2 ("parei: falta X; quem destrava: Y; não vou tentar de novo", ou "parei para perguntar a …") e, logo
abaixo, um card com a MESMA frase, uma caixa de texto de rótulo técnico ("o dado que faltava", "sua
resposta em texto") e "Responder e retomar". Dois lugares para escrever na mesma tela, e a pergunta
lida como formulário. O dono escolheu nos mockups (fileira 6) "A + B com citação automática": a
pergunta é uma mensagem, a próxima mensagem da pessoa responde, e respostas prováveis viram botões.

**Decisão.**

- **A pergunta é a fala do agente.** `pedir_a_pessoa` grava o `texto` do próprio agente, com payload
  `pedido_a_pessoa {decisaoId, opcoes?}` (jsonb: sem migração). A web desenha um balão azul claro — o
  azul de status, não o âmbar das decisões — com "Parei aqui até você responder" enquanto está aberta,
  "Respondida por você · HH:MM" depois, e "Sem resposta · venceu …" com o seu Reabrir quando vence
  (ADR-007 intacto: o balão é onde a vencida continua visível). `renderDecisoesDaConversa` não desenha
  mais `pergunta`, `falta_de_dado` e `permissao`; os outros tipos seguem como card. O molde da E5.2
  ficou só em `decisoes.frase`, a frase curta da fila ("Sua vez"); na conversa, "Parei aqui até você
  responder" diz em palavras que o agente não tenta de novo.
- **O campo responde.** Com pergunta aberta, uma faixa acima do campo diz "{agente} está esperando sua
  resposta · há … · vence em …", com "Ver pergunta" (leva ao balão) e "Deixar pra lá" (o
  `POST decisoes/:id/dispensar` do #46). O campo entra em modo resposta — placeholder "Responda à
  {agente}…", borda realçada, a dica "Sua próxima mensagem responde à pergunta…" — e enviar chama
  `POST decisoes/:id/responder`, a rota que já existia e que cria a retomada, em vez do envio comum.
  "Outro assunto" (também Esc e o × da citação) manda mensagem comum e deixa a pergunta aberta; a
  escolha vale até o próximo envio e é esquecida quando a conversa fica sem pergunta. Com duas ou mais
  abertas, o campo cita a mais antiga ("Respondendo à {agente} · “…” · 1 de 2") e passa à próxima ao
  enviar; "Responder a esta", no balão, troca a citada.
- **Anexo não vai na resposta.** A rota `responder` só leva texto. Em modo resposta o clipe fica
  desligado com o motivo na dica; colar ou soltar arquivo e enviar com arquivo já na fila recusam por
  escrito ("Na resposta à pergunta vão só palavras…") — o arquivo nunca some em silêncio.
- **Respostas prontas.** `opcoes` opcional em `pedir_a_pessoa`: até 4, até 60 caracteres cada
  (`src/contracts/pedido.ts`, fora de `ferramentas-nod.ts` pelo gatilho de 200 linhas da EMENDA 26).
  A normalização tira vazias, repetidas e longas — a longa SAI em vez de ser cortada, porque o toque
  manda o texto da opção como resposta e uma frase cortada seria uma resposta que ninguém escreveu. O
  toque usa a mesma rota `responder`; embaixo dos botões, "ou responda com suas palavras aí embaixo".
- **A resposta cita a pergunta.** A mensagem que `retomarComResposta` grava leva
  `resposta_a_pedido {decisaoId, agenteId, perguntaEm, retomada}`: a web rotula "respondendo à pergunta
  das HH:MM" e, com `retomada`, escreve "{agente} retomou com a sua resposta" sem gravar outra linha.
- **Sinais.** Na barra lateral, o agente que perguntou diz "esperando sua resposta" e ganha um selo azul
  de balão com a contagem, separado do ⚑ âmbar, que deixa de contar pergunta. A faixa do topo conta
  "pedidos" (decisões e perguntas). Em "Sua vez" a pergunta mostra a frase e "Responder na conversa",
  que abre a conversa com o campo já respondendo a ela; nenhuma caixa de texto na lista. Exceção: a
  decisora designada que não é dona da conversa (`quem_destrava`, EMENDA 1) não lê a conversa de outra
  pessoa (RLS de `conversas` e `mensagens`), então para ela a resposta em texto continua na lista.
- **Modelo.** A descrição de `pedir_a_pessoa` pede fala natural dirigida à pessoa, `opcoes` quando as
  respostas forem previsíveis e que o turno encerre sem repetir a pergunta em texto; a linha do
  inventário de rotinas manda as candidatas em `opcoes`.

**EMENDA 16 continua valendo.** A resposta é texto da pessoa, sempre por `responder`; `decidir` continua
recusando os três tipos (409). A opção pronta é uma sugestão de texto que a pessoa escolhe — o servidor
recebe as palavras, nunca um id de botão. Deixar pra lá continua não sendo responder: fecha sem texto e
sem retomada.

**Alternativas descartadas.** Manter o card e só esconder a frase repetida: continuariam duas caixas de
texto na tela. Responder por botão de decidir: quebra a EMENDA 16 e não serve a pergunta de julgamento.
Adivinhar na interface se a mensagem é resposta ou outro assunto: a escolha fica explícita no campo, e
quem distingue pedido de explicação de resposta é o agente (próximo PR).

**Validação.** web `perguntas-conversa` (balão sem card nem caixa de texto, a frase uma vez, faixa, modo
resposta, "1 de 2" e a troca da citada, opções como botões, "Outro assunto", depois de responder,
vencida com Reabrir, "Sua vez" com "Responder na conversa", enviar chama `responder` e não o envio
comum, anexo recusado), `decisoes-chat`, `navegacao-sem-rail` ("pedidos"; selo azul separado do ⚑);
unit `pedir-a-pessoa` (opções, payload, a rota `responder` grava a resposta ligada e cria a retomada),
`chamar-ferramenta`, `anti-tutorial`, `prompt-sistema`; integração `perguntas-conversa` (o jsonb das
duas mensagens no Postgres e a retomada); concorrência `e2e-catcher`.

Verde em 2026-09-24, sobre a `main` com #51–#54: lint, typecheck (4 projetos), fence:domain; unit
119 arquivos/701 testes, integration 77/283, conformidade 8/59, concurrency 22/70 (1 pulado).

**Gatilho de reversão.**

- Pessoas respondendo à pergunta errada: com duas ou mais abertas, se em 14 dias aparecerem 3 relatos
  (ADR-041) ou respostas corrigidas logo depois ("era sobre o PR 9"), a citação automática da mais
  antiga não basta — o campo passa a pedir a escolha explícita quando houver mais de uma.
- Confusão entre resposta e mensagem comum: se em 14 dias aparecerem 3 casos de "Outro assunto" que era
  resposta (a mesma pessoa manda de novo, em seguida, pelo modo resposta) ou de resposta que era outro
  assunto (a retomada recebe texto sem relação com a pergunta), o padrão deixa de ser responder e o
  campo passa a perguntar a cada envio enquanto houver pergunta aberta.

**Não implementado.** O fio da pergunta (próximo PR, migração 0024): hoje cada resposta fecha a decisão
mesmo quando é um pedido de explicação, e a pergunta seguinte abre outro pedido do zero — `fio_id`, a
rodada na faixa, o histórico do fio na entrada da retomada e o recolher "Pergunta resolvida · N
mensagens" ficam para lá. Também ficam de fora a linha "Você deixou uma pergunta pra lá" ao dispensar
e o anexo na resposta (a rota `responder` segue só com texto). Perguntas gravadas antes desta emenda não
têm balão ligado: continuam como texto comum, e a faixa e o campo funcionam por "Sua vez" (sem "Ver
pergunta").
