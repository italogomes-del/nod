# nod

**Primeira versão de produto (17/09/2026):** bots como contatos, criação com perfil, colaboração visível, salas e rotinas por prompt ou formulário. [Guia para experimentar](docs/primeira-versao.md). O executor real é o Claude Code instalado na máquina, usando sua assinatura.

> Um lugar onde agentes preparam decisões e uma pessoa decide — com registro de quem decidiu, por quê, e se havia alguém olhando.

**Ferramenta interna da Leapy.** Cada colaborador usa o Claude Code que já está credenciado na própria máquina; o nod pilota, nunca vê a credencial. Este README descreve a versão de 2026-09-17, como rodar e testar; medições históricas mantêm suas datas.

## Download do app para macOS

A [pré-release Desktop 0.2.0-rc.1 — Preview](https://github.com/marlonwlv/nod/releases/tag/desktop-v0.2.0-rc.1) inclui DMGs para **Mac Intel** e **Mac com chip M**, além do guia e dos checksums.

[Guia de instalação, servidor compartilhado e publicação](https://github.com/marlonwlv/nod/blob/desktop-v0.2.0-rc.1/docs/release-desktop.md).

Os instaladores desta pré-release **não têm assinatura Apple nem notarização** e precisam de um servidor nod acessível por HTTPS. Para montar o servidor correspondente aos DMGs, use o código da tag `desktop-v0.2.0-rc.1`. Windows ainda não é suportado nesta versão.

Para mantenedores: [como preparar, validar e publicar cada versão](docs/processo-de-release.md).

O código desktop está integrado nesta versão. Consulte também o [guia do código atual](docs/release-desktop.md).

## Rodar amanhã de manhã

O Postgres diário é persistente em `127.0.0.1:5434` (`nod_nod_pgdata`). Bancos descartáveis para
features podem rodar simultaneamente em `5435`, `5436` etc.; veja o
[guia do ambiente local persistente](docs/ambiente-local-persistente.md).

```bash
cd ~/code/nod
mise install && npm ci                 # Node 24.19.0 pinado em .mise.toml (nvm/asdf ganham do mise — ver AGENTS.md)
cp .env.example .env                   # se ainda não existir; troque NOD_SESSAO_SEGREDO e NOD_CREDENTIAL_KEY
npm run dev:setup                      # docker compose (Postgres 16 em 127.0.0.1:5434) + migrações nos bancos nod e nod_test + seed
NOD_LOGIN=stub npm run dev             # api http://127.0.0.1:8888 + web http://127.0.0.1:5274 (5173 e 5432 são de OUTROS projetos)
```

Abra http://127.0.0.1:5274, clique em **Entrar como Marlon** (sessão stub de desenvolvimento, só em 127.0.0.1) e a **Frota** aparece com a Vera do seed. O executor padrão é o **catcher** (`NOD_EXECUTOR=catcher` no `.env`): zero CLI, zero custo — as respostas do "modelo" vêm de marcadores no próprio texto (`[[tool: lembrar {...}]] [[texto: ...]]`, gramática em `tests/helpers/catcher-roteiro.ts`).

Para alternar sem reiniciar, use o interruptor na faixa de inventário da **Frota** ("usar Claude (real)" / "usar catcher (sem custo)"): trocar para o Claude sonda o CLI na hora (custa um turno) e só acontece se a sonda disser pronto — senão a recusa aparece escrita. A escolha vale até o servidor reiniciar; `NOD_EXECUTOR` dá o valor inicial.

Para rodar com o Claude Code real (custa a assinatura da pessoa):

```bash
NOD_EXECUTOR=claude-cli npm run sonda             # ~US$ 0,01: {estado:'pronto', versao:'2.1.272'} sem email
NOD_EXECUTOR=claude-cli npm run dev               # o boot sonda uma vez (um turno haiku) e só usa o CLI se a sonda disser 'pronto'
```

Contra-prova: `NOD_CLAUDE_BIN=/bin/false NOD_EXECUTOR=claude-cli npm run dev` → inventário `ausente`, a web escreve "claude ausente (…) desde HH:MM" e uma mensagem cria um turno interrompido `executor_indisponivel` com negação escrita — fail-closed renderizado (ADR-029), nunca silêncio.

## Testar

```bash
npm run check          # lint → typecheck (3 tsconfigs) → cerca do domínio → unit → integration → conformidade → concurrency
npm run e2e:fumaca     # as dez jornadas do aceite sobre o servidor COMPLETO com catcher (tests/concurrency/e2e-catcher.test.ts) — custo zero, roda no CI
npm run uat:regressao  # 16 testes de apoio ao aceite: produto, MCP, revogação e isolamento Composio
npm run e2e:haiku      # scripts/e2e-aceite.sh: o mesmo roteiro com o CLI real e curl+jq; imprime o custo somado
```

Medido em 2026-09-16 (esta máquina, Postgres em Docker): `npm run check` = 141 arquivos, 564 testes (300 unit + 188 integration + 49 conformidade + 27 concurrency); três execuções seguidas verdes em 92 s, 88 s e 86 s (critério da EMENDA-L9 §11). `e2e:fumaca` = 10 jornadas em ~26 s. `e2e:haiku` = rodada única verde (exit 0), US$ 0,1131 somados, cabeçalho de `scripts/e2e-aceite.sh`.

Quatro modos de teste (ADR-011 refinado): `tests/unit` (sem banco), `tests/integration` (Postgres real sob `withRollback`), `tests/conformidade` (gates que leem `pg_catalog`), `tests/concurrency` (duas conexões, commit real, limpeza própria por id — é onde o e2e mora, porque ele commita).

O [roteiro UAT da segunda rodada](docs/uat-rodada-2.md) contém 19 casos por épico, resultados observados, defeitos corrigidos e o aceite externo ainda pendente. A regressão automatizada não substitui o login real pelo Composio nem as jornadas de linguagem natural no navegador.

## O que existe

Um pacote TypeScript (ADR-018) no esqueleto herdado da Leapy (`docs/inherited-from-leapy.md`): `src/{domain,contracts,shared,db,repositories,services,use-cases,adapters/{http,fundo,executor,mcp-proxy},obs}`, `web/`, `tests/`. Provado por teste contra o Postgres real:

- **Fundação (L1):** migrações SQL puras (0001–0004) com RLS por PESSOA em toda tabela — desde a 0004, quatro policies PERMISSIVE por comando (`nod_pessoa_select` abre dono/'equipe'/perna extra; `insert`/`update`/`delete` só a dona) + a RESTRICTIVE do tenant; trilha imutável por trigger + CHECK; `events` particionada por mês sem catch-all; outbox transacional; gates de conformidade lendo o catálogo; log JSON único; CI em três jobs.
- **Contratos e domínio (L2):** nove ferramentas nod (`lembrar`, `atualizar_perfil`, `pedir_acesso`, `criar_rotina`, `pedir_aprovacao`, `pedir_a_pessoa`, `passar`, `encaminhar`, `perguntar_a_bot`), plano de turno (ADR-024), classificação de falha por estado de protocolo (ADR-009), orçamento de canal, rodada de sala, tudo puro em `src/domain`.
- **Executor (L4):** driver `claude-cli` real (`-p` + stream-json, `--session-id`/`--resume`, `--tools ""` + `--allowedTools` do plano, `--strict-mcp-config`, mcp.json 0600 em tmpdir por turno, env com denylist, SIGTERM→SIGKILL) e driver `catcher` no mesmo SPI; sonda de três estados (ADR-019); registry sombra; laço puxar → rodar → renovar → entregar.
- **Proxy MCP, plano, conectores, aprovação (L5):** o único servidor MCP que o CLI enxerga consome só o plano; conectores = servidores MCP registrados pela pessoa, sondados, com env cifrado no servidor; concessão por bot e por capacidade com mensagem de consentimento imutável; aprovação em **lista tipada** (item a item, sensível nasce desmarcado).
- **Bots, conversa, fila e Parar (L6):** criação com perfil confirmado pelo formulário ou conversacional ('Novo agente' até a proposta confirmada), perfil, memória, Pin/Hide/Duplicate, fila de turnos no Postgres (SKIP LOCKED, lease, quatro estados), Parar com faixa e SIGTERM em < 2 s, retomada sempre por turno novo.
- **Rotinas, salas, bot-a-bot (L7):** rotina por formulário ou texto (cron + fuso IANA) → proposta → decisão; teste imediato, pausa e histórico; scheduler com janela única; gate de aprovação; salas de 2–6 bots com grant por membro, @menção, handoff/passe tipados, orçamento do canal; `perguntar_a_bot` de um salto com conteúdo não confiável.
- **SSE, outbox, Sua vez, métricas (L8):** frames numerados por pessoa com contrato de resume, despachante do outbox, "Sua vez" sob RLS de duas pernas (vencido em cinza, reabrir), seis métricas em `/metrics`.
- **Integração e web (L9):** `compor.ts` + `boot.ts` ligam tudo; rotas de decisão (`decidir` para sete tipos, `responder`, `retomar`) e inventário; web em vanilla TS com render por regiões e reducer por frame (`web/`); e2e com catcher e roteiro com haiku.

## Custo

Dev e CI: **zero** — o catcher é o default. Agentes novos usam `sonnet` (configurável por `NOD_MODELO`); sondas usam Haiku (`NOD_MODELO_SONDA`). Todo turno mantém `--strict-mcp-config --tools ""` e ambiente limpo. Custos históricos medidos com **Haiku**, não estimativas de Sonnet, em 2026-09-16: ~US$ 0,02 por turno com MCP, ~US$ 0,003 por resume, ~US$ 0,01 por sonda. O roteiro `e2e:haiku` custou **US$ 0,1131** na rodada única de 2026-09-16 (1 sonda US$ 0,0129 + 8 turnos US$ 0,1001; detalhe no cabeçalho do script) — meta era < US$ 0,50. O custo de cada turno é gravado em `gastos` (ADR-015) e aparece em `GET turnos/:id`.

## O que NÃO existe (registrado)

- **Escala com múltiplas réplicas de servidor**: a ponte HTTP existe em `NOD_MODO=compartilhado`, mas tokens de turno e conexões continuam em memória; use uma instância.
- **Mobile / PWA / updater automático** — o desktop Electron verifica versão mínima, sem atualização automática. Windows ainda não foi validado.
- **Computador por bot, driver remoto, browser** (ADR-028); **skills por demonstração**; skills por instrução (nomeadas, `/`) também ficaram fora desta rodada (EMENDA 24).
- **OAuth real / credencial de colaborador com health-check** (ADR-015 revisado): conector é MCP registrado com env cifrado só no servidor. **Procuração entre donos** tem tabela e regra fail-closed, sem rota nem UI.
- **Cadastro autônomo**: o login Google usa allowlist previamente cadastrada (ADR-030). Para desenvolvimento local, `NOD_LOGIN=stub` usa cookie assinado e recusa `NOD_HOST` fora de 127.0.0.1.
- **Execução de rotina "em curso"**: `DesfechoRotina` não tem `pendente` — `rotina_execucoes` só ganha linha ao assentar; o "em curso" é a janela com `turno_id` (EMENDA-L9 §5, registrado).
- **Executor de servidor**: `custo_servidor_mes` é 0 por construção; `gastosRepo.somarMes(agora, executor)` já filtra para o dia em que existir.
- **GitHub pelo gh no modo compartilhado** (ADR-047): o conector `github` roda no processo do servidor, então no `NOD_MODO=compartilhado` o jeito gh nunca é usado (App da organização → Composio → token). Rodar o conector no Mac pediria um verbo novo na ponte. A tela do GitHub App só cadastra: não mostra se o tenant já tem App, e só quem cadastrou troca.
- Deliberadamente fora (lista NÃO CONSTRUIR dos ADRs): policy só por tenant, store JSON, cache de catálogo, endpoint síncrono de decisão, heartbeat, requeue automático, regex de intenção, DELETE em teste fora de concurrency, seed no CI, SDK MCP, workspaces.

## Desvios registrados

- **Aprovação em lista tipada** segue a spec E4.1 (P0), não o corte "binária nesta rodada" de core-features (EMENDA 23).
- **Perfil na criação:** `POST agentes {dono, nome?, titulo?, descricao?}` — nome e descrição confirmam o perfil diretamente (ADR-032); sem eles, o modelo propõe pelo `atualizar_perfil` (EMENDA 17). Organização/membership: fora (um tenant).
- **Dois eixos de profundidade:** `profundidade` 0|1 de peer e `HANDOFFS_POR_RODADA = 3` — o quarto `encaminhar` na mesma rodada vira passe `teto_canal` (EMENDA 14).
- **Anel de bots (EMENDA-L9 §6):** o domínio RECUSA o anel A→B→C no terceiro remetente distinto (negação escrita, terminal), em vez de "resfriar no quarto post" da spec E5.5 — esperar o quarto post seria deixar o anel fechar uma vez.
- **Cron com minuto e hora fixos:** o domínio recusa `* * * * *` (Regra 9); o aceite adianta `proxima_execucao` em vez de trocar o cron.
- **E2E commita** (laços reais, SSE, sessão), por isso mora em `tests/concurrency/e2e-catcher.test.ts` e não em `tests/integration` como o plano nomeava — é a definição do terceiro modo, e a única pasta onde limpeza por id é permitida. A `trilha` é imutável por desenho: as linhas do e2e (de uma pessoa aleatória) ficam.
- **Ids fora de uuid:** no path → 404 (roteador); no corpo → 400 `entrada_invalida` (22P02 traduzido) — nunca 500 (EMENDA-L9 §2). **`/metrics`** responde na raiz e em `/api/metrics` (§3).
- **Histórico da branch:** L1, L3.5, L4 e L7 têm mais de um commit (EMENDA 31) porque o loop de verificação pedia commit novo; não houve squash — o histórico conta o processo de verificação. A L9 tem um commit por passo (composição, pendências, web, e2e, docs).

## Onde ler mais

- [AGENTS.md](AGENTS.md): comandos, as regras que o código trava, desvios.
- [docs/adr/](docs/adr/): 32 decisões com gatilho de reversão; refinamentos datados (0003, 0004) em ADR-003 e ADR-007.
- [docs/product-spec.html](docs/product-spec.html), [docs/core-features.md](docs/core-features.md), [docs/internal-first.md](docs/internal-first.md), [docs/inherited-from-leapy.md](docs/inherited-from-leapy.md), [docs/spikes/serializacao-do-turno.md](docs/spikes/serializacao-do-turno.md).
- Protótipos: [`prototypes/fleet-is-home.html`](prototypes/fleet-is-home.html) (referência histórica), [`prototypes/private-agents-minimal.html`](prototypes/private-agents-minimal.html).

Gestão completa de agentes: menu na lista e no chat, organização em seções, leitura, perfil/avatar,
cópia, ocultos e exclusão recuperável. [Roteiro de aceite](docs/uat-gestao-agentes.md) e
[decisão de ciclo de vida](docs/adr/adr-034-gestao-e-exclusao-recuperavel-de-agentes.md).
`npm run uat:gestao` repete a regressão dedicada. Atualize o banco com `npm run db:migrate` antes de iniciar.

Computadores dos bots: [configuração, casos de uso e limites](docs/computadores.md).
