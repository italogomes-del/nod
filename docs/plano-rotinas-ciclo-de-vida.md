# Plano — ciclo de vida de rotinas por conversa

> **Andamento.**
> - Passo 1 (inventário no prompt) FEITO — `prompt-sistema.ts`, `plano-turno.ts`,
>   `emitir-plano-turno.ts`, 3 testes unitários.
> - Passo 2 (listar/pausar/reativar) FEITO — lista fechada de 9 → 12 ferramentas,
>   `contracts/ferramentas-rotina.ts` (novo), `use-cases/rotinas-do-agente.ts` (novo),
>   5 testes de integração. Catálogo por modo: só conversa e sala.
> - Verde: lint, typecheck (4 projetos), fence:domain, 474 unit, 232 integration, conformidade
>   (menos a falha pré-existente abaixo).
> - Falta: `atualizar_rotina` e `excluir_rotina` (proposta/decisão), migração 0016, rotas, web, ADR.

Hoje o agente só sabe **criar** rotina (`criar_rotina`). Este plano dá a ele o ciclo completo:
listar, atualizar, pausar, reativar e excluir — sempre sobre a rotina certa.

## O que já existe (não refazer)

| Capacidade | Backend | Ferramenta do agente |
| --- | --- | --- |
| Criar | `use-cases/criar-rotina.ts` → proposta `kind:'rotina'` → `ativar-rotina.ts` | ✅ `criar_rotina` |
| Listar | `rotinasRepo.listarDoAgente` / `listar-rotinas.ts` | ❌ |
| Pausar | `use-cases/pausar-rotina.ts` + `POST /rotinas/:id/pausar` | ❌ |
| Reativar | mesmo caso, `estado:'ativa'` + `POST /rotinas/:id/ativar` | ❌ |
| Atualizar | — não existe — | ❌ |
| Excluir | — não existe — | ❌ |

Ou seja: pausar/reativar já funcionam pela **web**; falta só a mão do agente.
Atualizar e excluir não existem em lugar nenhum.

## O problema de fundo: o agente é cego

`montarPromptSistema` (`src/domain/prompt-sistema.ts:47`) injeta o diretório de colegas e o
catálogo de conectores como JSON, mas **nunca as rotinas do agente**. Sem isso, "pausa a rotina
do relatório" é insolúvel: o modelo não tem os ids.

Agrava: `Rotina` (`src/contracts/rotina.ts`) **não tem campo `nome`**, e o teto é de
50 rotinas por agente (`rotina-limites.ts`). Identificar por instrução livre não escala.

### Decisão de design

1. **Injetar o inventário de rotinas no prompt**, no mesmo formato dos colegas: JSON com
   `{id, resumo, instrucao (truncada), estado, proximaExecucao}`. `resumoCron` já produz o texto
   humano ("dias úteis às 08:00"). Isso resolve a desambiguação sem parser novo.
2. **O modelo escolhe; o domínio valida.** `rotina-texto.ts` grava a Regra 9 —
   "NENHUM parser de intenção sobrevive aqui". As ferramentas novas recebem `rotina_id` **tipado**,
   nunca uma descrição em texto para o servidor adivinhar.
3. **Ambiguidade não vira chute.** Se a pessoa for vaga e houver várias candidatas, o agente usa
   `pedir_a_pessoa` (EMENDA 16) em vez de agir na rotina errada.

## Ferramentas novas (lista FECHADA — 4 entradas)

Todas seguem o contrato de `criar_rotina`: erro de domínio volta **tipado** em `{erro}` para o
modelo corrigir, em vez de virar negação do proxy.

- `listar_rotinas` — sem args. Leitura pura, sem proposta.
- `pausar_rotina` / `reativar_rotina` — `{rotina_id}`. Reversível e sem efeito externo:
  aplicam direto via `pausarRotina`, como o botão da web já faz.
- `atualizar_rotina` — `{rotina_id}` + campos opcionais. **Passa por proposta/decisão**, como
  `criar_rotina`: muda quando e o que a rotina faz sozinha.
- `excluir_rotina` — `{rotina_id}`. **Passa por proposta/decisão**: é destrutivo.

### Por que pausar aplica direto e excluir não

Pausar é reversível em um clique e já é ato de um botão. Excluir e reescrever a instrução não são.
Isso mantém a regra de ADR-033 (o gate nasce ligado) onde ela importa, sem pedir confirmação
cerimonial para o que a web já faz sem cerimônia.

## Exclusão: recuperável, seguindo ADR-034

ADR-034 fixou para agentes: `excluido_em` retira de operação, sem purga. Rotina hoje não tem
essa coluna. **Migração 0016** (0014 e 0015 já existem):
`ALTER TABLE rotinas ADD COLUMN excluido_em timestamptz`.

- `ativasVencidas` e `listarDoAgente` passam a filtrar `excluido_em is null`.
- `contarDoAgente` também — senão rotina excluída continua consumindo o teto de 50.
- Nada de `DELETE FROM`: a trilha é imutável (ADR-004) e as execuções passadas ficam.
- A migração precisa de `nod_escopar_tabela`? Não: a tabela já é escopada; só acrescenta coluna,
  como 0011/0012 fizeram. Nenhuma policy é ampliada.

## Duas invariantes do repositório que quebram código novo

**1. `estado` é COMPUTADO, nunca lido cru.** Em `COLUNAS` (`rotinas.repo.ts:25`) o estado sai de um
`case when` que compara `agentes.geracao_execucao` com `rotinas.geracao_execucao`: bump de geração
faz toda rotina do agente **ler como `pausada`** sem tocar linha nenhuma (ADR-034). Todo SELECT novo
passa por `COLUNAS` — selecionar `estado` direto discorda do resto do sistema em silêncio.

`geracao_execucao` **não é DEFAULT de coluna**: quem carimba é o trigger `nod_agente_ativo`
(migração 0012), sob `pg_advisory_xact_lock` por tenant/agente, e ele **levanta `agente inativo`
(23514) se o agente estiver excluído**. Consequência para `atualizar_rotina`: se o UPDATE novo
disparar esse trigger, editar rotina de agente excluído vira erro de banco — mapear para
`ErroDeDominio`, nunca deixar virar 500. Conferir quais triggers a 0002 pendura no UPDATE de
`rotinas` antes de escrever o caso.

**2. Leitura é do tenant; escrita é da dona.** `buscar`/`listar` são tenant-wide (a perna de
equipe abre leitura), mas `atualizarEstado`/`reagendar` filtram `owner_id = escopo.pessoaId` e
devolvem `null`, que o caso converte em `nao_permitido`. **`atualizar` e `excluir` novos têm que
repetir esse filtro** — é a regra do AGENTS.md ("a perna extra e 'equipe' só ABREM LEITURA").
Sem ele, um colega de equipe apaga rotina alheia.

## Arquivos a tocar

**Contrato e despacho** — cada nome novo passa por SETE lugares; `USE_CASE_POR_FERRAMENTA` é
`as const satisfies Record<NomeFerramentaNod, keyof UseCasesNod<unknown>>`, então faltar entrada ou
errar o camelCase é erro de compilação:
1. `src/contracts/ferramentas-nod.ts` — `FERRAMENTAS_NOD` + `NOMES_FERRAMENTAS_NOD`
2. `src/contracts/servicos.ts:79` — `interface UseCasesNod`
3. `src/contracts/servicos.ts:92` — `USE_CASE_POR_FERRAMENTA`
4. `src/use-cases/chamar-ferramenta.ts:86` — `DESPACHO`, na forma literal do regex
5. `src/use-cases/<novo-caso>.ts` — tipado `CasoNod<Deps, "nome_tool">`
6. `src/adapters/http/compor.ts:190` — literal `useCases`
7. `tests/conformidade/capabilities-consumidas.test.ts:17` — subir o `toHaveLength`

`Services` (`servicos.ts:23`) é outra superfície: hoje rotinas expõem só `ativar`. Ferramenta de
agente não mexe nela; capacidade que as rotas/L9 precisem chamar, sim (`compor.ts:217-241`).

**Casos de uso novos:** `listar-rotinas-agente.ts`, `alternar-rotina.ts`,
`propor-atualizacao-rotina.ts`, `aplicar-atualizacao-rotina.ts`, `propor-exclusao-rotina.ts`,
`excluir-rotina.ts`

**Domínio:** `rotina-texto.ts` (validar atualização parcial reusando `validarRotinaNormalizada`),
`prompt-sistema.ts` (inventário + instrução de uso)

**Persistência:** migração `0014`, `rotinas.repo.ts` (`atualizar`, `excluir`, filtros de
`excluido_em`), `contracts/rotina.ts` (`excluidoEm`)

**Proposta/decisão:** `contracts/conversa.ts` — novos kinds `rotina_atualizacao` e
`rotina_exclusao` (ou payload discriminado dentro de `rotina`).

O caminho de confirmação é `POST /decisoes/:id/decidir` (`rotas/decisoes.ts:76`); o braço de rotina
são duas linhas (:121-123) que passam `atual.id` direto como `propostaId` — é a invariante
`rotina.id == proposta.id == decisao.id` de novo. Um `tipo` novo cai no `else` que **lança**, então
tem que ganhar braço explícito ali.

Na web, um card novo são **três pontos no mesmo arquivo** (`web/telas/sua-vez.ts`):
`TIPO_HUMANO` (:8, `Record` exaustivo — **não compila** sem o rótulo novo), `renderAcoes` (:45,
`switch` sem `default`) e o gancho CSS `tipo-${d.tipo}` (:68). Hoje `rotina` divide o braço com
`perfil` (Confirmar/Recusar); atualização e exclusão pedem verbo próprio ("Aplicar", "Excluir").

## Testes (quatro modos)

- **unit** — desambiguação e validação de atualização parcial, domínio puro, `agora` por parâmetro.
- **integration** (`withRollback`) — ciclo completo; rotina excluída não conta no teto; rotina
  excluída nunca é devolvida por `ativasVencidas`; isolamento por dono.
- **conformidade** — `capabilities-consumidas` continua verde com a lista fechada maior; `rls.test`
  confirma a coluna nova sem policy ampliada.

### O gate de conformidade é literal — ler antes de codar

`tests/conformidade/capabilities-consumidas.test.ts` lê `chamar-ferramenta.ts` como **texto**,
não como tipo. Três amarras:

1. `expect(NOMES_FERRAMENTAS_NOD).toHaveLength(9)` (:17) — **contagem cravada**. Vai para 13, e o
   título do `it` ("9 nomes", :16) junto.
2. Cada caso tem que casar o regex exato (:19). Escrever literalmente, sem renomear parâmetro nem
   desestruturar:
   `nome_da_tool: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.nome_da_tool](deps, { ...ctx, ...args }),`
3. Igualdade de conjuntos (:28) — nenhum caso a mais, nenhum a menos.
- **concurrency/e2e** — jornada: cria → lista → pausa → atualiza → exclui, com `servidor-completo`
  e catcher (custo zero). Excluir durante execução em voo: o turno em curso pode terminar
  (mesmo limite declarado em ADR-034). `inherited-from-leapy.md` §"O limite do withRollback":
  invariante de reivindicação de janela (ADR-011, `rotina_janelas`) **só se prova com duas conexões
  reais** — corrida de "excluir enquanto o scheduler reivindica" mora aqui, nunca num envelope de
  rollback.

## Riscos

- **Excluir rotina que está executando agora.** Seguir ADR-034: bloqueia trabalho novo, não mata o
  que já saiu. A UI diz isso.
- **Crescimento do prompt.** 50 rotinas × instrução inteira estoura o prompt estável. Truncar a
  instrução e ordenar por id, como o diretório de colegas faz (`slice(0, 50)`), para preservar o
  cache `ephemeral_1h` de `--append-system-prompt`.
- **Escopo.** Toda operação continua sob `abrirTxEscopada`; `rotina_id` de fora nunca chega cru ao
  Postgres (`assertUuid` antes do banco, como `criar-rotina.ts` já faz).

## ADR

Isto emenda ADR-011, ADR-033 e ADR-034 → escrever a ADR com o gatilho de reversão antes de fechar
a branch. **Número: 041, não 040** — a branch `codex/turno-por-atividade` já tomou a 040
("O turno acaba quando o agente termina", commit 7bf838b). Conferir de novo na hora de escrever.

## Falha pré-existente no `npm run check` (não é desta branch)

`tests/conformidade/motivos-enum.test.ts > motivo_interrupcao` falha em `main` limpo: o
`nod_test` compartilhado tem `turno_travado` e `trabalho_incompleto` no pg_enum, valores que
vêm da `codex/turno-por-atividade` e não existem no `motivos.ts` daqui. Medido em 2026-09-21:
falha idêntica com a árvore desta branch vazia (stash). Some quando aquela branch entrar na main,
ou recriando o `nod_test`. Não mascarar: o gate está certo, o banco é que está adiante.
