# Pendências de contrato deixadas pela L8 (SSE, outbox, Sua vez, métricas, web-lib)

Nenhuma lane de ordem 4 edita `src/contracts`, `src/domain`, `src/db` ou `src/repositories` (EMENDA 18).
O que a L8 precisou e não existia foi contornado localmente, sem quebrar fronteira; a L9 resolve.

## 1. `ComDeps` / `DepsSuaVez` — onde mora o "abrir tx + montar Deps" da rota (L9)

- **Onde está hoje:** `src/adapters/http/rotas/sua-vez.ts` exporta
  `type ComDeps = <T>(escopo: Escopo, fn: (deps: DepsSuaVez) => Promise<T>) => Promise<T>` e
  `src/use-cases/listar-sua-vez.ts` exporta `DepsSuaVez = Pick<Deps, "repos" | "escopo" | "agora" | "tx">`.
  `rotas/dev.ts` importa o tipo de `rotas/sua-vez.ts`.
- **O que precisa:** um único lugar (sugestão: `src/adapters/http/compor.ts` ou `src/adapters/http/deps.ts`, L9)
  que abra `abrirTxEscopada(db, escopo)`, monte `Deps` completas sobre o trx e rode `fn` dentro — e que as
  rotas de todas as lanes recebam essa função. Uma `ComDeps` de `Deps` completas é atribuível à da L8
  (o parâmetro é mais estreito), então a L9 pode passar a dela sem adaptador.
- **Motivo:** os testes da L8 injetam uma `ComDeps` sobre o trx do withRollback (`tests/integration/web-sem-app.test.ts`);
  em produção a transação é da borda (Leapy §1) e os `events` devolvidos pelo caso de uso vão para
  `repos.events.gravarComOutbox` na MESMA tx — a rota de reabrir já faz isso.

## 2. `/metrics` na raiz × roteador que só casa públicas sob `/api` (L9 ou L1)

- **Onde está hoje:** `criarRotaMetricas` é `publica: true` com `padrao: /^\/metrics$/` → responde em
  **`/api/metrics`**, porque `criarRoteador` (L1) só roteia públicas dentro de `/^\/api(\/.*)$/`. A tabela
  `ROTAS` de `src/contracts/api.ts` nomeia `"/metrics"` (raiz). `responderMetricas(res)` fica exportado.
- **O que precisa:** ou (a) a L9 monta `responderMetricas` antes do roteador (ou no `fallback`) para
  `GET /metrics` na raiz, ou (b) a tabela `ROTAS` passa a dizer `"/api/metrics"`. Escolher uma e registrar.
- **Motivo:** Prometheus por convenção raspa `/metrics`; a L8 não pode editar `roteador.ts` nem `api.ts`.

## 3. `gastosRepo.somarMes` não filtra por executor (L3/L9) — e `custo_servidor_mes` é 0 por construção

- **Onde está hoje:** `coletarGauges` (src/adapters/fundo/despachar-outbox.ts) registra
  `custo_servidor_mes{tenant_id} = 0` sem consultar o banco.
- **O que precisa:** `somarMes(agora, executor?: Executor)` (ou um `somarMesPorExecutor`) — e o próprio
  `Executor` (`src/contracts/evento.ts`) ganhar o valor do executor de servidor quando ele existir.
- **Motivo:** nesta rodada `Executor = 'local' | 'catcher'` (ADR-022/028): todo turno roda na máquina da
  pessoa com a assinatura DELA; `somarMes` soma esse custo local. Publicar isso como "custo do executor de
  servidor" seria um número errado com nome certo (ADR-017: métrica que não gera decisão sai).

## 4. Quem alimenta as métricas que não são da L8 (L6/L7/L9)

- `expiracao{causa}`: quem roda `decisoesRepo.vencerPendentes` (varredor de expiração, L7) chama
  `metricas.incrementar({ metrica: "expiracao", causa: d.desfecho.tipo, tenant_id })` por decisão vencida —
  o repo já devolve os dois rótulos; `tests/integration/metricas.test.ts` mostra a ligação.
- `pos_restart{desfecho, origem}`: quem assenta turno retomado/perdido após reinício (L6 assentar-turno /
  varredor-lease, L9 boot) chama `metricas.incrementar(...)`.
- `polls_abertos`: a L8 conta conexões SSE; quando a ponte HTTP (ADR-021) entrar, o long-poll do `puxar`
  usa a mesma gauge (mesmo rótulo, valor somado por pessoa) — decidir se vira série separada por `origem`
  exige editar o union de `src/obs/metricas.ts` (é da L8; pode ser feito na L9 com este arquivo como aviso).

## 5. Frame por kind de evento: `turno_criado` e `turno_despachado` viram o mesmo `turno.iniciado`

- **Onde está hoje:** `FRAME_POR_EVENTO` em `src/adapters/fundo/despachar-outbox.ts` (tabela TOTAL sobre
  `KindEvento`). O frame carrega `dados.kind` com o kind original, então a web distingue "na fila" de
  "rodando" por `dados.kind`, não pelo tipo do frame. `concessao_criada` → `agente.mudou` (a frota muda
  "sem acessos").
- **O que precisa (opcional):** se a L9 preferir um `TipoFrame` `turno.criado`, é edição de
  `src/contracts/frame.ts` + `TIPOS` em `web/lib/live-events.ts` (o compilador cobra a chave nova).

## 6. Kind de evento para "reaberta"

- **Onde está hoje:** `reabrirDecisao` emite `kind: "decisao_criada"` com `dados.reaberta = true`
  (`KindEvento` não tem `decisao_reaberta`), dirigido à pessoa da sessão (quem reabriu é quem está olhando
  a fila; o outbox só aceita `owner_id` = pessoa da sessão sob RLS).
- **O que precisa (opcional):** um `decisao_reaberta` em `KindEvento` (+ enum/`FRAME_POR_EVENTO`) se a
  trilha de eventos quiser distinguir criação de reabertura sem olhar `dados`.

## 7. `listarSuaVez` carimba `vista_em` (decisão registrada; não é pendência, é aviso)

Listar a fila como decisora = ver (`marcarVista`, idempotente por coalesce) — é o único sinal que separa
`expirou_sem_ninguem_ver` de `expirou_com_alguem_ciente`. Consultas de fundo passam `{ marcarVista: false }`.
Se a L9 quiser o carimbo só quando a web de fato renderizar (e não no GET), é uma flag de rota.
