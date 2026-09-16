# ADR-017 — Um container, sete métricas ligadas a promessa de produto, e um alarme externo de disponibilidade

**Frente** Deploy · **Status** decidido · **Épicos** E3, E4, E7, E9, E10

## Decisão

Web, worker de turno, scheduler de rotina e varredor de expiração no mesmo processo e container, num PaaS gerenciado (Railway ou Fly), com Dockerfile honesto que roda em qualquer lugar. Sete instrumentações no dia 1: (1) idade da pendência mais velha não decidida; (2) taxa de expiração por falta de decisão, com dois rótulos (expirou_sem_ninguém_ver / expirou_com_alguém_ciente); (3) duração de checkout do pool; (4) turnos retomados versus perdidos após restart; (5) custo de modelo por tenant no mês; (6) distância até a partição futura mais próxima; (7) taxa de resumed:false. Mais um ALARME EXTERNO que pagina: health check de fora contra o endpoint da fila. Rótulo de métrica é union fechado em TypeScript, nunca Record<string,string>.

## Contexto

Os dois repos mostram extremos: grep por 'prometheus' e 'opentelemetry' em todo server/ do OpenMausBot não retorna nada; o Buzz tem instrumentação séria mas de infraestrutura. E nenhuma das cinco métricas propostas pelas frentes responde 'o sistema está fora do ar?' — são painéis que alguém olha, não alarmes que acordam.

## Alternativas rejeitadas

### Web e worker em containers separados desde o dia um

Dobra a superfície de deploy e força comunicação entre processos antes de saber a forma dela. O Buzz, o mais maduro dos dois, roda um binário só (Dockerfile:1-12 constrói buzz-relay e o bundle web numa imagem debian-slim) e o chart tem um Deployment, não dois. O OpenMausBot sobe dois serviços no compose (omb e caddy) e o caddy roda com network_mode: service:omb — é sidecar de TLS, não segundo componente.

### Kubernetes com Helm, como o Buzz

deploy/charts/buzz/values.yaml tem 405 linhas, values.schema.json 307, templates/deployment.yaml 267 — perto de mil linhas de configuração antes da primeira linha de produto. O Buzz sustenta porque é infraestrutura distribuída open-source com operadores terceiros. O nod tem 70 clientes num produto SaaS: seria imitação de escala que não existe.

### VPS com Docker Compose + Caddy

docs/deploy-vps.md tem 397 linhas para chegar num servidor funcionando, server/caddy.ts tem 221 só para baixar e verificar o Caddy com sha512 fixado por plataforma, server/tunnel.ts tem 315 para dar endereço público. É código de infraestrutura que o PaaS entrega de graça — e o próprio documento admite que o teste de lançamento não cobriu 'reautenticação de provedor e migração de login de browser'.

### Só CPU, memória e uptime

Não detectam o modo de falha que mata o nod. Uma pendência que expira porque ninguém olhou não move CPU: o container fica saudável enquanto o produto falha em silêncio.

### Fila externa (Redis/SQS) já na Fase 1

readiness.rs:17-31 do Buzz mostra o preço: redis_pool_timeout e redis_pool_error entre as razões de não-prontidão — mais uma dependência que derruba o serviço. Com Postgres já no caminho crítico, estado em tabela dá a mesma semântica sem um segundo servidor para operar.

## Evidência

A ausência é a evidência mais forte: em OpenMausBot, grep -rli 'prometheus' e 'opentelemetry' em server/ não retornam nada. No Buzz o que existe é de infra e é bom: crates/buzz-relay/src/metrics.rs:244-257 define buzz_db_pool_acquire_duration_seconds, _attempts_total e _waiters; crates/buzz-datastore-tracing/src/lib.rs:143-152 emite buzz_db_operation_duration_seconds por operação. Para custo por tenant a referência é server/usage-ledger.ts:24-39 (uma linha por turno com botId, model, input, output, cachedInput, costUsd) e server/spend.ts:31-41. Cardinalidade: metrics.rs:298-303 recusa gravar métrica para rota não casada 'para evitar bomba de cardinalidade'. E sobre o que NÃO formatar: crates/buzz-datastore-tracing/src/lib.rs:70-76 diz que a política é imposta pela macro — span de Postgres sempre omite argumentos e um Err marca otel.status_code sem inspecionar o erro. Nota honesta: no Buzz essa regra é sustentada só pelo compilador e review, sem teste nem job de CI.

## Consequências

- Deploy derruba o worker junto com o web. E9 deixa de ser épico e vira exigência de deploy: todo turno precisa ser retomável porque todo deploy o interrompe.
- A métrica (1) é a que mais dói e mais vale: vender 'sua vez' e a pendência mais velha ter dois dias é a falha que perde cliente, e é invisível sem ela. A (4) é a única prova de que E9 funciona.
- O rótulo por tenant tem cardinalidade segura com 70 clientes e insegura com 700. E — cuidado que nenhum dos dois repos resolve — rótulo de métrica NUNCA leva id ou e-mail de aprendiz. A trava é o union fechado em TypeScript, porque o compilador recusa o rótulo novo e uma regra de lint se desliga com um comentário.
- O provedor de métricas e o de log entram no inventário de tratamento de dados e no contrato de operador (LGPD art. 39), com retenção mais curta que a do Postgres. Nenhuma frente os mencionou como lugar onde dado pode parar.
- Escala vertical é o único botão por um bom tempo. Para 70 clientes de RH em horário comercial brasileiro, basta.
- O coletor é escolhido POR NOME antes do primeiro deploy, não por categoria — 'um coletor hospedado que fala Prometheus' não é escolha, e deixá-la em aberto significa que a instrumentação do dia 1 não acontece no dia 1.

## Reversibilidade

barata para acrescentar métrica, cara para retroagir — histórico não existe antes da instrumentação. Separar o worker depois é subir o mesmo container com comando diferente, desde que a unidade de trabalho seja linha de tabela reivindicada e o worker nunca chame função interna do web. Sair do PaaS para VPS é uma tarde se o Dockerfile for honesto e nenhum serviço gerenciado do provedor virar dependência de código.

## Revisitar quando

Quando um incidente for diagnosticado sem que nenhuma das sete tenha apontado para ele: a métrica que faltou é a oitava. E quando o p95 de HTTP piorar durante turno de agente, ou quando um cliente exigir contratualmente rodar no próprio ambiente.

