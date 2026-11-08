# ADA-14 · Bot com N quadros: projetos, navegação entre quadros e quadro compartilhado entre bots

Plano de engenharia (Xumbrega, 2026-11-07). Tarefa ADA-14 do quadro do Marlon. Origem: comentários #295/#296 no
protótipo da ADA-2 (https://gamefik.github.io/nod-prototipos/ada-2/#j3-2/proposta). Base: refs do Multica (projetos,
detalhe do projeto, menu de navegação) e Projects do Linear.

**Meta:** tudo o que a tela faz, qualquer bot faz pela conversa. Um bot passa a ter vários quadros, soltos ou em projetos,
troca entre eles dentro do app Quadro, e um quadro pode aparecer em mais de um bot.

**Já decidido (não reabrir):** abrir o quadro e trocar entre apps do bot (Conversa, Quadro, Canvas…) é sempre pela
pílula do bot, com os gestos da ADA-8. Escolher qual quadro/projeto abrir é um passo dentro do app Quadro.

Lentes aplicadas: revisão de engenharia (arquitetura, dados, concorrência, testes), de DX (contrato do `gerir_quadro` e
das rotas), de design (seletor, estados, mobile) e a regra de paridade `/acao-no-chat` (seção Ações).

---

## 0. O que existe hoje (lido no código, origin/main 316340a7)

| Peça | Onde | Hoje |
| --- | --- | --- |
| Quadro | `quadros` (0133) | `agente_id NOT NULL` + **`quadros_um_por_agente` UNIQUE (tenant_id, agente_id)**. Sem nome. Meta/prazo opcionais (0136, ADR-141), colunas jsonb (0134, ADR-140, passagem ADR-142), `prefixo` por quadro (0137, ADR-144), `modo_conversa` (0146, ADR-143). |
| Repo | `src/repositories/quadros.repo.ts` | `doAgente(agenteId)` (1 linha), `criar` com `on conflict (tenant_id, agente_id) do nothing`, `listar()` (todos da pessoa). |
| Achar o quadro | `acharQuadro` em `src/use-cases/quadro.ts:206` | id do quadro **ou** id/nome do bot → `doAgente`; sem ref: o da tarefa do turno, senão o do autor, senão o único. ~15 chamadas a `doAgente` em use-cases (`quadro.ts`, `comentar-tarefa.ts`, `quadro-execucoes.ts`, `quadro-pessoas.ts`, `apps-do-bot.ts`). |
| Rotas | `src/adapters/http/rotas/quadro.ts` | ~35 rotas `…/agentes/:id/quadro/…` (o bot é a chave do quadro) + `/quadros`, `/quadros/compartilhados`, `/quadros/:qid/…` (porta da dona, ADR-143). |
| Ferramenta | `src/contracts/ferramentas-quadro.ts` | `gerir_quadro {quadro?, acoes[]}`; `quadro` = id ou nome do bot anfitrião. 28 tipos de op. |
| Registro | `src/domain/acoes/quadro.ts` | 27 ids `quadro.*`. |
| App na pílula | `src/use-cases/apps-do-bot.ts` (ADR-146) | a página `tarefas` aparece quando `quadros.doAgente(bot)` existe. |
| Código da tarefa | ADR-144 | prefixo **já é do quadro** (`quadros.prefixo`, único por dona), derivado do nome do bot anfitrião. |
| Aviso de risco | `src/use-cases/avisos-quadro.ts` | sai na conversa do responsável único ou do `q.agenteId`. |
| Exibir por quadro | `preferencias.quadro_exibir` (0149) | já chaveado por id de quadro. |

Conclusão: a tarefa, o código, as colunas, a passagem, os membros e o Exibir já são **por quadro**. O que amarra "1 bot = 1
quadro" é: o índice único, o `doAgente`, a URL `/agentes/:id/quadro`, o `acharQuadro` por nome de bot e a página
`tarefas`. O plano troca esse eixo sem mexer no motor do lote (`aplicarLoteQuadro`/`planejarLote`).

---

## 1. Arquitetura

```
Pílula do bot (ADA-8) ── app Quadro (página `tarefas`, uma só por bot)
                              │
                              ├─ seletor no título: [Projeto ▸] Quadro ▾   ← novo (web)
                              │      lista os quadros VINCULADOS ao bot, agrupados por projeto
                              │
                              └─ quadro aberto = ?quadro=<qid> nas rotas de sempre
                                         │
servidor:  resolverQuadroDoBot(bot, qid?) ─┬─ qid dado → confere quadro_bots(qid, bot) (senão 404)
                                           └─ sem qid  → o padrão do bot (quadro_bots.padrao)
                                         │
                              aplicarLoteQuadro (inalterado: trava o quadro por id)
```

- **Quadro ↔ bot passa a ser N:N** pela tabela `quadro_bots` (quais bots mostram o quadro na pílula). `quadros.agente_id`
  fica como **bot dono** (o anfitrião: dá o prefixo inicial, recebe o aviso de risco quando não há responsável único e
  é o nome que o `remover_quadro` confere). Ele também é sempre uma linha de `quadro_bots`.
- **Projeto** é uma entidade da **pessoa** (não do bot), como no Linear: um quadro está em 0 ou 1 projeto. No seletor de um
  bot aparecem só os projetos que têm pelo menos um quadro vinculado a ele.
- **Quadro padrão do bot** = `quadro_bots.padrao` (um por bot, índice parcial). **Último aberto** = preferência da pessoa
  por bot (`preferencias.quadro_aberto {agenteId: quadroId}`), como o `quadro_exibir`.
- Nenhum caminho novo fora da pílula: a página `tarefas` continua uma só; o que muda é o que ela mostra.

## 2. Módulos

| Camada | Arquivo | Mudança |
| --- | --- | --- |
| Domínio puro | `src/domain/quadros-do-bot.ts` (novo) | `quadroAoAbrir(ultimo, padrao, vinculados)`, `proximoPadrao(vinculados)`, `validarNomeQuadro`, `validarProjeto` (nome 1–60 único sem acento/caixa por pessoa; meta ≤200; prazo), `agruparPorProjeto`, `progressoDoProjeto`. |
| Domínio | `src/domain/codigo-tarefa.ts` | `prefixoDoNome` passa a receber o nome do **quadro** (o bot só na migração e quando o quadro nasce sem nome). |
| Contratos | `src/contracts/quadro.ts`, `src/contracts/projeto.ts` (novo) | `Quadro` ganha `nome`, `projetoId`, `bots: {agenteId, padrao}[]`; `QuadroResumoDto` (seletor); `ProjetoDto`; ops novas (§4). |
| Repo | `quadros.repo.ts`, `projetos.repo.ts` (novo) | sai `doAgente` (vira `padraoDoBot` + `doBot(agenteId, qid)` + `vinculadosAo(agenteId)`); `criar` sem `on conflict` por bot; `vincular/desvincular/definirPadrao`; CRUD de projeto. |
| Casos de uso | `src/use-cases/quadro.ts` | `acharQuadro` resolve nome do quadro, prefixo, id, nome do bot (→ padrão) e `bot/quadro`; ops novas no `planejarLote` só onde é lote (renomear/projeto entram no lote com Desfazer; vincular/padrão também). |
| Casos de uso | `src/use-cases/acoes/projetos.ts` (novo) | executor único de `projeto.*`. |
| Porta | `src/db/porta-da-dona.ts` | sem mudança de regra: já é por `quadro_id`. |
| Rotas | `rotas/quadro.ts`, `rotas/projetos.ts` (novo) | `?quadro=` em todas as `/agentes/:id/quadro…`; `GET /agentes/:id/quadros` (seletor); rotas de projeto (§4). |
| Pílula | `src/use-cases/apps-do-bot.ts` | `tarefas` aparece quando `vinculadosAo(bot).length > 0`. |
| Web | `web/telas/seletor-de-quadro.ts` (novo), `quadro-real.ts`, `quadro-dados.ts`, `web/lib/api.ts` | seletor (desktop popover, mobile folha), `qid` em todas as chamadas, último aberto. |
| Prompt | `src/use-cases/emitir-plano-turno.ts` | "Os quadros deste bot" (nome, código, projeto, padrão) em vez de "o quadro". |

## 3. Dados e migrações

Uma migração **só aditiva + troca de índice**, `0152_quadros_por_bot.sql` (ou o próximo número livre no merge):

```sql
SET LOCAL lock_timeout = '5s';

CREATE TABLE projetos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  nome_chave text NOT NULL CHECK (length(nome_chave) BETWEEN 1 AND 60),
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 2000),
  meta text CHECK (meta IS NULL OR length(meta) BETWEEN 1 AND 200),
  prazo date,
  posicao integer NOT NULL DEFAULT 0,
  arquivado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('projetos');
ALTER TABLE projetos ADD PRIMARY KEY (tenant_id, id);
CREATE UNIQUE INDEX projetos_um_por_nome ON projetos (tenant_id, owner_id, nome_chave) WHERE arquivado_em IS NULL;

ALTER TABLE quadros ADD COLUMN nome text CHECK (nome IS NULL OR length(nome) BETWEEN 1 AND 60);
ALTER TABLE quadros ADD COLUMN projeto_id uuid;
ALTER TABLE quadros ADD FOREIGN KEY (tenant_id, projeto_id) REFERENCES projetos (tenant_id, id) ON DELETE SET NULL (projeto_id);
CREATE INDEX quadros_do_projeto ON quadros (tenant_id, projeto_id) WHERE projeto_id IS NOT NULL;

CREATE TABLE quadro_bots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quadro_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  padrao boolean NOT NULL DEFAULT false,
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('quadro_bots');
ALTER TABLE quadro_bots ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE quadro_bots ADD FOREIGN KEY (tenant_id, quadro_id) REFERENCES quadros (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE quadro_bots ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX quadro_bots_unico ON quadro_bots (tenant_id, quadro_id, agente_id);
CREATE UNIQUE INDEX quadro_bots_um_padrao ON quadro_bots (tenant_id, agente_id) WHERE padrao;
CREATE INDEX quadro_bots_do_bot ON quadro_bots (tenant_id, agente_id, posicao);

-- Migração do quadro único → padrão: todo quadro de hoje vira o padrão do seu bot, sem tocar nas tarefas.
INSERT INTO quadro_bots (tenant_id, owner_id, quadro_id, agente_id, padrao, posicao)
  SELECT tenant_id, owner_id, id, agente_id, true, 0 FROM quadros;

ALTER TABLE preferencias ADD COLUMN quadro_aberto jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(quadro_aberto) = 'object');

-- O índice "um por bot" sai por ÚLTIMO (depois do backfill): ver "Deploy em duas fases".
```

**Deploy em duas fases (azul/verde, ADR do deploy):**

1. **PR (este):** a 0152 cria tudo e faz o backfill, **mas mantém `quadros_um_por_agente`**. O servidor novo já lê
   `quadro_bots`, mas o `criar_quadro` de um 2º quadro do mesmo bot fica atrás da flag `NOD_QUADROS_N`
   (`desligado|admins|todos`, padrão `admins` em produção, como a `NOD_QUADROS`). Com a flag desligada nada muda para
   ninguém. O servidor antigo segue funcionando: não lê as tabelas novas e o `on conflict (tenant_id, agente_id)` dele
   continua válido.
2. **Mesmo PR, migração 0153 separada** (`0153_quadros_sem_um_por_agente.sql`), aplicada só depois de o servidor novo
   estar 100% no ar (o runbook já roda migrações antes da troca; por isso ela tem guarda): `DROP INDEX
   quadros_um_por_agente` + `CREATE INDEX quadros_do_agente ON quadros (tenant_id, agente_id)`. Até a 0153 rodar, o 2º
   quadro recusa com `um_por_bot_ainda` (mensagem clara), sem quebrar nada.
   - Alternativa se o runbook não aceitar migração pós-troca: a 0153 vai num PR de 3 linhas logo depois do deploy deste.
     **Isso não fere "1 PR por issue"**: é o passo de limpeza do deploy, registrado aqui. (Suposição S9.)

**Gatilho do quadro em quadro_bots:** a linha do dono é gravada pelo próprio `criar` do repo (mesma transação). Para o
servidor antigo durante a troca (que cria quadro sem `quadro_bots`), o leitor novo trata "quadro sem linha em
`quadro_bots`" como vinculado ao `agente_id` e padrão se o bot não tiver outro, e o próximo lote grava a linha
(mesma tática do `numero` nulável da ADR-144).

**Nome dos quadros migrados:** `nome = NULL` = "Tarefas" na tela e no chat (o nome da página de hoje). Nada é
reescrito; a pessoa renomeia quando quiser. O prefixo fica o que já é.

**ROLLBACK** (no fim de cada arquivo): 0153 recria `quadros_um_por_agente` **só se** nenhum bot tiver 2+ quadros (o
ROLLBACK tem a query que lista quem tem; se houver, mover/remover antes). 0152 dropa `quadro_bots`, `projetos`, as
colunas novas e `quadro_aberto`; nada de tarefa se perde.

## 4. APIs

### 4.1 Rotas

- **Todas as `/agentes/:id/quadro…` ganham `?quadro=<qid>`** (opcional). Sem ele: o padrão do bot (compatível com a web
  de antes e com o app do Mac antigo). Com ele: o servidor confere `quadro_bots(qid, :id)`; se o quadro não está
  vinculado ao bot → `404 nao_encontrado` (não vaza). Nenhum id de ação muda: `Rota.acao` é o mesmo, então a catraca de
  paridade não precisa de rota duplicada.
- `GET /agentes/:id/quadros` → `{ quadros: QuadroResumoDto[], projetos: ProjetoDto[], aberto: qid|null, padrao: qid|null }`
  (o seletor; leitura, sem ação).
- `PUT /agentes/:id/quadros/aberto {quadro}` → grava o último aberto (ação `quadro.abrir`, §8).
- `POST /agentes/:id/quadros/:qid/vinculo` / `DELETE …/vinculo` (ação `quadro.vincular_bot` / `quadro.desvincular_bot`).
- `PUT /agentes/:id/quadros/:qid/padrao` (ação `quadro.definir_padrao`).
- `GET /projetos`, `POST /projetos`, `PATCH /projetos/:pid`, `DELETE /projetos/:pid` (arquivar), `POST /projetos/:pid/restaurar`.
- `GET /quadros` (já existe) passa a trazer `nome`, `projetoId`, `bots`.
- `POST /agentes/:id/quadro` (`quadro.criar`) aceita `{nome?, projeto?, meta?, prazo?}`; o 1º quadro do bot nasce padrão.
- `PATCH /agentes/:id/quadro?quadro=` (`quadro.editar`) aceita `nome` e `projeto` (null tira do projeto).

### 4.2 `gerir_quadro`

- `quadro` (topo) passa a aceitar, nesta ordem: id do quadro → código/prefixo (`ZE`) → **nome do quadro** → `"Bot/Quadro"` →
  nome do bot (= o quadro padrão dele). Ambíguo → erro `quadro_ambiguo` com a lista `{nome, prefixo, bots}` para o bot
  perguntar. Sem `quadro`: o da tarefa do turno → o **aberto** do bot autor (se a pessoa está nele) → o padrão do autor →
  o único da pessoa. A descrição diz isso em uma linha.
- Ops novas (todas no lote, com Desfazer, salvo onde dito):
  - `criar_quadro {nome?, projeto?, meta?, prazo?, bots?}` — `bots` = outros bots onde aparece (o autor sempre entra).
  - `editar_quadro {nome?, projeto?, meta?, prazo?}` — renomear e pôr/tirar de projeto.
  - `listar_quadros {}` — leitura: os quadros do bot (ou da pessoa com `todos: true`), por projeto, com o aberto e o padrão.
  - `abrir_quadro {quadro}` — troca o quadro que a tela do bot abre (grava o último aberto e manda `quadro.aberto` à
    tela, que troca se o app Quadro desse bot estiver aberto). Sozinho, sem Desfazer (abrir de novo é o desfazer).
  - `definir_padrao {quadro}`; `vincular_bot {quadro, bot}`; `desvincular_bot {quadro, bot}`.
  - `criar_projeto {nome, descricao?, meta?, prazo?}`, `editar_projeto {projeto, nome?, descricao?, meta?, prazo?}`,
    `arquivar_projeto {projeto}` (os quadros ficam, soltos), `restaurar_projeto {projeto}`.
    Projeto não é de um quadro: essas ops ignoram `quadro` e rodam num lote de projeto (`projeto_lotes` **não** —
    Desfazer de projeto é o inverso explícito: arquivar ↔ restaurar, editar ↔ editar com o antes que o recibo devolve).
- O resultado de toda op traz `quadro: {id, nome, prefixo}` para o bot citar certo.

### 4.3 DX (quem integra: bots e a web)

- Uma regra só para "qual quadro": `resolverQuadro` no servidor; a web sempre manda `?quadro=` explícito, o bot
  quase nunca precisa (o padrão/aberto resolve).
- Erros tipados e com frase: `quadro_ambiguo`, `quadro_fora_do_bot`, `ultimo_quadro_do_bot` (desvincular o único quadro
  do dono: use `remover_quadro`), `projeto_nome_em_uso`, `um_por_bot_ainda` (fase 1), `limite_de_quadros` (50 por bot,
  200 por pessoa — S10).

## 5. Bordas e erros

| Caso | Comportamento |
| --- | --- |
| Bot sem quadro abre a pílula | sem página `tarefas` (igual hoje). |
| Último aberto foi removido / desvinculado | cai no padrão; preferência limpa no próximo GET. |
| Remover o quadro **padrão** com outros vinculados | o próximo (posição, depois mais recente) vira padrão na mesma transação. |
| Remover o **último** quadro do bot | o bot volta a agente comum (ADR-141 §4, igual hoje). |
| Desvincular o bot **dono** | recusado se ele é o único vínculo (`ultimo_quadro_do_bot`); com outros, o dono passa ao próximo vínculo (posição) no mesmo lote, e o prefixo NÃO muda. |
| Excluir o bot dono (`gerir_bots`/tela) | antes do soft-delete, quadros com outros vínculos passam o dono ao próximo; os que só têm ele seguem a regra de hoje. Hard delete (FK CASCADE): o caso de uso transfere antes de apagar. |
| Quadro compartilhado entre bots: passagem por coluna | inalterada (já aponta qualquer bot da pessoa). Vincular não muda passagem nem responsável. |
| Turno de tarefa no bot B de quadro do dono A | `doTurno` já acha o quadro pela tarefa; sem mudança. |
| Duas abas: uma renomeia, outra move tarefa | lote trava o quadro por id (igual hoje). |
| Arquivar projeto com quadros | quadros ficam, `projeto_id` mantido mas o seletor os mostra em "Sem projeto" com marca "(projeto arquivado)"; restaurar volta. Excluir de vez projeto = follow-up. |
| Quem participa (ADR-143) | vê o quadro compartilhado pelo id (`/quadros/:qid`), sem o seletor de bots da dona. |
| `mover_quadro` de tarefa | destino agora pode ser qualquer quadro (inclusive do mesmo bot); a resolução usa o mesmo `resolverQuadro`. |
| Flag `NOD_QUADROS_N` desligada | `criar_quadro` em bot que já tem quadro → `experimento_desligado`; tudo o mais lê igual. |

## 6. Concorrência

- **Criar quadro:** advisory dos prefixos (já existe, ADR-144) → insert quadro + linha do dono em `quadro_bots`; o 1º do bot
  ganha `padrao` (o índice parcial `quadro_bots_um_padrao` segura duas criações simultâneas: a perdedora tenta de novo
  sem `padrao`).
- **Definir padrão / vincular / desvincular / remover:** `select … from quadro_bots where agente_id = $bot for update`
  (todas as linhas do bot) antes de trocar; ordem fixa: quadro (por id) → linhas do bot (por id). Mesma ordem do lote,
  então sem deadlock com `aplicarLoteQuadro`.
- **Remover quadro x abrir pela tela:** o GET do seletor tolera quadro sumido (404 → recarrega a lista e cai no padrão).
- **Exclusão de bot x vincular:** a transferência de dono trava as linhas do bot e os quadros dele em ordem de id.
- Teste em `tests/concurrency/quadros-por-bot-corrida.test.ts`: duas criações do 1º quadro, padrão x remover, desvincular x
  lote.

## 7. Testes

- **Unit (domínio puro):** `quadros-do-bot.test.ts` (quadro ao abrir; próximo padrão; nome/projeto válidos; agrupamento;
  progresso do projeto), `codigo-tarefa.test.ts` (prefixo do nome do quadro, colisão).
- **Integração:** migração 0152 num banco com quadros de antes (todos viram padrão, tarefas/código/colunas iguais,
  contagem antes = depois); `resolverQuadro` (todas as formas do `quadro`, ambiguidade, fora do bot = 404); rotas com e sem
  `?quadro=`; `apps-do-bot` (página `tarefas` com 0, 1, N quadros; bot só vinculado); remover padrão/último;
  desvincular dono; excluir bot dono com vínculo; RLS (`projetos`, `quadro_bots` de outra dona invisíveis); porta da dona
  com quadro de 2 bots.
- **Contrato de ações:** cada id novo pela rota e pelo `gerir_quadro` chega ao mesmo estado (o teste de contrato do
  registro), `npm run paridade` atualiza `docs/paridade.md`, piso sobe.
- **Fuzz:** `src/domain/fuzz/gerador.ts` ganha as ops novas (o `fuzz-acoes` já cobre `quadro.*`).
- **Web:** `seletor-de-quadro` (teclado: ↑↓ Enter Esc, `aria-expanded`, foco volta ao título; mobile folha), troca sem
  sair do app Quadro, URL `?quadro=` do link de tarefa abre o quadro certo.
- **E2E/QA (stub):** criar 2º quadro pelo chat, trocar pela tela e pelo chat, projeto com 2 quadros, quadro em 2 bots
  aparecendo nas duas pílulas, quadro antigo intacto.

## 8. Ações

Paridade (`/acao-no-chat`, ADR-135). Tudo no mesmo PR: registro em `src/domain/acoes/quadro.ts` e
`src/domain/acoes/projetos.ts` (novo, no spread de `REGISTRO_DE_ACOES` em `src/domain/acoes/index.ts`), `Rota.acao` em
`rotas/quadro.ts` e `rotas/projetos.ts`, executor único em `src/use-cases/acoes/quadro.ts` / `projetos.ts` (tabela id →
executor, chamada pela rota e pela ferramenta), ferramenta `gerir_quadro` (todo bot, por `FERRAMENTAS_NOD_POR_MODO`,
schema em `src/contracts/ferramentas-quadro.ts`), teste de contrato por id, piso em `docs/paridade.piso.json` e `npm run
paridade`.

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| `quadro.criar` (muda) | agora cria o 2º+ quadro, com nome/projeto/bots | muda | não | vivo | todos |
| `quadro.editar` (muda) | + renomear e pôr/tirar de projeto | muda | não | vivo | todos |
| `quadro.abrir` (nova) | troca o quadro que o app Quadro do bot abre | leitura | não | vivo | todos |
| `quadro.definir_padrao` (nova) | quadro padrão do bot | muda | não | vivo | todos (turno limpo) |
| `quadro.vincular_bot` (nova) | o quadro aparece na pílula de outro bot | muda | não | vivo | todos (turno limpo) |
| `quadro.desvincular_bot` (nova) | tira o quadro da pílula de um bot | muda | não | vivo | todos (turno limpo) |
| `quadro.remover` (muda) | remove UM quadro (pelo nome do quadro); regra do padrão/último | arriscada | sim | vivo | todos (igual hoje: card `quadro_exclusao`) |
| `projeto.criar` | cria projeto | muda | não | vivo | todos |
| `projeto.editar` | nome, descrição, meta, prazo | muda | não | vivo | todos |
| `projeto.arquivar` | arquiva (quadros ficam soltos) | muda | não | vivo | todos |
| `projeto.restaurar` | desfaz o arquivar | muda | não | vivo | todos |
| `quadro.listar` | — | — | — | — | leitura sem rota de pessoa nova (GET): fica fora do registro, entra como op `listar_quadros` |

- `quadro.abrir` é `leitura` de propósito: só grava uma preferência de tela da própria pessoa, sem efeito no quadro; sem
  card em modo nenhum. Não é "estado de tela" puro (fica no servidor, vale em todos os aparelhos), por isso entra vivo.
- Corte de confiança igual ao das colunas (ADR-140 §5, emenda NOD-430): `definir_padrao`, `vincular_bot`,
  `desvincular_bot`, `editar_quadro {projeto}` e `arquivar_projeto` só num turno da pessoa limpo; no limite **normal**
  (tarefa, rotina, colega, conteúdo de fora) o bot só lê (`listar_quadros`) e cria tarefa, como hoje.
- **Como a pessoa pede:** "cria um quadro Marketing pra Ada, no projeto Lançamento"; "abre o quadro de Compras";
  "quais quadros a Ada tem?"; "põe o quadro Site também no Gil"; "renomeia o quadro Tarefas da Ada pra Operação".
- Critério fixo: Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com
  o cartão que o risco e o modo pedem.

## 9. UI (lente de design)

- **Desktop:** no topo do app Quadro, o título vira botão `Projeto › Quadro ▾` (só `Quadro ▾` se solto; só `Tarefas` sem
  seta quando o bot tem 1 quadro e nenhum projeto — nada muda para quem não usa). Abre popover ancorado (≤ 360 px):
  busca no topo (aparece com 6+ quadros), grupos por projeto (recolhíveis, contagem), "Sem projeto", o padrão com marca
  discreta "padrão", o aberto com ✓; no pé: "+ Novo quadro", "+ Novo projeto". "…" em cada linha: Renomear, Mover para
  projeto, Tornar padrão, Mostrar também em… (bots), Remover. Atalho: ⌘K não (é da busca); `⌥↑/⌥↓` não (ADA-8 usa as setas
  com ⌥ para páginas) — o seletor abre com Enter/Espaço no título e `g q` não entra (S11).
- **Mobile:** o mesmo título abre uma **folha de baixo** (bottom sheet, alvo ≥ 44 pt, alça, fecha puxando), com a mesma
  lista. Sem drawer nem hambúrguer (lição do Multica: navegação longe do polegar). Os gestos da pílula (ADA-8) seguem
  intocados: a folha não usa swipe horizontal.
- **Projeto:** tocar no nome do projeto no seletor mostra o resumo do projeto (meta, prazo, progresso só com meta, os
  quadros dele) na própria folha/popover, não uma página nova — a visão geral **antes** do board (o Multica erra isso).
- **Estados:** vazio (bot com 1 quadro: sem seletor), erro de carregar a lista (linha "Não deu para carregar os quadros ·
  Tentar de novo"), quadro removido enquanto aberto (aviso inline "Esse quadro foi removido. Abrindo o padrão.").
- **Pede o Gil:** protótipo do seletor (desktop + mobile) e do resumo do projeto antes de implementar a UI (o servidor
  e o chat podem seguir antes).

## 10. Riscos

1. **Troca do índice único em produção** (alto): o servidor antigo usa `on conflict (tenant_id, agente_id)`. Mitigado
   pelas duas fases (0152 mantém o índice; 0153 só depois da troca) e pela flag.
2. **~15 chamadas a `doAgente`** espalhadas (médio): trocar uma esquecida faz a ação cair no padrão em vez do aberto.
   Mitigação: `doAgente` some do repo (não compila), e cada chamada escolhe `padraoDoBot` ou `doBot(bot, qid)` explícito.
3. **Exclusão do bot dono apagar quadro compartilhado** (alto): FK CASCADE em `quadros.agente_id`. Mitigado pela
   transferência de dono antes de excluir + teste.
4. **Ambiguidade de nome no chat** (médio): "Tarefas" é o nome de todos os migrados. A resolução prefere nome do bot →
   padrão, e o erro `quadro_ambiguo` devolve a lista com `Bot/Quadro`.
5. **Escopo grande para 1 PR** (médio): ~2–3 mil linhas com testes. Mitigado pela ordem dos commits (servidor e chat
   primeiro, UI por último atrás da flag), PR único.
6. **Prompt maior** (baixo): lista de quadros por bot limitada a 20 no prompt, com "e mais N" e `listar_quadros`.

## 11. ADR

**Nova ADR-153 — "Quadro ↔ bot é N:N; projeto é da pessoa"** (rascunho em `docs/adr/adr-153-quadros-por-bot-e-projetos.md`
neste PR). Revisa a decisão da 0133 ("um quadro por bot anfitrião") e emenda a ADR-141 §4 (remover = um quadro; o bot
volta a comum só no último), a ADR-144 §2 (prefixo do nome do quadro) e a ADR-146 §2 (a página `tarefas` existe com ≥ 1
quadro vinculado; continua uma só e conta 1 no limite de 12).

## 12. Suposições para a Ada (produto) e o Gil (design) — sigo com elas até alguém dizer o contrário

- **S1 (projeto):** projeto é agrupador **da pessoa** com descrição, meta e prazo opcionais. Progresso só com meta:
  Feito ÷ (total − Fechado) somando os quadros dele (mesma regra do quadro, ADR-141). Sem aviso de risco de projeto
  nesta issue (follow-up). Sem status manual tipo "Planned/In progress" do Linear.
- **S2 (seletor e padrão):** seletor no título do app Quadro (popover no desktop, folha no mobile). Ao abrir pela pílula:
  o último aberto **naquele bot** (guardado no servidor, vale em todos os aparelhos), senão o padrão do bot. Com 1 quadro
  e sem projeto, a tela fica como hoje (sem seletor).
- **S3 (vários bots):** um quadro tem **um bot dono** (o que criou; dá o prefixo inicial e recebe o aviso de risco sem
  responsável único) e pode aparecer em outros bots (`vincular_bot`). Ele aparece na pílula (app Quadro) de **todos os
  bots vinculados**. Passagens por coluna não mudam (já apontam qualquer bot). **Prefixo é do quadro**, tirado do nome do
  quadro quando nasce, fixo depois (renomear não muda). Se o dono sai, o próximo vínculo vira dono, sem mudar o prefixo.
- **S4 (chat):** criar, listar, renomear, abrir/trocar, tornar padrão, vincular/desvincular bot, criar/editar/arquivar
  projeto, tudo pelo `gerir_quadro`; `quadro` aceita id, prefixo, nome do quadro, `Bot/Quadro` ou nome do bot (padrão).
  "Abrir" pelo chat troca o que a tela do bot mostra.
- **S5 (migração):** o quadro de hoje vira o padrão do bot, nome exibido "Tarefas" (sem reescrever), mesmo prefixo,
  tarefas, colunas, passagens, membros e histórico intactos. Sem ação da pessoa.
- **S6:** remover quadro continua `arriscada` com o card `quadro_exclusao`, agora por quadro; o bot volta a comum só ao
  remover o último.
- **S7:** arquivar projeto não apaga quadro; excluir projeto de vez fica para depois.
- **S8:** quem participa (ADR-143) vê o quadro pelo id, sem projetos da dona (projeto é da dona).
- **S9:** a troca do índice vai numa 2ª migração aplicada depois da troca do servidor (no mesmo PR se o runbook aceitar;
  senão num PR de limpeza de 3 linhas).
- **S10:** limites: 50 quadros por bot, 200 por pessoa, 100 projetos por pessoa.
- **S11 (Gil):** sem atalho de teclado novo para o seletor nesta issue (os ⌥+setas são da pílula).

## 13. Passos (commits) — 1 PR

1. `ADA-14: ADR-153 e plano` (este commit).
2. `ADA-14: migração 0152 (projetos, quadro_bots, nome/projeto do quadro, quadro_aberto) + teste de migração`.
3. `ADA-14: domínio quadros-do-bot (puro) + testes`.
4. `ADA-14: repo — padraoDoBot/doBot/vinculadosAo, sai doAgente; projetos.repo` (compila só com as chamadas trocadas).
5. `ADA-14: resolverQuadro + ?quadro= nas rotas + GET /agentes/:id/quadros` + testes de integração.
6. `ADA-14: ops novas no gerir_quadro e no lote (criar N, editar nome/projeto, padrão, vincular, abrir)` + contrato.
7. `ADA-14: projetos — registro projeto.*, rotas, executor, ferramenta` + contrato + `npm run paridade`.
8. `ADA-14: bordas — remover padrão/último, transferência de dono na exclusão do bot` + corrida.
9. `ADA-14: pílula/apps-do-bot e prompt (quadros do bot)`.
10. `ADA-14: web — seletor de quadro (desktop + mobile), qid nas chamadas, último aberto` (depois do protótipo do Gil).
11. `ADA-14: migração 0153 (sai quadros_um_por_agente) + flag NOD_QUADROS_N`.
12. `ADA-14: npm run check verde` (ajustes).

## 14. Critérios de aceite (rascunho da Ada, com a prova)

- [ ] Bot pode ter > 1 quadro e troca sem sair do app Quadro (desktop e mobile) — web + E2E.
- [ ] Abre pela pílula (ADA-8), sem caminho novo fora dela — a página `tarefas` continua uma só (teste apps-do-bot).
- [ ] Quadros num projeto ou soltos — integração + web.
- [ ] Quadro com > 1 bot com regra de dono e passagem — integração (S3).
- [ ] Tudo pelo chat — contrato de ações + `npm run paridade`.
- [ ] Quadros existentes continuam funcionando sem ação da pessoa — teste da migração 0152.
- [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o cartão
  que o risco e o modo pedem.
