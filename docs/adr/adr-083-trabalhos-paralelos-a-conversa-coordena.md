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
4. **Sem teto.** O limite é a máquina: o Mac lê a pressão de memória do macOS
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
9. **Computador do bot (ADR-037):** continua um por bot. O segundo trabalho recebe "computador em uso por: <título>"
   e espera, em vez do 409 que o proxy tratava como conector fora do ar.

## Alternativas rejeitadas

- **Mesma sessão com subagente em segundo plano.** Só o Claude tem, o Nod não vê o subagente e a pasta é a mesma.
- **Duas faixas fixas por bot (conversa + uma).** Não resolve rotina e colega ao mesmo tempo; o padrão de mercado é
  uma sessão por trabalho.
- **Teto de trabalhos por bot ou por pessoa.** A máquina varia (8 a 36 GB); um teto de 8 travaria o pico de 25 turnos
  que o diário já tem. O aviso pela pressão do macOS se adapta sozinho.
- **Interruptor `NOD_TASKS`.** Só o Marlon usa o Nod por enquanto; voltar atrás é reverter o PR (a migração 0060 é
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
