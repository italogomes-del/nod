# AGENTS.md — como trabalhar neste repositório

Curto no dia 1; cresce quando um agente errar de verdade. As decisões moram em [docs/adr/](docs/adr/); as
práticas herdadas, com evidência, em [docs/praticas-herdadas.md](docs/praticas-herdadas.md).

Para iniciar, atualizar ou separar o Nod diário de bancos descartáveis de feature, siga
[docs/ambiente-local-persistente.md](docs/ambiente-local-persistente.md). O banco diário usa a porta
5434 e o volume `nod_nod_pgdata`; agentes nunca devem executar `docker:reset`, `docker compose down -v`
ou remover esse volume sem um pedido explícito de perda total dos dados.

## Comandos

```bash
npm ci                      # Node 24.19.0 (pinado em .mise.toml)
npm run dev:setup           # sobe o Postgres (127.0.0.1:5434, container nod-postgres), migra nod + nod_test (0001–0010) e roda o seed em nod
npm run dev                 # api 8888 + web 5274 (5173 e 5432 são de OUTROS projetos: nunca use); executor catcher por default
npm run check               # lint → typecheck → fence:domain → unit → integration → conformidade → concurrency
npm run e2e:fumaca          # onze jornadas sobre o servidor completo com catcher (tests/concurrency/e2e-catcher.test.ts), custo zero
npm run e2e:haiku           # scripts/e2e-aceite.sh com o CLI real (haiku); imprime o custo somado — rode UMA vez, custa assinatura
node scripts/carga-tela/rodar.ts medir <rotulo>   # carga da TELA num Chrome headless (vários bots escrevendo, turno pesado) sobre um banco efêmero; uso no cabeçalho do script (ADR-061)
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
MENTE sobre onde está o bug. A origem deste aviso é uma medição do projeto de referência, não nossa: no monorepo dele,
19 falhas com o Node 18 do nvm contra 892 verdes com `mise exec` — e as 19 apontavam arquivos de
feature que estavam corretos (docs/praticas-herdadas.md §8). Se algo falhar sem sentido, confira
`node --version` = 24.19.0 ou envelope com `mise exec -- npm run check`.

## Regras que o código trava (não são sugestão)

- **Toda transação tem tenant E pessoa.** `abrirTxEscopada(db, {tenantId, pessoaId})` em produção;
  `withRollback(escopo, fn)` + `vincularEscopo` nos testes. Vazio lança `escopo_vazio`. Ler sem escopo
  falha fechado no Postgres ("unrecognized configuration parameter"), nunca devolve zero linhas.
  `abrirTxEscopada` só aceita o POOL: passar uma transação aberta não compila e lança
  `estado_invalido` (o SET LOCAL num SAVEPOINT sobrevive ao RELEASE — medido em 2026-09-16).
- **Chave de máquina carrega o próprio escopo** (ADR-031): validar busca o hash DENTRO da tx escopada
  pelo escopo alegado (`autorizarChaveMaquina`). Busca pelo hash sem escopo nunca acha a linha (falha
  como nod_app; volta vazia em silêncio como nod_dono). A chave crua não vai para banco, log nem listagem.
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
  O composer nunca é regravado dentro da mesma conversa (`web/lib/regioes.ts`).

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
O executor da máquina é VIVO: `NOD_EXECUTOR` só dá o valor inicial e o interruptor (`GET`/`POST executor`,
botão na Frota) troca catcher ⇄ claude-cli em tempo de execução — a troca liga o driver em sombra na hora
(`registrarDriver`, sonda paga só quando a pessoa pede) e só acontece se a sonda disser 'pronto'. Quem
precisa do executor lê `app.executor`/getters, nunca copia o valor (a cópia congela a troca). A escolha
não sobrevive ao reinício (NOD_HOME guarda só `machine-id`, EMENDA 11).
`tests/helpers/servidor-completo.ts` sobe o mesmo app em porta 0 sobre `nod_test` (commita: por isso o
e2e mora em `tests/concurrency` e limpa por id). Serviço chamado fora de uma tx escopada lança
`escopo_vazio` — o escopo dos `Services` vem do `AsyncLocalStorage` que `abrirTxEscopada` preenche.

## Desvios registrados

- **O e2e commita** (laços reais, sessão, SSE) e mora em `tests/concurrency/e2e-catcher.test.ts`, não em
  `tests/integration` como o plano nomeava; a `trilha` é imutável e as linhas do e2e (de uma pessoa
  aleatória por execução) ficam em `nod_test`.
- **`/metrics`** responde na raiz (server) e em `/api/metrics` (rota da L8) — EMENDA-L9 §3.
- **Cron com intervalos** (ADR-033): minuto/hora aceitam fixos, listas, `*` e passos como `*/5`.
  UTC também é persistível (0010); a janela continua canônica e deduplicada.

- **Docker compose com um serviço só** (desvio do §5 das práticas herdadas, EMENDA 25): o catcher do nod não é um
  serviço como o Mailpit — é um driver in-process do executor (`NOD_EXECUTOR=catcher`), porque o que se
  captura é o que o proxy decidiu e o que o CLI teria chamado, e isso mora no processo do servidor.
- **`src/contracts/` existe além de `src/shared/types.ts`** (EMENDA 26): contém SÓ tipos e `as const`,
  sem lógica; a web importa dali só com `import type`. Gatilho de revisão: um arquivo passando de
  200 linhas.
- **Login por `NOD_LOGIN`, obrigatório** (ADR-030; o épico E1 dizia "o stub some" — revisto em
  2026-09-16). `google` = OAuth Google só para e-mails do cadastro (o seed lê `NOD_SEED_EMAIL`; `NOD_GOOGLE_DOMINIO`
  restringe a um domínio Workspace — emenda 2026-10-02), pode escutar fora de 127.0.0.1 e
  RECUSA segredo de sessão curto ou o de exemplo; `stub` = login de desenvolvimento que lista as pessoas
  do cadastro, só em 127.0.0.1. Sem `NOD_LOGIN` o servidor não sobe. Os testes nunca usam nenhum dos
  dois: cunham o cookie com `cunharCookie` (`servidorDeTeste.entrar`, `servidorCompleto.sessaoDe`).

## Cloud Agents e gstack

O `install` em `.cursor/environment.json` chama `scripts/cloud/install-gstack.sh`: instala bun 1.3.10 se faltar (em `~/.bun/bin`, com symlink em `/usr/local/bin` quando o sudo sem senha existir), clona https://github.com/garrytan/gstack.git em `~/.claude/skills/gstack` no commit `GSTACK_REF` (padrão `c43c850cae779bcd134b71a28eeec00628ba0792`), roda `./setup --host claude --no-prefix --no-team --no-plan-tune-hooks --quiet`, cria symlinks em `~/.cursor/skills/` sem sobrescrever o que já existir, desliga `telemetry` / `update_check` / `auto_upgrade` / `proactive`, liga o modo spawned (marcador `~/.gstack/spawned`; o preâmbulo imprime `SPAWNED_SESSION: true`) e tenta o Chromium do Playwright sem derrubar o Build.

Neste ambiente o gstack roda spawned, não interativo: se uma skill oferecer A/B, escolha a opção marcada `(recommended)` e siga. Não use AskUserQuestion.

Para trocar a versão: `GSTACK_REF=<sha-ou-tag> bash scripts/cloud/install-gstack.sh`. O padrão vive na variável `GSTACK_REF` do próprio script.

## Executor e custo

Dev local não exige CLI nem chave: `NOD_EXECUTOR=catcher` é o padrão. Qualquer `claude -p` real
usa o modelo do agente (padrão `sonnet`, configurável por `NOD_MODELO`), `--strict-mcp-config --tools ""` e ambiente limpo
(denylist `^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$`) — sem isso o custo
de um turno trivial sobe 8x (mapa da sonda de 2026-09-16) e pode cair na fatura errada.

Definido em 2026-09-17: as sondas usam `NOD_MODELO_SONDA` (default `claude-haiku-4-5-20251001`), separado do modelo dos agentes. `e2e:haiku` mantém o modelo barato explícito.

Definido em 2026-09-18 (ADR-040): o turno **não** passa `--max-turns` — o teto de 12 passos cortava
tarefa de código no meio. `--max-turns` fica em `FLAG_FLOORS` porque `sonda.ts` ainda a usa com valor 1.
`--autocompact` é condicional como `--restricted`: fora de `FLAGS_DO_TURNO`, liberada pelo `--help` da
versão instalada.

Revisto em 2026-10-01 (ADR-067, sessão viva): **nenhum relógio de trabalho**. O driver do Claude abre o CLI
com a entrada em `stream-json` e só fecha o stdin quando o modelo respondeu, nada roda em segundo plano
(`system/task_*`) e o servidor não tem mensagem nova da pessoa; cada volta intermediária vira fala na hora
(`falas` na renovação, frame `turno.fala`). Saíram o vigia de atividade, a validade de 1 h do plano e do
token de turno e o `prazoEm` nas pastas e no computador; o Bash do CLI roda sem teto (`BASH_*_TIMEOUT_MS`).
O turno acaba quando o bot termina, no Parar ou com o lease vencido (a máquina sumiu). **Um processo
preso fica "trabalhando" até alguém apertar Parar** — a lacuna está na ADR-067.

## Desktop e servidor compartilhado (2026-09-17)

Produção na GCP (VM + Cloud SQL, deploy pelo workflow `deploy`): [docs/deploy-gcp.md](docs/deploy-gcp.md).
`NOD_MODO=compartilhado` desliga registry e orquestrador locais; os Macs usam `/api/maquina/…`
com chave escopada. O id da chave identifica o computador; o corpo não escolhe o escopo.
`npm run desktop:build` compila Electron, preload e proxy; a cerca do bundle recusa imports de
banco/repositórios/casos de uso/HTTP/fundo. `npm run desktop:mac` exige assinatura/notarização.
O proxy usa o runtime do app com ELECTRON_RUN_AS_NODE somente em seu mcp.json.
Não rode sondas reais para validar empacotamento: `scripts/desktop/smoke-proxy.mjs` testa JSON-RPC
sem Claude. Instruções e limites: [docs/release-desktop.md](docs/release-desktop.md).

Definido em 2026-09-24 (aviso no Mac): a janela web carrega `preload-web.cjs`, que expõe SÓ
`window.nodDesktop` (avisar, contador, preferências, tema — ADR-070; microfone e emLigacao — ADR-071); a tela de
conexão carrega `preload.cjs` (`window.nod`, com `conectar`). Nunca dê o segundo à página remota. A página
continua sem permissão nenhuma (`proteger`), com UMA exceção desde 2026-10-04 (modo ligação): `media` só de áudio,
só na origem do servidor e só no frame de topo (`desktop/permissoes-midia.ts`). O aviso sai do processo
principal, que confere remetente e argumentos (`desktop/avisos-mac.ts`). A voz do bot toca no AudioContext do
renderer (web/lib/ligacao.ts), nunca pelo processo principal: é a referência do AEC do Chromium.
`electron scripts/desktop/smoke-window.mjs` (depois de `desktop:build`) confere as duas pontes sem empacotar.

## Harnesses e inteligência por agente (ADR-036, 2026-09-18)

`harness` identifica o driver; `executor` continua indicando `local`/`catcher` nos eventos existentes.
Novos agentes usam `harness=auto, modelo=auto`; perfis anteriores preservam seus modelos. A migração
0013 adiciona a preferência a agentes e turnos. Todo novo caminho de enfileiramento deve copiar
**harness e modelo** do agente (ou do turno original em retomadas). O plano resolve a escolha uma vez;
quem executa usa `plano.harness`, nunca o padrão global copiado no boot.

Claude Code e Codex estão integrados; Cursor e Hermes são somente entradas indisponíveis no catálogo.
`NOD_EXECUTOR=auto` descobre contas conectadas sem turno pago; produção sem variável também usa auto.
Desenvolvimento continua com catcher. `NOD_MODELO=auto` permite o padrão por harness; `sonnet` fixa
Claude para os agentes criados com esse override. Boot/desktop usam sondagem de login sem inferência;
`scripts/sonda.ts` e `e2e:haiku` continuam explicitamente separados e pagos.

Codex exige flags de isolamento verificadas no help, usa apenas o proxy nod para integrações, não
herda chaves OpenAI nem configuração de plugins/apps e não põe o token de turno no argv. Seu launcher
0600 chama `main()` do proxy e é apagado ao encerrar. `desktop/proxy.ts` deve exportar `main` além de
funcionar como executável direto. Valide ambos os caminhos sem modelos reais.

Anúncio remoto de harnesses é validado e vinculado ao escopo da chave; a fila só entrega a uma máquina
tarefas compatíveis. O fluxo com seleção de harness não reutiliza sessões nativas: reconstrói contexto
com histórico e memória do nod. Harness explicitamente escolhido e indisponível nunca muda para outro
fornecedor nem para catcher sem a pessoa escolher.

## Computadores dos bots (ADR-037, 2026-09-18)

`NOD_COMPUTADORES=docker` habilita o driver do servidor; `npm run computador:build` prepara a imagem.
Computador de trabalho e máquina executora do harness são recursos diferentes. O vínculo está em
`agentes.computador_id`; nunca derive o escopo do corpo da requisição. Ações passam pelo gateway
com reserva confirmada antes do efeito e nova validação depois do boot, fora da transação.
Takeover só termina por devolução explícita. Não use `--password-store=basic`: perfil usa GNOME
Keyring e checkpoint de cookies cifrado. Preserve a chave de credenciais junto da estratégia de backup.
`node scripts/smoke-computador.ts` usa dois ambientes descartáveis, sem modelos pagos. Limites e
operação: [docs/computadores.md](docs/computadores.md).

## Repositórios de referência (2026-09-18)

Procure o clone local primeiro; se não existir neste ambiente, use a URL. O clone pode faltar em
Cloud Agent ou noutra máquina, então a URL é a fonte canônica, não o caminho.

- **OpenBot (CopilotKit)** — `~/code/OpenBot`, senão https://github.com/CopilotKit/OpenBot.
  A [ADR-038](docs/adr/adr-038-padroes-e-escolhas-da-pessoa.md) fixa o commit
  `eb325300023289f17adf5a10fb38b5bb403dca82`, conferido em 2026-09-18: existe no histórico e os
  quatro arquivos citados existem nele. `server/src/host-access/tools.ts` é o paralelo direto das
  ferramentas `workspace_*`; sem pasta concedida o catálogo dele tem uma ferramenta só (linha 170),
  a mesma conclusão a que o nod chegou por conta própria. Lá a pessoa escolhe a pasta no seletor
  nativo (`requestFolderGrant` não recebe caminho): a descoberta automática é do nod.
- **OpenMausBot** — `~/code/OpenMausBot`, senão https://github.com/milind-soni/OpenMausBot.
  Referência dominante dos ADRs; a comparação viva está em
  [docs/comparacao-openmausbot.md](docs/comparacao-openmausbot.md).

`~/.openmausbot/` **não é código**: são dados de runtime do app instalado (`bots.json`,
`messages.db`). Servem como evidência de comportamento, nunca como fonte a copiar.

## Modo ligação (ADR-071 a 077, 2026-10-04)

Plano em [docs/plano-modo-ligacao.md](docs/plano-modo-ligacao.md). A voz roda no processo do nod (`src/adapters/voz/`,
sem banco: grava pelo `PersistenciaVoz` que `compor.ts` injeta); o cérebro é um turno `origem='ligacao'` que o executor
do Mac roda como laço de voz (`drivers/claude-ligacao.ts`, `codex-ligacao.ts`, `rodarLigacaoCatcher`). Provedores por
`NOD_VOZ_STT`/`NOD_VOZ_TTS`: `local` (whisper.cpp + `say`, grátis) é o padrão em dev no Mac — rode
`scripts/voz/preparar-local.sh` uma vez —, `falso` nos testes (o `servidorCompleto` já liga), `google` em produção.
`NOD_LIGACAO` = desligada | admins | todas (padrão: todas fora de produção, admins em produção).

- O e2e de custo zero é `tests/concurrency/ligacao-catcher.test.ts`; o UAT com voz e CLI de verdade é
  `node scripts/uat/ligacao-voz.ts --url http://127.0.0.1:<porta> "frase" …` contra um servidor de pé (custa assinatura
  com claude-cli).
- A decisão por voz nunca é do modelo: só a rota de decisão com `canal:"voz"` e um `comandoId` que o orquestrador emitiu
  (ADR-074). Não crie outro caminho de decisão a partir da fala.
- Nenhum áudio é gravado e o texto falado não vai para log (`log` com contagens e tempos, nunca a fala).
- Para saber onde uma ligação demorou, leia o log `ligacao_vez` (uma linha por vez: fim da voz → trecho fechado → final
  do STT → vez → primeiro texto → primeiro áudio, ferramenta antes do texto, quem fechou o trecho) e os contadores do
  VAD em `voz_ligacao_encerrada` (emenda da ADR-073). Quem mexer na decisão da vez mantém a regra: com texto pendente e
  ninguém falando, há sempre uma decisão agendada (`agendarDecisao`/`retomarDecisao` no orquestrador).
- No laço do Claude, o texto pertence à vez da última mensagem que o CLI **leu** (o eco de `--replay-user-messages`),
  não da última escrita (emenda da ADR-072). `scripts/sonda-voltas-ligacao.ts` mede isso contra o CLI real (centavos).
