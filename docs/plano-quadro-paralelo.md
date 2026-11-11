# ADA-16 — Quadro roda cada tarefa num trabalho próprio, em paralelo

Plano de engenharia. Regra fixa: **1 PR por issue**.

> **Revisto em 2026-11-10 (pedido do Marlon: "não quero limites").** O teto por bot e por máquina (6/20, envs
> `NOD_QUADRO_TETO_POR_BOT`/`_POR_MAQUINA`) saiu do `reivindicar`, com as envs e `src/domain/quadro-trabalho.ts`. A
> tarefa do quadro não tem limite próprio: o recurso é do nod, e o único freio é o mesmo de agentes e frentes, o portão
> de recursos da máquina (`portaoDoMac`/`deveSegurar`, ADR-085) e o pool elástico de laços do executor. Em série, só a
> mesma tarefa com o mesmo bot. O card diz "na fila há X min" só com motivo real (`motivoFila`: `mesma_tarefa` ou o
> portão — `memoria`, `processador`, `disco`). As seções abaixo já estão com a decisão nova; a ADR-163 a registra.

## Problema

`abrirTurno` (src/use-cases/quadro.ts:442) enfileira o turno da tarefa com `origem: "delegacao"`, **sem `trabalhoId`**, na conversa própria do bot. O turno nasce com `bastidores=true` (`nasceNosBastidores`). O `reivindicar` (src/repositories/turnos.repo.ts:357, `faixaOcupadaSql` na :251) solta só 1 turno despachando por faixa (conversa + bastidores). Resultado: todas as tarefas do mesmo bot andam em série, uma esperando a outra.

## Arquitetura

**Tarefa do quadro vira trabalho.** Um trabalho por (agente, tarefa), reaproveitado entre as etapas.

- Gatilho da tarefa (início, resposta, comentário, repetir, recado, automática): `abrirTurno` acha ou cria o trabalho da tarefa (`criarTrabalho`, mesmo padrão de `abrirFrentes` em src/use-cases/frentes.ts:40-115) e enfileira o turno com `trabalhoId`.
- Com `trabalhoId`, a faixa do turno passa a ser o trabalho (ADR-083 §3: `coalesce(trabalho_id, conversa_id)`). Duas tarefas do mesmo bot = duas faixas = rodam juntas (critério 1).
- Sessão e pasta são do trabalho (`sessao_cli`, `sessao_harness`, `sessao_executor`, `pasta`). Etapas seguidas da mesma tarefa com o mesmo bot reaproveitam o trabalho e continuam a sessão (critério 4, núcleo da ADA-10). Se o executor ou o harness mudar, sessão nova na mesma pasta. Repetir com a sessão quebrada abre trabalho novo.
- Trocar o responsável abre outro trabalho (outro agente). O trabalho antigo fecha.
- Turnos antigos sem trabalho que estiverem na fila no deploy continuam como hoje (sem migração de dados).

```
gatilho da tarefa ──> abrirTurno ──> trabalhoDaTarefa(agente, tarefa)
                                        │ existe aberto? reaproveita
                                        │ senão criarTrabalho(origem=quadro)
                                        ▼
                         enqueue(turno, trabalhoId) ──> reivindicar
                                                         │ faixa = trabalho
                                                         │ portão de recursos (ADR-085)
                                                         ▼
                                                     despacha (sessão do trabalho)
```

## Módulos

| Módulo | Mudança |
|---|---|
| src/db/migrations/0163_quadro_trabalho.sql | colunas, CHECK, índices (abaixo) |
| src/repositories/trabalhos.repo.ts | `buscarDaTarefa(tenant, agente, tarefa)`, `criar` aceita `quadroTarefaId` |
| src/use-cases/quadro.ts | `abrirTurno` usa o trabalho da tarefa; `pararTurno`/juntar do NOD-417 dentro do trabalho; fechar trabalho ao trocar responsável ou excluir |
| src/repositories/turnos.repo.ts | o portão do Mac (`segurarFundo`) também segura a primeira etapa de origem `quadro`; o espaço de 30 s não |
| src/use-cases/fila-da-tarefa.ts (novo) + src/repositories/quadros.repo.ts | `motivosDaFila`: `mesma_tarefa` ou o portão (`esperaDoMac`) |
| src/contracts/quadro.ts | `TarefaDto` ganha `naFilaDesde`, `motivoFila`; estado `esperando` |
| web/telas/quadro-real.ts, web/telas/quadro.ts | chip "Rodando" / "Na fila há X min" / "Esperando" |
| src/domain/quadro.ts, src/domain/triagem.ts | prompt da tarefa ganha linha da pasta; texto da triagem corrigido |
| docs/adr/adr-163-tarefa-do-quadro-e-trabalho.md | ADR nova + emendas |

## Dados e migrações (0163, só adição)

```sql
alter table trabalhos add column quadro_tarefa_id uuid
  references quadro_tarefas(id) on delete set null;
alter table trabalhos drop constraint trabalhos_origem_check,
  add constraint trabalhos_origem_check
  check (origem in ('pessoa','rotina','colega','rede','quadro'));
-- regra 2: um trabalho aberto por (agente, tarefa)
create unique index trabalhos_quadro_aberto_uniq
  on trabalhos (tenant_id, agente_id, quadro_tarefa_id)
  where quadro_tarefa_id is not null
    and estado in ('na_fila','rodando','precisa_de_voce');
alter table quadro_execucoes add column trabalho_id uuid
  references trabalhos(id) on delete set null;
```

- Origem nova `quadro` (em vez de reusar `colega`): deixa o portão do Mac, o card e a tela de Trabalhos separarem a tarefa do quadro sem heurística.
- Expand-only: o servidor antigo ignora as colunas novas; o CHECK só amplia.
- Estado `terminado`/`fechado_ocioso` reabre com turno novo via `sincronizarTrabalho`. O índice parcial cobre a corrida de dois gatilhos criando o trabalho ao mesmo tempo: o segundo pega `unique_violation` e relê.

## Sem teto (critério 3)

Nenhuma contagem própria no `reivindicar`. Tarefas diferentes, do mesmo bot ou de bots diferentes, saem juntas.

- O freio é o do nod para todo trabalho: o portão de recursos da máquina (`segurarFundo` com memória ou processador
  apertados pelo uso do Mac, `segurarNovo` com disco crítico) segura a **primeira** etapa da tarefa, como a rotina e o
  colega; a etapa seguinte de um trabalho já começado segue. O pool elástico de laços do executor dosa os processos.
- O espaço de 30 s (`ESPACO_FUNDO_MS`) não vale para o quadro: serializaria o paralelo.
- Em série só a mesma tarefa com o mesmo bot (a faixa é o trabalho).
- Ordem: retomadas primeiro, depois FIFO por `criado_em`. Cota e declínio continuam.

## Card (critérios 3 e 5)

- **Rodando:** turno despachando.
- **Na fila:** turno pendente. "Na fila há X min · motivo" só com motivo real, a partir de 1 min: "termina a etapa
  anterior desta tarefa" (`mesma_tarefa`) ou o portão ("a máquina está sem memória livre", "o processador da máquina
  está ocupado", "o disco da máquina está cheio"). Sem motivo, só "na fila".
- **Esperando:** trabalho do responsável aberto sem turno vivo (colega, CI, comando, volta marcada).

## APIs

Sem rota nova. A rota do quadro devolve a execução com `naFilaDesde` e `motivoFila`. O contrato do DTO ganha os dois campos (opcionais, para o cliente antigo).

## Ações

Ações: nenhuma ação nova. Sem teto, não há número a configurar.

## Bordas e erros

| Caso | Comportamento |
|---|---|
| Corrida de claim | advisory lock + `SKIP LOCKED`; teste de concorrência: duas conexões pegam as duas tarefas do mesmo bot |
| Dois gatilhos criam o trabalho juntos | índice único parcial; o perdedor relê e reaproveita |
| Lease vencido | varredor atual interrompe; execução vai para nova tentativa no mesmo trabalho |
| Cancelamento | `cancelar_trabalho` cancela o turno; execução marcada `cancelada_em` |
| Card movido durante a execução | NOD-417: `pararTurno` no turno atual + turno novo no mesmo trabalho (juntar à fila se pendente) |
| Troca de responsável | fecha o trabalho do antigo; abre o do novo |
| Bot sem conversa própria | volta para A fazer (igual hoje) |
| Tarefa excluída | `on delete set null`; trabalho fecha |
| Máquina apertada | o portão segura a primeira etapa; o card mostra "na fila há X min · " com o recurso (memória, processador, disco) |
| Computador do bot | é um só por bot: tarefas que usam o computador esperam a vez (fora do escopo isolar) |
| Duas tarefas no mesmo repo | worktrees distintas por trabalho (pasta própria); conflito de merge fica para o PR de cada uma |

## Prompt

- Turno com trabalho de origem `quadro` não leva a linha de Triagem (`emTriagem` já fica falso com `trabalhoId`).
- Ganha a frase de pasta/worktree das frentes ("trabalhe na pasta X, worktree própria") e mantém "Faça a tarefa" + `gerir_quadro`.
- Corrigir o texto desatualizado da triagem ("a conversa com a pessoa espera").

## Testes

**Unit:** estado do card (rodando/fila/esperando); texto do motivo da fila; sem motivo, sem a hora nem "vaga/limite".

**Integração (Postgres real):**
1. **Critério 6:** duas tarefas do mesmo bot em andamento → dois turnos `despachando` ao mesmo tempo.
2. Sem teto: oito tarefas do mesmo bot, a de outro bot e a task da pessoa saem todas para a mesma máquina.
3. Motivo da fila: `mesma_tarefa` com a etapa anterior rodando; `memoria` com o portão fechado; nenhum sem leitura.
4. Duas etapas da mesma tarefa: em série, mesmo trabalho, `sessao_cli` reaproveitada.
5. Corrida: dois gatilhos simultâneos criam um trabalho só.
6. NOD-417/418 dentro do trabalho: mover o card durante a execução para o turno e enfileira outro no mesmo trabalho.
7. Portão do Mac segura a primeira etapa e solta a seguinte; o espaço de 30 s não segura o quadro.

**Web:** chip do card nos três estados e "há X min".

## Riscos

- **Custo de IA:** N tarefas em paralelo gastam N vezes. Mitiga: a cota atual (decisão do Marlon: sem teto).
- **CPU/memória/disco da máquina:** rajada de processos. Mitiga: o portão de recursos (ADR-085) e o pool de laços.
- **Conflitos de merge** entre tarefas do mesmo repo: aceitos; cada uma tem worktree e PR.
- **Deploy com execuções em andamento:** turnos antigos sem trabalho continuam; só gatilhos novos usam o trabalho.
- **Servidor antigo com a migração:** expand-only, seguro.

## ADR

Nova **ADR-163 "Tarefa do quadro é trabalho"**, com emendas:

- **ADR-083 §3:** a tarefa do quadro também usa a faixa do trabalho.
- **ADR-083 §4 ("Sem teto"):** mantida; o quadro também não tem teto próprio.
- **ADR-085:** o portão também segura a primeira etapa do quadro; o espaço de 30 s não.
- **ADR-130:** o turno da tarefa sai dos bastidores da conversa do bot; os bastidores ficam para delegação e triagem.

## Passos (commits, 1 PR)

1. `migração 0163 + contratos`: colunas, CHECK, índices, tipos do repo, DTO.
2. `quadro cria e reaproveita o trabalho da tarefa`: `abrirTurno`, `buscarDaTarefa`, NOD-417 no trabalho, troca de responsável e exclusão. Testes 1, 4, 5, 6.
3. `portão do Mac no quadro` (o teto da primeira versão saiu em 2026-11-10). Testes 2 e 7.
4. `motivo da fila e chip do card`: DTO, `motivosDaFila`, telas. Testes 3 e web.
5. `prompt da tarefa como trabalho`: linha da pasta, triagem corrigida.
6. `ADR-163 e emendas`: docs/adr.

`npm run check` uma vez, antes da revisão.

## Revisão de engenharia (plan-eng-review)

- **Escopo:** enxuto. Reusa trabalho, sessão, pasta, lease e varredor que já existem; só acrescenta o vínculo com a tarefa e o chip. Nada de fila nova.
- **Arquitetura:** a decisão central (trabalho por agente+tarefa) resolve os critérios 1, 2 e 4 com a mesma peça. Sem teto próprio nem segundo escalonador: o recurso é o portão que já existe.
- **Qualidade:** a regra 2 tem defesa em profundidade (faixa do trabalho + índice parcial + NOD-417).
- **Testes:** o critério 6 está em integração com Postgres real; o "sem teto" tem regressão em integração e concorrência.
- **Desempenho:** nenhuma contagem nova no claim.
- **Em aberto:** perguntas abaixo.

## Suposições

- Sem teto próprio (decisão do Marlon, 2026-11-10).
- A ADA-16 absorve o núcleo da ADA-10 (sessão contínua por agente+tarefa).
- Computador do bot continua um só (fora do escopo).

## Perguntas para a Ada

1. ~~Confirma 6 por bot e 20 por máquina?~~ Respondida: sem teto.
2. A ADA-10 se funde à ADA-16?
3. Como fica a relação com a ADA-23/ADA-230 (frente ligada à tarefa)?
4. ~~Esperar CI ocupa vaga?~~ Sem vaga, não se aplica.
