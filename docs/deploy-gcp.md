# Produção na GCP

O nod de produção roda no projeto `nod-producao`, em São Paulo (`southamerica-east1`). Os arquivos
estão em [`infra/gcp/`](../infra/gcp/) e a configuração não secreta em
[`infra/gcp/config.env`](../infra/gcp/config.env).

## O que existe

| Peça | Recurso | Por quê |
|---|---|---|
| Servidor | VM `nod-vm` (Compute Engine, `e2-medium`, Debian 12) com Docker: as duas cores do nod (`nod-azul`, `nod-verde`; uma ativa) e o Caddy | Uma instância com estado em memória, long-poll de até 35 s e SSE (ADR-001, ADR-017, ADR-021) descartam Cloud Run |
| HTTPS | Caddy, certificado automático | Único processo com porta aberta para a internet (80/443) |
| Banco | Cloud SQL `nod-pg`, PostgreSQL 16, só IP privado, backup diário e PITR de 7 dias | RLS forçada e três papéis (ADR-003); conexão direta, pool de 5 (ADR-001) |
| Segredos | Secret Manager (`nod-*`) | Senhas do banco, segredo da sessão, chave do cofre (ADR-015, ADR-031) e o cliente OAuth |
| Imagens | Artifact Registry `nod` | Cada deploy publica `nod:<sha do commit>` |
| Rede | VPC `nod-vpc`; 80/443 abertas; SSH só pelo IAP | A VM não aceita SSH da internet |
| Deploy | `.github/workflows/deploy.yml` | Depois do `ci` verde num push ao `main`; autenticação por Workload Identity Federation |

Contas de serviço: `nod-vm` (lê segredos e imagens, escreve logs), `nod-deploy` (publica imagens e
entra na VM pelo IAP) e `nod-ensaio` (clona o banco e apaga só as cópias `nod-pg-ensaio-*`, para o
[ensaio de restauração](runbook-producao.md#5-como-rodar-o-ensaio)). Só o repositório `gamefik/nod`,
na branch `main`, pode usar as duas últimas.

## Como um deploy acontece

1. Push no `main` → o `ci` roda → se passou, o `deploy` começa.
2. O workflow gera a imagem do `Dockerfile` e publica `nod:<sha>`.
3. Copia `config.env`, `compose.yml` e `deploy.sh` para `/opt/nod` na VM. O `Caddyfile` vai em estágio, como
   `/opt/nod/Caddyfile.novo` (NOD-331): um restart do Caddy ou da VM antes da troca relê o Caddyfile em uso.
   A tag do deploy vai junto em `Caddyfile.novo.tag`: o `deploy.sh` só promove o estágio da própria tag.
4. `deploy.sh` (NOD-218, azul/verde) faz, nesta ordem:
   1. Reconcilia um deploy interrompido: se as duas cores estão de pé, drena a que não é a do marcador;
      se o marcador aponta para uma cor parada e a outra roda, o marcador passa à que roda.
   2. Escolhe a cor **nova** (a parada) e grava `/opt/nod/nod-<nova>.env` a partir do Secret Manager.
      O env da cor velha, que ainda drena, não é tocado. As imagens de cada cor ficam em `/opt/nod/imagens.env`.
   3. `pull` e migrações como `nod_dono` com a imagem nova; se a migração falha, sai antes de subir nada.
   4. Sobe a cor nova e espera o healthcheck (`/api/saude`, até 90 s). A saúde inclui o banco: `select 1`
      com prazo de 2 s, senão 503 (NOD-175). Se não ficar saudável: logs, para a nova, marcador intocado.
   5. Troca o marcador `/opt/nod/estado/cor-ativa` (`tmp` + `mv`). Em até 500 ms a nova liga os laços e
      passa a responder 200 em `/api/saude/lb`; a velha passa a 503 `inativa`. Se o `Caddyfile.novo` difere do
      em uso, ele é promovido agora (o em uso vira `Caddyfile.anterior`) e o Caddy é recriado; se é igual, só
      some o estágio, sem recreate.
   6. Confirma pelo Caddy local, 3 vezes seguidas em até 15 s, que `/api/saude/lb` responde a cor nova.
      Se não: o marcador volta para a velha, o `Caddyfile.anterior` volta (com recreate do Caddy), a nova
      para, exit 1. Confirmou: o `Caddyfile.anterior` é apagado.
   7. Para a velha com `stop -t 660` (drenagem de até 10 min, `NOD_DRENAGEM_MAX_MS`) e fecha as ligações
      de voz que ficaram com `instancia` = cor velha (`scripts/ligacoes-orfas.ts`). São 3 tentativas, 5 s entre
      elas (NOD-331). Falhando as 3, o deploy segue (exit 0) e grava a pendência em
      `/opt/nod/estado/orfas-pendentes` (uma linha `<cor> [--transicao]`). O deploy seguinte a retoma logo
      depois da reconciliação, antes de subir a cor nova, com a imagem da ativa; a pendência da própria cor
      ativa é descartada (o boot dela já fechou as dela).

   O env leva as duas URLs: `DATABASE_URL` (nod_app, das requisições) e `DATABASE_URL_DONO`, que o
   boot usa só para criar as partições de `events` (ADR-006) e fecha em seguida.

O deploy não derruba o nod (ADR-001, emenda de 2026-10-22). O Caddy (`lb_policy first`, health check
a cada 1 s em `/api/saude/lb`) manda tudo para a cor ativa; a velha drena sem receber pedido novo. Ao
drenar, a velha para os laços, fecha os SSE (o navegador reconecta na nova e reidrata) e aceita o token
de turno só se o banco disser que o turno segue `despachando`. A cada 5 s ela confere no banco os tokens que
ainda espera e solta os dos turnos que a cor ativa já assentou (NOD-331): esses não seguram o deploy até o teto. Os Macs são reconhecidos pela nova pelo
409 de sempre (reanunciam). Desde a NOD-214, o turno que um Mac atualizado está rodando segue rodando: o
processo novo o reconhece pelo token de turno (o hash fica em `turno_credenciais`). Só a ligação de voz
com mais de 10 min cai, com a linha "A ligação caiu porque o nod foi atualizado. Ligue de novo." Um
deploy manual: Actions → deploy → Run workflow.

**Migração compatível com N-1.** A versão velha roda sobre o esquema novo por até 10 min. Coluna nova
entra nula ou com default; renomear ou remover leva dois deploys (primeiro o código para de usar, depois
a migração remove). Migração que quebra a versão anterior derruba a cor que drena.

### Qual cor está no ar

```bash
cat /opt/nod/estado/cor-ativa                         # a cor do marcador
curl -s https://<domínio>/api/saude/lb                # {"ok":true,"cor":"verde"}: o que o Caddy enxerga
sudo docker compose --env-file /opt/nod/imagens.env -f /opt/nod/compose.yml ps   # quem roda
cat /opt/nod/imagens.env                              # a imagem de cada cor
```

### Rollback

Volte para a tag anterior (o sha do commit, que está em `imagens.env` na cor parada):
`sudo /opt/nod/deploy.sh <tag-anterior>`. É um deploy normal, sem queda: sobe a tag velha na cor parada
e troca. Migração não volta sozinha: por isso a regra do N-1. Uma tag de antes da NOD-218 (sem
`/api/saude/lb`) é recusada pelo `deploy.sh` antes de migrar: o Caddy nunca a escolheria e o boot dela
fecharia as ligações vivas da cor ativa. Para voltar a ela, use "Reverter a transição" abaixo.
Um `Caddyfile.novo` que sobrou de um deploy que falhou antes da troca é de outra tag (`Caddyfile.novo.tag`):
o rollback não o promove (avisa e segue com o Caddyfile em uso, sem recreate do Caddy); o próximo deploy do
workflow o substitui.

### Deploy de transição (o primeiro depois da NOD-218)

O primeiro deploy encontra o container antigo `nod` (serviço único) e nenhum marcador. Ele sobe a
`nod-azul` ao lado, recria o Caddy uma vez com o Caddyfile novo (alguns segundos de queda: faça fora do
horário de ligação), confirma a azul e só então para e remove o `nod` antigo e fecha as ligações dele
(`--instancia legado --transicao`). O `nod` antigo sai com `stop -t 30` (`NOD_TRANSICAO_STOP_S`, NOD-331), não
660: depois do recreate do Caddy ninguém mais o alcança, e drenar 10 min só deixaria os laços dele rodando em
dobro com os da azul. O `/opt/nod/nod.env` antigo fica, sem uso.

### Reverter a transição

Se a transição falhar na confirmação, o script desfaz sozinho (NOD-331): devolve o Caddyfile anterior,
recria o Caddy, confirma 3 vezes por ele que o `nod` antigo responde `/api/saude` e só então para a azul e
apaga o marcador (o próximo deploy refaz a transição). Sai com erro "transição desfeita".

Se o recreate falhar ou o `nod` antigo não responder pelo Caddy, o script deixa a azul, o marcador e o `nod`
antigo de pé e sai com erro apontando esta seção. O plano B, manual, na VM:

```bash
# 1. No seu computador, com o checkout no commit anterior à NOD-218:
git checkout <sha-anterior>
gcloud compute scp infra/gcp/vm/{compose.yml,Caddyfile,deploy.sh} nod-vm:/tmp/ \
  --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao
# 2. Na VM:
cd /opt/nod
sudo docker compose --env-file imagens.env stop -t 660 nod-azul caddy
sudo docker compose --env-file imagens.env rm -f nod-azul caddy
sudo rm -f estado/cor-ativa .caddyfile.sha Caddyfile.novo Caddyfile.novo.tag Caddyfile.anterior
sudo cp /tmp/compose.yml /tmp/Caddyfile /tmp/deploy.sh . && sudo /opt/nod/deploy.sh <sha-anterior>
```

## Estado em 2026-10-02

Já existe e está no ar: projeto `nod-producao` (com o faturamento dos créditos GFS), rede, firewall,
IP fixo `34.39.164.139`, VM `nod-vm` com Docker, Cloud SQL `nod-pg` (IP privado `10.183.96.3`),
segredos gerados, Artifact Registry, contas de serviço e Workload Identity Federation. O banco `nod`
existe **vazio**: só os papéis `nod_dono`/`nod_app`/`nod_poda` e as extensões. A imagem de produção
já foi construída uma vez pelo Cloud Build (tag `validacao`).

Falta, nesta ordem: levar os dados (opcional), o cliente OAuth, e o merge que dispara o primeiro
deploy. **Não faça o merge antes de levar os dados**: o deploy roda as migrações, o banco deixa de
estar vazio e a importação passa a ser recusada.

## Primeira subida, no computador que tem o banco do dia a dia

1. Prepare o computador (uma vez):

   ```bash
   brew install --cask gcloud-cli
   export PATH=/opt/homebrew/share/google-cloud-sdk/bin:$PATH   # ou ponha no ~/.zshrc
   gcloud auth login                       # a conta que administra o nod-producao
   gcloud config set project nod-producao
   git fetch && git checkout feat/deploy-gcp
   ```

   O Postgres local precisa estar de pé (`docker ps` mostra `nod-postgres`). Se o container tiver
   outro nome, use `NOD_PG_CONTAINER=<nome>` no passo 2.

2. Leve os dados (pule para começar com o banco vazio):

   ```bash
   ./infra/gcp/levar-dados.sh
   ```

   O script mostra quantas migrações o banco local tem e pergunta se é o banco certo antes de
   enviar qualquer coisa. No fim, imprime migrações, pessoas, linhas e tabelas que chegaram ao
   Cloud SQL. Migrações que faltarem no banco local são aplicadas pelo primeiro deploy. Se a
   importação falhar no meio, esvazie o banco e repita:

   ```bash
   gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --command='sudo docker run --rm -e PGPASSWORD="$(sudo gcloud secrets versions access latest --secret=nod-pg-senha-postgres --project=nod-producao)" -e PGSSLMODE=require postgres:16 psql -h 10.183.96.3 -U postgres -d postgres -c "drop database nod with (force)"'
   ./infra/gcp/preparar-banco.sh
   ```

3. O login: siga "Cliente OAuth do Google" abaixo. Só entra quem tem e-mail na tabela `pessoas`
   do banco levado. Começando vazio, ninguém entra até existir uma pessoa: depois do primeiro deploy,
   rode o seed pela VM com `NOD_SEED_EMAIL` (ver "Operar"); ele cria você, a Vera e a sala geral.

4. Faça o merge do PR do deploy. O workflow `deploy` roda depois do `ci` e termina com
   `nod no ar: https://34-39-164-139.sslip.io`. No app do Mac, conecte com esse endereço.

## Montagem do zero (só num projeto novo)

```bash
cd infra/gcp
./provisionar.sh        # APIs, rede, Cloud SQL, segredos, Artifact Registry, VM, WIF. Idempotente.
# grave o IP privado impresso em SQL_IP no config.env
./preparar-banco.sh     # papéis nod_dono/nod_app/nod_poda, banco nod, pgcrypto e unaccent
./levar-dados.sh        # opcional, UMA vez: recusa banco não vazio
```

No GitHub, as variáveis do repositório `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA` e `GCP_ENSAIO_SA` recebem
o que o `provisionar.sh` imprime no final.

### Cliente OAuth do Google (manual)

O login de produção é `NOD_LOGIN=google` (ADR-030). O cliente OAuth só se cria pelo console:

1. https://console.cloud.google.com/auth/overview?project=nod-producao → configure a tela de
   consentimento: público **Externo**, nome "nod", e-mail de suporte seu.
2. Em **Público**, publique o app (**Em produção**). Com os escopos `openid` e `email` não há
   verificação do Google.
3. Em **Clientes** → **Criar cliente** → tipo **Aplicativo da Web**. Em "URIs de redirecionamento
   autorizados", o endereço exato: `https://<domínio>/api/sessao/google/callback`.
4. Grave o id e o segredo no Secret Manager:

```bash
printf %s 'ID.apps.googleusercontent.com' | gcloud secrets versions add nod-google-client-id --data-file=- --project=nod-producao
printf %s 'SEGREDO' | gcloud secrets versions add nod-google-client-secret --data-file=- --project=nod-producao
```

Entra quem tem e-mail na tabela `pessoas` e, desde 2026-10-05, qualquer conta Google Workspace dos domínios em
`NOD_ADMISSAO_DOMINIOS` (no `config.env`): a primeira entrada cria a pessoa, com o nome tirado do endereço. Para
abrir ou fechar um domínio, edite a linha e rode o deploy; o boot iguala a tabela `dominios_admitidos` à variável.
Fechar um domínio não tira quem já entrou. `NOD_GOOGLE_DOMINIO` não é usado em produção.

### Chave da API do revisor do Automático (ADR-115)

Desde 2026-10-25 o revisor do Automático roda no servidor, com o Claude Haiku 4.5 na conta do Nod. Com
`NOD_REVISOR=ligado` no `config.env`, o deploy lê o segredo `nod-anthropic-revisor` para `NOD_REVISOR_CHAVE`; sem
versão nele, o deploy para antes de subir a cor nova, e o servidor também não sobe sem a chave. Desligado, o segredo
nem é lido. Para ligar (depois da política de privacidade citar o envio do pedido redigido à Anthropic):

```bash
# Uma chave de API de um workspace da organização do Nod, com limite de gasto no console da Anthropic.
gcloud secrets describe nod-anthropic-revisor --project=nod-producao >/dev/null 2>&1 || \
  gcloud secrets create nod-anthropic-revisor --replication-policy=user-managed --locations=southamerica-east1 --project=nod-producao
gcloud secrets add-iam-policy-binding nod-anthropic-revisor --member="serviceAccount:nod-vm@nod-producao.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor --project=nod-producao
printf %s 'sk-ant-…' | gcloud secrets versions add nod-anthropic-revisor --data-file=- --project=nod-producao
```

O teto do gasto do dia (UTC), somando todas as contas, é `NOD_REVISOR_TETO_GLOBAL_USD` (padrão US$ 10); o gasto
corrente mora em `limites_conta`, chave `revisor:gasto_microdolares`, em microdólares. Cada pessoa tem ainda a sua cota
do dia, `NOD_REVISOR_TETO_PESSOA_USD` (padrão US$ 1), na mesma tabela, chave `revisor_gasto:<HMAC do id da pessoa>`
(com o segredo da sessão; trocar o `nod-sessao-segredo` zera as cotas do dia, não o total). Acima da cota, só as
revisões daquela pessoa viram cartão.

## Máquina na nuvem que dorme e acorda (NOD-92, ADR-121)

Com `NOD_MAQUINA_NUVEM=gcp`, a pessoa conecta a conta Google Cloud dela em Máquinas, e o nod liga e desliga a VM
dela pela API do Google. A VM e o custo ficam no projeto da pessoa, não no `nod-producao`. Sem a flag, nada muda:
as rotas `nuvem/*` dão 404, o reconciliador não sobe e a tela é a de sempre.

### No cliente OAuth do login (uma vez)

O OAuth da nuvem usa o MESMO cliente do login (`nod-google-client-id`/`-secret`), com outro callback.

1. Em **Clientes**, abra o cliente do login. Em "URIs de redirecionamento autorizados", acrescente o endereço exato:
   `https://<domínio>/api/nuvem/google/callback`. Mantenha o `/api/sessao/google/callback`.
2. Em **Acesso a dados**, acrescente o escopo `https://www.googleapis.com/auth/cloud-platform`.

`cloud-platform` é escopo sensível. Até o Google verificar o app, a tela de consentimento mostra "app não verificado"
e aceita até 100 pessoas novas. Para o uso interno, basta. Antes de abrir o nod para fora, peça a verificação.

O nod pede o token com `access_type=online` e PKCE. O token só vive na memória durante o preparo e nunca é gravado.

### No projeto da pessoa

Nada a fazer à mão. O preparo roda depois do consentimento, em segundo plano, com o token da pessoa:

- usa o projeto que ela informou ao conectar, ou cria `nod-<pessoa>-<4hex>`;
- confere o faturamento: se está desligado, vincula `NOD_NUVEM_CONTA_FATURAMENTO` ou a primeira conta de cobrança
  aberta dela;
- habilita as APIs `compute.googleapis.com` e `iam.googleapis.com`;
- cria a rede `nod-maquinas`, a conta de serviço `nod-<hash>` da pessoa, os papéis `nodMaquinasGerenciar`,
  `nodMaquinasLigar` e `nodMaquinasLer` e a chave da conta de serviço, que vai cifrada com `NOD_CREDENTIAL_KEY` para o
  banco.

A pessoa precisa poder fazer isso no projeto (dona ou editora, mais a administração de IAM). Organização que bloqueia
chave de conta de serviço falha com `credencial_nuvem` (`org_bloqueia_chave`).

### Variáveis

| Variável | Obrigatória | O que faz |
|---|---|---|
| `NOD_MAQUINA_NUVEM=gcp` | sim | Liga a feature. Qualquer outro valor (ou nenhum) desliga |
| `NOD_NUVEM_REDIRECT_URI` | não | O callback. Padrão: `NOD_URL_PUBLICA` + `/api/nuvem/google/callback` |
| `NOD_NUVEM_CONTA_FATURAMENTO` | não | A conta de cobrança (`billingAccounts/XXXXXX-XXXXXX-XXXXXX` ou só o id) vinculada ao projeto sem faturamento. Vazio: a primeira aberta da pessoa |

Sem `NOD_GOOGLE_CLIENT_ID`/`_SECRET` ou sem callback (nem `NOD_NUVEM_REDIRECT_URI` nem `NOD_URL_PUBLICA`), as rotas
existem, mas conectar responde `integracao_nao_configurada`.

**Atenção:** hoje o `infra/gcp/vm/deploy.sh` monta o `nod.env` com uma lista fixa e não leva nenhuma destas
variáveis, nem `NOD_URL_PUBLICA`. Pôr a linha só no `config.env` não liga nada. Para ligar em produção, acrescente ao
`deploy.sh`, como as do revisor, `NOD_MAQUINA_NUVEM=${NOD_MAQUINA_NUVEM:-}` e
`NOD_NUVEM_REDIRECT_URI=https://$NOD_DOMINIO/api/nuvem/google/callback` (e, se quiser,
`NOD_NUVEM_CONTA_FATURAMENTO`); depois, `NOD_MAQUINA_NUVEM=gcp` no `config.env` e rode o deploy.

### Desligar

Tire `NOD_MAQUINA_NUVEM` (ou deixe vazia) e rode o deploy. As rotas somem e o reconciliador para. As VMs ficam como
estão no Google.

**Antes, acorde as máquinas que dormem.** O filtro do `reivindicar` e a suspensão dos prazos leem `maquinas_nuvem`
com ou sem a flag. Uma linha parada em `adormecendo`, `dormindo` ou `acordando` continua segurando os turnos dessa
máquina, mesmo que a pessoa ligue a VM no console, e o prazo de 24 h sem contato não corre. Então: em Máquinas, use
Acordar em cada uma e espere Acordada (ou escolha Nunca dormir); só depois tire a flag. Se já tirou, ponha de novo,
acorde e tire outra vez.

As linhas de `maquinas_nuvem` e `credenciais_nuvem` ficam no banco. A pessoa pode apagar a chave da conta de serviço
`nod-<hash>` no console (IAM › Contas de serviço › Chaves).

## Trocar para o domínio definitivo

Enquanto `NOD_DOMINIO` está vazio no `config.env`, o endereço é `https://<ip-com-traços>.sslip.io`,
derivado do IP fixo `nod-ip`. Para trocar:

1. No DNS do domínio, um registro **A** para o IP da VM (no Cloudflare, "DNS only", nuvem cinza).
2. No cliente OAuth, acrescente `https://<domínio>/api/sessao/google/callback`.
3. `NOD_DOMINIO=<domínio>` no `config.env`, commit no `main`. O deploy reconfigura o Caddy, que
   emite o certificado novo.
4. No app do Mac, conecte de novo com o endereço novo.

Com o domínio preenchido, o Caddy continua servindo também o `<ip-com-traços>.sslip.io` no mesmo site
(`NOD_ENDERECO_PROVISORIO`, montado pelo `deploy.sh`), para os Macs que ainda têm o endereço antigo gravado. O login
Google pelo endereço antigo volta para o domínio novo, porque o callback é um só.

## Runner do CI

Desde 2026-10-06 o `ci` e o `deploy` rodam num runner próprio, a VM `nod-ci-runner` (`e2-standard-4`),
porque o repo é privado e os minutos do plano Free acabaram. Ela tem três runners: `nod-ci-1` e
`nod-ci-2` (label `nod-ci`: lint, unit e deploy) e `nod-ci-integracao` (label `nod-integracao`: o único
que sobe o Postgres na porta 5434 do host). Fica na rede `nod-ci`, separada da `nod-vpc`, sem service
account; o deploy se autentica pelo WIF, como antes. O `desktop-release` continua no runner do GitHub.

Desde 2026-10-21 há uma segunda VM igual, `nod-ci-runner-2`, com `nod-ci-3` (label `nod-ci`) e
`nod-ci-integracao-2` (label `nod-integracao`): a integração era o gargalo, com PRs de bots esperando na fila do
único runner com Postgres. Cada VM tem no máximo um runner de integração, por causa da porta 5434.

```bash
# Criar ou recriar (idempotente; precisa do gh com admin no repo)
infra/gcp/runner/provisionar-runner.sh
RUNNER_VM=nod-ci-runner-2 RUNNERS="nod-ci-3:nod-ci nod-ci-integracao-2:nod-integracao" infra/gcp/runner/provisionar-runner.sh
# Entrar na VM e ver os runners
gcloud compute ssh nod-ci-runner --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao
sudo systemctl list-units 'actions.runner.*'
```

Para recriar do zero: apague a VM, remova os runners dela em Settings › Actions › Runners e rode o script.

## Operar

```bash
# Entrar na VM (pelo IAP)
gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao
# Logs: Cloud Logging, ou na VM
sudo docker compose --env-file /opt/nod/imagens.env -f /opt/nod/compose.yml logs -f nod-azul nod-verde
# Seed (só com o banco sem pessoas): cria o dono com o e-mail do login Google
sudo bash -c 'cd /opt/nod && cor="$(cat estado/cor-ativa)" &&
  docker compose --env-file imagens.env run --rm --no-deps -T -e NOD_SEED_EMAIL=voce@exemplo.com "nod-$cor" node scripts/seed.ts'
```

Restaurar o banco (PITR, plano B, segredos) e o ensaio de restauração: [runbook-producao.md](runbook-producao.md).

O monitor de disponibilidade fica fora da GCP (ADR-017): cadastre `https://<domínio>/api/saude`
num serviço externo (UptimeRobot, Better Stack). O passo a passo e o reinício automático pelo watchdog (NOD-267) estão
em [runbook-producao.md](runbook-producao.md#7-monitor-externo-e-reinício-automático).

Custo esperado, coberto pelos créditos do programa GFS: VM `e2-medium`, Cloud SQL `db-custom-1-3840`
com 10 GB SSD, IP fixo e tráfego baixo, mais as duas VMs de runner do CI (`e2-standard-4`, disco de 100 GB cada).
