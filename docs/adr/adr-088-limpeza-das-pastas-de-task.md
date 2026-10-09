# ADR-088 — Limpeza das tasks: a worktree nasce na pasta da task e sai quando a task acaba

Status: aceito · Data: 2026-10-09 · Emenda a [ADR-065](adr-065-o-bot-sabe-o-que-tem-e-cada-task-na-sua-pasta.md) (a
worktree por task) e usa a ponte da [ADR-021](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md).
Parte do épico de performance no Mac do usuário (#221), issue #216.

## Contexto

Cada task cria uma worktree git com `node_modules` próprio, e nada no nod as removia. Medido no Mac do Marlon em 09/10:

- `~/nod` com 254 GB (era 109 GB em 06/10), num disco de 466 GB que chegou a 97% de uso.
- 261 worktrees. 198 delas ficavam na raiz da pasta do bot (`~/nod/<bot>/<repo>-<algo>`), fora de qualquer
  `trabalhos.pasta`, e só 63 dentro de pastas de task. O nod não sabia de quem eram.
- 181 do nod (~180 MB de node_modules cada), 46 do gamefik (~3,6 GB cada), 22 do leapy (~1 GB cada).
- O bot não limpa sozinho: `rm -r` vira pedido de aprovação.

O caminho já ia para a task desde a ADR-083: na task, o plano leva a pasta dela como `pastaDoBot`, o driver a usa como
diretório e a cerca do git vale para ela. Mas o `worktree add` era livre em qualquer lugar (só o git que mexe era
cercado), e os bots seguiam o hábito da memória deles: em 08/10 e 09/10 ainda nasceram worktrees na raiz
(`Tarsila/qa-194`, `Eng 3/nod-200`, `Ze 2/gamefik-gfk-1793`), de tasks de QA que nunca commitam.

## Decisão

**1. A worktree nova nasce dentro da pasta do turno.** O hook (`gitForaDaPastaDoBot`) agora também confere o destino do
`git worktree add`. Na task, a pasta é `~/nod/<bot>/<slug>`, e a worktree fora dela é negada com o caminho certo
(`<pasta>/<repo>`). Sem task, vale a raiz do bot, como antes. O `worktree add` no clone da pessoa continua livre; só
muda onde ela pode nascer.

O driver grava `daTask` na configuração do hook, e o prompt da task diz que o nod apaga a worktree quando a task acaba.
A pasta da task se reconhece pela barra (`ehPastaDeTask`): a pasta do bot nunca tem barra, e a da task é `<bot>/<slug>`.

**2. Quem pode ser limpo é decisão do servidor** (`quandoLimpar`, src/domain/limpeza-das-tasks.ts). O servidor tem o
banco e decide pelas tasks da pessoa encerradas nos últimos 30 dias (`trabalhosRepo.candidatosALimpeza`):

- **nunca:**
  - task aberta;
  - task `parado`: a pessoa parou e pode continuar;
  - task com turno pendente ou rodando, inclusive a volta marcada com `acordar_em` (ADR-086);
  - task com decisão pendente (o "Retomar" é uma decisão);
  - task cuja pasta é dividida com outra task aberta;
  - pasta que não é `~/nod/<bot>/<slug>`.
- **nunca nas primeiras 2 h depois de encerrar:** é a janela da retomada automática da ADR-084 (`RETOMAR_ATE_MS`).
- **`encerrada`:** terminada ou falha há mais de 3 dias. As worktrees limpas saem.
- **`so_com_pr_mergeado`:** encerrada entre 2 h e 3 dias. Só sai a worktree cujo PR o `gh` deste Mac diz que foi
  mergeado. Qualquer dúvida conta como não mergeado: gh fora, sem login ou HEAD solto.

A task reaberta (uma mensagem nova) sai da lista. Quando volta a acabar, `terminado_em` recomeça o relógio.

**3. Quem apaga é o Mac, onde os arquivos estão** (src/adapters/executor/limpeza-das-tasks.ts). A regra é do servidor,
mas o disco é do Mac. Em produção o servidor roda na nuvem e nunca vê `~/nod`. Por isso a limpeza mora no executor,
nos dois modos:

- **modo local (o diário):** o servidor é o executor do Mac. `comporApp` sobe uma limpeza por pessoa ao lado do pool
  de laços, e ela fala com a ponte in-process.
- **modo compartilhado:** o app do Mac sobe a limpeza depois de conectar. Ela **puxa** a lista em
  `POST /api/maquina/limpeza` e relata em `limpeza/resultado`; o servidor nunca disca (ADR-021). Com servidor antigo
  (404), a lista vem vazia e nada acontece.

A primeira passada roda 10 min depois de subir e as seguintes a cada 6 h, uma por vez e sem paralelismo, porque apagar
`node_modules` gasta disco. `NOD_LIMPEZA_TASKS=desligada` desliga a limpeza no modo local. Para cada pasta oferecida, o
Mac:

1. Confere de novo o caminho: a forma `<bot>/<slug>`, que é uma pasta de verdade (não um link) e que o caminho real
   fica dentro de `~/nod`. Pasta que não existe neste Mac é pulada sem barulho: já foi limpa, ou a task rodou em
   outro Mac.
2. Acha as worktrees dentro da pasta, pelo `.git` arquivo, até 3 níveis. Não entra em `node_modules`, em pasta
   escondida, em link nem na própria worktree. Um clone inteiro (`.git` pasta) não é apagado: ele é contado como
   `clone`.
3. Remove cada uma com `git worktree remove` **sem --force**. Se a worktree tem alteração não commitada ou arquivo
   novo, o git recusa e ela fica, com o log `limpeza_worktree_pulada` e o motivo `suja`. O `node_modules` ignorado
   não segura a remoção. A branch fica no clone, então o trabalho commitado não se perde.
4. Apaga com `rmdir` as pastas que ficaram vazias, inclusive a da task (só um `.DS_Store` conta como vazio). O `rmdir`
   nunca apaga conteúdo, nunca entra numa worktree que ficou e nunca apaga uma origem de montagem.
5. Roda `git worktree prune` nos clones que perderam worktree.

**4. A proteção das montagens.** O `nod-postgres` do diário monta `~/nod/Eng 1/nod-169/infra/postgres/init`. Antes de
remover, o Mac lê as origens dos bind mounts de todos os containers, rodando ou parados (`docker ps -aq` e
`docker inspect`). A worktree que contém uma origem de montagem fica, com o motivo `montagem`.

- **Sem Docker instalado:** não há montagens.
- **Docker que não respondeu** (o Docker Desktop trava quando o disco da VM enche): a worktree que tem arquivo
  de compose fica, com o motivo `compose_sem_docker`.

Fora isso, a pasta do caso concreto está na raiz do bot, e a raiz do bot nunca entra na limpeza.

**5. As worktrees órfãs da raiz do bot não são apagadas.** O nod não sabe de quem elas são. A passada só as conta
(`orfas`, e `orfasParadas` as sem mexer há 2 dias, pelo HEAD e pelo índice no clone). Mostrar o espaço liberável em
Seu espaço › Este Mac, com um botão para limpar, fica para um PR próprio (ver "Não implementado").

**6. Medir.** No Mac, os logs `limpeza_worktree_removida` (com `liberado_mb`) e `limpeza_worktree_pulada` (com o
motivo), com o id da task e só o nome da pasta do repositório. No servidor, o log `limpeza_feita` resume cada passada:
pastas, removidas, pastas apagadas, `liberado_mb`, `pulada_<motivo>`, órfãs e duração. Nenhum caminho vai ao servidor,
porque o slug vem do título da task.

O liberado é a diferença do espaço livre do volume (`statfs`) antes e depois de cada remoção, e não o `du`. Com os
clones APFS do pnpm (gamefik, leapy), o `du` mostra mais do que apagar libera. A diferença é ruidosa quando outro
processo grava ao mesmo tempo, então soma nunca negativo.

## Alternativas descartadas

- **Limpar pelo servidor, direto no disco.** Funcionaria no diário, onde tudo está no mesmo Mac, e quebraria em produção,
  onde o servidor está na nuvem. Também não decidir no Mac: o Mac não tem o banco para saber se a task pode voltar.
- **`git worktree remove --force`, ou `rm -rf` na pasta da task.** Apagaria trabalho não commitado. A recusa do git é a
  proteção que este desenho usa.
- **Apagar também as órfãs da raiz com a mesma regra de idade.** Sem dono, não há como saber se alguém volta a elas.
  A decisão fica com a pessoa, na tela.
- **Marcar a pasta como limpa no banco (migração 0066).** Com dois Macs, o que não tem a pasta marcaria a do outro como
  limpa. A janela de 30 dias e um `lstat` por pasta resolvem sem coluna nova.
- **Conferir PR mergeado pela ancestralidade no git.** O squash merge do GitHub quebra a ancestralidade, então o `gh` do
  Mac é a fonte.

## Riscos aceitos

- **Uma task reaberta no meio da passada.** A lista é lida antes e a remoção vem depois, segundos ou minutos. Se a
  pessoa escrever numa task de 3 dias exatamente nesse intervalo, a worktree pode sumir debaixo do bot. A branch fica no
  clone e o bot recria a worktree.
- **Um processo vivo rodando de dentro de uma worktree de task encerrada** (um servidor de dev esquecido) perde a pasta.
  Para isso a task precisa estar encerrada há 3 dias, ou ter o PR mergeado.
- **O prazo de 10 min por remoção.** Se ele estourar no meio, a worktree fica pela metade. O `prune` arruma os
  metadados, e o resto aparece como pasta com conteúdo.

## Não implementado (segue em PRs próprios)

- **Este Mac mostra o espaço liberável e permite limpar** (critério da #216). O Mac mede as órfãs paradas (o `du` é
  caro, então medir por amostra ou só sob pedido) e manda a medição no `puxar`, como a leitura de memória da ADR-085.
  A tela mostra "X GB em N cópias paradas há 2+ dias", com o detalhe atrás de um clique. O botão grava um pedido que o
  Mac puxa e cumpre com a mesma remoção sem --force.
- **Reaproveitar dependências entre tasks** (`npm ci --prefer-offline`, store do pnpm no mesmo volume) e a **cota por
  bot** (item 4 e item 5 da #216).

## Gatilho de reversão

- `limpeza_feita` com `pulada_suja` maior que `removidas` por uma semana: os bots deixam trabalho por commitar. Rever a
  instrução do prompt antes de pensar em forçar.
- `~/nod` crescendo mais de 20 GB por semana com a limpeza ligada: o que cresce está fora dela (as órfãs ou os clones),
  e a tela do item 5 passa a ser prioridade.
- Qualquer relato de worktree apagada com trabalho que não estava em branch nenhuma: desligar com
  `NOD_LIMPEZA_TASKS=desligada` no diário e reabrir esta ADR.
