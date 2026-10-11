# ADR-096 — O disco que se cuida: a máquina dos bots não enche sem ninguém olhar

Status: aceito · Data: 2026-10-11 · Emenda a [ADR-088](adr-088-limpeza-das-pastas-de-task.md) (a limpeza das tasks) e
usa os limites de disco da [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (#219).

## Contexto

Em 11/10 os bots pararam. A VM `nod-motor-teste` (disco de 49 GB) chegou a 99%, com 935 MB livres, e o portão do disco
(#219) segurou todo trabalho novo, como devia. O portão só detecta e para; ninguém liberava espaço.

Medido na VM em 11/10 (`du` e `git status` com `nice`/`ionice`, e o `journalctl -u nod-motor`):

- A limpeza das tasks (ADR-088) rodava no padrão `simular` havia dois dias. Nos logs de 3 dias, **zero** worktrees
  sairiam: 74 puladas como `aninhado`, 13 como `ignorado_valioso` e 10 como `suja`.
- O `aninhado` era falso. A busca por `.git` dentro da worktree desistia com qualquer pasta a mais de 8 níveis, e o
  gamefik tem código assim (`packages/mundo-vivo/tools/provas/vereditos/mundo/rondas/r14-mundo-vivo/palcos`). Nenhuma
  das worktrees conferidas tinha repositório dentro.
- Das 41 worktrees de task, 4 eram seguradas por cache de ferramenta dentro de um pacote (`packages/auth/.turbo/`,
  `apps/mobile/.expo/`): a regra da ADR-088 só aceitava o cache no primeiro nível do caminho.
- `~/nod` somava ~37 GB, ~31 GB deles em worktrees de task. Outros ~3 GB eram sobras da task fora de worktree:
  dados de Postgres local (`pgdata`, `pg5471`), logs, ferramentas. Caches: 1,4 GB em `~/.npm` e 4 GB no store do pnpm.
- Depois de liberar, o disco cresceu 2 GB em uma hora de bots trabalhando.

O Marlon aumentou o disco para 100 GB e ligou a limpeza à mão. Isso não serve para quem usa o nod: a pessoa comum não
sabe da variável, não tem como aumentar o disco e só descobre quando os bots param.

## Decisão

A máquina que roda os bots cuida do próprio disco: limpa por padrão, limpa mais quando aperta, guarda antes de apagar
o que não se refaz e avisa antes de chegar ao fim. Sete partes. As quatro primeiras (1, 2, 3 e 7) entram neste PR; as
outras, no PR seguinte, que emenda esta ADR.

**1. O `aninhado` olha o que importa.** A busca por `.git` abaixo da worktree não tem mais teto de nível, só o de 20 mil
pastas fora de `node_modules`. Ela já não seguia link (`Dirent.isDirectory()` é falso para ele), então não entra em
laço. A worktree do gamefik tem 1.193 pastas fora de `node_modules`.

O cache de **uma ferramenta conhecida**, com nome que só ela usa, vale em qualquer nível: `.turbo`, `.expo`, `.next`,
`.nuxt`, `.svelte-kit`, `.vite`, `.parcel-cache`, `.pnpm-store`, `__pycache__` e `.pytest_cache`. A pasta inteira passa
pela mesma conferência de `.env*` da ADR-088. `dist`, `coverage` e `.cache` continuam só no primeiro nível, porque são
nomes genéricos.

**2. A limpeza apaga por padrão.** `NOD_LIMPEZA_TASKS` sem valor, ou com valor desconhecido, liga. `simular` e
`desligada` só valem escritos por extenso. Isto é o gatilho da ADR-088 §7, cumprido pelo Marlon em 11/10 com os logs da
VM na mão. As proteções da ADR-088 continuam todas: `git worktree remove` sem --force, montagem, travada, aninhado,
suja, ignorado valioso, HEAD solto, turno vivo, reconfirmação com o servidor.

**3. Disco apertado, limpeza na hora.** A cada 5 min a limpeza lê o disco de `~/nod` (`statfs`, sem processo novo). No
amarelo ou no vermelho da ADR-085 (abaixo de 10 GB ou de 3 GB livres, com a mesma histerese), ela roda uma **passada
apertada**, no máximo uma a cada 30 min:

- o pedido leva `apertado: true`, e o servidor oferece também a task encerrada há mais de 2 h como `encerrada`, sem
  exigir o PR mergeado. As outras travas de `quandoLimpar` não mudam. A branch fica no clone: se o bot voltar à task,
  ele recria a worktree;
- no fim, os caches de pacote saem pelas próprias ferramentas: `npm cache clean --force` e `pnpm store prune`. O
  segundo roda depois das worktrees, porque só tira do store o que nenhum projeto usa. Programa ausente é pulado;
- o relato vai marcado (`apertada`, `caches_mb` no log `limpeza_feita`), e a máquina registra
  `limpeza_disco_apertado` com o nível e o espaço livre.

**7. O pesado cede a vez.** Os comandos pesados da limpeza rodam com prioridade baixa de CPU e de disco: o
`git status` de cada worktree, o `git worktree remove`, o `du` da simulação e a limpeza dos caches. No Linux,
`ionice -c2 -n7 nice -n10`; no macOS, `taskpolicy -c utility`; sem as ferramentas, roda direto (`prefixoDeFundo`). Em
11/10, três `du` sobre `/home` da VM, ao lado dos turnos, deixaram a máquina sem responder nem ao SSH (~170 MB/s de
leitura com 20% de CPU) até um reset.

Prioridade baixa, nunca a ociosa. A primeira versão usou `taskpolicy -b` e `ionice -c3`: com load 114 no Mac, três
testes da limpeza passaram de 60 s sem terminar. Máquina cheia é justamente quando o disco enche, e a limpeza parada
nessa hora não serve.

### No PR seguinte (emenda desta ADR)

**4. Guardar antes de apagar.** O que hoje segura a pasta para sempre (worktree `suja`, `ignorado_valioso` ou com HEAD
solto, repositório aninhado, clone, e as sobras fora de worktree, como `pgdata` e logs) passa a ser guardado compactado
em `~/nod/.guardado/`, sem o que se refaz. O HEAD de cada worktree ganha uma referência local
(`refs/nod/guardado/...`), para nenhum commit se perder. Só então a pasta sai. Nada vai ao GitHub. O guardado vence em
30 dias, e antes disso se o disco apertar.

**5. Gastar menos.** Medir se o pnpm da máquina liga os pacotes ao store (hardlink) ou copia, e corrigir a
configuração se copiar. Para o npm, que não tem store compartilhado, medir o ganho de `--prefer-offline` antes de
decidir.

**6. Cota e tendência.** O servidor já recebe a leitura de disco de cada máquina. Com as leituras das últimas horas,
ele estima em quanto tempo o disco chega ao vermelho e avisa a pessoa antes ("no ritmo atual, acaba em 6 h; já liberei
8 GB"). As worktrees órfãs paradas na raiz dos bots (ADR-088 §5) entram na passada apertada, com a mesma regra do
item 4.

## Alternativas descartadas

- **Aumentar o disco.** Resolve uma vez, para quem tem acesso à nuvem. A pessoa comum não tem, e o disco enche de novo
  no mesmo ritmo.
- **Manter `simular` e avisar a pessoa para ligar.** Exige saber de uma variável de ambiente; o padrão é o que acontece
  com quem não sabe.
- **Regra percentual para o aperto.** A ADR-085 já recusou: 5% de 466 GB seguraria um disco com folga de sobra. Os
  limites absolutos valem para a VM de 50 GB e para o Mac de 466 GB.
- **Apagar caches com `rm`.** As ferramentas sabem o que é delas e o que está em uso (`pnpm store prune` só tira o que
  nenhum projeto referencia).
- **Rodar o motor inteiro com prioridade baixa (systemd `Nice=`).** Os turnos dos bots também perderiam a vez; só a
  limpeza é trabalho de fundo.

## Riscos aceitos

- **A worktree de uma task encerrada há 2 h some no aperto.** Se o bot voltar, recria a worktree a partir da branch e
  reinstala as dependências. É mais lento, mas os bots não param.
- **`npm cache clean` ou `pnpm store prune` no meio da instalação de um bot.** A instalação pode falhar e o bot tenta de
  novo. Só acontece no aperto, no máximo uma vez a cada 30 min.
- **Valor desconhecido em `NOD_LIMPEZA_TASKS` liga a limpeza.** Antes ele simulava. Quem quer simular escreve `simular`.

## Gatilho de reversão

- Relato de worktree apagada com trabalho fora de qualquer branch: `NOD_LIMPEZA_TASKS=desligada` e reabrir esta ADR e a
  ADR-088.
- `limpeza_disco_apertado` repetindo por mais de um dia na mesma máquina sem `liberado_mb` nem `caches_mb`: o que enche
  está fora da limpeza, e o item 4 (ou o 6) vira prioridade.
