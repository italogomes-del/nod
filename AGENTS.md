# AGENTS.md — como trabalhar neste repositório

Curto no dia 1; cresce quando um agente errar de verdade. As decisões moram em [docs/adr/](docs/adr/); as
práticas herdadas, com evidência, em [docs/inherited-from-leapy.md](docs/inherited-from-leapy.md).

## Comandos

```bash
npm ci                      # Node 24.19.0 (pinado em .mise.toml)
npm run dev:setup           # sobe o Postgres (127.0.0.1:5434, container nod-postgres), migra nod + nod_test (0001–0004) e roda o seed em nod
npm run dev                 # api 8888 + web 5274 (5173 e 5432 são de OUTROS projetos: nunca use); executor catcher por default
npm run check               # lint → typecheck → fence:domain → unit → integration → conformidade → concurrency
npm run e2e:fumaca          # dez jornadas sobre o servidor completo com catcher (tests/concurrency/e2e-catcher.test.ts), custo zero
npm run e2e:haiku           # scripts/e2e-aceite.sh com o CLI real (haiku); imprime o custo somado — rode UMA vez, custa assinatura
npm run sonda               # ADR-019: {estado, versao} sem email; custa um turno haiku (~US$ 0,01). sonda:mcp-timeout mede o teto do tools/call
npm run test:integration    # só com DATABASE_URL_TEST (copie .env.example para .env); sem ele pula fora do CI e FALHA sob CI
npm run db:migrate          # como nod_dono; a aplicação (nod_app, NOBYPASSRLS) nunca migra
npm run db:seed             # identidade (tenants/pessoas) como nod_dono + Vera/Tuca/sala geral como nod_app; idempotente por id determinístico (a 2ª passagem registra seed_sem_mudancas); o CI nunca chama
npm start                   # node src/adapters/http/server.ts → boot.ts (partições, compor, listen, registry, laços); é o mesmo CMD do Dockerfile
```

O pre-commit roda só `lint-staged` (eslint --fix nos .ts). O gate pesado é `npm run check`, antes do push.
O hook é instalado pelo `prepare` do `npm ci`/`npm install`; confira com `ls .git/hooks/pre-commit`
(observado em 2026-09-16: o primeiro commit da fundação saiu SEM o hook porque ninguém tinha rodado
`npm run prepare` — um `git commit` que não imprime a linha do lint-staged é sinal de hook ausente).

## Aviso: nvm/asdf ganham do mise

Se o seu shell carrega nvm ou asdf, eles GANHAM do mise e você roda a suíte no Node errado, e o erro
MENTE sobre onde está o bug. A origem deste aviso é a medição da Leapy, não nossa: no monorepo deles,
19 falhas com o Node 18 do nvm contra 892 verdes com `mise exec` — e as 19 apontavam arquivos de
feature que estavam corretos (docs/inherited-from-leapy.md §8). Se algo falhar sem sentido, confira
`node --version` = 24.19.0 ou envelope com `mise exec -- npm run check`.

## Regras que o código trava (não são sugestão)

- **Toda transação tem tenant E pessoa.** `abrirTxEscopada(db, {tenantId, pessoaId})` em produção;
  `withRollback(escopo, fn)` + `vincularEscopo` nos testes. Vazio lança `escopo_vazio`. Ler sem escopo
  falha fechado no Postgres ("unrecognized configuration parameter"), nunca devolve zero linhas.
  `abrirTxEscopada` só aceita o POOL: passar uma transação aberta não compila e lança
  `estado_invalido` (o SET LOCAL num SAVEPOINT sobrevive ao RELEASE — medido em 2026-09-16).
- **`tenants`/`pessoas` são só leitura para nod_app.** Quem escreve identidade é o seed (nod_dono).
  Teste que precisa de pessoas usa `withRollbackDono` de `tests/helpers/db-dono.ts` — e esse helper
  nunca lê tabela escopada.
- **Toda tabela nova passa por `nod_escopar_tabela(tbl, perna_extra)`** na migração, senão
  `tests/conformidade/rls.test.ts` acusa (lê pg_catalog; exceções têm motivo escrito em `gate-rls.ts`).
  Desde a 0004 a função cria QUATRO policies PERMISSIVE por comando — `nod_pessoa_select` (dono OU
  'equipe' OU perna extra), `nod_pessoa_insert`/`update`/`delete` (só a dona) — e o gate confere nome E
  comando (`polcmd`). A perna extra e 'equipe' só ABREM LEITURA: UPDATE/DELETE por quem não é a dona
  afetam ZERO linhas (medido em 2026-09-16: com a policy FOR ALL da 0001 a decisora apagava a decisão
  da dona). Quem precisa que a perna também ESCREVA cria uma policy PERMISSIVE a mais, só para o comando
  necessário, e a registra por nome em `POLICIES_EXTRAS` do gate — como `nod_decisora` (0003, FOR UPDATE
  em decisoes/itens_aprovacao).
  Uma policy FOR UPDATE concede UPDATE de QUALQUER coluna (medido em 2026-09-16 com os triggers da 0003
  desligados: a decisora reescreveu frase/prazo e pôs `visibility = 'equipe'` na decisão da dona); por isso a policy vem
  SEMPRE com um trigger BEFORE UPDATE que fecha a lista de colunas que quem não é a dona pode mudar
  (`colunasLivresDaDecisora` em `src/db/schema/decisoes.ts`), e o motivo em `POLICIES_EXTRAS` nomeia o trigger.
- **Domínio é puro** (`src/domain/**`): sem `node:*`, sem banco, `agora: number` por parâmetro.
  O compilador guarda a pureza (`tsconfig.domain.json`); o eslint guarda a direção entre camadas.
- **`src/services` é SEM BANCO.** Laço de fundo que abre transação mora em `src/adapters/fundo/` e
  passa por `paraCadaPessoa`.
- **Sem `console.*`** fora de `src/obs/log.ts`. Sem `DELETE FROM`/`TRUNCATE` em teste fora de
  `tests/concurrency/`. Sem `as unknown as`.
- **Erro nunca vaza `message`.** `ErroDeDominio(codigo)`; a mensagem sai de uma tabela fixa em
  `src/adapters/http/erros.ts`; o resto vira 500 + `correlation_id`.
- **Comentário registra medição e data**, não intenção: `definido em AAAA-MM-DD: <critério>` para
  escolhas, `medido em AAAA-MM-DD: <número> (<como>)` SÓ para o que foi cronometrado/observado.
- **Id de fora nunca chega cru ao Postgres**: grupo `id`/`mid` de path fora de uuid → 404 no roteador;
  22P02 (id malformado no corpo) → 400 `entrada_invalida` em `erros.ts`. Nunca 500.
- **Quem assenta um turno lê a linha com trava** (`turnosRepo.buscarTravado`, FOR UPDATE): Parar e a
  entrega correm em transações paralelas e a leitura sem trava assentava 'sem_progresso' no lugar de
  'parado_pela_pessoa' (medido em 2026-09-16 no e2e).
- **A web só faz `import type` de `src/`** (eslint) e nunca executa nada: pede por REST, recebe frames
  SSE que dizem O QUE mudou (kind, conversaId, turnoId) e reidrata por REST (`web/estado/reducer.ts`).
  O composer nunca é regravado dentro da mesma conversa (`web/lib/render.ts`).

## Quatro modos de teste

`tests/unit` (sem banco) · `tests/integration` (withRollback, paralelo) · `tests/conformidade`
(lê o catálogo do Postgres; o primeiro teste do gate é NEGATIVO) · `tests/concurrency` (duas
conexões de verdade, serial, limpeza própria por id). Testes nunca dependem do seed: criam as próprias
linhas com `randomUUID` dentro do envelope; só `tests/helpers/ids.ts` (identidade) é fixo.

## Composição (L9)

`src/adapters/http/compor.ts` é o único lugar que liga as lanes: `comporApp({db, env})` monta o
`Services` concreto, `UseCasesNod`, a ponte in-process, a fábrica `dentro` (abre `abrirTxEscopada` e
monta `Deps`) e as rotas de todas as lanes; `boot.ts` sobe partições → listen → registry (claude-cli
só quando `NOD_EXECUTOR=claude-cli`; a sonda custa um turno) → inventário por pessoa → orquestrador →
scheduler 30 s → varredor de lease 15 s → varredor de expiração 30 s → despachante do outbox.
`tests/helpers/servidor-completo.ts` sobe o mesmo app em porta 0 sobre `nod_test` (commita: por isso o
e2e mora em `tests/concurrency` e limpa por id). Serviço chamado fora de uma tx escopada lança
`escopo_vazio` — o escopo dos `Services` vem do `AsyncLocalStorage` que `abrirTxEscopada` preenche.

## Desvios registrados

- **O e2e commita** (laços reais, sessão, SSE) e mora em `tests/concurrency/e2e-catcher.test.ts`, não em
  `tests/integration` como o plano nomeava; a `trilha` é imutável e as linhas do e2e (de uma pessoa
  aleatória por execução) ficam em `nod_test`.
- **`/metrics`** responde na raiz (server) e em `/api/metrics` (rota da L8) — EMENDA-L9 §3.
- **Cron com minuto e hora fixos** (Regra 9): `* * * * *` é `entrada_invalida`; o aceite adianta
  `proxima_execucao`.

- **Docker compose com um serviço só** (desvio do §5 da Leapy, EMENDA 25): o catcher do nod não é um
  serviço como o Mailpit — é um driver in-process do executor (`NOD_EXECUTOR=catcher`), porque o que se
  captura é o que o proxy decidiu e o que o CLI teria chamado, e isso mora no processo do servidor.
- **`src/contracts/` existe além de `src/shared/types.ts`** (EMENDA 26): contém SÓ tipos e `as const`,
  sem lógica; a web importa dali só com `import type`. Gatilho de revisão: um arquivo passando de
  200 linhas.
- **Sessão stub por cookie** assinado (HMAC) só em 127.0.0.1; o servidor recusa outro `NOD_HOST`
  enquanto a sessão for stub (ADR-019/021).

## Cloud Agents e gstack

O `install` em `.cursor/environment.json` chama `scripts/cloud/install-gstack.sh`: instala bun 1.3.10 se faltar (em `~/.bun/bin`, com symlink em `/usr/local/bin` quando o sudo sem senha existir), clona https://github.com/garrytan/gstack.git em `~/.claude/skills/gstack` no commit `GSTACK_REF` (padrão `c43c850cae779bcd134b71a28eeec00628ba0792`), roda `./setup --host claude --no-prefix --no-team --no-plan-tune-hooks --quiet`, cria symlinks em `~/.cursor/skills/` sem sobrescrever o que já existir, desliga `telemetry` / `update_check` / `auto_upgrade` / `proactive`, liga o modo spawned (marcador `~/.gstack/spawned`; o preâmbulo imprime `SPAWNED_SESSION: true`) e tenta o Chromium do Playwright sem derrubar o Build.

Neste ambiente o gstack roda spawned, não interativo: se uma skill oferecer A/B, escolha a opção marcada `(recommended)` e siga. Não use AskUserQuestion.

Para trocar a versão: `GSTACK_REF=<sha-ou-tag> bash scripts/cloud/install-gstack.sh`. O padrão vive na variável `GSTACK_REF` do próprio script.

## Executor e custo

Dev local não exige CLI nem chave: `NOD_EXECUTOR=catcher` é o padrão. Qualquer `claude -p` real
usa `--model claude-haiku-4-5-20251001 --strict-mcp-config --tools ""` e ambiente limpo
(denylist `^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$`) — sem isso o custo
de um turno trivial sobe 8x (mapa da sonda de 2026-09-16) e pode cair na fatura errada.
