# Pendências de contrato — L4 EXECUTOR (para a L9)

Cada item: o que falta, onde, por quê, e como a L4 contornou sem cruzar a fronteira.

## 1. `EventoStream` não tem o evento `catcher` — `src/contracts/turno.ts`

**O plano dizia:** o catcher emite `sinks.evento({tipo:'catcher', dados})` e o servidor persiste em
`catcher_registros`. **A união `EventoStream` é fechada** (init | delta | tool_use | tool_result |
result | rate_limit | ignorado) e a L4 não edita `src/contracts`.

**Contorno:** `criarCatcherDriver({ aoRegistrar })` em `src/adapters/executor/drivers/catcher.ts`
recebe um callback `(r: {turnoId; tipo; dados}) => void` com `tipo` snake_case
(`plano_recebido` | `tool_use` | `tool_result` | `resultado`, casando o CHECK `catcher_registros_tipo`).
A L9 liga `aoRegistrar` a `services.catcher.registrar(trx, turnoId, tipo, dados)` dentro de uma tx
escopada. Os eventos de stream do catcher continuam sendo `EventoStream` normais (tool_use/tool_result).

**Se preferir o contrato:** acrescentar `| { tipo: "catcher"; dados: Record<string, unknown> }` a
`EventoStream` e trocar `registrar(...)` por `sinks.evento(...)` no driver (uma linha por registro).

## 2. `KindEvento` não tem kind para progresso de turno — `src/contracts/evento.ts` × `PedidoRenovar.eventos`

**O plano dizia:** `renovar` viaja com `sinais + eventos` (ADR-009). `PedidoRenovar.eventos` é
`RuntimeEvent[]` e `KindEvento` não tem valor para "o CLI chamou uma ferramenta / produziu delta"
(os kinds são de domínio: turno_criado, decisao_criada, negacao…).

**Contorno:** `iniciarLaco` manda `eventos: []` em cada renovação e expõe `aoEvento(plano, ev)` /
`aoDelta(plano, texto)` para quem persiste/publica in-process (L9: catcher_registros, trilha, SSE).
Os sinais (o que o ADR-009 exige) viajam completos. Quando a ponte virar HTTP, o lote de eventos
precisa de um kind (`turno_progresso`?) ou de um payload próprio em `PedidoRenovar`.

## 3. `package.json` sem o script `sonda` — critério manual do plano

`npm run sonda` não existe e a L4 não edita `package.json`. O script está em `scripts/sonda.ts` e
roda com `node scripts/sonda.ts` (Node 24 executa .ts direto) ou `npx tsx scripts/sonda.ts`.
**Pedido à L9:** `"sonda": "node scripts/sonda.ts"` e `"sonda:mcp-timeout": "node scripts/sonda-mcp-timeout.ts"`.

## 4. `LONGPOLL_APROVACAO_MS` continua "definido", não "medido" — `src/shared/constantes.ts` (L1)

`scripts/sonda-mcp-timeout.ts` está pronto mas NÃO foi rodado (cada ponto custa um turno real e o
critério de pronto da L4 não o pedia). Quem rodar grava ao lado da constante
`medido em <data>: <N> s (scripts/sonda-mcp-timeout.ts)`. Até lá o driver passa
`MCP_TOOL_TIMEOUT = max(60 s, prazoMs)` ao CLI (`montarEnvDoFilho`).

## 5. Drivers são fábricas, não constantes — `src/adapters/executor/drivers/{claude-cli,catcher}.ts`

**O plano dizia** `claudeCliDriver.meta = …` (constante). O driver claude-cli precisa saber a URL
do nod e o caminho do proxy para escrever o `mcp.json`, e `ConfigDriver` (spi.ts, L2) não tem esses
campos — nem pode vir pelo env, que a denylist limpa de `NOD_*`. **Contorno:**
`criarClaudeCliDriver({ urlNod, proxyPath, nodePath?, modeloSonda? })` e
`criarCatcherDriver({ urlNod?, aoRegistrar?, atrasoMs? })`; `catcherDriver` (sem ligação) existe
como constante. A L9 compõe: `criarRegistry(process.env, [criarClaudeCliDriver({urlNod, proxyPath}), criarCatcherDriver({urlNod, aoRegistrar})])`.

## 6. `rotas/inventario.ts` não foi criada (EMENDA 4)

O plano listava `src/adapters/http/rotas/inventario.ts` nos arquivos da L4; a EMENDA 4 dá a rota à
L9 e proíbe rota na L4. O serviço que a rota consome está pronto: `criarInventario({ sondar, persistir, relogio })`
em `src/services/inventario.ts` (`obter(pessoaId, {forcar})`, `ultimo`, `invalidar`).
`sondar` da L9 = `registry['claude-cli'].instance.sondar()` (ou `sondar(bin, env, modelo)` de
`src/adapters/executor/sonda.ts`); `persistir` = `repos.inventario.registrar('claude-cli', inv)` numa tx.

## 8. `tests/fixtures/claude-falso.mjs` (L3): os knobs do modo json não casam com o CLI real

Medido em 2026-09-16 (um turno haiku real, US$0,014): o `--output-format json` do CLI 2.1.272 NÃO
traz `apiKeySource` (chaves: type, subtype, is_error, result, session_id, total_cost_usd, usage,
modelUsage, permission_denials, duration_ms, num_turns…); o campo só existe no `system/init` do
stream-json. A sonda da L4 usa stream-json e lê o init (fail-closed: init sem o campo → nao_autenticado).
Os knobs `NOD_FALSO_NAO_AUTENTICADO` / `NOD_FALSO_API_KEY_SOURCE` do binário falso só atuam no modo
json e ficaram sem uso; os cenários equivalentes vivem como shims próprios em
`tests/integration/executor/sonda-falsa.test.ts`. Sugestão à L3/L9: mover os knobs para o modo
stream-json (init com `apiKeySource` configurável) ou apagá-los.

## 9. `~` em NOD_CLAUDE_BIN expande contra $HOME — o critério manual "HOME temporário" precisa de caminho absoluto

`.env.example` traz `NOD_CLAUDE_BIN=~/.local/bin/claude`. Com `HOME=$(mktemp -d)`, o `~` expande
para o HOME temporário e a sonda diz `ausente` (correto para o que foi pedido). O critério "CLI
presente, sem login" foi verificado com `NOD_CLAUDE_BIN=/Users/<pessoa>/.local/bin/claude` absoluto
→ `nao_autenticado` (`turno_de_sonda_exit_1`). Alternativa, se a L9 preferir: expandir `~` com
`os.userInfo().homedir` (lê o passwd, ignora $HOME) — decisão de produto, não da L4.

## 7. `catcher.ts` importa `tests/helpers/catcher-roteiro.ts` por caminho

Autorizado pelo plano ("importado por caminho ou copiar"); a L3 registrou que é feio. O Dockerfile
faz `COPY . .`, então o arquivo está na imagem. Se a L9 quiser, move `catcher-roteiro.ts` para
`src/adapters/executor/roteiro-catcher.ts` e ajusta os dois imports (driver e `tests/helpers/driver-falso.ts`).
