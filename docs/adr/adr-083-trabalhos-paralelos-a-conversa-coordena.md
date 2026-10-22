# ADR-083 — Trabalhos em paralelo: a conversa coordena, cada trabalho longo roda à parte

Status: aceito · Data: 2026-10-07 · Emenda a [ADR-010](adr-010-fila-por-conversa-no-postgres-prazo-absoluto.md) (emenda 13,
"agente serial") e a [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (mensagem no meio do turno).
Decisões do Marlon em 2026-10-07 (épico #188, protótipo na página "Chat limpo" do canvas do Nod).

## Contexto

Medido no diário, 7 dias até 07/10: só 10% das 5.982 mensagens são a pessoa falando com o bot. Turnos de conversa
duram 0,7 min no p50 e 5 min no p90; pedido de colega dura 73 min no p90 (66 acima de 1 h, até 7 h) e rotina chega a
16 h. Pela regra de um turno por bot, esse trabalho segura a conversa: 38 mensagens da pessoa foram absorvidas no meio
de um turno, 16 esperaram mais de 5 min, uma esperou 71 min dentro de uma rotina. A resposta à mensagem do meio vira
passo do card, e uma resposta curta antes de outra ferramenta era descartada como narração.

O mercado resolve igual: Claude Code `--bg`/agent view (cada pedido numa sessão nova na sua worktree), Projects e
Cowork Dispatch (uma conversa coordenadora abre uma thread por trabalho), Codex (chats paralelos com worktree), Jules
(tasks paralelas com teto visível).

## Decisão

1. **Trabalho** (`trabalhos`, `turnos.trabalho_id`, `src/contracts/trabalho.ts`) é uma unidade de trabalho longo de
   um bot, com sessão do CLI própria (`trabalhos.sessao_cli`), pasta própria (`~/nod/<bot>/<slug>`, convenção da
   ADR-065) e uma linha no chat. Na tela é "task". O nome no código não é `tarefa` porque `tarefaId` já é o id do
   turno delegado, `iniciar_tarefa` é da ligação e `turno.tarefas` é a lista do TaskCreate.
2. **Origens:** `pessoa` (a conversa abriu com `abrir_task`), `rotina` (um por execução), `colega` (`pedir_a_bot`,
   com os acessos de quem recebe, ADR-058; vale também para o legado `peer`) e `rede` (turno de conversa que passou de
   2 min trabalhando, só com harness que `bifurcaSessao`).
3. **Faixas no `reivindicar`:** a faixa de um turno é `coalesce(trabalho_id, conversa_id)`. Turno de conversa espera
   só outro turno de conversa da mesma conversa; turno de trabalho espera só outro turno do mesmo trabalho e o trabalho
   de `depois_de_trabalho_id`. O mesmo bot pode responder na conversa direta e numa sala ao mesmo tempo (conversas
   diferentes). O ramo da ligação não muda. Ordem: ligação primeiro, depois o que não é rotina nem colega.
4. **Sem teto.** (Emendado em 2026-10-08 pela [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md): a pessoa escolhe o
   uso do Mac, o processador também é medido, e o Mac apertado segura trabalho novo em segundo plano.) O limite é a máquina: o Mac lê a pressão de memória do macOS
   (`kern.memorystatus_vm_pressure_level`: 1 verde, 2 amarela, 4 vermelha) uma vez por máquina a cada 30 s e manda na
   renovação. Amarela: aviso e o processo de trabalho parado esperando a pessoa fecha em 5 min (verde: 1 h) e volta
   com `--resume`. Vermelha: aviso em tom de alerta. Nunca para trabalho rodando.
5. **Capacidades, nunca o nome do harness.** `CAPACIDADES_HARNESS` (`src/contracts/harness.ts`) declara
   `mensagemNoMeio`, `retomaSessao`, `bifurcaSessao`, `processoProprio` e `terminal`; o servidor lê por
   `capacidadesDe(harness)`. Harness desconhecido não tem nenhuma, e todo caminho tem a versão "sem a capacidade".
   Se a entrada está aberta agora continua sendo o `aceitaMensagens()` do adapter.
6. **Mensagem no meio (emenda da ADR-067):** só entra em turno de conversa (nunca em rotina, colega ou trabalho);
   chega com moldura ("responda a ela primeiro"); a primeira fala depois dela é sempre gravada; o CLI que morre entre
   absorver e escrever devolve a mensagem para `pendente`. O Codex do chat roda no app-server quando a sonda o acha
   (`turn/steer`), com `codex exec` como reserva.
7. **A conversa coordena.** O prompt da conversa recebe "Trabalhos em andamento"; ferramentas `abrir_task` e
   `mandar_para_task`; a rotina pode abrir trabalhos (as filhas, com `trabalho_mae_id`, não abrem). Pergunta e
   resultado do trabalho chegam na conversa como balão com a etiqueta "da task …"; as falas do meio ficam no trabalho.
8. **Rotas** (`/api/t/<tenant>/…`): `GET trabalhos?agenteId=` (`TrabalhosDto`), `GET trabalhos/:id`
   (`TrabalhoDetalheDto`), `POST trabalhos/:id/mensagens {texto}`, `POST trabalhos/:id/parar`,
   `POST trabalhos/:id/depois {depoisDe}`, `POST trabalhos/:id/fazer-aqui`, `POST telemetria/linhas {eventos}`,
   `GET telemetria/linhas` (`TaxaDeAbertura[]`), e `faixaTrabalhosRecolhida` em `PUT preferencias`. Frames
   `trabalho.mudou` e `memoria.mudou`. A mensagem lida ganha `origemTurno`, `trabalhoId` e `fimDoTurno`.
   Revisto em 2026-10-09 (pedido do Marlon): a faixa de Trabalhos nasce sempre recolhida na pílula e só fica aberta
   enquanto a pessoa está na conversa (`faixaTrabalhosAberta` no estado da web); a web não lê nem grava mais
   `faixaTrabalhosRecolhida`, que fica no contrato e no banco sem uso até uma migração a retirar.
9. **Computador do bot (ADR-037):** continua um por bot. O segundo trabalho recebe "computador em uso por: <título>"
   e espera, em vez do 409 que o proxy tratava como conector fora do ar.

## Alternativas rejeitadas

- **Mesma sessão com subagente em segundo plano.** Só o Claude tem, o Nod não vê o subagente e a pasta é a mesma.
- **Duas faixas fixas por bot (conversa + uma).** Não resolve rotina e colega ao mesmo tempo; o padrão de mercado é
  uma sessão por trabalho.
- **Teto de trabalhos por bot ou por pessoa.** A máquina varia (8 a 36 GB); um teto de 8 travaria o pico de 25 turnos
  que o diário já tem. O aviso pela pressão do macOS se adapta sozinho.
- **Interruptor `NOD_TASKS`.** Só o Marlon usa o Nod por enquanto; voltar atrás é reverter o PR (a migração 0063 é
  aditiva).

## Limites

- Duas tasks podem mexer no mesmo card do ClickUp: fora do git não há isolamento. Aceito; reabrir se houver relato.
- Codex: sem `thread/resume` e sem fork medidos, recebe o histórico recente e não entra na rede de 2 min.
- O executor do servidor não existe (100% dos turnos rodam no Mac, #199); as faixas valem para a fila, que já roda no
  servidor.
- Outras checagens pelo nome do harness (anexos, comandos, pasta na gaveta, padrão do automático) ficam para a #201.

## Gatilho de reversão

- Um tipo de linha (rotina, bots, task) aberto em mais de 30% das vezes em 2 semanas (taxa no Modo dev) volta a ser
  balão. A decisão é manual.
- Pressão vermelha em mais de 1 dia por semana em algum Mac: reabrir a discussão de um teto.

## Emenda (2026-10-18, ADR-114, chat limpo, PR 2)

- **Item 1:** "uma linha no chat" por trabalho vira um item na Atividade do bot (começou e terminou, um item cada). Na
  conversa própria a linha "Abriu a task" (e "Virou a frente", "Começou N frentes", "N frentes terminaram", o recado e
  "… terminou · 39 min") não é mais desenhada; a mensagem continua na janela como `anexo`, dando o título e a origem. Os
  botões "Fazer aqui" e "Fazer depois da …" vão para o topo da tela da task e para a linha dela em Trabalhos. A linha do
  dono continua dizendo as frentes que rodam.
- **Item 7:** a etiqueta "da task …" no balão da pergunta e do resultado fica.
- **Janela:** a fala do meio de um turno de trabalho não conta mais no limite de 200 da conversa própria (vem como `anexo`
  desde o corte); uma task falante não empurra as falas da conversa para fora.
- **Gatilho:** o "tipo de linha aberto em mais de 30%" ganha o tipo `atividade` (a Atividade aberta até 60 s depois de
  abrir a conversa). O PR 3 do plano acrescenta "troca" (a conversa com outros bots numa linha, emenda da ADR-099 item 8).

## Emenda (2026-10-22, NOD-311): o Parar do chat para só o turno do chat

Decisão do Marlon (19/10, revisão da NOD-225): o Parar da barra do chat principal não derruba mais as frentes.

- **O que para:** os turnos da faixa do chat (`trabalho_id` nulo) da conversa, os pedidos a colegas que esses turnos
  abriram (avisados na hora a quem pediu, uma vez, com `peer_ask.paradoPelaPessoa`) e as esperas deles
  (`esperas.trabalho_id` nulo). Turno de rotina sem task é turno do chat e para.
- **O que não para:** frentes, tasks (inclusive as de rotina), os turnos, esperas, pedidos e frames delas. Cada uma se
  para por dentro, pela pílula ou pela tela da task. A faixa do Parar do chat não traz mais `trabalhosParados`.
- **A parada do chat é gravada e encerrada na hora**, na mesma transação (`paradas.encerrar`): fica a auditoria e o
  evento `parada`, mas nada fica segurado — a próxima rotina roda no horário dela, sem `parada_aberta` nem
  "rotina-parada-aberta". A trava do turno parado passa a ser `turnos.parar_solicitado_em` (lease, ferramentas,
  esperas, assentar). A migração 0103 fecha as paradas de conversa própria que já estavam abertas.
- **Freio de emergência:** passa a ser o Parar global (sem conversa), que segue como antes (para tudo, tasks
  inclusive, e segura o despacho até a pessoa voltar). O Parar da sala também não muda.
- **Depois do Parar:** a frente que termina depois devolve o lote ao dono normalmente e acorda o chat com o resultado;
  liberar um app depois do Parar retoma o turno que esperava por ele; o resultado tardio de um pedido já avisado só
  fica registrado, sem acordar quem pediu.
- **Risco aceito:** sem parada aberta, um pingue-pongue entre bots pode voltar quando chega um pedido novo; o Parar
  global resolve.
