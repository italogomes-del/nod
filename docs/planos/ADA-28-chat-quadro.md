# ADA-28: jornada chat × quadro (o que a pessoa vê)

Plano de engenharia (Xumbrega, 07/11). Base: `origin/main` @ `316340a7`. Estudo de entrada:
`NOD-JORNADAS.md` da Ada (03/11, @ `e323dda7`; as linhas citadas abaixo foram reconferidas em `316340a7`).
Junta a ADA-23, a ADA-24 e a ADA-25 (viram duplicadas desta) e a ADA-27 (cancelada). Relacionadas: ADA-15 (aprovação
pelo chat, PR #696 em draft), ADA-16 (tarefa com faixa própria), ADA-22 e ADA-26.

**O protótipo único do Gil ainda não existe.** Toda a UI daqui é suposição (U1–U6 no fim): minimalista, cards que
parecem mensagem, nada de painel novo. O plano isola a UI em PRs próprios para que o protótipo troque só a pele.

## Decisões do Marlon que o plano segue

- **d1 (03/11, aprovada):** pergunta e aprovação de efeito externo durante uma tarefa moram **na tarefa e na Sua vez**;
  o chat só aponta.
- **d2:** quem dá o Done é escolha do usuário, por quadro: "o bot leva até Done" (hoje) ou "o bot para em Revisando e eu
  dou o Done" (hoje imitável com `travar_coluna so_pessoa`).

## A ideia em uma frase

**A tarefa vira a casa do trabalho**: tudo o que nasce num turno de tarefa (pergunta, aprovação, frente, artefato,
resultado, conversa entre bots) leva o `tarefa_id` e aparece na tarefa; a Sua vez junta o que precisa da pessoa; o chat
recebe no máximo **uma linha com link**. Fora de tarefa, nada muda.

```
turno de tarefa (delegacao, quadro_execucoes.turno_id)          chat do bot
 ├─ pedir_a_pessoa / pedir_aprovacao ─▶ decisoes.tarefa_id ─┐     └─ "ADA-28 precisa de você · abrir"  (1 linha)
 ├─ mudar_tarefa status voce ─────────▶ decisoes.tarefa_id ─┤
 │                                                          ├─▶ card "Precisa de você" na tarefa + Sua vez
 │                       (responder em qualquer um resolve) ┘
 ├─ abrir_frentes ─▶ trabalhos.tarefa_id ─▶ card "trabalhando numa frente"
 │                    └─ devolver_resumo ─▶ comentário na tarefa (PR, branch, SHA, artefato)
 ├─ publicar_artefato ─▶ comentário na tarefa
 └─ fim do turno ─▶ comentário na tarefa;  chat: "Xumbrega terminou ADA-28 · abrir" (nunca "Conversou com um colega")
bastidores (recibos, turno.falhou, lote.retorno_caiu, negacao.terminal, ia.troca…) ─▶ Atividade
```

## Arquitetura: a chave é UMA função, `tarefaDoTurno`

Hoje já existe a subida da cadeia de retomadas até a tarefa (`quadrosRepo.tarefaDoTurno`, `src/repositories/
quadros.repo.ts:234`) e o mapa turno raiz → tarefa (`quadro_execucoes`, migração 0139). O plano **materializa** essa
ligação nos três lugares que hoje a perdem, em vez de recalculá-la em cada leitura:

| onde | coluna nova | quem grava | por quê materializar |
|---|---|---|---|
| `decisoes` | `tarefa_id uuid null` | `pedir_a_pessoa`, `pedir_aprovacao`, `pedir_acesso`, `pedir_credencial` e o `status voce` | a Sua vez e o card leem por índice; a cadeia pode ser podada (0139: "a poda apaga turnos") |
| `trabalhos` | `tarefa_id uuid null` | `abrirLote` (frentes) quando o turno é de tarefa | a frente não tem `retoma_turno_id` até a tarefa; hoje ela perde a origem (`pedido-de-colega.ts:61-72`) |
| `turnos` | — (não muda) | — | a cadeia já resolve; o turno da frente acha a tarefa pelo `trabalho.tarefa_id` |

`tarefaDoTurno(turnoId)` passa a responder também para o turno de frente (`turno.trabalhoId → trabalhos.tarefa_id`). É a
única fonte para: o `terminei`/`pr_url` sem tarefa (`domain/quadro.ts:1151`), a decisão nascida no turno, o
comentário de resultado e a regra de destino no chat.

Relação com a ADA-16 (tarefa com faixa, sessão e pasta próprias): este plano **não depende** dela e não a antecipa. Se a
ADA-16 trocar o turno `delegacao` por um trabalho da tarefa, `tarefaDoTurno` é o único ponto a adaptar.

## Escopo A: um único "Precisa de você"

**Regra:** durante uma tarefa, `pedir_a_pessoa`, `pedir_aprovacao` (e `pedir_acesso`/`pedir_credencial`, que são a
mesma família) e `mudar_tarefa status voce` viram **uma decisão ligada à tarefa**.

1. `pedir_a_pessoa`/`pedir_aprovacao` num turno com `tarefaDoTurno ≠ null`:
   - cria a decisão como hoje, com `tarefa_id`;
   - põe a tarefa em "Precisa de você" pelo lote comum (autor = o bot, `status voce`, `pergunta` = a frase da decisão,
     ligação pela `decisoes.tarefa_id`), **sem** o `aviso_pessoa` "Preciso de você no quadro" (`use-cases/quadro.ts:491-509`);
   - **não** grava o balão `pedido_a_pessoa` na conversa; grava uma linha `tarefa.precisa` (assunto novo, destino `chat`):
     "ADA-28 precisa de você · abrir" com link `/quadros/<id>?tarefa=<id>`.
2. `mudar_tarefa status voce` (com pergunta) cria a decisão `pergunta` com `tarefa_id`, no mesmo lote. A pergunta do
   card continua em `quadro_tarefas.pergunta` (compatível), mas a fonte da verdade da espera passa a ser a decisão.
3. **Responder em qualquer lugar resolve os dois:**
   - pelo card (`quadro.responder`): resolve a decisão ligada pelo **mesmo** `decidirDecisao` da Sua vez, e é a
     retomada dela (`enfileirarRetomada`, `use-cases/decidir.ts:240`) que continua o trabalho. Com decisão ligada, o
     `quadro.responder` **não** abre o turno próprio de `entradaDaResposta` (senão a mesma resposta acordaria o bot duas
     vezes: revisão de eng, achado 1). Sem decisão ligada (tarefa antiga), segue o caminho de hoje;
   - pela Sua vez ou pelo cartão (`cartoes.responder`/`cartoes.decidir`): resolve a decisão como hoje (retomada da
     cadeia) e tira a tarefa de "Precisa de você" para a coluna de volta (`colunaDeVolta`), **sem** abrir turno novo: a
     retomada da decisão já é o turno que continua;
   - pela fala no chat (ADA-15, `responder pela_fala`): passa pelo `quadro.responder`, logo resolve a decisão.
   Idempotência: a decisão tem estado; quem chega depois recebe "já respondida" (o `decidir` já recusa estado fechado).
   Concorrência: card e Sua vez ao mesmo tempo serializam na trava do quadro (`buscarTravado`) + `UPDATE decisoes … WHERE
   estado IN ('pendente','reaberta')`.
4. **Sua vez** (`listar-sua-vez.ts`): nada a mudar na leitura principal, porque a espera do quadro agora é decisão. Cada
   item ganha `tarefa: { id, codigo, titulo, quadroId } | null` (uma consulta por lote de ids) para o card mostrar
   "ADA-28 · <título>" e abrir a tarefa. Tarefas em "Precisa de você" **antigas** (sem decisão) **não** ganham backfill:
   seguem o caminho de hoje até alguém responder pelo card (revisão de eng, achado 2).
5. **Na tarefa:** o detalhe mostra a decisão aberta no topo, como um cartão de mensagem (pergunta, opções, Aprovar/
   Recusar com os itens da aprovação). É o mesmo componente da Sua vez (`web/telas/sua-vez.ts`), não um novo.
6. **Fora de tarefa nada muda:** `tarefaDoTurno = null` → caminho de hoje, byte a byte (teste de regressão).

Bordas:
- Aprovação de efeito externo com `pessoa_confirma`/modo "Ignorar todas as aprovações": quando o modo aprova sozinho não
  há decisão; o recibo vai para a Atividade (escopo C) e **um comentário de sistema** na tarefa ("rodou sem perguntar:
  …"). A tarefa não vai para "Precisa de você".
- Duas decisões abertas na mesma tarefa (pergunta + aprovação): a tarefa fica em "Precisa de você" até a última
  fechar; o card lista as duas. A lista sai só de `decisoes.tarefa_id` (sem coluna espelho na tarefa).
- Decisão vence (24 h): a tarefa vai para Bloqueado com o motivo "a pergunta venceu sem resposta" (`decisao.vencida`
  segue no chat porque pede ação, como hoje).
- Tarefa excluída/cancelada com decisão aberta: a decisão vira `dispensada` (o varredor já trata decisão órfã de turno
  cancelado; aqui é explícito no lote).
- Coluna com trava `so_pessoa`/`sai_para` que não aceita ir a "Precisa de você": a decisão é criada mesmo assim e a
  tarefa não se move; o card mostra a decisão no topo (a trava é sobre mover, não sobre perguntar).
- Turno da tarefa sob procuração de quem participa (NOD-443): decisor é `quemDecide` da tarefa, como hoje.
- Freios: criar decisão não conta como passe; o `status voce` automático não conta como ida e volta.

## Escopo B: frente ligada à tarefa

1. `abrirLote` (`src/use-cases/frentes.ts:23`): se `tarefaDoTurno(turno) ≠ null`, grava `trabalhos.tarefa_id` em cada
   frente e a entrada da frente ganha a linha "Esta frente é da tarefa ADA-28 (<título>): use `gerir_quadro terminei`
   e `pr_url` nela." O `origemDasFrentes` deixa de cair em `pessoa`/`conversa` para tarefa: origem `tarefa` (valor novo
   em `trabalhos.origem`, texto livre hoje) e `turnoOrigem` `delegacao`, para o plano do turno dar à frente o catálogo
   da tarefa (com `gerir_quadro` de etapa, sem as ferramentas de tela) e a entrada sem "pedido de colega".
2. `gerir_quadro` na frente: `tarefaDoTurno` resolve pela frente, então `terminei` e `mudar_tarefa pr_url` sem
   `tarefa` valem para ela. O limite continua o da tarefa (normal): a frente só mexe na própria tarefa.
3. Fechamento (`fechar-lote.ts:219`): lote de frentes de tarefa **não** volta ao chat pelo `devolverAoDono`. Cada
   `devolver_resumo` grava um comentário de sistema na tarefa, autor = o bot, com o resumo, PR, branch, SHA e artefatos
   (os campos que o resumo já tem). O fim do lote grava a linha `tarefa.resultado` no chat (escopo C) e retoma a cadeia
   da tarefa como hoje (a retomada é que decide `terminei`).
4. Card: com frente da tarefa em `na_fila`/`rodando`, o avatar mostra "trabalhando numa frente" (estado novo
   `frente` em `execucaoDoTurno`, `src/domain/quadro.ts:397`) mesmo com o turno raiz concluído; a execução conta a frente
   como aguardando (`quadro-execucoes.repo.ts:190-199`).
5. `publicar_artefato` num turno de tarefa (ou frente dela): além do card na conversa do turno, comentário na tarefa
   com o link do artefato. O card na conversa segue para a Biblioteca, mas a regra de destino o tira da timeline (C).

Bordas: frente que termina com falha → comentário "a frente falhou: <motivo>" e a tarefa não anda; cancelar o trabalho
da tarefa (`quadro.cancelar_trabalho`) cancela as frentes dela (`trabalhos.tarefa_id`); tarefa excluída com frente
rodando → `pararTurno` nas frentes; a frente de rotina (com `trabalho_mae_id`) não é afetada.

## Escopo C: chat limpo, bastidores na Atividade

A alavanca já existe: a tabela `DESTINO` (`src/domain/destino-no-chat.ts`, ADR-114). Mudanças:

| assunto | hoje | passa a | nota |
|---|---|---|---|
| `aprovacao.recibo` | chat | atividade (`sem_aprovacao`) | recibo de aprovação automática |
| `turno.falhou`, `turno.orfao` | chat | atividade (`bloqueios`) **se** o turno é de tarefa/rotina/colega; chat se é da conversa | a falha do turno da pessoa continua visível |
| `lote.retorno_caiu` | chat | atividade, e linha discreta no chat só quando o lote era da conversa | |
| `negacao.terminal` | chat | atividade quando o turno é de bastidor; chat (linha discreta) quando é da conversa | "falha que exige ação segue visível" |
| `ia.troca` | chat temporal | atividade (`maquina_ia`) | |
| `rotina.adiada` | chat | atividade | |
| `aviso_pessoa` do quadro ("Preciso de você no quadro…") | chat | some (vira `tarefa.precisa`) | escopo A |
| resumo de decisões do quadro (`avisos-quadro.ts:66`) | fala do bot | `tarefa.precisa` agrupado ("3 tarefas precisam de você · abrir a Sua vez") | |
| **novo** `tarefa.precisa` | — | chat (linha) | link para a tarefa |
| **novo** `tarefa.resultado` | — | chat (linha) | "Xumbrega terminou a etapa Plano de ADA-28 · abrir" |

Como a regra depende da origem do turno, `RegraDeDestino` ganha `seBastidor?: Destino` (o destino quando o turno é de
bastidor; `bastidores=true` já está no turno). `destinoDe(assunto, { bastidor })` continua puro.

Timeline do chat (`web/telas/linhas-do-chat.ts`):
- Mensagens de turno de tarefa (raiz `delegacao` com execução no quadro: o servidor marca `tarefa: { id, codigo }` na
  mensagem, como já marca `bastidores`) **não entram** na timeline. `emOrdemDoChat` deixa de reordená-las: elas saem.
- A unidade de troca que hoje vira "Conversou com um colega" (`UM_COLEGA`, `linhas-do-chat.ts:560-584`) para turno de
  tarefa vira a linha `tarefa.resultado`. Pedido de colega de verdade (com `peer_pedido`) segue igual.
- "Rodando em segundo plano" (`web/telas/detalhes.ts`) passa a dizer "trabalhando em ADA-28 · abrir".
- A fala que o bot da tarefa escreveria "para a pessoa" vira comentário na tarefa (o fim do turno de tarefa grava a
  última fala como comentário de sistema; ver D).

Backfill: nenhum. Linhas antigas ficam onde estão (`destinoDe` vale para o que for gravado depois; as antigas já têm
assunto gravado). Suposição registrada: não reescrever o passado.

## Escopo D: o comentário diz se aciona alguém

1. **Prévia de quem será acionado.** `quemAcionar` (`src/domain/comentarios-quadro.ts:46`) é puro e já decide; falta a
   coluna (andamento ou não) e o freio. Nova função pura `previaDoComentario({ tarefa, colunas, autor, texto, agentes,
   acionamentosNaHora }) → { acionados: nome[], motivo: "andamento"|"mencao"|"fora_do_andamento"|"freio" }` em
   `src/domain/comentarios-quadro.ts`, usada pelo `comentarTarefa` (uma regra só) e pela web (import do domínio, como
   `contraste-do-balao.ts`). O campo mostra, sutil, embaixo: "Xumbrega vai ver agora", "Xumbrega e Gil vão ver agora"
   (com @), "fica só registrado (A fazer não aciona ninguém)", "fica só registrado (freio: muitos acionamentos na
   hora)". Atualiza a cada tecla (sem rede).
2. **Conversa entre bots no fio da tarefa.** O `pedir_a_bot` com tarefa já vira comentário (NOD-417). Falta: a resposta
   do colega acionado por comentário volta como comentário (hoje volta pelo turno), e a timeline do chat não mostra essas
   trocas (C). Na tarefa, o comentário de bot leva o selo "bot" e a autoria.
3. **Comentário de bot nunca vale como aprovação.** Já é verdade (comentário não é `mensagens`, e a ADA-15 só aceita
   `mensagens` de pessoa). O plano acrescenta: um comentário de bot numa tarefa em "Precisa de você" **não resolve** a
   decisão nem tira a tarefa de lá (hoje o comentário só aciona); teste de regressão explícito.

## Escopo E: quem fecha a tarefa

1. Opção por quadro `quadros.quem_fecha text not null default 'bot' check (quem_fecha in ('bot','pessoa'))`.
   Na tela: no menu do quadro, "Quem dá o Done: o bot / eu". No chat: `gerir_quadro editar { quem_fecha }` (só a dona,
   na conversa, como colunas).
2. Com `pessoa`:
   - o `terminei` de uma coluna de revisão (`papelDe = "revisao"`) **não** leva a Feito; a tarefa fica em Revisando e
     nasce uma decisão `tarefa_done` (tipo novo) com `tarefa_id`, frase "ADA-28 está pronta para o Done", opções
     "Dar Done" / "Voltar para <coluna anterior>";
   - o `mudar_tarefa status feito` de bot é recusado com "neste quadro quem dá o Done é a pessoa: use terminei" (a
     mensagem dá o caminho, não só a regra);
   - o fechamento automático no merge (`prs-do-quadro.ts`, NOD-421) **não** move a Feito: grava a linha "PR mergeado" e
     cria a mesma decisão `tarefa_done` (idempotente por tarefa);
   - a pessoa dá o Done pelo card ("Dar Done"), pela Sua vez ou pelo chat ("pode dar done na ADA-28" → ADA-15
     `pela_fala`, `mudar_tarefa status feito`).
3. Com `bot`: comportamento de hoje.
4. Relação com `travar_coluna so_pessoa`: continua existindo e independente. A opção nova não grava trava (não mexe nas
   colunas da pessoa); a doc da ferramenta deixa de sugerir a trava como forma de "eu dou o Done".

## Dados e migrações

Uma migração por PR que precisa (números provisórios: a ADA-15 reserva 0152; renumerar no merge):

- `0157_tarefa_casa_do_trabalho.sql` (PR A):
  - `ALTER TABLE decisoes ADD COLUMN tarefa_id uuid` + FK `(tenant_id, tarefa_id) REFERENCES quadro_tarefas (tenant_id,
    id) ON DELETE SET NULL (tarefa_id)`; índice parcial `decisoes_da_tarefa (tenant_id, tarefa_id) WHERE tarefa_id IS NOT
    NULL AND estado IN ('pendente','reaberta')`.
  - Sem `quadro_tarefas.decisao_id`: seria uma segunda fonte da verdade para o mesmo fato (revisão de eng, achado 3).
  - **Sem backfill.** `decisoes` exige `agente_id`, `conversa_id` e `prazo_decisao_em` (`0002_dominio.sql`) e a
    decisão de backfill nasceria sem `turno_id`, sem retomada possível, e venceria em 24 h, levando as tarefas antigas
    para Bloqueado de uma vez. As `voce` antigas seguem pelo caminho de hoje.
  - Só coluna nula + `SET LOCAL lock_timeout = '5s'`; o servidor antigo ignora a coluna. `ON DELETE SET NULL
    (tarefa_id)` com lista de colunas exige Postgres 15+: o CI e o compose usam o 16 (conferido).
- `0154_frente_da_tarefa.sql` (PR B): `trabalhos.tarefa_id uuid` + FK `ON DELETE SET NULL` + índice parcial por tarefa
  com estado aberto.
- `0155_quem_fecha.sql` (PR E): `quadros.quem_fecha` com default `'bot'` (sem reescrita: default constante) e
  `ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'tarefa_done'` (fora de transação, padrão da 0117; o tipo novo só é
  gravado pelo código novo).

Reverter: código antigo ignora todas as colunas; o tipo de enum novo fica sem uso.

## APIs e contratos

- `SuaVezDto.itens[].tarefa?: { id, codigo, titulo, quadroId }`.
- `TarefaDto.decisoes: DecisaoResumoDto[]` (as abertas), `TarefaDto.frentes: { id, titulo, estado }[]`,
  `QuadroDto.quemFecha`.
- `Mensagem.tarefa?: { id, codigo }` (marca do servidor para a timeline).
- Assuntos novos em `src/contracts/destino-no-chat.ts`: `tarefa.precisa`, `tarefa.resultado`; payloads
  `{ kind: "tarefa_linha", tarefaId, codigo, quadroId, motivo }`.
- `gerir_quadro`: `editar.quem_fecha`; descrição da ferramenta: "durante uma tarefa, pergunte com pedir_a_pessoa ou
  pedir_aprovacao: a pergunta vai para a tarefa e a Sua vez; não use status voce + aviso" e corta o trecho sobre travar
  coluna para fechar. Sem campo novo para A/B (a ligação é implícita pelo turno).
- `POST /api/quadros/:id/tarefas/:tid/comentarios` não muda; a prévia é local.

## Ações (ADR-135, NOD-392)

`/acao-no-chat` rodado. **Nenhuma ação nova (id novo)**; emendas em ids que já existem, todos seguem `vivo`:

| Ação (id) | Emenda | Risco | Estado | Contrato |
|---|---|---|---|---|
| `quadro.editar` | schema ganha `quem_fecha: "bot" \| "pessoa"`; no chat só a dona, num turno da conversa (como colunas) | muda | vivo | `tests/integration/paridade-quadro.test.ts`: `quem_fecha` por clique e por chat chegam ao mesmo `quadros.quem_fecha` |
| `quadro.mudar_tarefa` | "Dar Done" da tela é `status: feito` por este id (sem rota nova); com `quem_fecha=pessoa`, bot sem fala recusa | muda | vivo | paridade: Dar Done pela tela e "dá done na ADA-x" pelo chat (com a ADA-15) → Feito + decisão `tarefa_done` resolvida |
| `quadro.responder` | também resolve a decisão ligada | muda | vivo | paridade: responder pelo card e pelo chat fecham a mesma decisão |
| `cartoes.responder` / `cartoes.decidir` | com `tarefa_id`, tiram a tarefa de "Precisa de você" | pessoa_confirma | cartão (`nunca` pelo chat, ADR-135 §2: o cartão é a resposta da pessoa) | integração do escopo A |

Rota nova: nenhuma de pessoa que não seja GET. Executor único: as emendas passam pelo mesmo `aplicarLoteQuadro`/
`decidirDecisao`. Piso `docs/paridade.piso.json` não muda (`vivo: 50`); `npm run paridade` regenera `docs/paridade.md`
no PR E (schema de `quadro.editar`). Ferramenta: `gerir_quadro` (já é a via). O QA testa clique e chat por id.

**Como a pessoa pede (E):** "nesse quadro quem dá o done sou eu"; "deixa o bot fechar as tarefas sozinho"; "pode dar
done na ADA-28".

## Testes

Integração (Postgres real, `withRollback`):
- `tests/integration/quadro-precisa-de-voce.test.ts` (A): pedir_a_pessoa em turno de tarefa → decisão com `tarefa_id`,
  tarefa em `voce`, sem `aviso_pessoa`, linha `tarefa.precisa`; responder pelo card fecha a decisão; responder pela Sua
  vez tira a tarefa de `voce` sem turno novo; responder pelo card com decisão ligada enfileira **uma** retomada e
  nenhum turno de `entradaDaResposta`; os dois ao mesmo tempo → um vence, o outro "já respondida"; status voce
  cria decisão; fora de tarefa = idêntico a hoje (snapshot das linhas gravadas); decisão vencida → Bloqueado;
  comentário de bot não resolve; procuração (decisor = quemDecide); aprovação automática → comentário na tarefa e
  recibo na Atividade.
- `tests/integration/frente-da-tarefa.test.ts` (B): frente aberta em turno de tarefa grava `tarefa_id`, origem `tarefa`,
  catálogo de tarefa; `terminei` sem tarefa na frente move a tarefa certa; `devolver_resumo` vira comentário e não cai
  no chat; card "frente" enquanto roda; cancelar o trabalho cancela a frente; frente de rotina intacta.
- `tests/integration/quem-fecha.test.ts` (E): `pessoa` → terminei em Revisando fica + decisão; `mudar_tarefa feito` de
  bot recusa; merge (sincronizarPrsDoQuadro) não move e cria decisão uma vez só (duas voltas concorrentes); Dar Done
  fecha; `bot` = hoje.
- Paridade: emendas acima em `paridade-quadro.test.ts`.
Unit: `destinoDe` com `seBastidor` (tabela inteira, um caso por assunto mudado); `previaDoComentario` (andamento,
@menção, autor bot, freio, fora do andamento); `tarefaDoTurno` pela frente; reducer/`linhas-do-chat` (turno de tarefa
fora da timeline, linha `tarefa.resultado` no lugar de "Conversou com um colega", peer de verdade intacto).
E2E (Playwright, `NOD_LOGIN=stub`): um fluxo por escopo, com print para o Gil comparar com o protótipo quando existir.
Mutantes nos pontos críticos: a condição `tarefaDoTurno ≠ null` (A/B), o `WHERE estado IN` do decidir, o
`quem_fecha` no fechamento do merge.

## Riscos

1. **Regressão fora de tarefa** (A e C mexem em `pedir_a_pessoa` e no destino de tudo): mitigado pelo teste de
   snapshot "fora de tarefa = hoje" e por `seBastidor` só valer com a marca do turno.
2. **Esconder do chat algo que pede ação** (C): a regra "na dúvida, chat" da ADR-114 continua; só sai o que é de
   bastidor. A Atividade ganha o filtro "Tarefas".
3. **Concorrência card × Sua vez × fala** (A): trava do quadro + update condicional; teste dedicado.
4. **Conflito com a ADA-15** (mesmo `quadro.responder`, mesma faixa de migração): ordem fixa abaixo; a ADA-15 entra
   antes e este PR A rebaseia por merge.
5. **Convivência de `voce` antigas e novas** (A): sem backfill, tarefas antigas em "Precisa de você" não aparecem
   na Sua vez até serem respondidas pelo card. Aceito: o número é pequeno e cai sozinho (suposição S5).
6. **Prompt** (B): a frente de tarefa passa a receber o catálogo da tarefa; risco de perder ferramenta que a frente usa
   hoje (`devolver_resumo` precisa continuar). Teste do plano de turno da frente de tarefa.
7. **UI sem protótipo**: retrabalho de pele. Mitigado separando UI em commits próprios e usando componentes que já
   existem (cartão da Sua vez, linha discreta do chat).

## ADR

**Precisa de ADR nova: ADR-159 "A tarefa é a casa do trabalho"** (número provisório; a ADA-15 reserva a 153), escrita
no PR A. Emenda a ADR-114 (destino no chat ganha `seBastidor` e os assuntos de tarefa), a ADR-099 (frente herda a
tarefa) e a ADR-142 (passagem/fechamento com `quem_fecha`). Decide: tudo o que nasce num turno de tarefa leva o
`tarefa_id`; a espera da pessoa é sempre uma decisão; o chat só aponta. Gatilho de reversão: a pessoa perder uma
pergunta/aprovação porque ela foi só para a tarefa (medir decisões vencidas com `tarefa_id` vs. sem, 2 semanas).

## Ordem e quebra em PRs

Engenharia quebra em 5 PRs (1 PR por sub-issue; sugiro a Ada abrir ADA-28a…e):

| # | PR | Depende de | Commits |
|---|---|---|---|
| 1 | **C: chat limpo** | nada | `destino`: `seBastidor` + tabela; `servidor`: marca `tarefa` na mensagem; `web`: timeline sem turno de tarefa e linha `tarefa.resultado`; testes |
| 2 | **ADA-15** (PR #696, outra frente) | nada | — |
| 3 | **A: Precisa de você único** | 1 (assunto `tarefa.precisa`), 2 (`quadro.responder`) | `docs`: ADR-159; `db`: 0157 + repos; `domain`: decisão da tarefa; `pedir_*` em turno de tarefa; `quadro.responder`/`cartoes.*` resolvem os dois; Sua vez com `tarefa`; web: cartão na tarefa; testes; prompt |
| 4 | **B: frente ligada** | 1; pode ir em paralelo com 3 | `db`: 0154; `abrirLote` + origem `tarefa`; `tarefaDoTurno` pela frente; fechamento vira comentário; card "frente"; artefato na tarefa; testes |
| 5 | **D: comentário diz se aciona** | 1 | `domain`: `previaDoComentario` + uso no `comentarTarefa`; web: prévia no campo; resposta de colega no fio; teste "bot não aprova" |
| 6 | **E: quem fecha** | 3 (decisão com `tarefa_id`), 2 (Dar Done pela fala) | `db`: 0155; `quadro.editar.quem_fecha`; terminei/merge criam `tarefa_done`; Dar Done; paridade; testes |

Caminho crítico: 1 → (2) → 3 → 6. 4 e 5 entram quando houver folga, depois de 1.

## Suposições para a Ada e o Gil confirmarem

Produto (Ada):
- **S1** `pedir_acesso` e `pedir_credencial` entram na mesma regra do A (são "aprovação de efeito externo" pela d1).
- **S2** Responder pela Sua vez continua o **mesmo** turno (a retomada), sem abrir um turno novo na tarefa.
- **S3** Com aprovação automática (modo "Ignorar todas"), a tarefa não para; vira comentário de sistema na tarefa.
- **S4** Com `quem_fecha=pessoa`, o merge do PR **não** fecha a tarefa: pede o Done (contraria a NOD-421 nesse modo).
- **S5** Sem backfill: as tarefas que já estão em "Precisa de você" seguem como hoje até serem respondidas.
- **S6** Linhas antigas do chat não mudam de lugar (sem reescrever o passado).
- **S7** A falha do turno de tarefa vai para a Atividade + comentário na tarefa; no chat só se a tarefa ficou parada
  (Bloqueado), como linha `tarefa.precisa`.
UI (Gil, sem protótipo):
- **U1** No chat, a linha de tarefa é cinza, uma linha, com o código como link ("ADA-28 precisa de você · abrir").
- **U2** Na tarefa, a decisão aberta é o mesmo cartão da Sua vez, no topo do detalhe, com cara de mensagem do bot.
- **U3** O card do quadro mostra um ponto e "precisa de você" / "trabalhando numa frente" no lugar do estado do avatar.
- **U4** A prévia do comentário é texto pequeno sob o campo, sem ícone, atualizado a cada tecla.
- **U5** "Quem dá o Done" mora no menu "…" do quadro, com duas opções em rádio.
- **U7** Linha `tarefa.*` de uma tarefa já excluída: texto sem link, "ADA-28 (removida)" (estado vazio, nada quebra).
- **U6** Na Sua vez, o item de tarefa tem o código e o título como primeira linha e "Dar Done" como ação principal.

## Fora do escopo

A tarefa com faixa própria (ADA-16); dividir o `gerir_quadro` em ferramentas de etapa × tela (pista do estudo, issue
própria); tirar o manual do quadro do prompt do chat (4.7 do estudo); a pílula do quadro escrevendo no chat (4.8); a
rotina com `repetir_trabalho` (4.9); aprovação "o resto desta tarefa" atravessando para a tarefa do quadro (4.10).
Sugiro issues de follow-up para cada um.

## Revisão de engenharia (/plan-eng-review, sem interação)

A frente roda sem ninguém para responder, então as decisões foram tomadas pela recomendação e ficam registradas aqui.

- [P1] (confiança 8/10) `src/use-cases/decidir.ts:240`, `const r = await enfileirarRetomada(...)`: resolver a decisão
  já enfileira a retomada. Se o `quadro.responder` também abrisse o turno de `entradaDaResposta`, a mesma resposta
  acordaria o bot duas vezes. **Aceito:** com decisão ligada, só a retomada continua (escopo A, item 3), com teste.
- [P2] (confiança 9/10) `src/db/migrations/0002_dominio.sql`, `agente_id uuid NOT NULL, conversa_id uuid NOT NULL,
  prazo_decisao_em timestamptz NOT NULL`: o backfill criaria decisões sem turno para retomar e com vencimento em massa.
  **Aceito:** backfill cortado (S5).
- [P3] (confiança 7/10) `quadro_tarefas.decisao_id` duplicava `decisoes.tarefa_id`. **Aceito:** coluna cortada.
- Verificado: `ON DELETE SET NULL (col)` precisa de PG 15+, e o CI e o compose usam `postgres:16`.
- Arquitetura: um ponto de ligação só (`tarefaDoTurno`), sem serviço novo. Performance: a Sua vez faz uma consulta a
  mais por lote de ids, e os índices são parciais por tarefa aberta. Nada em laço.
- Voz de fora (Codex): **não rodou** nesta frente. Fica para o /review do PR A, que mexe em concorrência e migração.

## Revisão de design (/plan-design-review, sem protótipo)

Sem o protótipo do Gil, a revisão cobriu hierarquia, estados vazios e de erro e reuso de componentes, não a pele.
Saíram daqui a U7 (tarefa removida) e a regra de reaproveitar o cartão da Sua vez e a linha discreta do chat. As
decisões de UI de U1 a U7 são suposições até o Gil validar.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /plan-eng-review | arquitetura, dados, concorrência, testes | 1 | DONE (decisões auto pela recomendação) | 3 achados (P1 turno duplo, P2 backfill, P3 coluna espelho), todos aceitos e aplicados; Codex não rodou |
| Design review | /plan-design-review | tem UI e não há protótipo | 1 | DONE (por suposição) | U1–U7 abertas para o Gil |
| Ação no chat | /acao-no-chat | paridade tela × chat | 1 | DONE | nenhuma ação nova; emendas em `quadro.editar`, `quadro.mudar_tarefa`, `quadro.responder`; piso igual |

VERDICT: pronto para quebrar em sub-issues; a UI espera o protótipo do Gil para a pele, não para a engenharia.

NO UNRESOLVED DECISIONS
