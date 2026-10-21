# Produção na GCP

O nod de produção roda no projeto `nod-producao`, em São Paulo (`southamerica-east1`). Os arquivos
estão em [`infra/gcp/`](../infra/gcp/) e a configuração não secreta em
[`infra/gcp/config.env`](../infra/gcp/config.env).

## O que existe

| Peça | Recurso | Por quê |
|---|---|---|
| Servidor | VM `nod-vm` (Compute Engine, `e2-medium`, Debian 12) com Docker: o container do nod e o Caddy | Uma instância com estado em memória, long-poll de até 35 s e SSE (ADR-001, ADR-017, ADR-021) descartam Cloud Run |
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
3. Copia `config.env`, `compose.yml`, `Caddyfile` e `deploy.sh` para `/opt/nod` na VM.
4. `deploy.sh` monta `/opt/nod/nod.env` a partir do Secret Manager, roda as migrações como
   `nod_dono` com a imagem nova e recria o container do nod. Espera o healthcheck (`/api/saude`).
   A saúde inclui o banco: `select 1` com prazo de 2 s, senão 503 (NOD-175).
   O env leva as duas URLs: `DATABASE_URL` (nod_app, das requisições) e `DATABASE_URL_DONO`, que o
   boot usa só para criar as partições de `events` (ADR-006) e fecha em seguida.

O deploy é recreate: o nod fica fora do ar alguns segundos. Os Macs reconectam sozinhos (o
long-poll recomeça). Desde a NOD-214, o turno que um Mac atualizado está rodando segue rodando no
deploy: a drenagem não o espera, e o processo novo o reconhece pelo token de turno (o hash fica em
`turno_credenciais`) quando a máquina renova ou entrega. Mac com app antigo ainda segura a drenagem
até 10 min (ADR-071). Um deploy manual: Actions → deploy → Run workflow.

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
sudo docker compose -f /opt/nod/compose.yml logs -f nod
# Seed (só com o banco sem pessoas): cria o dono com o e-mail do login Google
sudo bash -c 'cd /opt/nod && export NOD_DOMINIO=34-39-164-139.sslip.io \
  NOD_IMAGEM="$(docker ps --filter label=com.docker.compose.service=nod --format "{{.Image}}")" &&
  docker compose run --rm --no-deps -T -e NOD_SEED_EMAIL=voce@exemplo.com nod node scripts/seed.ts'
```

Restaurar o banco (PITR, plano B, segredos) e o ensaio de restauração: [runbook-producao.md](runbook-producao.md).

O monitor de disponibilidade fica fora da GCP (ADR-017): cadastre `https://<domínio>/api/saude`
num serviço externo (UptimeRobot, Better Stack). O passo a passo e o reinício automático pelo watchdog (NOD-267) estão
em [runbook-producao.md](runbook-producao.md#7-monitor-externo-e-reinício-automático).

Custo esperado, coberto pelos créditos do programa GFS: VM `e2-medium`, Cloud SQL `db-custom-1-3840`
com 10 GB SSD, IP fixo e tráfego baixo, mais as duas VMs de runner do CI (`e2-standard-4`, disco de 100 GB cada).
