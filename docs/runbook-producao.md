# Runbook de produção: restaurar o banco

O que fazer quando o banco de produção (`nod-pg`, Cloud SQL, projeto `nod-producao`) precisa voltar
a um estado anterior, e como provar de tempos em tempos que isso funciona (NOD-205). A montagem e o
deploy estão em [deploy-gcp.md](deploy-gcp.md).

Regra geral: **restaurar nunca sobrescreve a instância atual**. Toda restauração cria outra instância
(ou enche um banco vazio) e o nod passa a apontar para ela; a `nod-pg` antiga fica intacta até alguém
decidir apagá-la.

## 1. PITR e troca de SQL_IP (caminho principal)

O `nod-pg` tem backup diário e PITR de 7 dias. Para voltar a um instante dentro dessa janela:

```bash
# 1. Clone no instante (UTC). NÃO use o prefixo nod-pg-ensaio-: o ensaio apaga essas cópias.
gcloud sql instances clone nod-pg nod-pg-restaurada-AAAAMMDD \
  --point-in-time='2026-10-02T12:00:00Z' --project=nod-producao
# 2. IP privado da instância nova
gcloud sql instances describe nod-pg-restaurada-AAAAMMDD \
  --format='value(ipAddresses[0].ipAddress)' --project=nod-producao
```

3. Em [`infra/gcp/config.env`](../infra/gcp/config.env), troque `SQL_IP` pelo IP novo e
   `SQL_INSTANCIA` pelo nome novo. O `vm/deploy.sh` monta `DATABASE_URL` e `DATABASE_URL_DONO` a
   partir de `SQL_IP`.
4. Commit no `main` → o deploy leva o `config.env` para a VM e recria o container. Sem esperar o CI:
   Actions → deploy → Run workflow.
5. Confira `https://<domínio>/api/saude` (a saúde inclui o banco) e entre no nod.
6. Na instância nova, confira que a proteção contra exclusão e os backups com PITR estão ligados
   (`gcloud sql instances describe … --format='value(settings.deletionProtectionEnabled,settings.backupConfiguration)'`);
   se não estiverem, `gcloud sql instances patch … --deletion-protection --enable-point-in-time-recovery`.

O que se perde: tudo o que foi escrito no `nod-pg` depois do instante escolhido. Os usuários e as
senhas dos papéis (`nod_dono`, `nod_app`, `nod_poda`) vêm junto no clone, então os segredos não mudam.
O clone de 10 GB leva minutos; o tempo real fica registrado na tabela de ensaios abaixo.

## 2. Plano B: pg_dump e restaurar.sh

Quando o PITR não serve (instante fora dos 7 dias, ou instância perdida), restaure um dump no formato
custom (`pg_dump -Fc`) num banco **vazio**: o [`vm/restaurar.sh`](../infra/gcp/vm/restaurar.sh) recusa
banco com tabelas.

1. Banco vazio: uma instância nova (`SQL_INSTANCIA` e `SQL_IP` novos no `config.env`, criada pelo
   `provisionar.sh`) e depois `infra/gcp/preparar-banco.sh` (papéis, banco `nod`, extensões).
2. Leve o dump e rode na VM, como o [`levar-dados.sh`](../infra/gcp/levar-dados.sh) faz:

   ```bash
   gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao --command='mkdir -p ~/nod-tmp'
   gcloud compute scp infra/gcp/config.env infra/gcp/vm/restaurar.sh nod.dump nod-vm:~/nod-tmp/ \
     --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao
   gcloud compute ssh nod-vm --zone=southamerica-east1-b --tunnel-through-iap --project=nod-producao \
     --command='sudo bash ~/nod-tmp/restaurar.sh ~/nod-tmp/nod.dump; rm -rf ~/nod-tmp'
   ```

3. O `restaurar.sh` imprime migrações, pessoas e linhas no fim. Depois, deploy como no passo 4 da seção 1
   (o deploy aplica as migrações que faltarem por cima).

## 3. Segredos

Ficam no Secret Manager do `nod-producao`; o `vm/deploy.sh` os lê a cada deploy. Uma restauração não
mexe neles.

| Segredo | O que é |
|---|---|
| `nod-credential-key` | `NOD_CREDENTIAL_KEY`, chave do cofre de credenciais (ADR-015, ADR-031). Sem ela, as credenciais gravadas no banco não abrem: um banco restaurado só serve com a mesma chave |
| `nod-sessao-segredo` | Assinatura das sessões |
| `nod-google-client-id`, `nod-google-client-secret` | Cliente OAuth do login Google |
| `nod-pg-senha-postgres`, `nod-pg-senha-dono`, `nod-pg-senha-app` | Senhas dos papéis do banco |

Nunca imprima um segredo: passe por variável de ambiente (`-e PGPASSWORD`), nunca por `echo`.

## 4. Migração só de adição

Voltar o código não volta o banco. Por isso toda migração nova só adiciona (NOD-186): o código anterior
continua funcionando sobre o esquema novo, e um rollback de código não pede restauração. A regra é
travada por `npm run fence:migrations` (no `check` e no CI); as exceções e o `-- ROLLBACK:` estão no
[AGENTS.md](../AGENTS.md). Restaurar o banco é para perda ou estrago de dados, não para desfazer deploy.

## 5. Como rodar o ensaio

O ensaio prova que o PITR funciona: clona o `nod-pg` numa cópia `nod-pg-ensaio-<run_id>`, compara
produção e cópia na `nod-vm` e **sempre** apaga a cópia. Script em
[`infra/gcp/ensaiar-restauracao.sh`](../infra/gcp/ensaiar-restauracao.sh), workflow em
[`.github/workflows/ensaio-restauracao.yml`](../.github/workflows/ensaio-restauracao.yml).

Uma vez, por alguém com papel de dono do projeto:

1. `infra/gcp/provisionar.sh` (idempotente) cria a conta `nod-ensaio` e os papéis `nodEnsaioLeitura`
   (ler, clonar, criar) e `nodEnsaioApagar` (alterar e apagar só instâncias `nod-pg-ensaio-*`, por
   condição IAM). A conta de deploy continua sem poder apagar instância.
2. No GitHub, a variável de repositório `GCP_ENSAIO_SA` recebe o e-mail impresso no fim.

A cada ensaio: Actions → **ensaio-restauracao** → Run workflow, **na branch `main`** (o WIF só aceita
`main`). O campo `instante` é opcional (ISO em UTC, ex. `2026-10-09T12:00:00Z`); vazio restaura o
estado mais recente.

O que o ensaio confere, e falha se não bater:

- a lista de `schema_migrations` (quantidade e md5 dos nomes em ordem);
- a contagem de `pessoas` (por `count(*)` como `nod_dono`; se a RLS esconder as linhas, por
  `n_live_tup`, e o resumo diz qual método foi usado);
- o número de tabelas em `public`.

Produção com zero em qualquer um desses falha: comparação vazia não conta. O total de linhas
(`pg_stat_user_tables`, depois de `analyze`) é só informativo, porque a produção segue recebendo
escritas durante o clone. O resultado sai no resumo do run.

Para ver o roteiro sem tocar na GCP: `infra/gcp/ensaiar-restauracao.sh --simular`. Se um run morrer
antes de apagar a cópia: `infra/gcp/ensaiar-restauracao.sh apagar --copia nod-pg-ensaio-<run_id>`
(recusa qualquer nome fora do prefixo).

Faça um ensaio no lançamento e depois a cada mudança relevante de infraestrutura.

## 6. Ensaios realizados

Preencha uma linha por ensaio com os números do resumo do run.

| Data | Instante | Duração do clone | Migrações | Pessoas | Tabelas | Linhas | Bateu | Run |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Rollback de código: definido na NOD-173
